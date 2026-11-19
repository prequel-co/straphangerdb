import type { Map as MapLibreMap } from 'maplibre-gl';
import maplibregl from 'maplibre-gl';
import {
  resolveRouteColor,
  buildRouteBulletHtml,
  formatRouteBadge,
  resolveCommuterOrBusRouteSpec,
} from '../echarts-theme-mta.js';
import { store } from '../../state/store.js';
import { interpolateTrainPosition, interpolateTrainPositions, type TrackPoint } from './track-interpolator.js';
import {
  resolveStationInfo,
  hydrateStationCache,
  ensureMtaSubwayOverlay,
  interpolateAlongServiceLine,
  advanceAlongServiceLine,
  projectStationOntoServiceLine,
  snapPointToSubwayTrack,
  cleanStationLabelText,
  getActiveAuxiliaryCorridors,
  type MapVisualThemeId,
} from '../map/mta-subway-overlay.js';

export { interpolateTrainPosition, interpolateTrainPositions, type TrackPoint };

export interface TrainPosition {
  tripId: string;
  vehicleId: string;
  routeId: string;
  agencyId: string;
  lat: number;
  lon: number;
  bearing: number;
  speedMph: number;
  eventTime: number;
  stationId: string;
  stationName: string;
  status: string;
  colorHex?: string;
}

/**
 * Safely parses any DuckDB / Arrow timestamp value into numeric epoch seconds.
 * Handles epoch seconds, epoch milliseconds (> 1e11), Date objects, and ISO-8601 strings.
 */
export function parseEventEpochSec(raw: unknown): number {
  const normalizeNumericEpoch = (val: number): number => {
    if (isNaN(val) || !isFinite(val) || val <= 0) return 0;
    if (val > 1e17) return val / 1e9; // nanoseconds
    if (val > 1e14) return val / 1e6; // microseconds
    if (val > 1e11) return val / 1e3; // milliseconds
    return val; // seconds
  };

  if (typeof raw === 'number') {
    return normalizeNumericEpoch(raw);
  }
  if (typeof raw === 'bigint') {
    return normalizeNumericEpoch(Number(raw));
  }
  if (raw instanceof Date) {
    const t = raw.getTime();
    return isNaN(t) ? 0 : t / 1000;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return 0;
    const asNum = Number(trimmed);
    if (!isNaN(asNum)) {
      return normalizeNumericEpoch(asNum);
    }
    const parsed = Date.parse(trimmed);
    if (!isNaN(parsed)) {
      return parsed / 1000;
    }
  }
  return 0;
}

/**
 * Formats epoch seconds to EDT/EST time string (America/New_York).
 */
export function formatEdtTime(epochSec: number): string {
  if (!epochSec || epochSec <= 0) return 'Live';
  const d = new Date(epochSec * 1000);
  return d.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function getEasternTzAbbr(epochSec: number): string {
  try {
    const d = epochSec && epochSec > 0 ? new Date(epochSec * 1000) : new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      timeZoneName: 'short',
    }).formatToParts(d);
    const tz = parts.find((p) => p.type === 'timeZoneName')?.value;
    if (tz === 'EST' || tz === 'EDT') return tz;
  } catch {
    // Fallback below
  }
  return 'ET';
}

function isSubwayLikeAgency(agencyId: string): boolean {
  const clean = (agencyId || 'MTA_NYCT_SUBWAY').trim().toUpperCase();
  return clean === 'MTA_NYCT_SUBWAY' || clean === 'MTA_NYCT_SIR' || clean === 'MTA_SIR' || clean === '';
}

export function inferCommuterBranchFromCoords(
  agencyId: string,
  lon: number,
  lat: number
): string {
  const rawUpper = agencyId.trim().toUpperCase();
  const agUpper =
    rawUpper === 'PATH' || rawUpper === 'PA_PATH' ? 'PORT_AUTHORITY_PATH' : rawUpper;
  const candidates = getActiveAuxiliaryCorridors().filter(c => c.agencyId === agUpper);
  if (candidates.length === 0) {
    return agUpper === 'MTA_METRO_NORTH'
      ? 'HUD'
      : agUpper === 'PORT_AUTHORITY_PATH'
        ? 'NWK'
        : 'BAB';
  }
  let bestBadge = candidates[0]!.badge;
  let bestDistSq = Infinity;
  for (const spec of candidates) {
    for (const chain of spec.chains) {
      for (let i = 0; i < chain.length - 1; i++) {
        const [x1, y1] = chain[i]!;
        const [x2, y2] = chain[i + 1]!;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;
        const t = lenSq > 1e-12 ? Math.max(0, Math.min(1, ((lon - x1) * dx + (lat - y1) * dy) / lenSq)) : 0;
        const px = x1 + t * dx;
        const py = y1 + t * dy;
        const dSq = (lon - px) * (lon - px) + (lat - py) * (lat - py);
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestBadge = spec.badge;
        }
      }
    }
  }
  return bestBadge;
}

/**
 * Builds GeoJSON points and calculates active route counts at a given targetTime.
 * If targetTime is omitted, selects the latest observation for each vehicle and positions
 * in-transit trains along their active inter-station service line segment.
 */
