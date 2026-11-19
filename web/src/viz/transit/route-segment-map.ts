import type { Map as MapLibreMap, LngLatBoundsLike } from 'maplibre-gl';
import maplibregl from 'maplibre-gl';
import {
  resolveRouteColor,
  buildRouteBulletHtml,
  resolveCustomColorForKey,
} from '../echarts-theme-mta.js';
import {
  resolveStationInfo,
  hydrateStationCache,
  ensureMtaSubwayOverlay,
  ensureStationLabelSprite,
  ensureStopPillSprite,
  extractCurvedSegmentAlongServiceLine,
  projectStationOntoServiceLine,
  cleanStationLabelText,
  extractRoutesFromStationText,
  normalizeStationRoutes,
  getStopPillIconId,
  getStationLabelOffset,
  TRANSFER_HUB_STATION_IDS,
  type StationInfo,
  type StationChainProjection,
} from '../map/mta-subway-overlay.js';

export interface RouteSegmentFeatureProps {
  routeId: string;
  fromStationId: string;
  toStationId: string;
  fromStationName: string;
  toStationName: string;
  color: string;
  speedTierColor?: string;
  speedMph: number;
  travelTimeSec: number;
  distanceMeters: number;
  speedTier: 'slow' | 'standard' | 'express';
  isSlowZone: boolean;
}

const EAST_RIVER_PORTAL_PAIRS: ReadonlySet<string> = new Set(
  [
    // Steinway Tunnel (7)
    ['723', '721'],
    ['631', '721'],
    // 53rd St Tunnel (E / M)
    ['F11', 'F09'],
    ['F11', 'G22'],
    ['F11', 'G21'],
    // 63rd St Tunnel (F / Q)
    ['B08', 'B06'],
    ['B06', 'B04'],
    // 60th St Tunnel (N / R / W)
    ['R11', 'R09'],
    ['R11', '718'],
    ['R11', '719'],
    ['R11', 'G21'],
    ['629', 'R09'],
    ['629', '718'],
    ['629', '719'],
    ['629', 'G21'],
    // 14th St Tunnel (L)
    ['L06', 'L08'],
    // Williamsburg Bridge (J / M / Z)
    ['M18', 'M16'],
    ['F15', 'M16'],
    // Rutgers St Tunnel (F)
    ['F16', 'F18'],
    // Cranberry St Tunnel (A / C)
    ['A38', 'A41'],
    ['A40', 'A41'],
    // Montague St Tunnel (R / W)
    ['R27', 'R28'],
    ['142', 'R28'],
    // Manhattan Bridge (B / D / N / Q)
    ['D21', 'D24'],
    ['D21', 'R30'],
    ['R23', 'R30'],
    ['R23', 'D24'],
    ['Q01', 'R30'],
    ['Q01', 'D24'],
    // Clark St Tunnel (2 / 3)
    ['230', '231'],
    ['230', '232'],
    ['229', '231'],
    // Joralemon St Tunnel (4 / 5)
    ['420', '417'],
    ['420', '232'],
    ['419', '417'],
    ['419', '232'],
    // Newtown Creek (G)
    ['G22', 'G26'],
    ['G24', 'G26'],
    ['F09', 'G26'],
  ].flatMap(([a, b]) => [`${a}:${b}`, `${b}:${a}`])
);

export function isEastRiverCrossing(
  _fromInfo: StationInfo | null | undefined,
  _toInfo: StationInfo | null | undefined,
  fromId: string,
  toId: string
): boolean {
  const cleanFrom = fromId.trim().replace(/[NS]$/, '');
  const cleanTo = toId.trim().replace(/[NS]$/, '');
  if (!cleanFrom || !cleanTo || cleanFrom === cleanTo) return false;
  return EAST_RIVER_PORTAL_PAIRS.has(`${cleanFrom}:${cleanTo}`);
}

/**
 * High-contrast electric neon speed palette so corridor speed tiers are immediately
 * distinguishable from standard MTA trunk route bullet colors.
 */
export function getSpeedTierColor(speedTier: 'slow' | 'standard' | 'express'): string {
  switch (speedTier) {
    case 'slow':
      return '#FF007F'; // Electric Neon Magenta (< 14 mph Slow Zone)
    case 'express':
      return '#00F59B'; // Electric Neon Mint (>= 22 mph Express Pace)
    case 'standard':
    default:
      return '#00E5FF'; // Electric Neon Cyan (14 - 22 mph Standard Pace)
  }
}