export function buildTrainFeatures(
  vehicleGroups: Map<
    string,
    {
      routeId: string;
      agencyId: string;
      colorHex?: string;
      positions: TrainPosition[];
    }
  >,
  targetTime?: number,
  windowBounds?: { minEpoch: number; maxEpoch: number }
): { geojson: GeoJSON.FeatureCollection; routeCounts: Map<string, number> } {
  const features: GeoJSON.Feature[] = [];
  const routeCounts = new Map<string, number>();
  const coordCounts = new Map<string, number>();
  const cleanStopId = (id: string) => id.trim().replace(/[NS]$/, '');

  for (const group of vehicleGroups.values()) {
    group.positions.sort((a, b) => a.eventTime - b.eventTime);
    const rawPts = group.positions;
    if (rawPts.length === 0) continue;

    const agencyId = (group.agencyId || rawPts[rawPts.length - 1]!.agencyId || 'MTA_NYCT_SUBWAY').trim();
    const isSubwayAgency = isSubwayLikeAgency(agencyId);
    const rawRouteId = group.routeId || rawPts[rawPts.length - 1]!.routeId;
    const latestObs = rawPts[rawPts.length - 1]!;
    const routeId =
      !isSubwayAgency && (!rawRouteId || rawRouteId.toUpperCase() === 'UNKNOWN')
        ? inferCommuterBranchFromCoords(agencyId, latestObs.lon, latestObs.lat)
        : rawRouteId;
    const trackRouteKey = isSubwayAgency ? routeId : routeId ? `${agencyId}:${routeId}` : agencyId;
    const trackSnapRadius = isSubwayAgency
      ? 0.0045
      : agencyId.toUpperCase() === 'MTA_BUS'
        ? 0.0025
        : 0.012;

    // 1. Deduplicate observations with identical timestamps, collapse consecutive subway pings at the same
    // station ID (preventing GPS vs station-centroid jitter micro-segments at stops like Myrtle Av M11N),
    // and remove single-poll retrograde station ping oscillations (A -> B -> A within 240s).
    const dedupedPts: TrainPosition[] = [];
    for (const p of rawPts) {
      if (dedupedPts.length === 0) {
        dedupedPts.push(p);
      } else {
        const prev = dedupedPts[dedupedPts.length - 1]!;
        const pStop = isSubwayAgency ? cleanStopId(p.stationId) : p.stationId.trim();
        const prevStop = isSubwayAgency ? cleanStopId(prev.stationId) : prev.stationId.trim();
        const movedDist = Math.hypot(p.lon - prev.lon, p.lat - prev.lat);

        if (p.eventTime === prev.eventTime) {
          dedupedPts[dedupedPts.length - 1] = p;
        } else if (isSubwayAgency && pStop !== '' && pStop === prevStop) {
          const stInfo = resolveStationInfo(pStop, agencyId);
          const mergedStatus =
            p.status === 'STOPPED_AT' || prev.status === 'STOPPED_AT' ? 'STOPPED_AT' : p.status;
          dedupedPts[dedupedPts.length - 1] = {
            ...p,
            lat: stInfo?.lat ?? prev.lat,
            lon: stInfo?.lon ?? prev.lon,
            status: mergedStatus,
            speedMph: mergedStatus === 'STOPPED_AT' ? 0 : p.speedMph || prev.speedMph,
          };
        } else if (!isSubwayAgency && movedDist <= 1e-5) {
          const mergedStatus =
            p.status === 'STOPPED_AT' || prev.status === 'STOPPED_AT' ? 'STOPPED_AT' : p.status;
          dedupedPts[dedupedPts.length - 1] = {
            ...p,
            status: mergedStatus,
            speedMph: mergedStatus === 'STOPPED_AT' ? 0 : p.speedMph || prev.speedMph,
          };
        } else if (movedDist > 1e-5) {
          if (dedupedPts.length >= 2) {
            const prev2 = dedupedPts[dedupedPts.length - 2]!;
            const prev2Stop = isSubwayAgency ? cleanStopId(prev2.stationId) : prev2.stationId.trim();
            const sameAsPrev2 =
              Math.hypot(p.lon - prev2.lon, p.lat - prev2.lat) < 1e-4 ||
              Boolean(isSubwayAgency && pStop && prev2Stop && pStop === prev2Stop);
            if (sameAsPrev2 && p.eventTime - prev2.eventTime <= 240) {
              // Collapse single-poll retrograde bounce (A -> B -> A)
              dedupedPts[dedupedPts.length - 1] = p;
              continue;
            }
          }
          dedupedPts.push(p);
        }
      }
    }

    // 1b. De-collide interleaved multi-train `trip_id` observations and cross-borough terminal reassignments
    // by walking backward from the latest observation and keeping only kinematically reachable points.
    let coherentPts = dedupedPts;
    if (dedupedPts.length >= 2) {
      const latestPt = dedupedPts[dedupedPts.length - 1]!;
      const acceptedRev: TrainPosition[] = [latestPt];
      for (let i = dedupedPts.length - 2; i >= 0; i--) {
        const cand = dedupedPts[i]!;
        const anchor = acceptedRev[acceptedRev.length - 1]!;
        const dt = Math.max(1, anchor.eventTime - cand.eventTime);
        const dist = Math.hypot(anchor.lon - cand.lon, anchor.lat - cand.lat);
        const candDirMatch = /[NS]$/.exec(cand.stationId.trim());
        const anchorDirMatch = /[NS]$/.exec(anchor.stationId.trim());
        if (
          candDirMatch &&
          anchorDirMatch &&
          candDirMatch[0] !== anchorDirMatch[0] &&
          dist > 0.006
        ) {
          continue;
        }
        const maxKinematicDist = Math.max(0.042, dt * 0.00042);
        if (dist > maxKinematicDist) {
          continue;
        }
        acceptedRev.push(cand);
      }
      coherentPts = acceptedRev.reverse();
    }

    // 2. Filter out any intermediate retrograde steps along the route's service line arc-length
    // so the trajectory moves strictly monotonically in the trip's travel direction.
    let pts = coherentPts;
    if (coherentPts.length >= 3 && trackRouteKey) {
      const lastSample = coherentPts[coherentPts.length - 1]!;
      const refSnap = snapPointToSubwayTrack(
        trackRouteKey,
        lastSample.lon,
        lastSample.lat,
        undefined,
        trackSnapRadius
      );
      const projRoute = refSnap?.matchedRouteId || trackRouteKey;
      const projs = coherentPts.map((pt) => projectStationOntoServiceLine(projRoute, pt.lon, pt.lat));
      const firstProj = projs[0];
      const lastProj = projs[projs.length - 1];
      if (
        firstProj &&
        lastProj &&
        firstProj.chainIndex === lastProj.chainIndex &&
        Math.abs(lastProj.arcLen - firstProj.arcLen) > 0.0005
      ) {
        const dirSign = Math.sign(lastProj.arcLen - firstProj.arcLen);
        const monotonicPts: TrainPosition[] = [coherentPts[0]!];
        let lastArc = firstProj.arcLen;
        for (let i = 1; i < coherentPts.length - 1; i++) {
          const pr = projs[i];
          if (
            pr &&
            pr.chainIndex === firstProj.chainIndex &&
            (pr.arcLen - lastArc) * dirSign < -0.0001
          ) {
            // Skip transient backward arc-length step
            continue;
          }
          if (pr && pr.chainIndex === firstProj.chainIndex) {
            lastArc = pr.arcLen;
          }
          monotonicPts.push(coherentPts[i]!);
        }
        monotonicPts.push(coherentPts[coherentPts.length - 1]!);
        pts = monotonicPts;
      }
    }

    let targetLon: number;
    let targetLat: number;
    let targetBearing = 0;
    let activePoint: TrainPosition;

    if (targetTime !== undefined) {
      const firstPt = pts[0]!;
      const lastPt = pts[pts.length - 1]!;
      const tripSpan = lastPt.eventTime - firstPt.eventTime;

      if (pts.length > 1 && firstPt.eventTime > 0 && tripSpan > 0) {
        // When windowBounds is provided, map window progress monotonically onto [firstPt.eventTime, lastPt.eventTime]
        // so trains never wrap or jump mid-window when their first/last poll is slightly inside the window bounds.
        let effectiveTime: number;
        if (windowBounds && windowBounds.maxEpoch > windowBounds.minEpoch) {
          const winSpan = windowBounds.maxEpoch - windowBounds.minEpoch;
          let progress: number;
          if (targetTime >= windowBounds.minEpoch && targetTime <= windowBounds.maxEpoch) {
            progress = (targetTime - windowBounds.minEpoch) / winSpan;
          } else {
            const rawOffset = (((targetTime - windowBounds.minEpoch) % winSpan) + winSpan) % winSpan;
            progress = rawOffset / winSpan;
          }
          progress = Math.max(0, Math.min(1, progress));
          effectiveTime = firstPt.eventTime + progress * tripSpan;
        } else if (targetTime >= firstPt.eventTime && targetTime <= lastPt.eventTime) {
          effectiveTime = targetTime;
        } else {
          effectiveTime =
            firstPt.eventTime + (((targetTime - firstPt.eventTime) % tripSpan + tripSpan) % tripSpan);
        }

        let p1 = pts[pts.length - 2]!;
        let p2 = pts[pts.length - 1]!;
        if (effectiveTime <= firstPt.eventTime) {
          p1 = pts[0]!;
          p2 = pts[1]!;
        } else {
          for (let i = 0; i < pts.length - 1; i++) {
            if (pts[i]!.eventTime <= effectiveTime && effectiveTime <= pts[i + 1]!.eventTime) {
              p1 = pts[i]!;
              p2 = pts[i + 1]!;
              break;
            }
          }
        }
        const span = p2.eventTime - p1.eventTime;
        const ratio = span > 0 ? Math.max(0, Math.min(1, (effectiveTime - p1.eventTime) / span)) : 0;
        const curved = interpolateAlongServiceLine(
          trackRouteKey,
          p1.lon,
          p1.lat,
          p2.lon,
          p2.lat,
          ratio
        );
        targetLon = curved.lon;
        targetLat = curved.lat;
        targetBearing = curved.bearing || p1.bearing || p2.bearing;

        const isAtStartStop = ratio <= 0.04 && p1.status === 'STOPPED_AT';
        const isAtEndStop = ratio >= 0.96 && p2.status === 'STOPPED_AT';
        const refPt = ratio <= 0.04 ? p1 : p2;
        const interpStatus =
          isAtStartStop || isAtEndStop
            ? 'STOPPED_AT'
            : ratio >= 0.85
              ? p2.status === 'STOPPED_AT'
                ? 'INCOMING_AT'
                : p2.status
              : 'IN_TRANSIT_TO';
        const interpSpeed =
          interpStatus === 'STOPPED_AT'
            ? 0
            : p2.speedMph > 0
              ? p2.speedMph
              : p1.speedMph > 0
                ? p1.speedMph
                : 18.5;
        activePoint = {
          ...refPt,
          status: interpStatus,
          speedMph: interpSpeed,
          stationName: cleanStationLabelText(refPt.stationName),
        };
      } else {
        // Single-point trajectory: advance along the route's curved MTA service line in the train's travel direction
        activePoint = {
          ...lastPt,
          stationName: cleanStationLabelText(lastPt.stationName),
          speedMph: lastPt.status === 'STOPPED_AT' ? 0 : lastPt.speedMph,
        };
        const dirSign = activePoint.stationId.endsWith('S') ? -1 : 1;
        const winSpan =
          windowBounds && windowBounds.maxEpoch > windowBounds.minEpoch
            ? windowBounds.maxEpoch - windowBounds.minEpoch
            : 600;
        const winStart =
          windowBounds && windowBounds.maxEpoch > windowBounds.minEpoch
            ? windowBounds.minEpoch
            : Math.max(0, (activePoint.eventTime || targetTime) - 600);
        const progress =
          winSpan > 0
            ? ((((targetTime - winStart) % winSpan) + winSpan) % winSpan) / winSpan
            : 0.5;
        const singleSpanDeg = activePoint.status === 'STOPPED_AT' ? 0.0065 : 0.012;
        const moved = advanceAlongServiceLine(
          trackRouteKey,
          activePoint.lon,
          activePoint.lat,
          singleSpanDeg * dirSign,
          progress
        );
        targetLon = moved.lon;
        targetLat = moved.lat;
        targetBearing = moved.bearing || activePoint.bearing;
      }
    } else {
      // Live mode: pick latest observation per train, and if in transit between two observed stops,
      // place the train along the curved service line between its previous and upcoming station.
      const rawActive = pts[pts.length - 1]!;
      activePoint = {
        ...rawActive,
        stationName: cleanStationLabelText(rawActive.stationName),
        speedMph: rawActive.status === 'STOPPED_AT' ? 0 : rawActive.speedMph,
      };
      if (pts.length >= 2) {
        const prevPt = pts[pts.length - 2]!;
        const liveRatio =
          activePoint.status === 'IN_TRANSIT_TO'
            ? 0.58
            : activePoint.status === 'INCOMING_AT'
              ? 0.85
              : 1.0;
        const curved = interpolateAlongServiceLine(
          trackRouteKey,
          prevPt.lon,
          prevPt.lat,
          activePoint.lon,
          activePoint.lat,
          liveRatio
        );
        targetLon = curved.lon;
        targetLat = curved.lat;
        targetBearing = activePoint.bearing || curved.bearing;
      } else if (activePoint.status === 'IN_TRANSIT_TO' || activePoint.status === 'INCOMING_AT') {
        const dirSign = activePoint.stationId.endsWith('S') ? -1 : 1;
        const moved = advanceAlongServiceLine(
          trackRouteKey,
          activePoint.lon,
          activePoint.lat,
          0.0025 * dirSign,
          0.5
        );
        targetLon = moved.lon;
        targetLat = moved.lat;
        targetBearing = activePoint.bearing || moved.bearing;
      } else {
        targetLon = activePoint.lon;
        targetLat = activePoint.lat;
        targetBearing = activePoint.bearing;
      }
    }

    // Ensure every rail / corridor marker whose trajectory sits on a defined service line snaps cleanly onto its corridor
    const firstTrajectoryPt = pts[0]!;
    if (
      snapPointToSubwayTrack(
        trackRouteKey,
        firstTrajectoryPt.lon,
        firstTrajectoryPt.lat,
        undefined,
        trackSnapRadius
      ) &&
      snapPointToSubwayTrack(
        trackRouteKey,
        activePoint.lon,
        activePoint.lat,
        undefined,
        trackSnapRadius
      )
    ) {
      const trackSnap = snapPointToSubwayTrack(
        trackRouteKey,
        targetLon,
        targetLat,
        undefined,
        trackSnapRadius
      );
      if (trackSnap) {
        targetLon = trackSnap.lon;
        targetLat = trackSnap.lat;
        if (!targetBearing && trackSnap.bearing) {
          targetBearing = trackSnap.bearing;
        }
      }
    }

    // Prevent multiple trains at the exact same station/coordinate in static mode from stacking invisibly
    if (targetTime === undefined) {
      const coordKey = `${Math.round(targetLon * 2000)}:${Math.round(targetLat * 2000)}`;
      const seenAtCoord = coordCounts.get(coordKey) ?? 0;
      coordCounts.set(coordKey, seenAtCoord + 1);
      if (seenAtCoord > 0) {
        const angle = seenAtCoord * 2.39996; // Golden angle radial fan-out
        const radius = 0.00045 * Math.ceil(seenAtCoord / 2);
        targetLon += Math.cos(angle) * radius;
        targetLat += Math.sin(angle) * radius;
      }
    }

    const customHex = group.colorHex ?? activePoint.colorHex;
    const defaultColor = resolveRouteColor(routeId, agencyId);
    const color = resolveRouteColor(routeId, agencyId, customHex);
    const isDiamond =
      isSubwayAgency &&
      (routeId.endsWith('X') || (routeId.startsWith('<') && routeId.endsWith('>')));
    let displayLabel: string;
    if (isSubwayAgency) {
      const rawLabel = routeId.replace(/^<|>$/g, '').replace(/X$/i, '').trim();
      displayLabel =
        rawLabel === 'GS' || rawLabel === 'FS' || rawLabel === 'H'
          ? 'S'
          : rawLabel === 'SI'
            ? 'SIR'
            : rawLabel;
    } else {
      displayLabel = formatRouteBadge(routeId, agencyId).displayLabel;
    }
    const baseIconId = isDiamond ? `diamond-${displayLabel}` : `bullet-${displayLabel}`;
    const cleanHex = color.replace(/[^0-9A-Za-z]/g, '');
    const iconId = !isSubwayAgency
      ? `${baseIconId}-${cleanHex}`
      : customHex && color !== defaultColor
        ? `${baseIconId}-${cleanHex}`
        : baseIconId;
    const filterKey = isSubwayAgency ? routeId : `${agencyId}:${displayLabel}`;

    if (routeId) {
      routeCounts.set(filterKey, (routeCounts.get(filterKey) ?? 0) + 1);
    }

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [targetLon, targetLat],
      },
      properties: {
        vehicleId: activePoint.vehicleId,
        tripId: activePoint.tripId,
        routeId,
        agencyId,
        filterKey,
        displayLabel,
        badge: displayLabel,
        isDiamond,
        iconId,
        color,
        bearing: targetBearing,
        speedMph: Math.round(activePoint.speedMph * 10) / 10,
        eventTime: activePoint.eventTime,
        stationId: activePoint.stationId,
        stationName: activePoint.stationName,
        status: activePoint.status,
      },
    });
  }

  return {
    geojson: {
      type: 'FeatureCollection',
      features,
    },
    routeCounts,
  };
}

export function buildTrainPopupHtml(p: Record<string, any>, isPinned = false): string {
  const routeId = String(p['routeId'] ?? '');
  const agencyId = String(p['agencyId'] ?? 'MTA_NYCT_SUBWAY');
  const tripId = String(p['tripId'] ?? '');
  const status = String(p['status'] ?? 'IN_TRANSIT_TO');
  const stationName = cleanStationLabelText(String(p['stationName'] ?? ''));
  const stationId = String(p['stationId'] ?? '');
  const speedMph = Number(p['speedMph'] ?? 0);
  const eventTime = Number(p['eventTime'] ?? 0);
  const color = String(p['color'] ?? '');

  const bulletHtml = buildRouteBulletHtml(routeId, agencyId, color || null, 24);
  const commuterOrBusSpec = resolveCommuterOrBusRouteSpec(routeId, agencyId);
  const agUpper = agencyId.toUpperCase();
  const isBus = agUpper === 'MTA_BUS';
  const isPath = agUpper === 'PORT_AUTHORITY_PATH' || agUpper === 'PATH' || agUpper === 'PA_PATH';
  const routeTitle = commuterOrBusSpec
    ? agUpper === 'MTA_METRO_NORTH'
      ? `Metro-North ${commuterOrBusSpec.label}`
      : agUpper === 'MTA_LIRR'
        ? `LIRR ${commuterOrBusSpec.label}`
        : isPath
          ? `PATH ${commuterOrBusSpec.label}`
          : commuterOrBusSpec.label
    : isBus
      ? `Bus ${routeId}`
      : isPath
        ? `PATH ${routeId}`
        : `Train ${routeId}`;
  const stopFieldLabel = isBus ? 'Stop' : 'Station';
  const pinHintNoun = isBus ? 'bus' : 'train';

  const timeString =
    eventTime > 0
      ? new Date(eventTime * 1000).toLocaleTimeString('en-US', {
          timeZone: 'America/New_York',
          hour: 'numeric',
          minute: '2-digit',
          second: '2-digit',
        })
      : 'Live observation';

  const stationCopyValue = stationId ? `${stationName} (${stationId})` : stationName;
  const stationRow = stationName
    ? `<div class="dbtc-popup-copyable" data-copy-text="${stationCopyValue.replace(/"/g, '&quot;')}" title="Click to copy ${stopFieldLabel.toLowerCase()}" style="margin-bottom:3px;cursor:pointer;padding:1px 3px;margin-left:-3px;border-radius:4px;"><strong>${stopFieldLabel}:</strong> ${stationName}${stationId ? ` <span style="color:#64748B;font-size:11px;">(${stationId})</span>` : ''}</div>`
    : '';
  const speedText = `${speedMph} mph`;
  const speedRow = `<div class="dbtc-popup-copyable" data-copy-text="${speedText}" title="Click to copy speed" style="margin-bottom:3px;cursor:pointer;padding:1px 3px;margin-left:-3px;border-radius:4px;"><strong>Speed:</strong> <span style="font-variant-numeric:tabular-nums;">${speedText}</span></div>`;

  const footerRow = isPinned
    ? `<div style="font-size:10px;color:#0F172A;font-weight:600;margin-top:6px;border-top:1px solid #E2E8F0;padding-top:4px;display:flex;align-items:center;justify-content:space-between;gap:8px;">
         <span>Pinned (click any text to copy)</span>
         <span class="dbtc-copy-toast" style="color:#00933C;font-weight:700;"></span>
       </div>`
    : `<div style="font-size:10px;color:#64748B;margin-top:5px;border-top:1px solid #F1F5F9;padding-top:4px;">
         Click ${pinHintNoun} to pin modal &amp; pause
       </div>`;

  const tzAbbr = getEasternTzAbbr(eventTime);
  const observedText =
    eventTime > 0 ? `Observed at ${timeString} ${tzAbbr}` : 'Observed live';

  return `
    <div class="dbtc-train-popup-card" style="font-family:'Inter',-apple-system,sans-serif;line-height:1.45;min-width:190px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        ${bulletHtml}
        <div>
          <div class="dbtc-popup-copyable" data-copy-text="${routeTitle.replace(/"/g, '&quot;')}" title="Click to copy route" style="font-weight:800;font-size:13px;color:#0F172A;cursor:pointer;padding:0 3px;margin-left:-3px;border-radius:4px;">${routeTitle}</div>
          <div class="dbtc-popup-copyable" data-copy-text="${tripId}" title="Click to copy trip ID" style="font-size:11px;color:#64748B;cursor:pointer;padding:0 3px;margin-left:-3px;border-radius:4px;">Trip ${tripId}</div>
        </div>
      </div>
      <div class="dbtc-popup-copyable" data-copy-text="${status}" title="Click to copy status" style="margin-bottom:3px;cursor:pointer;padding:1px 3px;margin-left:-3px;border-radius:4px;"><strong>Status:</strong> ${status}</div>
      ${stationRow}
      ${speedRow}
      <div class="dbtc-popup-copyable" data-copy-text="${observedText}" title="Click to copy timestamp" style="font-size:11px;color:#64748B;margin-top:4px;cursor:pointer;padding:1px 3px;margin-left:-3px;border-radius:4px;">
        ${observedText}
      </div>
      ${footerRow}
    </div>
  `;
}