export function buildRouteSegmentGeoJson(
  rows: readonly Record<string, unknown>[],
  options: {
    metricColumn?: string;
    followServiceLines?: boolean;
    customColors?: Readonly<Record<string, string>>;
  } = {}
): {
  segmentsGeoJson: GeoJSON.FeatureCollection;
  stationsGeoJson: GeoJSON.FeatureCollection;
  bounds: [number, number, number, number] | null;
} {
  hydrateStationCache(rows);
  const customColors = options.customColors;

  const metricCol = options.metricColumn || 'effective_speed_mph';
  const segments: GeoJSON.Feature[] = [];
  const stationsMap = new Map<string, { stationId: string; name: string; lat: number; lon: number; routes: Set<string> }>();

  const registerStationNode = (
    rawId: string,
    rawName: string,
    lat: number,
    lon: number,
    routeTokens: readonly string[]
  ) => {
    const cleanId = rawId.trim().replace(/[NS]$/, '');
    if (!cleanId || lat === 0 || lon === 0) return;
    const stInfo = resolveStationInfo(cleanId);
    const parentheticalRoutes = extractRoutesFromStationText(rawName);
    const cleanName = cleanStationLabelText(rawName || stInfo?.name || cleanId) || cleanId;
    const allRoutes = normalizeStationRoutes([
      ...routeTokens,
      ...parentheticalRoutes,
      ...(stInfo?.routes ?? []),
    ]);
    let entry = stationsMap.get(cleanId);
    if (!entry) {
      entry = {
        stationId: cleanId,
        name: cleanName,
        lat,
        lon,
        routes: new Set<string>(),
      };
      stationsMap.set(cleanId, entry);
    }
    for (const rt of allRoutes) {
      entry.routes.add(rt);
    }
  };

  let minLon = 180;
  let maxLon = -180;
  let minLat = 90;
  let maxLat = -90;

  const updateBounds = (lon: number, lat: number) => {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  };

  // Check if rows represent inter-station legs (Case A) or ordered points (Case B)
  const isLegFormat = rows.some(r => r['from_station_id'] !== undefined && r['to_station_id'] !== undefined);

  if (isLegFormat) {
    // Pre-collect observed station coordinates and per-route station sets to detect and reject skip-stop chords
    const observedNodes = new Map<string, { lat: number; lon: number }>();
    const observedByRoute = new Map<string, Set<string>>();

    for (const r of rows) {
      const fId = String(r['from_station_id'] ?? '').trim().replace(/[NS]$/, '');
      const tId = String(r['to_station_id'] ?? '').trim().replace(/[NS]$/, '');
      const fInfo = fId ? resolveStationInfo(fId) : null;
      const tInfo = tId ? resolveStationInfo(tId) : null;
      const rtId = String(r['route_id'] ?? fInfo?.routes[0] ?? tInfo?.routes[0] ?? '1').trim().toUpperCase();
      if (!observedByRoute.has(rtId)) {
        observedByRoute.set(rtId, new Set<string>());
      }
      const routeSet = observedByRoute.get(rtId)!;

      if (fId) {
        const fLat = Number(r['from_lat'] ?? fInfo?.lat ?? 0);
        const fLon = Number(r['from_lon'] ?? fInfo?.lon ?? 0);
        if (fLat !== 0 && fLon !== 0) {
          observedNodes.set(fId, { lat: fLat, lon: fLon });
          routeSet.add(fId);
        }
      }
      if (tId) {
        const tLat = Number(r['to_lat'] ?? tInfo?.lat ?? 0);
        const tLon = Number(r['to_lon'] ?? tInfo?.lon ?? 0);
        if (tLat !== 0 && tLon !== 0) {
          observedNodes.set(tId, { lat: tLat, lon: tLon });
          routeSet.add(tId);
        }
      }
    }

    // Cache station projections per routeId
    const routeProjectionCache = new Map<string, Map<string, StationChainProjection>>();
    const getRouteProjections = (
      routeId: string,
      serviceLineGeoJson?: unknown
    ): Map<string, StationChainProjection> => {
      const key = routeId.toUpperCase();
      if (routeProjectionCache.has(key)) {
        return routeProjectionCache.get(key)!;
      }
      const projMap = new Map<string, StationChainProjection>();
      for (const [stId, coords] of observedNodes.entries()) {
        const proj = projectStationOntoServiceLine(key, coords.lon, coords.lat, serviceLineGeoJson);
        if (proj && proj.distSq <= 0.0015 * 0.0015) {
          projMap.set(stId, proj);
        }
      }
      routeProjectionCache.set(key, projMap);
      return projMap;
    };

    const seenPairs = new Set<string>();

    const emitSegmentFeature = (
      r: Record<string, unknown>,
      routeId: string,
      sFromId: string,
      sToId: string,
      sFromName: string,
      sToName: string,
      sFromLat: number,
      sFromLon: number,
      sToLat: number,
      sToLon: number,
      legTimeRatio = 1
    ) => {
      const cleanSFrom = sFromId.replace(/[NS]$/, '');
      const cleanSTo = sToId.replace(/[NS]$/, '');
      if (!cleanSFrom || !cleanSTo || cleanSFrom === cleanSTo) return;

      const cleanFromName = cleanStationLabelText(sFromName) || sFromName;
      const cleanToName = cleanStationLabelText(sToName) || sToName;
      const fromRoutes = normalizeStationRoutes([
        routeId,
        ...(r['from_routes'] ? normalizeStationRoutes(String(r['from_routes'])) : []),
        ...extractRoutesFromStationText(sFromName),
      ]);
      const toRoutes = normalizeStationRoutes([
        routeId,
        ...(r['to_routes'] ? normalizeStationRoutes(String(r['to_routes'])) : []),
        ...extractRoutesFromStationText(sToName),
      ]);

      // Always register both endpoint stations and their stopping routes even if this shared link was already emitted
      registerStationNode(cleanSFrom, sFromName, sFromLat, sFromLon, fromRoutes);
      registerStationNode(cleanSTo, sToName, sToLat, sToLon, toRoutes);

      const pairKey = cleanSFrom < cleanSTo ? `${cleanSFrom}:${cleanSTo}` : `${cleanSTo}:${cleanSFrom}`;
      if (seenPairs.has(pairKey)) return;

      const useCurvedGeometry =
        options.followServiceLines === true || r['service_line_geojson'] !== undefined;
      const coords: [number, number][] = useCurvedGeometry
        ? extractCurvedSegmentAlongServiceLine(
            routeId,
            sFromLon,
            sFromLat,
            sToLon,
            sToLat,
            r['service_line_geojson'],
            true
          )
        : [
            [sFromLon, sFromLat],
            [sToLon, sToLat],
          ];

      if (coords.length < 2) return;
      seenPairs.add(pairKey);

      const color = String(
        resolveCustomColorForKey(routeId, customColors) ??
          r['route_color_hex'] ??
          r['color_hex'] ??
          resolveRouteColor(routeId, r['agency_id'] ? String(r['agency_id']) : 'MTA_NYCT_SUBWAY')
      );

      let speedMph = Number(r[metricCol] ?? 0);
      if (speedMph === 0 && r['leg_speed_mps'] !== undefined) {
        speedMph = Number(r['leg_speed_mps']) * 2.23694;
      }
      const rawTravelTimeSec = Number(r['leg_travel_time_sec'] ?? r['travel_time_sec'] ?? 0);
      const rawDistanceMeters = Number(r['leg_distance_meters'] ?? r['distance_meters'] ?? 0);
      if (speedMph === 0 && rawDistanceMeters > 0 && rawTravelTimeSec > 0) {
        speedMph = (rawDistanceMeters / rawTravelTimeSec) * 2.23694;
      }
      const travelTimeSec = rawTravelTimeSec * legTimeRatio;
      const distanceMeters = rawDistanceMeters * legTimeRatio;

      const speedTier: 'slow' | 'standard' | 'express' =
        speedMph < 14 ? 'slow' : speedMph >= 22 ? 'express' : 'standard';
      const speedTierColor =
        resolveCustomColorForKey(speedTier, customColors) ??
        resolveCustomColorForKey(routeId, customColors) ??
        getSpeedTierColor(speedTier);

      for (const [cx, cy] of coords) {
        updateBounds(cx, cy);
      }

      segments.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: coords,
        },
        properties: {
          routeId,
          fromStationId: sFromId,
          toStationId: sToId,
          fromStationName: cleanFromName,
          toStationName: cleanToName,
          color,
          speedTierColor,
          speedMph: Math.round(speedMph * 10) / 10,
          travelTimeSec: Math.round(travelTimeSec),
          distanceMeters: Math.round(distanceMeters),
          speedTier,
          isSlowZone: speedTier === 'slow',
        },
      });
    };

    interface DeferredGapLeg {
      r: Record<string, unknown>;
      routeId: string;
      chainStops: Array<{ id: string; name: string; lat: number; lon: number }>;
    }
    const deferredGapLegs: DeferredGapLeg[] = [];

    for (const r of rows) {
      const fromId = String(r['from_station_id'] ?? '').trim();
      const toId = String(r['to_station_id'] ?? '').trim();
      if (!fromId || !toId) continue;
      const cleanFrom = fromId.replace(/[NS]$/, '');
      const cleanTo = toId.replace(/[NS]$/, '');
      if (!cleanFrom || !cleanTo || cleanFrom === cleanTo) continue;

      const fromInfo = resolveStationInfo(fromId);
      const toInfo = resolveStationInfo(toId);

      const fromLat = Number(r['from_lat'] ?? fromInfo?.lat ?? 0);
      const fromLon = Number(r['from_lon'] ?? fromInfo?.lon ?? 0);
      const toLat = Number(r['to_lat'] ?? toInfo?.lat ?? 0);
      const toLon = Number(r['to_lon'] ?? toInfo?.lon ?? 0);

      if (fromLat === 0 || fromLon === 0 || toLat === 0 || toLon === 0) continue;

      // Skip invalid long jumps (spiderweb lines across NYC, e.g. unlinked stop IDs or anomalies)
      const dLat = toLat - fromLat;
      const dLon = toLon - fromLon;
      const dist = Math.sqrt(dLat * dLat + dLon * dLon);
      const eastRiver = isEastRiverCrossing(fromInfo, toInfo, fromId, toId);
      const maxDist = eastRiver ? 0.032 : 0.019;
      if (dist > maxDist) continue;

      // Roosevelt Island (B06) only connects to Lexington Av/63 St (B08) and 21 St-Queensbridge (B04)
      if (
        (cleanFrom === 'B06' && cleanTo !== 'B08' && cleanTo !== 'B04') ||
        (cleanTo === 'B06' && cleanFrom !== 'B08' && cleanFrom !== 'B04')
      ) {
        continue;
      }

      // Any cross-river transition between Manhattan and Queens/Brooklyn must use a valid portal pair
      if (fromInfo?.borough && toInfo?.borough && fromInfo.borough !== toInfo.borough) {
        const isManhattanToEast =
          (fromInfo.borough === 'Manhattan' &&
            (toInfo.borough === 'Queens' || toInfo.borough === 'Brooklyn')) ||
          (toInfo.borough === 'Manhattan' &&
            (fromInfo.borough === 'Queens' || fromInfo.borough === 'Brooklyn'));
        if (isManhattanToEast && !eastRiver) {
          continue;
        }
      }

      const routeId = String(r['route_id'] ?? fromInfo?.routes[0] ?? toInfo?.routes[0] ?? '1').trim();
      const routeKey = routeId.toUpperCase();
      const routeObservedSet = observedByRoute.get(routeKey);
      const fromName = String(r['from_station_name'] ?? fromInfo?.name ?? fromId);
      const toName = String(r['to_station_name'] ?? toInfo?.name ?? toId);

      // 1. Arc-length intermediate station detection along the route's service line
      // Verified East River tunnel portal pairs never skip intermediate stations.
      let skipsIntermediateStation = false;
      const intermediateStops: Array<{ id: string; name: string; lat: number; lon: number; arcLen: number }> = [];

      if (!eastRiver) {
        const projMap = getRouteProjections(routeKey, r['service_line_geojson']);
        const pFrom =
          projMap.get(cleanFrom) ??
          projectStationOntoServiceLine(routeKey, fromLon, fromLat, r['service_line_geojson']);
        const pTo =
          projMap.get(cleanTo) ??
          projectStationOntoServiceLine(routeKey, toLon, toLat, r['service_line_geojson']);

        const hasServiceLineProj =
          Boolean(pFrom && pTo) &&
          pFrom!.distSq <= 0.004 * 0.004 &&
          pTo!.distSq <= 0.004 * 0.004 &&
          pFrom!.chainIndex === pTo!.chainIndex;

        if (hasServiceLineProj && pFrom && pTo) {
          const minArc = Math.min(pFrom.arcLen, pTo.arcLen) + 0.0012;
          const maxArc = Math.max(pFrom.arcLen, pTo.arcLen) - 0.0012;
          if (maxArc > minArc) {
            for (const [midId, midProj] of projMap.entries()) {
              if (midId === cleanFrom || midId === cleanTo) continue;
              if (midProj.chainIndex !== pFrom.chainIndex) continue;
              const sameRouteOrLine =
                (routeObservedSet?.has(midId) ?? false) ||
                (midId[0] === cleanFrom[0] && midId[0] === cleanTo[0]);
              if (!sameRouteOrLine) continue;
              const midCoords = observedNodes.get(midId);
              if (!midCoords) continue;
              // Ignore co-located platforms of the same station complex (e.g. F09/G22 at Court Sq, R14/R15 at 49 St)
              if (
                Math.hypot(midCoords.lon - fromLon, midCoords.lat - fromLat) <= 0.0028 ||
                Math.hypot(midCoords.lon - toLon, midCoords.lat - toLat) <= 0.0028
              ) {
                continue;
              }
              if (midProj.arcLen > minArc && midProj.arcLen < maxArc) {
                skipsIntermediateStation = true;
                const midInfo = resolveStationInfo(midId);
                intermediateStops.push({
                  id: midId,
                  name: midInfo?.name ?? midId,
                  lat: midCoords.lat,
                  lon: midCoords.lon,
                  arcLen: midProj.arcLen,
                });
              }
            }
          }
          if (intermediateStops.length > 0 && intermediateStops.length <= 2 && dist <= 0.016) {
            const forward = pFrom.arcLen <= pTo.arcLen;
            intermediateStops.sort((a, b) => (forward ? a.arcLen - b.arcLen : b.arcLen - a.arcLen));
            deferredGapLegs.push({
              r,
              routeId,
              chainStops: [
                { id: fromId, name: fromName, lat: fromLat, lon: fromLon },
                ...intermediateStops.map(s => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon })),
                { id: toId, name: toName, lat: toLat, lon: toLon },
              ],
            });
          }
        } else {
          // 2. Fallback geometric skip-stop check only when service-line projection is unavailable
          for (const [midId, midCoords] of observedNodes.entries()) {
            if (midId === cleanFrom || midId === cleanTo) continue;
            const sameRouteOrLine =
              (routeObservedSet?.has(midId) ?? false) ||
              (midId[0] === cleanFrom[0] && midId[0] === cleanTo[0]);
            if (!sameRouteOrLine) continue;
            const d1 = Math.hypot(midCoords.lon - fromLon, midCoords.lat - fromLat);
            const d2 = Math.hypot(toLon - midCoords.lon, toLat - midCoords.lat);
            if (d1 <= 0.0028 || d2 <= 0.0028) continue;
            if (d1 < dist * 0.85 && d2 < dist * 0.85 && d1 + d2 <= dist * 1.12) {
              skipsIntermediateStation = true;
              break;
            }
          }
        }
      }

      if (skipsIntermediateStation) {
        const skippedFromRoutes = normalizeStationRoutes([
          routeId,
          ...(r['from_routes'] ? normalizeStationRoutes(String(r['from_routes'])) : []),
          ...extractRoutesFromStationText(fromName),
        ]);
        const skippedToRoutes = normalizeStationRoutes([
          routeId,
          ...(r['to_routes'] ? normalizeStationRoutes(String(r['to_routes'])) : []),
          ...extractRoutesFromStationText(toName),
        ]);
        registerStationNode(cleanFrom, fromName, fromLat, fromLon, skippedFromRoutes);
        registerStationNode(cleanTo, toName, toLat, toLon, skippedToRoutes);
        continue;
      }

      emitSegmentFeature(
        r,
        routeId,
        fromId,
        toId,
        fromName,
        toName,
        fromLat,
        fromLon,
        toLat,
        toLon,
        1
      );
    }

    // Pass 2: For 1-to-2 stop polling skips along a service line chain, fill in any missing adjacent
    // station-to-station sub-segments that were not already observed directly in Pass 1.
    for (const gapLeg of deferredGapLegs) {
      const stops = gapLeg.chainStops;
      const ratio = 1 / Math.max(1, stops.length - 1);
      for (let i = 0; i < stops.length - 1; i++) {
        const sA = stops[i]!;
        const sB = stops[i + 1]!;
        const subDist = Math.hypot(sB.lon - sA.lon, sB.lat - sA.lat);
        if (subDist > 0.012) continue;
        emitSegmentFeature(
          gapLeg.r,
          gapLeg.routeId,
          sA.id,
          sB.id,
          sA.name,
          sB.name,
          sA.lat,
          sA.lon,
          sB.lat,
          sB.lon,
          ratio
        );
      }
    }
  } else {
    // Case B: Group points by routeId and connect consecutively
    const routeGroups = new Map<string, { stationId: string; name: string; lat: number; lon: number; speedMph: number; seq: number }[]>();

    for (const r of rows) {
      const stationId = String(r['station_id'] ?? r['gtfs_stop_id'] ?? '').trim();
      const stInfo = stationId ? resolveStationInfo(stationId) : null;
      const lat = Number(r['latitude'] ?? stInfo?.lat ?? 0);
      const lon = Number(r['longitude'] ?? stInfo?.lon ?? 0);
      if (lat === 0 || lon === 0) continue;

      const routeId = String(r['route_id'] ?? '1').trim();
      const rawName = String(r['station_name'] ?? stInfo?.name ?? stationId);
      const cleanName = cleanStationLabelText(rawName) || rawName;
      const speedMph = Number(r[metricCol] ?? r['effective_speed_mph'] ?? 18);
      const seq = Number(r['stop_sequence'] ?? r['sequence'] ?? r['seq'] ?? 0);

      let group = routeGroups.get(routeId);
      if (!group) {
        group = [];
        routeGroups.set(routeId, group);
      }
      group.push({ stationId, name: cleanName, lat, lon, speedMph, seq });
      updateBounds(lon, lat);

      if (stationId) {
        registerStationNode(stationId, rawName, lat, lon, [
          routeId,
          ...normalizeStationRoutes(String(r['daytime_routes'] ?? r['routes'] ?? '')),
        ]);
      }
    }

    for (const [routeId, pts] of routeGroups.entries()) {
      const color = resolveRouteColor(routeId, 'MTA_NYCT_SUBWAY');
      if (pts.some(p => p.seq !== 0)) {
        pts.sort((a, b) => a.seq - b.seq);
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const p1 = pts[i]!;
        const p2 = pts[i + 1]!;

        // Skip long jumps between non-adjacent stations (spiderweb chords)
        const dLat = p2.lat - p1.lat;
        const dLon = p2.lon - p1.lon;
        const dist = Math.sqrt(dLat * dLat + dLon * dLon);
        const st1Info = resolveStationInfo(p1.stationId);
        const st2Info = resolveStationInfo(p2.stationId);
        const maxDist = isEastRiverCrossing(st1Info, st2Info, p1.stationId, p2.stationId) ? 0.032 : 0.019;
        if (dist > maxDist) continue;

        const speedMph = (p1.speedMph + p2.speedMph) / 2;
        const speedTier: 'slow' | 'standard' | 'express' =
          speedMph < 14 ? 'slow' : speedMph >= 22 ? 'express' : 'standard';
        const speedTierColor =
          resolveCustomColorForKey(speedTier, customColors) ??
          resolveCustomColorForKey(routeId, customColors) ??
          getSpeedTierColor(speedTier);

        const coords: [number, number][] = options.followServiceLines
          ? extractCurvedSegmentAlongServiceLine(routeId, p1.lon, p1.lat, p2.lon, p2.lat, undefined, true)
          : [
              [p1.lon, p1.lat],
              [p2.lon, p2.lat],
            ];
        if (coords.length < 2) continue;

        segments.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: coords,
          },
          properties: {
            routeId,
            fromStationId: p1.stationId,
            toStationId: p2.stationId,
            fromStationName: p1.name,
            toStationName: p2.name,
            color,
            speedTierColor,
            speedMph: Math.round(speedMph * 10) / 10,
            travelTimeSec: 0,
            distanceMeters: 0,
            speedTier,
            isSlowZone: speedTier === 'slow',
          },
        });
      }
    }
  }

  const stationsFeatures: GeoJSON.Feature[] = Array.from(stationsMap.values()).map(st => {
    const normalizedRoutes = normalizeStationRoutes(Array.from(st.routes)).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
    const primaryRoute = normalizedRoutes[0] ?? '1';
    const cleanStationId = st.stationId.replace(/[NS]$/, '');
    const cleanName = cleanStationLabelText(st.name) || st.name;
    return {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [st.lon, st.lat],
      },
      properties: {
        stationId: st.stationId,
        name: cleanName,
        routes: normalizedRoutes.join(','),
        routeCount: normalizedRoutes.length,
        primaryRoute,
        iconId: getStopPillIconId(normalizedRoutes),
        labelIconId: `station-label-${st.stationId}`,
        labelOffset: getStationLabelOffset(normalizedRoutes.length),
        isMultiRoute: normalizedRoutes.length > 1,
        isTransferHub: TRANSFER_HUB_STATION_IDS.has(cleanStationId) || normalizedRoutes.length > 1,
      },
    };
  });

  const bounds: [number, number, number, number] | null =
    minLon <= maxLon && minLat <= maxLat ? [minLon, minLat, maxLon, maxLat] : null;

  return {
    segmentsGeoJson: { type: 'FeatureCollection', features: segments },
    stationsGeoJson: { type: 'FeatureCollection', features: stationsFeatures },
    bounds,
  };
}