export function attachPopupCopyHandlers(rootEl: HTMLElement | null): void {
  if (!rootEl) return;
  const copyables = rootEl.querySelectorAll('.dbtc-popup-copyable');
  const toast = rootEl.querySelector('.dbtc-copy-toast') as HTMLElement | null;
  copyables.forEach((node) => {
    const el = node as HTMLElement;
    if (el.dataset['copyBound'] === '1') return;
    el.dataset['copyBound'] = '1';
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const text = el.getAttribute('data-copy-text') || el.textContent?.trim() || '';
      if (!text) return;
      rootEl.dataset['lastCopiedText'] = text;
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).catch(() => {});
      } else if (typeof document !== 'undefined') {
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand?.('copy');
          ta.remove();
        } catch {
          // Ignore fallback copy errors
        }
      }
      el.style.backgroundColor = 'rgba(0, 147, 60, 0.12)';
      if (toast) {
        toast.textContent = `Copied: ${text.length > 18 ? text.slice(0, 18) + '...' : text}`;
      }
      setTimeout(() => {
        el.style.backgroundColor = '';
        if (toast) toast.textContent = '';
      }, 1400);
    });
  });
}

export interface RenderTrainPositionsOptions {
  onRefreshLive?: (opts?: { forceQuery?: boolean }) => void | boolean | Promise<void | boolean>;
  livePollIntervalMs?: number;
  liveModeAllowed?: boolean;
  theme?: MapVisualThemeId;
  hideSubwayOverlay?: boolean;
  corridorOverlay?: string;
}

export function renderTrainPositions(
  map: MapLibreMap,
  rows: readonly Record<string, unknown>[],
  targetTime?: number,
  options?: RenderTrainPositionsOptions
): void {
  hydrateStationCache(rows);

  // 1. Ensure authentic MTA base subway network, commuter rail corridors, geographic tiles, or M60 corridor overlay.
  ensureMtaSubwayOverlay(map, {
    baseTrunkOpacity: 0.72,
    showStationStops: true,
    showTransferCapsules: true,
    showTerminalBullets: false,
    ...(options?.theme ? { theme: options.theme } : {}),
    ...(options?.hideSubwayOverlay !== undefined ? { hideSubwayOverlay: options.hideSubwayOverlay } : {}),
    ...(options?.corridorOverlay ? { corridorOverlay: options.corridorOverlay } : {}),
  });

  // Group observations by vehicle/trip to deduplicate historical breadcrumbs
  const vehicleGroups = new Map<
    string,
    {
      routeId: string;
      agencyId: string;
      colorHex?: string;
      positions: TrainPosition[];
    }
  >();

  let minEpoch = Infinity;
  let maxEpoch = -Infinity;

  for (const r of rows) {
    const vehicleId = String(r['vehicle_id'] ?? r['trip_id'] ?? 'unknown').trim();
    const tripId = String(r['trip_id'] ?? vehicleId).trim();
    const routeId = String(r['route_id'] ?? '').trim();
    const agencyId = String(r['agency_id'] ?? 'MTA_NYCT_SUBWAY').trim();
    const rowColorHex =
      typeof r['color_hex'] === 'string' && r['color_hex']
        ? r['color_hex']
        : typeof r['colorHex'] === 'string' && r['colorHex']
          ? r['colorHex']
          : undefined;
    let bearing = Number(r['bearing'] ?? 0);
    const speedVal = Number(r['speed'] ?? r['speed_mph'] ?? 0);
    const speedMph = speedVal > 0 ? speedVal : 0;
    const eventTime = parseEventEpochSec(r['timestamp'] ?? r['event_time'] ?? r['recorded_at'] ?? 0);
    const stationId = String(r['station_id'] ?? r['stop_id'] ?? '').trim();
    const status = String(r['current_status'] ?? r['status'] ?? 'IN_TRANSIT_TO').trim();

    let lat = Number(r['latitude'] ?? r['lat'] ?? 0);
    let lon = Number(r['longitude'] ?? r['lon'] ?? 0);
    let stationName = cleanStationLabelText(String(r['station_name'] ?? ''));

    // Fallback: Resolve agency-scoped station coordinates if lat/lon is 0 or NaN but station_id is present
    if ((lat === 0 || lon === 0 || isNaN(lat) || isNaN(lon)) && stationId) {
      const stInfo = resolveStationInfo(stationId, agencyId);
      if (stInfo) {
        lat = stInfo.lat;
        lon = stInfo.lon;
        if (!stationName) stationName = stInfo.name;
      }
    }

    // Infer bearing from 'N' vs 'S' directional subway platform suffix if bearing is 0
    if (isSubwayLikeAgency(agencyId) && bearing === 0 && stationId) {
      if (stationId.endsWith('N')) bearing = 30; // Northbound / Uptown
      else if (stationId.endsWith('S')) bearing = 210; // Southbound / Downtown
    }

    if (lat === 0 || lon === 0 || isNaN(lat) || isNaN(lon)) continue;

    if (eventTime > 0) {
      if (eventTime < minEpoch) minEpoch = eventTime;
      if (eventTime > maxEpoch) maxEpoch = eventTime;
    }

    const trainPos: TrainPosition = {
      tripId,
      vehicleId,
      routeId,
      agencyId,
      lat,
      lon,
      bearing,
      speedMph,
      eventTime,
      stationId,
      stationName,
      status,
      ...(rowColorHex ? { colorHex: rowColorHex } : {}),
    };

    const vehicleKey = `${agencyId}:${vehicleId || tripId}`;
    let group = vehicleGroups.get(vehicleKey);
    if (!group) {
      group = {
        routeId,
        agencyId,
        ...(rowColorHex ? { colorHex: rowColorHex } : {}),
        positions: [],
      };
      vehicleGroups.set(vehicleKey, group);
    } else if (rowColorHex && !group.colorHex) {
      group.colorHex = rowColorHex;
    }
    group.positions.push(trainPos);
  }

  if (minEpoch === Infinity) {
    const nowSec = Math.floor(Date.now() / 1000);
    minEpoch = nowSec - 900;
    maxEpoch = nowSec;
  } else if (maxEpoch - minEpoch < 300) {
    minEpoch = maxEpoch - 600;
  }
  const windowBounds = { minEpoch, maxEpoch };

  function ensureTrainSprite(
    map: MapLibreMap,
    _routeId: string,
    isDiamond: boolean,
    displayLabel: string,
    color: string,
    explicitIconId?: string
  ): void {
    const iconId = explicitIconId || (isDiamond ? `diamond-${displayLabel}` : `bullet-${displayLabel}`);
    if (map.hasImage(iconId)) return;

    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 48;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, 48, 48);
    ctx.scale(1.5, 1.5);

    if (isDiamond) {
      ctx.beginPath();
      ctx.moveTo(16, 2);
      ctx.lineTo(30, 16);
      ctx.lineTo(16, 30);
      ctx.lineTo(2, 16);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#FFFFFF';
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(16, 16, 14, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#FFFFFF';
      ctx.stroke();
    }

    const textColor = ['#FCCC0A', '#E6B800', '#F9A51A'].includes(color.toUpperCase())
      ? '#000000'
      : '#FFFFFF';
    ctx.fillStyle = textColor;
    const fontSize = displayLabel.length >= 3 ? 11 : displayLabel.length === 2 ? 13 : 15;
    ctx.font = `bold ${fontSize}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(displayLabel, 16, 16.5);

    const imgData = ctx.getImageData(0, 0, 48, 48);
    map.addImage(iconId, imgData, { pixelRatio: 2 });
  }

  const container = map.getContainer();
  const mapAny = map as any;
  const liveModeAllowed = options?.liveModeAllowed ?? store.notebook.mode === 'standard';
  if (!liveModeAllowed) {
    mapAny._liveSyncPinned = false;
    if (container?.dataset) {
      delete container.dataset['liveSyncPinned'];
    }
  } else if (container?.dataset?.['liveSyncPinned'] === 'true') {
    mapAny._liveSyncPinned = true;
  }
  const isPinnedToLiveEdge =
    liveModeAllowed &&
    (Boolean(mapAny._liveSyncPinned) || container?.dataset?.['liveSyncPinned'] === 'true');
  const isMountedBrowser =
    targetTime === undefined && typeof window !== 'undefined' && Boolean(container?.isConnected);
  const preservedTime =
    typeof mapAny._currentTimelapseTime === 'number' && Number.isFinite(mapAny._currentTimelapseTime)
      ? Math.min(maxEpoch, Math.max(minEpoch, mapAny._currentTimelapseTime))
      : undefined;
  const initialRenderTime =
    targetTime !== undefined
      ? targetTime
      : preservedTime !== undefined
        ? preservedTime
        : isMountedBrowser
          ? minEpoch + (maxEpoch - minEpoch) * 0.75
          : undefined;

  const { geojson, routeCounts } = buildTrainFeatures(
    vehicleGroups,
    initialRenderTime,
    windowBounds
  );

  for (const feat of geojson.features) {
    const p = feat.properties;
    if (p && p['iconId']) {
      try {
        ensureTrainSprite(map, p['routeId'], p['isDiamond'], p['displayLabel'], p['color'], p['iconId']);
      } catch {
        // Headless fallback
      }
    }
  }

  const sourceId = 'train-positions-source';
  const haloLayerId = 'train-positions-halo';
  const circleLayerId = 'train-positions-circle';
  const headingLayerId = 'train-positions-heading';

  if (map.getSource(sourceId)) {
    (map.getSource(sourceId) as any).setData(geojson);
  } else {
    map.addSource(sourceId, {
      type: 'geojson',
      data: geojson,
    });

    // High-contrast outer halo ring so live trains stand out sharply over subway trunk lines
    map.addLayer({
      id: haloLayerId,
      type: 'circle',
      source: sourceId,
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          9.5, 9,
          11, 11,
          12.5, 13.5,
          14, 15.5,
        ],
        'circle-color': '#FFFFFF',
        'circle-opacity': 0.92,
        'circle-stroke-width': 2,
        'circle-stroke-color': ['get', 'color'],
      },
    });

    // Train bullet / diamond marker symbol layer with high-DPI sprites
    map.addLayer({
      id: circleLayerId,
      type: 'symbol',
      source: sourceId,
      layout: {
        'icon-image': ['get', 'iconId'],
        'icon-size': [
          'interpolate', ['linear'], ['zoom'],
          9.5, 0.66,
          11, 0.80,
          12.5, 0.92,
          14, 1.05,
        ],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    });

    // Directional heading chevron indicator
    map.addLayer({
      id: headingLayerId,
      type: 'symbol',
      source: sourceId,
      filter: ['>', ['get', 'bearing'], 0],
      layout: {
        'icon-image': 'train-heading-chevron',
        'icon-size': [
          'interpolate', ['linear'], ['zoom'],
          9.5, 0.46,
          11, 0.56,
          13, 0.70,
        ],
        'icon-rotate': ['get', 'bearing'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-offset': [0, -17],
      },
    });
  }

  // Keep train layers at the very top of the map stack above trunk lines and capsules
  if (options?.onRefreshLive) {
    mapAny._onRefreshLive = options.onRefreshLive;
  }

  if (typeof mapAny.moveLayer === 'function') {
    for (const lid of [haloLayerId, circleLayerId, headingLayerId]) {
      if (map.getLayer(lid)) {
        try {
          mapAny.moveLayer(lid);
        } catch {
          // Ignore in headless mock
        }
      }
    }
  }

  // 2. Interactive Hover & Click-to-Pin Popup (bound once per map instance)
  if (!mapAny._trainPositionEventsBound) {
    mapAny._trainPositionEventsBound = true;
    mapAny._activeTrainPopup = null;
    mapAny._isPopupPinned = false;
    let lastClickEventObj: unknown = null;

    const showTrainPopup = (e: any, pin: boolean) => {
      const feat = e.features?.[0];
      if (!feat) return;
      const p = feat.properties as Record<string, any>;
      const coords =
        feat.geometry?.type === 'Point' && Array.isArray(feat.geometry.coordinates)
          ? (feat.geometry.coordinates as [number, number])
          : e.lngLat;

      if (mapAny._activeTrainPopup) {
        mapAny._activeTrainPopup.remove();
        mapAny._activeTrainPopup = null;
      }

      mapAny._isPopupPinned = pin;
      const popup = new maplibregl.Popup({
        closeButton: pin,
        closeOnClick: false,
        offset: 12,
        className: pin ? 'dbtc-train-popup-pinned' : 'dbtc-train-popup-hover',
      });
      mapAny._activeTrainPopup = popup;
      popup.setLngLat(coords).setHTML(buildTrainPopupHtml(p, pin)).addTo(map);
      const popupEl = typeof popup.getElement === 'function' ? popup.getElement() : null;
      attachPopupCopyHandlers(popupEl);

      if (pin && typeof popup.on === 'function') {
        popup.on('close', () => {
          mapAny._isPopupPinned = false;
        });
      }
    };

    map.on('mouseenter', circleLayerId, (e: any) => {
      map.getCanvas().style.cursor = 'pointer';
      if (mapAny._isPopupPinned) return;
      showTrainPopup(e, false);
    });

    map.on('mouseleave', circleLayerId, () => {
      map.getCanvas().style.cursor = '';
      if (mapAny._isPopupPinned) return;
      if (mapAny._activeTrainPopup) {
        mapAny._activeTrainPopup.remove();
        mapAny._activeTrainPopup = null;
      }
    });

    const handleTrainClick = (e: any) => {
      if (e?.originalEvent && e.originalEvent === lastClickEventObj) {
        return;
      }
      if (e?.originalEvent) {
        lastClickEventObj = e.originalEvent;
        if (typeof e.originalEvent.stopPropagation === 'function') {
          e.originalEvent.stopPropagation();
        }
      }
      // Pause live/timelapse playback when user clicks a train so the modal stays steady for copying
      if (typeof mapAny._pauseTrainPlayback === 'function') {
        mapAny._pauseTrainPlayback();
      }
      showTrainPopup(e, true);
    };

    map.on('click', circleLayerId, handleTrainClick);
    map.on('click', haloLayerId, handleTrainClick);
  }

  // 3. Live Fleet Summary & Route Filter HUD Bar
  let filterHud = container.querySelector('.dbtc-map-hud-fleet-filter') as HTMLElement | null;
  if (!filterHud) {
    filterHud = document.createElement('div');
    filterHud.className = 'dbtc-map-hud dbtc-map-hud-fleet-filter';
    container.appendChild(filterHud);
  }

  const routeMetaByFilterKey = new Map<
    string,
    { routeId: string; agencyId: string; displayLabel: string; color: string | null }
  >();
  let busFeatureCount = 0;
  for (const feat of geojson.features) {
    const p = (feat.properties ?? {}) as Record<string, unknown>;
    const fKey = String(p['filterKey'] ?? p['routeId'] ?? '');
    const agId = String(p['agencyId'] ?? 'MTA_NYCT_SUBWAY');
    if (agId.toUpperCase() === 'MTA_BUS') {
      busFeatureCount++;
    }
    if (fKey && !routeMetaByFilterKey.has(fKey)) {
      routeMetaByFilterKey.set(fKey, {
        routeId: String(p['routeId'] ?? fKey),
        agencyId: agId,
        displayLabel: String(p['displayLabel'] ?? fKey),
        color: typeof p['color'] === 'string' && p['color'] ? p['color'] : null,
      });
    }
  }
  const isBusFleet =
    options?.corridorOverlay === 'M60-SBS' ||
    (geojson.features.length > 0 && busFeatureCount === geojson.features.length);
  const fleetLabelTitle = isBusFleet ? 'Active Buses' : 'Active Trains';
  const fleetSingular = isBusFleet ? 'bus' : 'train';
  const fleetPlural = isBusFleet ? 'buses' : 'trains';

  const sortedRoutes = Array.from(routeCounts.entries()).sort((a, b) => {
    const labelA = routeMetaByFilterKey.get(a[0])?.displayLabel || routeMetaByFilterKey.get(a[0])?.routeId || a[0];
    const labelB = routeMetaByFilterKey.get(b[0])?.displayLabel || routeMetaByFilterKey.get(b[0])?.routeId || b[0];
    return labelA.localeCompare(labelB, undefined, { numeric: true, sensitivity: 'base' });
  });
  const totalTrains = geojson.features.length;
  const allRouteKeys = sortedRoutes.map(([k]) => k);
  const savedFilter = container.dataset['activeTrainRouteFilter'];

  let selectedRoutes: Set<string>;
  if (!savedFilter || savedFilter === '*') {
    selectedRoutes = new Set(allRouteKeys);
  } else if (savedFilter === '__NONE__') {
    selectedRoutes = new Set();
  } else {
    try {
      const parsed = JSON.parse(savedFilter);
      if (Array.isArray(parsed)) {
        selectedRoutes = new Set(parsed.filter((k): k is string => typeof k === 'string' && routeCounts.has(k)));
      } else {
        selectedRoutes = routeCounts.has(savedFilter) ? new Set([savedFilter]) : new Set(allRouteKeys);
      }
    } catch {
      selectedRoutes = routeCounts.has(savedFilter) ? new Set([savedFilter]) : new Set(allRouteKeys);
    }
  }

  const applyRouteFilter = (selected: Set<string>) => {
    const isAll = selected.size === allRouteKeys.length && allRouteKeys.length > 0;
    const isNone = selected.size === 0;
    if (isAll) {
      container.dataset['activeTrainRouteFilter'] = '*';
      if (map.getLayer(haloLayerId)) {
        map.setFilter(haloLayerId, null);
      }
      map.setFilter(circleLayerId, null);
      map.setFilter(headingLayerId, ['>', ['get', 'bearing'], 0]);
    } else if (isNone) {
      container.dataset['activeTrainRouteFilter'] = '__NONE__';
      const noneExpr: any = [
        '==',
        ['coalesce', ['get', 'filterKey'], ['get', 'routeId']],
        '__NONE__',
      ];
      if (map.getLayer(haloLayerId)) {
        map.setFilter(haloLayerId, noneExpr);
      }
      map.setFilter(circleLayerId, noneExpr);
      map.setFilter(headingLayerId, [
        'all',
        ['>', ['get', 'bearing'], 0],
        noneExpr,
      ]);
    } else {
      const arr = Array.from(selected);
      container.dataset['activeTrainRouteFilter'] = JSON.stringify(arr);
      const matchExpr: any = [
        'in',
        ['coalesce', ['get', 'filterKey'], ['get', 'routeId']],
        ['literal', arr],
      ];
      if (map.getLayer(haloLayerId)) {
        map.setFilter(haloLayerId, matchExpr);
      }
      map.setFilter(circleLayerId, matchExpr);
      map.setFilter(headingLayerId, [
        'all',
        ['>', ['get', 'bearing'], 0],
        matchExpr,
      ]);
    }
  };

  applyRouteFilter(selectedRoutes);

  const MAX_VISIBLE_ROUTES = 10;
  const visibleRoutes = sortedRoutes.slice(0, MAX_VISIBLE_ROUTES);
  const overflowRoutes = sortedRoutes.slice(MAX_VISIBLE_ROUTES);

  const getRouteLabel = (fKey: string) => {
    const meta = routeMetaByFilterKey.get(fKey) ?? {
      routeId: fKey,
      agencyId: 'MTA_NYCT_SUBWAY',
      displayLabel: fKey,
      color: null,
    };
    const spec = resolveCommuterOrBusRouteSpec(meta.routeId, meta.agencyId);
    return {
      meta,
      desc: spec ? spec.label : `${meta.displayLabel} ${fleetSingular}`,
    };
  };

  const escapeAttr = (val: string) =>
    val.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const computeSelectedTrainCount = () => {
    let sum = 0;
    for (const k of selectedRoutes) {
      sum += routeCounts.get(k) ?? 0;
    }
    return sum;
  };

  filterHud.innerHTML = `
    <div style="font-weight:700;font-size:11px;color:#0F172A;margin-right:4px;">
      ${fleetLabelTitle}: <span class="dbtc-active-trains-count" style="font-variant-numeric:tabular-nums;">${selectedRoutes.size === allRouteKeys.length ? totalTrains : `${computeSelectedTrainCount()}/${totalTrains}`}</span>
    </div>
    <button class="dbtc-map-hud-bullet-btn dbtc-map-hud-all-btn ${selectedRoutes.size === allRouteKeys.length ? 'active' : ''}" data-action="all" title="Select all active ${fleetPlural}" style="font-size:10.5px;font-weight:700;padding:2px 6px;border-radius:4px;background:#F1F5F9;border:1px solid #CBD5E1;color:#0F172A;">
      All
    </button>
    <button class="dbtc-map-hud-bullet-btn dbtc-map-hud-none-btn ${selectedRoutes.size === 0 ? 'active' : ''}" data-action="none" title="Deselect all routes" style="font-size:10.5px;font-weight:700;padding:2px 6px;border-radius:4px;background:#F1F5F9;border:1px solid #CBD5E1;color:#0F172A;">
      None
    </button>
    ${visibleRoutes
      .map(([fKey, count]) => {
        const { meta, desc } = getRouteLabel(fKey);
        const isSelected = selectedRoutes.has(fKey);
        return `
      <button class="dbtc-map-hud-bullet-btn ${isSelected ? 'active' : ''}" data-route="${escapeAttr(fKey)}" title="Toggle ${escapeAttr(desc)} (${count} active)" style="${isSelected ? '' : 'opacity:0.35;filter:grayscale(0.6);'}">
        ${buildRouteBulletHtml(meta.routeId, meta.agencyId, meta.color, 20)}
      </button>
    `;
      })
      .join('')}
    ${
      overflowRoutes.length > 0
        ? `<select class="dbtc-map-hud-overflow-select" title="Toggle additional routes" style="font-size:10.5px;font-weight:600;padding:2px 6px;border-radius:4px;background:#F8FAFC;border:1px solid #CBD5E1;color:#0F172A;max-width:138px;cursor:pointer;">
            <option value="">+${overflowRoutes.length} more…</option>
            ${overflowRoutes
              .map(([fKey, count]) => {
                const { meta, desc } = getRouteLabel(fKey);
                const mark = selectedRoutes.has(fKey) ? '✓ ' : '○ ';
                return `<option value="${escapeAttr(fKey)}">${mark}${escapeAttr(meta.displayLabel || desc)} (${count})</option>`;
              })
              .join('')}
          </select>`
        : ''
    }
  `;

  const syncFilterHudUi = () => {
    const isAll = selectedRoutes.size === allRouteKeys.length && allRouteKeys.length > 0;
    const isNone = selectedRoutes.size === 0;
    const countEl = filterHud?.querySelector('.dbtc-active-trains-count');
    if (countEl) {
      countEl.textContent = isAll ? String(totalTrains) : `${computeSelectedTrainCount()}/${totalTrains}`;
    }
    filterHud?.querySelector('.dbtc-map-hud-all-btn')?.classList.toggle('active', isAll);
    filterHud?.querySelector('.dbtc-map-hud-none-btn')?.classList.toggle('active', isNone);
    filterHud?.querySelectorAll('.dbtc-map-hud-bullet-btn[data-route]').forEach((btn) => {
      const fKey = btn.getAttribute('data-route') || '';
      const on = selectedRoutes.has(fKey);
      btn.classList.toggle('active', on);
      (btn as HTMLElement).style.opacity = on ? '' : '0.35';
      (btn as HTMLElement).style.filter = on ? '' : 'grayscale(0.6)';
    });
    const overflowSelect = filterHud?.querySelector('.dbtc-map-hud-overflow-select') as HTMLSelectElement | null;
    if (overflowSelect) {
      const overflowOnCount = overflowRoutes.filter(([k]) => selectedRoutes.has(k)).length;
      if (overflowSelect.options[0]) {
        overflowSelect.options[0].textContent =
          overflowOnCount > 0 && overflowOnCount < overflowRoutes.length
            ? `+${overflowRoutes.length} (${overflowOnCount} on)`
            : `+${overflowRoutes.length} more…`;
      }
      overflowRoutes.forEach(([fKey, count], idx) => {
        const opt = overflowSelect.options[idx + 1];
        if (!opt) return;
        const { meta, desc } = getRouteLabel(fKey);
        const mark = selectedRoutes.has(fKey) ? '✓ ' : '○ ';
        opt.textContent = `${mark}${meta.displayLabel || desc} (${count})`;
      });
      overflowSelect.selectedIndex = 0;
    }
  };

  filterHud.querySelector('.dbtc-map-hud-all-btn')?.addEventListener('click', () => {
    selectedRoutes = new Set(allRouteKeys);
    applyRouteFilter(selectedRoutes);
    syncFilterHudUi();
  });

  filterHud.querySelector('.dbtc-map-hud-none-btn')?.addEventListener('click', () => {
    selectedRoutes = new Set();
    applyRouteFilter(selectedRoutes);
    syncFilterHudUi();
  });

  filterHud.querySelectorAll('.dbtc-map-hud-bullet-btn[data-route]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const fKey = (e.currentTarget as HTMLElement).getAttribute('data-route');
      if (!fKey) return;
      if (selectedRoutes.has(fKey)) {
        selectedRoutes.delete(fKey);
      } else {
        selectedRoutes.add(fKey);
      }
      applyRouteFilter(selectedRoutes);
      syncFilterHudUi();
    });
  });

  filterHud.querySelector('.dbtc-map-hud-overflow-select')?.addEventListener('change', (e) => {
    const sel = e.currentTarget as HTMLSelectElement;
    const fKey = sel.value;
    if (!fKey) return;
    if (selectedRoutes.has(fKey)) {
      selectedRoutes.delete(fKey);
    } else {
      selectedRoutes.add(fKey);
    }
    applyRouteFilter(selectedRoutes);
    syncFilterHudUi();
  });

  // 4. Floating Glassmorphism Timelapse Scrubber HUD Bar
  if (mapAny._timelapseAnimId) {
    cancelAnimationFrame(mapAny._timelapseAnimId);
    mapAny._timelapseAnimId = null;
  }
  const stopLiveAutoRefreshPolling = () => {
    if (mapAny._livePollIntervalId) {
      clearInterval(mapAny._livePollIntervalId);
      mapAny._livePollIntervalId = null;
    }
  };
  stopLiveAutoRefreshPolling();

  let timelapseHud = container.querySelector('.dbtc-map-hud-timelapse') as HTMLElement | null;
  if (!timelapseHud) {
    timelapseHud = document.createElement('div');
    timelapseHud.className = 'dbtc-map-hud dbtc-map-hud-timelapse';
    container.appendChild(timelapseHud);
  }

  let isLive = liveModeAllowed && targetTime === undefined && isPinnedToLiveEdge;
  let isPlaying = false;
  let activeTrainCount = totalTrains;
  let currentTime =
    initialRenderTime !== undefined ? initialRenderTime : maxEpoch;
  mapAny._currentTimelapseTime = currentTime;
  let playbackSpeed = mapAny._timelapseSpeed || 15;
  let lastTimestamp: number | null = null;
  const justSynced =
    Boolean(mapAny._justSyncedLiveAt) && Date.now() - Number(mapAny._justSyncedLiveAt) < 3500;
  const syncedBadgeLabel = `✓ LIVE SYNCED · ${activeTrainCount} ${activeTrainCount === 1 ? fleetSingular : fleetPlural}`;
  const currentTzAbbr = getEasternTzAbbr(currentTime);
  const liveBtnInitialTitle = liveModeAllowed
    ? isLive
      ? 'Auto-refreshing live feed periodically without pinning the scrubber; click to pause auto-refresh'
      : 'Periodically rerun this query automatically (On Demand mode only; does not pin the scrubber)'
    : 'Live auto-refresh is only available in On Demand mode';

  timelapseHud.innerHTML = `
    <button class="dbtc-timelapse-btn dbtc-timelapse-play-btn" title="Play 15-min kinematic timelapse">▶</button>
    <div class="dbtc-timelapse-scrubber-wrap">
      <input type="range" class="dbtc-timelapse-scrubber" min="${Math.floor(minEpoch)}" max="${Math.ceil(maxEpoch)}" value="${Math.round(currentTime)}" step="1" title="Scrub across 15-minute observed ${fleetSingular} trajectory window" />
    </div>
    <span class="dbtc-timelapse-mode-badge" style="font-size:9.5px;font-weight:800;padding:2px 6px;border-radius:999px;letter-spacing:0.3px;white-space:nowrap;">${isLive ? (justSynced ? syncedBadgeLabel : 'LIVE AUTO') : 'REPLAY'}</span>
    <span class="dbtc-timelapse-time">${formatEdtTime(currentTime)} ${currentTzAbbr}</span>
    <div class="dbtc-timelapse-speeds">
      <button class="dbtc-timelapse-speed-btn ${playbackSpeed === 1 ? 'active' : ''}" data-speed="1">1x</button>
      <button class="dbtc-timelapse-speed-btn ${playbackSpeed === 5 ? 'active' : ''}" data-speed="5">5x</button>
      <button class="dbtc-timelapse-speed-btn ${playbackSpeed === 15 ? 'active' : ''}" data-speed="15">15x</button>
      <button class="dbtc-timelapse-speed-btn ${playbackSpeed === 60 ? 'active' : ''}" data-speed="60">60x</button>
    </div>
    <button class="dbtc-timelapse-btn dbtc-timelapse-live-btn ${isLive ? 'active' : ''}" ${liveModeAllowed ? '' : 'disabled'} title="${liveBtnInitialTitle}">${isLive ? '● LIVE ON' : '● LIVE'}</button>
  `;

  const playBtn = timelapseHud.querySelector('.dbtc-timelapse-play-btn') as HTMLButtonElement;
  const scrubber = timelapseHud.querySelector('.dbtc-timelapse-scrubber') as HTMLInputElement;
  const modeBadge = timelapseHud.querySelector('.dbtc-timelapse-mode-badge') as HTMLElement;
  const timeLabel = timelapseHud.querySelector('.dbtc-timelapse-time') as HTMLElement;
  const liveBtn = timelapseHud.querySelector('.dbtc-timelapse-live-btn') as HTMLButtonElement;
  const speedBtns = timelapseHud.querySelectorAll('.dbtc-timelapse-speed-btn');

  const updateSourceAtTime = (t?: number) => {
    const { geojson: nextGeoJson } = buildTrainFeatures(vehicleGroups, t, windowBounds);
    activeTrainCount = nextGeoJson.features.length;
    const src = map.getSource(sourceId) as any;
    if (src) {
      src.setData(nextGeoJson);
    }
    const countEl = filterHud?.querySelector('.dbtc-active-trains-count');
    if (countEl) {
      countEl.textContent = String(activeTrainCount);
    }
  };

  const updateControlsUI = () => {
    const syncingNow = Boolean(mapAny._isSyncingLive);
    const tzCur = getEasternTzAbbr(currentTime);
    const tzMax = getEasternTzAbbr(maxEpoch);
    if (playBtn) {
      playBtn.textContent = isPlaying ? '⏸' : '▶';
      playBtn.setAttribute(
        'title',
        isPlaying ? 'Pause timelapse replay' : 'Play 15-min kinematic timelapse'
      );
    }
    if (scrubber) {
      scrubber.value = String(Math.round(currentTime));
    }
    if (modeBadge) {
      if (syncingNow) {
        modeBadge.textContent = '↻ SYNCING FEED...';
        modeBadge.style.background = '#FEF3C7';
        modeBadge.style.color = '#B45309';
        modeBadge.style.border = '1px solid #FCD34D';
      } else if (isLive) {
        const syncedNow =
          Boolean(mapAny._justSyncedLiveAt) && Date.now() - Number(mapAny._justSyncedLiveAt) < 3500;
        if (syncedNow) {
          modeBadge.textContent = `✓ LIVE SYNCED · ${activeTrainCount} ${activeTrainCount === 1 ? fleetSingular : fleetPlural}`;
          modeBadge.style.background = '#ECFDF5';
          modeBadge.style.color = '#047857';
          modeBadge.style.border = '1px solid #6EE7B7';
        } else {
          modeBadge.textContent = isPlaying ? 'LIVE AUTO · REPLAY' : 'LIVE AUTO';
          modeBadge.style.background = '#FEF2F2';
          modeBadge.style.color = '#DC2626';
          modeBadge.style.border = '1px solid #FCA5A5';
        }
      } else {
        modeBadge.textContent = isPlaying ? 'REPLAY' : 'PAUSED';
        modeBadge.style.background = '#EFF6FF';
        modeBadge.style.color = '#1D4ED8';
        modeBadge.style.border = '1px solid #BFDBFE';
      }
    }
    if (timeLabel) {
      timeLabel.textContent = `${formatEdtTime(currentTime)} ${tzCur}`;
    }
    if (liveBtn) {
      liveBtn.disabled = !liveModeAllowed;
      if (!liveModeAllowed) {
        liveBtn.classList.remove('active');
        liveBtn.textContent = '● LIVE';
        liveBtn.setAttribute('title', 'Live auto-refresh is only available in On Demand mode');
      } else if (syncingNow) {
        liveBtn.classList.add('active');
        liveBtn.textContent = '↻ SYNCING...';
      } else if (isLive) {
        liveBtn.classList.add('active');
        liveBtn.textContent = '● LIVE ON';
        liveBtn.setAttribute(
          'title',
          `Auto-rerunning query every ${Math.round(livePollMs / 1000)}s (latest ${formatEdtTime(maxEpoch)} ${tzMax}, ${activeTrainCount} active ${fleetPlural}) without pinning the scrubber. Click to pause auto-refresh.`
        );
      } else {
        liveBtn.classList.remove('active');
        liveBtn.textContent = '● LIVE';
        liveBtn.setAttribute(
          'title',
          `Periodically rerun this query automatically (On Demand mode only; keeps scrubber free)`
        );
      }
    }
  };
  mapAny._updateTimelapseControlsUI = updateControlsUI;

  const scheduleLiveSyncBadgeReset = () => {
    if (mapAny._liveSyncBadgeTimer) {
      clearTimeout(mapAny._liveSyncBadgeTimer);
    }
    mapAny._liveSyncBadgeTimer = setTimeout(() => {
      mapAny._justSyncedLiveAt = 0;
      if (typeof mapAny._updateTimelapseControlsUI === 'function') {
        mapAny._updateTimelapseControlsUI();
      }
    }, 3550);
  };

  const livePollMs = options?.livePollIntervalMs ?? 60_000;
  const startLiveAutoRefreshPolling = () => {
    stopLiveAutoRefreshPolling();
    if (!liveModeAllowed || !isMountedBrowser || typeof mapAny._onRefreshLive !== 'function' || livePollMs <= 0) {
      return;
    }
    mapAny._livePollIntervalId = setInterval(async () => {
      if (!liveModeAllowed || !container?.isConnected || !mapAny._liveSyncPinned) {
        stopLiveAutoRefreshPolling();
        return;
      }
      if (mapAny._isSyncingLive || typeof mapAny._onRefreshLive !== 'function') {
        return;
      }
      mapAny._isSyncingLive = true;
      if (typeof mapAny._updateTimelapseControlsUI === 'function') {
        mapAny._updateTimelapseControlsUI();
      }
      let syncOk = false;
      try {
        const res = await mapAny._onRefreshLive({ forceQuery: true });
        syncOk = res !== false;
      } catch {
        syncOk = false;
      } finally {
        mapAny._isSyncingLive = false;
        if (syncOk) {
          mapAny._justSyncedLiveAt = Date.now();
          scheduleLiveSyncBadgeReset();
        }
        if (typeof mapAny._updateTimelapseControlsUI === 'function') {
          mapAny._updateTimelapseControlsUI();
        }
      }
    }, livePollMs);
  };

  const pausePlayback = () => {
    if (isPlaying) {
      isPlaying = false;
      mapAny._wasTimelapsePlaying = false;
      if (mapAny._timelapseAnimId) {
        cancelAnimationFrame(mapAny._timelapseAnimId);
        mapAny._timelapseAnimId = null;
      }
      updateControlsUI();
    }
  };
  mapAny._pauseTrainPlayback = pausePlayback;

  const animationStep = (timestamp: number) => {
    if (!isPlaying) return;
    const isTabHidden = typeof document !== 'undefined' && document.hidden;
    const isOffscreen = mapAny._isContainerVisible === false;
    if (isTabHidden || isOffscreen) {
      lastTimestamp = null;
      mapAny._timelapseAnimId = requestAnimationFrame(animationStep);
      return;
    }
    if (lastTimestamp !== null && timestamp >= lastTimestamp) {
      const deltaSec = ((timestamp - lastTimestamp) / 1000) * playbackSpeed;
      currentTime += deltaSec;
      if (currentTime >= maxEpoch) {
        const span = Math.max(1, maxEpoch - minEpoch);
        currentTime = minEpoch + ((currentTime - minEpoch) % span);
      }
      mapAny._currentTimelapseTime = currentTime;
      updateControlsUI();
      updateSourceAtTime(currentTime);
    }
    lastTimestamp = timestamp;
    mapAny._timelapseAnimId = requestAnimationFrame(animationStep);
  };

  if (isMountedBrowser && typeof IntersectionObserver !== 'undefined' && container && !mapAny._visibilityObserver) {
    mapAny._isContainerVisible = true;
    const io = new IntersectionObserver(entries => {
      for (const entry of entries) {
        mapAny._isContainerVisible = entry.isIntersecting;
      }
    }, { threshold: 0.05 });
    io.observe(container);
    mapAny._visibilityObserver = io;
  }

  const startTimelapseMotion = () => {
    isPlaying = true;
    mapAny._wasTimelapsePlaying = true;
    lastTimestamp = null;
    if (currentTime >= maxEpoch || currentTime < minEpoch) {
      currentTime = minEpoch + (maxEpoch - minEpoch) * 0.75;
    }
    mapAny._currentTimelapseTime = currentTime;
    updateControlsUI();
    if (typeof requestAnimationFrame === 'function') {
      if (mapAny._timelapseAnimId) cancelAnimationFrame(mapAny._timelapseAnimId);
      mapAny._timelapseAnimId = requestAnimationFrame(animationStep);
    }
  };

  // Initialize badge and button styling immediately
  updateControlsUI();

  // When mounted in an active browser document, auto-start smooth kinematic replay unless user paused or pinned a popup
  if (isMountedBrowser && !mapAny._isPopupPinned && mapAny._wasTimelapsePlaying !== false) {
    startTimelapseMotion();
  }
  if (isLive && isMountedBrowser && liveModeAllowed) {
    startLiveAutoRefreshPolling();
  }

  if (playBtn) {
    playBtn.onclick = () => {
      if (isPlaying) {
        pausePlayback();
      } else {
        if (currentTime >= maxEpoch) {
          currentTime = minEpoch;
        }
        mapAny._currentTimelapseTime = currentTime;
        isPlaying = true;
        mapAny._wasTimelapsePlaying = true;
        lastTimestamp = null;
        updateControlsUI();
        updateSourceAtTime(currentTime);
        mapAny._timelapseAnimId = requestAnimationFrame(animationStep);
      }
    };
  }

  if (scrubber) {
    scrubber.oninput = () => {
      currentTime = Number(scrubber.value);
      mapAny._currentTimelapseTime = currentTime;
      updateControlsUI();
      updateSourceAtTime(currentTime);
    };
  }

  if (liveBtn) {
    liveBtn.onclick = async () => {
      if (!liveModeAllowed) {
        return;
      }
      if (isLive) {
        // Toggle periodic auto-refresh OFF without altering scrubber or playback state
        stopLiveAutoRefreshPolling();
        isLive = false;
        mapAny._liveSyncPinned = false;
        if (container?.dataset) {
          delete container.dataset['liveSyncPinned'];
        }
        if (typeof mapAny._onLivePinChange === 'function') {
          mapAny._onLivePinChange(false);
        }
        mapAny._justSyncedLiveAt = 0;
        updateControlsUI();
        return;
      }

      // Toggle periodic auto-refresh ON without pinning scrubber to now or stopping playback
      isLive = true;
      mapAny._liveSyncPinned = true;
      if (container?.dataset) {
        container.dataset['liveSyncPinned'] = 'true';
      }
      if (typeof mapAny._onLivePinChange === 'function') {
        mapAny._onLivePinChange(true);
      }
      mapAny._justSyncedLiveAt = Date.now();

      updateControlsUI();
      scheduleLiveSyncBadgeReset();
      startLiveAutoRefreshPolling();

      // Trigger an immediate query rerun if callback is registered
      if (typeof mapAny._onRefreshLive === 'function') {
        mapAny._isSyncingLive = true;
        updateControlsUI();
        let syncOk = false;
        try {
          const res = await mapAny._onRefreshLive({ forceQuery: true });
          syncOk = res !== false;
        } catch {
          syncOk = false;
        } finally {
          mapAny._isSyncingLive = false;
          if (syncOk) {
            mapAny._justSyncedLiveAt = Date.now();
            scheduleLiveSyncBadgeReset();
          } else {
            mapAny._justSyncedLiveAt = 0;
          }
          if (typeof mapAny._updateTimelapseControlsUI === 'function') {
            mapAny._updateTimelapseControlsUI();
          } else {
            updateControlsUI();
          }
        }
      }
    };
  }

  speedBtns.forEach((btn) => {
    (btn as HTMLButtonElement).onclick = () => {
      const spd = Number(btn.getAttribute('data-speed') || '15');
      playbackSpeed = spd;
      mapAny._timelapseSpeed = spd;
      speedBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    };
  });
}