export function renderRouteSegmentMap(
  map: MapLibreMap,
  rows: readonly Record<string, unknown>[],
  options: {
    metricColumn?: string;
    showStationBubbles?: boolean;
    customColors?: Readonly<Record<string, string>>;
  } = {}
): void {
  // 1. Ensure authentic MTA base subway network, water/park tints, and borough watermarks
  // Keep background routes as quiet context so only the active corridor speed segments and station pills stand out cleanly
  ensureMtaSubwayOverlay(map, {
    baseTrunkOpacity: 0.22,
    showStationStops: false,
    showTransferCapsules: false,
    showTerminalBullets: false,
  });

  const { segmentsGeoJson, stationsGeoJson, bounds } = buildRouteSegmentGeoJson(rows, {
    followServiceLines: true,
    ...options,
  });

  // Pre-register pure black multi-route station pills and clean station label sprites for all active stations
  for (const feat of stationsGeoJson.features) {
    const props = feat.properties;
    if (props && props['stationId'] && props['name']) {
      try {
        const stRoutes = normalizeStationRoutes(String(props['routes'] ?? props['primaryRoute'] ?? '1'));
        ensureStopPillSprite(map, stRoutes);
        ensureStationLabelSprite(map, String(props['stationId']), String(props['name']));
      } catch {
        // Headless canvas fallback
      }
    }
  }

  const segmentsSourceId = 'active-route-segments-src';
  const stationsSourceId = 'active-route-stations-src';

  // 2. Active Inter-Station Route Segments Layer
  if (map.getSource(segmentsSourceId)) {
    (map.getSource(segmentsSourceId) as any).setData(segmentsGeoJson);
  } else {
    map.addSource(segmentsSourceId, {
      type: 'geojson',
      data: segmentsGeoJson,
    });

    // Dark slate outer casing so neon speed ribbons pop against the white map background
    map.addLayer({
      id: 'active-route-segments-casing',
      type: 'line',
      source: segmentsSourceId,
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#0F172A',
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          10, 5.8,
          12, 7.8,
          14, 10.4,
        ],
        'line-opacity': 0.92,
      },
    });

    // Neon speed tier colored route ribbon
    map.addLayer({
      id: 'active-route-segments-line',
      type: 'line',
      source: segmentsSourceId,
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': ['get', 'speedTierColor'],
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          10, 3.4,
          12, 5.0,
          14, 7.0,
        ],
        'line-opacity': 0.98,
      },
    });
  }

  // 3. Active Stations Layer (Pure Black Multi-Route Stop Pills & Clean Labels)
  if (map.getSource(stationsSourceId)) {
    (map.getSource(stationsSourceId) as any).setData(stationsGeoJson);
  } else {
    map.addSource(stationsSourceId, {
      type: 'geojson',
      data: stationsGeoJson,
    });

    map.addLayer({
      id: 'active-route-stations-pill',
      type: 'symbol',
      source: stationsSourceId,
      layout: {
        'icon-image': ['get', 'iconId'],
        'icon-size': [
          'interpolate', ['linear'], ['zoom'],
          10, 0.58,
          12, 0.74,
          14, 0.90,
        ],
        'icon-padding': 2,
        'icon-allow-overlap': true,
        'icon-ignore-placement': false,
      },
    });

    map.addLayer({
      id: 'active-route-stations-label',
      type: 'symbol',
      source: stationsSourceId,
      minzoom: 12,
      layout: {
        'icon-image': ['get', 'labelIconId'],
        'icon-anchor': 'left',
        'icon-offset': ['coalesce', ['get', 'labelOffset'], ['literal', [9, 0]]],
        'icon-padding': 6,
        'icon-allow-overlap': false,
        'icon-ignore-placement': false,
      },
    });
  }

  // 4. Interactive Hover Popups (bound once per map instance)
  const mapAny = map as any;
  if (!mapAny._routeSegmentEventsBound) {
    mapAny._routeSegmentEventsBound = true;
    let popup: maplibregl.Popup | null = null;

    map.on('mouseenter', 'active-route-segments-line', (e: any) => {
      map.getCanvas().style.cursor = 'pointer';
      const feat = e.features?.[0];
      if (!feat) return;

      const p = feat.properties as RouteSegmentFeatureProps;
      const bulletHtml = buildRouteBulletHtml(p.routeId, 'MTA_NYCT_SUBWAY', p.color, 22);

      const badgeColor = p.speedTierColor || getSpeedTierColor(p.speedTier);
      const tierBadge =
        p.speedTier === 'slow'
          ? `<span style="display:inline-block;padding:1px 6px;border-radius:3px;background:#0F172A;color:${badgeColor};border:1px solid ${badgeColor};font-weight:700;font-size:10px;">Slow Zone &lt; 14 mph</span>`
          : p.speedTier === 'express'
          ? `<span style="display:inline-block;padding:1px 6px;border-radius:3px;background:#0F172A;color:${badgeColor};border:1px solid ${badgeColor};font-weight:700;font-size:10px;">Express Pace &gt;= 22 mph</span>`
          : `<span style="display:inline-block;padding:1px 6px;border-radius:3px;background:#0F172A;color:${badgeColor};border:1px solid ${badgeColor};font-weight:700;font-size:10px;">Standard Pace</span>`;

      const timeHtml = p.travelTimeSec > 0
        ? `<div><strong>Median Time:</strong> <span style="font-variant-numeric:tabular-nums;">${Math.floor(p.travelTimeSec / 60)}m ${p.travelTimeSec % 60}s</span></div>`
        : '';
      const distHtml = p.distanceMeters > 0
        ? `<div><strong>Distance:</strong> <span style="font-variant-numeric:tabular-nums;">${(p.distanceMeters / 1609.34).toFixed(2)} mi</span></div>`
        : '';

      const contentHtml = `
        <div style="font-family:'Inter',-apple-system,sans-serif;line-height:1.45;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
            ${bulletHtml}
            <span style="font-weight:800;font-size:13px;color:#0F172A;">${p.fromStationName} &rarr; ${p.toStationName}</span>
          </div>
          <div style="margin-bottom:4px;display:flex;align-items:center;gap:6px;">
            <div><strong>Speed:</strong> <span style="font-size:13px;font-weight:700;color:#0F172A;font-variant-numeric:tabular-nums;">${p.speedMph} mph</span> <span style="color:#64748B;font-size:11px;">(${(p.speedMph * 1.60934).toFixed(1)} km/h)</span></div>
            ${tierBadge}
          </div>
          ${timeHtml}
          ${distHtml}
        </div>
      `;

      if (!popup) {
        popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });
      }
      popup.setLngLat(e.lngLat).setHTML(contentHtml).addTo(map);
    });

    map.on('mouseleave', 'active-route-segments-line', () => {
      map.getCanvas().style.cursor = '';
      if (popup) {
        popup.remove();
        popup = null;
      }
    });
  }

  // 5. Fit bounds to active corridor only when bounds change (preserve pan/zoom on color/theme edits)
  if (bounds) {
    const boundsKey = bounds.map(b => b.toFixed(4)).join(',');
    const mapAny = map as any;
    if (mapAny._lastRouteSegmentBoundsKey !== boundsKey) {
      mapAny._lastRouteSegmentBoundsKey = boundsKey;
      const lngLatBounds: LngLatBoundsLike = [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]],
      ];
      map.fitBounds(lngLatBounds, { padding: 48, maxZoom: 14.5, duration: 600 });
    }
  }

  // 6. Editorial Legend HUD (Neon Speed Palette distinct from MTA train route bullets)
  const container = map.getContainer();
  let legendHud = container.querySelector('.dbtc-map-hud-legend') as HTMLElement | null;
  if (!legendHud) {
    legendHud = document.createElement('div');
    legendHud.className = 'dbtc-map-hud dbtc-map-hud-legend';
    container.appendChild(legendHud);
  }

  const expressColor = resolveCustomColorForKey('express', options.customColors) ?? '#00F59B';
  const standardColor = resolveCustomColorForKey('standard', options.customColors) ?? '#00E5FF';
  const slowColor = resolveCustomColorForKey('slow', options.customColors) ?? '#FF007F';

  legendHud.innerHTML = `
    <div style="font-weight:700;font-size:11px;margin-bottom:5px;letter-spacing:0.3px;color:#0F172A;text-transform:uppercase;">
      Corridor Speed Performance
    </div>
    <div style="display:flex;flex-direction:column;gap:4px;font-size:11px;">
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="width:16px;height:6px;background:${expressColor};border:1.5px solid #0F172A;border-radius:3px;display:inline-block;"></span>
        <span>&ge; 22 mph (Express Pace)</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="width:16px;height:6px;background:${standardColor};border:1.5px solid #0F172A;border-radius:3px;display:inline-block;"></span>
        <span>14 - 22 mph (Standard)</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="width:16px;height:6px;background:${slowColor};border:1.5px solid #0F172A;border-radius:3px;display:inline-block;"></span>
        <span>&lt; 14 mph (Slow Zone)</span>
      </div>
    </div>
  `;
}
