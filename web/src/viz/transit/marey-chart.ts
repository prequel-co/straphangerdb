import type { EChartsOption } from 'echarts';
import {
  resolveRouteColor,
  buildRouteBulletSvgDataUri,
  buildRouteBulletHtml,
} from '../echarts-theme-mta.js';
import {
  resolveStationDisplay,
  differentiateTrunkShade,
  KNOWN_NYC_STATION_NAMES,
} from './station-progression.js';

export interface MareyRow {
  trip_id: string;
  route_id?: string;
  agency_id?: string;
  station_id?: string;
  parent_station_id?: string;
  arrival_time?: number | string;
  departure_time?: number | string;
  event_time?: number | string;
  stop_sequence?: number;
}

export interface MareyChartOptions {
  stationOrder?: readonly string[];
  showBoroughBands?: boolean;
  showBothDirections?: boolean;
  containerWidth?: number;
}

interface MareyStopPoint {
  station: string;
  arrivalTime: number;
  departureTime: number;
  headwaySec?: number | undefined;
  dwellSec?: number | undefined;
  speedMph?: number | undefined;
  displayValue?: string | undefined;
}

interface TripEntry {
  tripId: string;
  routeId: string;
  routeLabel?: string | undefined;
  agencyId?: string | undefined;
  directionId?: string | undefined;
  points: MareyStopPoint[];
}

function normalizeEpochNumberMs(val: number): number {
  if (!Number.isFinite(val) || val <= 0) return 0;
  if (val > 1e17) return Math.round(val / 1e6); // nanoseconds -> ms
  if (val > 1e14) return Math.round(val / 1e3); // microseconds -> ms
  if (val < 10_000_000_000) return val * 1000; // seconds -> ms
  return val;
}

function parseTimestampMs(raw: unknown): number {
  if (typeof raw === 'number') {
    return normalizeEpochNumberMs(raw);
  }
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const trimmed = raw.trim();
    const asNum = Number(trimmed);
    if (!Number.isNaN(asNum) && trimmed.length >= 9) {
      return normalizeEpochNumberMs(asNum);
    }
    const parsed = new Date(trimmed).getTime();
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (raw instanceof Date) {
    return raw.getTime();
  }
  return 0;
}

function extractLongestMonotonicStops(
  stops: readonly MareyStopPoint[],
  stationIndexMap: ReadonlyMap<string, number>,
  isReverse: boolean
): MareyStopPoint[] {
  const indexed = stops
    .map(pt => ({ pt, yIdx: stationIndexMap.get(pt.station) }))
    .filter((item): item is { pt: MareyStopPoint; yIdx: number } => item.yIdx !== undefined);
  const n = indexed.length;
  if (n <= 2) return indexed.map(item => item.pt);

  // Check fast path: already monotonic
  let alreadyMonotonic = true;
  for (let i = 1; i < n; i++) {
    const prevY = indexed[i - 1]!.yIdx;
    const curY = indexed[i]!.yIdx;
    if (isReverse ? curY > prevY : curY < prevY) {
      alreadyMonotonic = false;
      break;
    }
  }
  if (alreadyMonotonic) return indexed.map(item => item.pt);

  // Longest non-decreasing (forward) or non-increasing (reverse) subsequence DP (n <= ~60 stops)
  const dp = new Array<number>(n).fill(1);
  const prev = new Array<number>(n).fill(-1);
  let bestLen = 0;
  let bestEnd = 0;

  for (let i = 0; i < n; i++) {
    const curY = indexed[i]!.yIdx;
    for (let j = 0; j < i; j++) {
      const prevY = indexed[j]!.yIdx;
      const validStep = isReverse ? curY <= prevY : curY >= prevY;
      if (validStep && dp[j]! + 1 > dp[i]!) {
        dp[i] = dp[j]! + 1;
        prev[i] = j;
      }
    }
    if (dp[i]! > bestLen) {
      bestLen = dp[i]!;
      bestEnd = i;
    }
  }

  const result: MareyStopPoint[] = [];
  let cur = bestEnd;
  while (cur !== -1) {
    result.push(indexed[cur]!.pt);
    cur = prev[cur]!;
  }
  result.reverse();
  return result;
}

function formatNyTime(ms: number, includeSeconds = false): string {
  return new Date(ms).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    ...(includeSeconds ? { second: '2-digit' } : {}),
  });
}

function shortenTripId(tripId: string): string {
  const parts = tripId.split('_');
  if (parts.length >= 2) {
    return parts.slice(-2).join('_');
  }
  return tripId.length > 18 ? `…${tripId.slice(-14)}` : tripId;
}

export function buildMareyChartOption(
  rows: readonly Record<string, unknown>[],
  stationOrderOrOptions: readonly string[] | MareyChartOptions = []
): EChartsOption {
  const opts: MareyChartOptions = Array.isArray(stationOrderOrOptions)
    ? { stationOrder: stationOrderOrOptions }
    : (stationOrderOrOptions as MareyChartOptions);
  const explicitStationOrder = opts.stationOrder ?? [];
  const isCompact = opts.containerWidth !== undefined && opts.containerWidth < 520;
  const compactLabelWidth = isCompact
    ? Math.max(84, Math.min(115, Math.floor((opts.containerWidth ?? 360) * 0.32)))
    : undefined;

  const tripsMap = new Map<string, TripEntry>();
  const stationBoroughMap = new Map<string, string>();
  const stationMinStopIdMap = new Map<string, string>();
  const stationSeqSumMap = new Map<string, { sum: number; count: number }>();
  const stationFirstSeenOrder: string[] = [];
  const stationSeenSet = new Set<string>(explicitStationOrder);
  for (const st of explicitStationOrder) {
    stationFirstSeenOrder.push(st);
  }

  const recordStationMeta = (station: string, borough?: string, seqHint?: number, rawStopId?: unknown) => {
    if (!stationSeenSet.has(station)) {
      stationSeenSet.add(station);
      stationFirstSeenOrder.push(station);
    }
    if (borough && !stationBoroughMap.has(station)) {
      stationBoroughMap.set(station, borough);
    }
    if (rawStopId !== undefined && rawStopId !== null) {
      const cleanId = String(rawStopId).trim().toUpperCase().replace(/[NS]$/, '');
      if (/^[1-9A-Z]\d{2}$/.test(cleanId)) {
        const prevId = stationMinStopIdMap.get(station);
        if (!prevId || cleanId.localeCompare(prevId) < 0) {
          stationMinStopIdMap.set(station, cleanId);
        }
      }
    }
    if (seqHint !== undefined && Number.isFinite(seqHint)) {
      const cur = stationSeqSumMap.get(station);
      if (cur) {
        cur.sum += seqHint;
        cur.count += 1;
      } else {
        stationSeqSumMap.set(station, { sum: seqHint, count: 1 });
      }
    }
  };

  for (const r of rows) {
    const tripId = String(r['trip_id'] ?? '').trim();
    if (!tripId) continue;

    const routeId = String(r['route_id'] ?? '').trim() || 'Subway';
    const agencyId = r['agency_id'] ? String(r['agency_id']) : undefined;
    const rawDir = r['direction_id'] != null ? String(r['direction_id']).trim() : undefined;
    const routeLabelRaw = r['route_label'] ?? r['line_label'] ?? r['series_label'];
    const routeLabel = routeLabelRaw != null ? String(routeLabelRaw).trim() : undefined;

    const customDisplayRaw =
      r['display_value'] ?? r['formatted_value'] ?? r['measure_display'] ?? r['value_label'];
    const displayValue = customDisplayRaw != null
      ? String(customDisplayRaw).trim()
      : undefined;

    const headwaySec = r['headway_sec'] != null ? Number(r['headway_sec']) : undefined;
    const dwellSec = r['dwell_sec'] != null ? Number(r['dwell_sec']) : undefined;
    const speedMph =
      r['effective_speed_mph'] != null
        ? Number(r['effective_speed_mph'])
        : r['leg_speed_mps'] != null
          ? Number(r['leg_speed_mps']) * 2.23694
          : r['speed'] != null
            ? Number(r['speed'])
            : undefined;

    let tripEntry = tripsMap.get(tripId);
    if (!tripEntry) {
      tripEntry = {
        tripId,
        routeId,
        routeLabel,
        agencyId,
        directionId: rawDir,
        points: [],
      };
      tripsMap.set(tripId, tripEntry);
    } else {
      if (agencyId && !tripEntry.agencyId) tripEntry.agencyId = agencyId;
      if (rawDir && !tripEntry.directionId) tripEntry.directionId = rawDir;
      if (routeLabel && !tripEntry.routeLabel) tripEntry.routeLabel = routeLabel;
    }

    // Check if row is a station-to-station leg (has both from_station_id/name and to_station_id/name)
    const hasLegEndpoints =
      (r['from_station_id'] !== undefined || r['from_station_name'] !== undefined) &&
      (r['to_station_id'] !== undefined || r['to_station_name'] !== undefined) &&
      r['departure_time'] !== undefined &&
      r['arrival_time'] !== undefined;

    if (hasLegEndpoints) {
      const depTime = parseTimestampMs(r['departure_time']);
      const arrTime = parseTimestampMs(r['arrival_time']);
      const fromResolved = resolveStationDisplay({
        station_id: r['from_station_id'],
        station_name: r['from_station_name'] ?? r['from_station_label'],
        borough: r['from_borough'] ?? r['borough'],
        route_id: r['route_id'],
      });
      const toResolved = resolveStationDisplay({
        station_id: r['to_station_id'],
        station_name: r['to_station_name'] ?? r['to_station_label'],
        borough: r['to_borough'] ?? r['borough'],
        route_id: r['route_id'],
      });

      if (fromResolved.name && fromResolved.name !== 'Unknown' && depTime > 0) {
        recordStationMeta(fromResolved.name, fromResolved.borough, undefined, r['from_station_id']);
        tripEntry.points.push({
          station: fromResolved.name,
          arrivalTime: depTime,
          departureTime: depTime,
          headwaySec,
          dwellSec,
          speedMph,
          displayValue,
        });
      }
      if (toResolved.name && toResolved.name !== 'Unknown' && arrTime > 0) {
        recordStationMeta(toResolved.name, toResolved.borough, undefined, r['to_station_id']);
        tripEntry.points.push({
          station: toResolved.name,
          arrivalTime: arrTime,
          departureTime: arrTime,
          headwaySec,
          dwellSec,
          speedMph,
          displayValue,
        });
      }
      continue;
    }

    // Standard station arrival/departure event row
    const { name: station, borough } = resolveStationDisplay(r);
    if (!station || station === 'Unknown') continue;

    const seqHint =
      r['stop_sequence'] !== undefined
        ? Number(r['stop_sequence'])
        : r['station_order'] !== undefined
          ? Number(r['station_order'])
          : undefined;
    recordStationMeta(station, borough, seqHint, r['parent_station_id'] ?? r['station_id']);

    const arrMs = parseTimestampMs(r['arrival_time']);
    const depMs = parseTimestampMs(r['departure_time']);
    const evtMs = parseTimestampMs(r['event_time']);

    let arrivalTime = arrMs || depMs || evtMs;
    let departureTime = depMs || arrMs || evtMs;
    if (!arrivalTime || Number.isNaN(arrivalTime)) continue;

    if (
      arrivalTime === departureTime &&
      dwellSec !== undefined &&
      Number.isFinite(dwellSec) &&
      dwellSec >= 15 &&
      dwellSec <= 600
    ) {
      arrivalTime = departureTime - dwellSec * 1000;
    }

    tripEntry.points.push({
      station,
      arrivalTime,
      departureTime: Math.max(arrivalTime, departureTime),
      headwaySec,
      dwellSec,
      speedMph,
      displayValue,
    });
  }

  // Determine canonical corridor station ordering if not explicitly supplied
  let allStations: string[];
  if (explicitStationOrder.length > 0) {
    allStations = [...explicitStationOrder];
    for (const st of stationFirstSeenOrder) {
      if (!allStations.includes(st)) allStations.push(st);
    }
  } else if (stationSeqSumMap.size === stationFirstSeenOrder.length && stationSeqSumMap.size > 1) {
    allStations = [...stationFirstSeenOrder].sort((a, b) => {
      const sa = stationSeqSumMap.get(a)!;
      const sb = stationSeqSumMap.get(b)!;
      return sa.sum / sa.count - sb.sum / sb.count;
    });
  } else {
    // Derive topological corridor order from the trip that visits the most distinct stations
    let longestTripStations: string[] = [];
    const allTripSequences: string[][] = [];

    for (const tripData of tripsMap.values()) {
      const sortedPts = [...tripData.points].sort(
        (a, b) => a.arrivalTime - b.arrivalTime || a.departureTime - b.departureTime
      );
      const seq: string[] = [];
      for (const pt of sortedPts) {
        if (seq[seq.length - 1] !== pt.station && !seq.includes(pt.station)) {
          seq.push(pt.station);
        }
      }
      if (seq.length >= 2) {
        allTripSequences.push(seq);
        if (seq.length > longestTripStations.length) {
          longestTripStations = seq;
        }
      }
    }

    if (longestTripStations.length >= 2) {
      const boroughNorthSouthRank: Record<string, number> = {
        Bronx: 0,
        Queens: 1,
        Manhattan: 2,
        Brooklyn: 3,
        'Staten Island': 4,
      };
      const firstB = stationBoroughMap.get(longestTripStations[0]!);
      const lastB = stationBoroughMap.get(longestTripStations[longestTripStations.length - 1]!);
      const firstRank = firstB !== undefined ? boroughNorthSouthRank[firstB] : undefined;
      const lastRank = lastB !== undefined ? boroughNorthSouthRank[lastB] : undefined;
      // If dataset has trips in both directions and the chosen longest trip starts in Brooklyn and ends in Queens/Bronx/Manhattan,
      // orient the canonical corridor from North/East (Bronx/Queens) to South (Brooklyn).
      const hasOppositeDirectionTrip = allTripSequences.some(seq => {
        const i0 = longestTripStations.indexOf(seq[0]!);
        const i1 = longestTripStations.indexOf(seq[seq.length - 1]!);
        return i0 !== -1 && i1 !== -1 && i1 < i0;
      });
      const corridor =
        hasOppositeDirectionTrip &&
        firstRank !== undefined &&
        lastRank !== undefined &&
        firstRank > lastRank
          ? [...longestTripStations].reverse()
          : [...longestTripStations];

      const insertByBoroughOrPush = (st: string) => {
        const stBorough = stationBoroughMap.get(st);
        if (stBorough) {
          for (let k = corridor.length - 1; k >= 0; k--) {
            if (stationBoroughMap.get(corridor[k]!) === stBorough) {
              corridor.splice(k + 1, 0, st);
              return;
            }
          }
        }
        corridor.push(st);
      };

      const mergeTripSequenceIntoCorridor = (seq: string[]) => {
        const sharedIndices = seq
          .map(s => corridor.indexOf(s))
          .filter(idx => idx !== -1);
        const isSameDir =
          sharedIndices.length < 2 ||
          sharedIndices[sharedIndices.length - 1]! >= sharedIndices[0]!;
        const orderedSeq = isSameDir ? seq : [...seq].reverse();
        for (let i = 0; i < orderedSeq.length; i++) {
          const st = orderedSeq[i]!;
          if (!corridor.includes(st)) {
            const stBorough = stationBoroughMap.get(st);
            const prevSt = i > 0 ? orderedSeq[i - 1] : undefined;
            const prevIdx = prevSt ? corridor.indexOf(prevSt) : -1;
            if (prevIdx !== -1) {
              let insertIdx = prevIdx + 1;
              const prevBorough = stationBoroughMap.get(corridor[prevIdx]!);
              // When a parallel branch transitions to a new borough (e.g. 63rd St vs 53rd St on the F line),
              // advance past any remaining stations of the previous borough so borough bands never split.
              if (stBorough && prevBorough && stBorough !== prevBorough) {
                while (
                  insertIdx < corridor.length &&
                  stationBoroughMap.get(corridor[insertIdx]!) === prevBorough
                ) {
                  insertIdx += 1;
                }
              }
              corridor.splice(insertIdx, 0, st);
            } else {
              // Station precedes any station matched so far in orderedSeq; look ahead for the first station in corridor
              let nextIdx = -1;
              for (let j = i + 1; j < orderedSeq.length; j++) {
                const candidateIdx = corridor.indexOf(orderedSeq[j]!);
                if (candidateIdx !== -1) {
                  nextIdx = candidateIdx;
                  break;
                }
              }
              if (nextIdx !== -1) {
                let insertIdx = nextIdx;
                const nextBorough = stationBoroughMap.get(corridor[nextIdx]!);
                if (stBorough && nextBorough && stBorough !== nextBorough) {
                  while (
                    insertIdx > 0 &&
                    stationBoroughMap.get(corridor[insertIdx - 1]!) === nextBorough
                  ) {
                    insertIdx -= 1;
                  }
                }
                corridor.splice(insertIdx, 0, st);
              } else {
                insertByBoroughOrPush(st);
              }
            }
          }
        }
      };

      // Iteratively merge trip sequences that overlap with the growing corridor first
      const unmerged = [...allTripSequences];
      while (unmerged.length > 0) {
        let bestIdx = -1;
        let bestOverlap = 0;
        for (let idx = 0; idx < unmerged.length; idx++) {
          const seq = unmerged[idx]!;
          const overlap = seq.filter(s => corridor.includes(s)).length;
          if (overlap > bestOverlap) {
            bestOverlap = overlap;
            bestIdx = idx;
          }
        }
        if (bestIdx === -1) break;
        const [chosen] = unmerged.splice(bestIdx, 1);
        mergeTripSequenceIntoCorridor(chosen!);
      }
      for (const seq of unmerged) {
        mergeTripSequenceIntoCorridor(seq);
      }
      for (const st of stationFirstSeenOrder) {
        if (!corridor.includes(st)) {
          insertByBoroughOrPush(st);
        }
      }

      // Within each contiguous borough block, ensure stations sharing the same GTFS stop ID prefix
      // follow monotonic stop ID order along the corridor direction (essential when short time windows have non-overlapping trips).
      if (stationMinStopIdMap.size > 1) {
        const prefixTrend = new Map<string, number>();
        for (const seq of allTripSequences) {
          for (let i = 0; i + 1 < seq.length; i++) {
            const idA = stationMinStopIdMap.get(seq[i]!);
            const idB = stationMinStopIdMap.get(seq[i + 1]!);
            if (idA && idB && idA.charAt(0) === idB.charAt(0)) {
              const p = idA.charAt(0);
              const cmp = idA.localeCompare(idB);
              if (cmp < 0) prefixTrend.set(p, (prefixTrend.get(p) ?? 0) + 1);
              else if (cmp > 0) prefixTrend.set(p, (prefixTrend.get(p) ?? 0) - 1);
            }
          }
        }
        let runStart = 0;
        while (runStart < corridor.length) {
          const runBorough = stationBoroughMap.get(corridor[runStart]!);
          let runEnd = runStart + 1;
          while (runEnd < corridor.length && stationBoroughMap.get(corridor[runEnd]!) === runBorough) {
            runEnd += 1;
          }
          const prefixGroups = new Map<string, { indices: number[]; items: { station: string; stopId: string }[] }>();
          for (let k = runStart; k < runEnd; k++) {
            const st = corridor[k]!;
            const stopId = stationMinStopIdMap.get(st);
            if (stopId && /^[1-9A-Z]\d{2}$/.test(stopId)) {
              const p = stopId.charAt(0);
              let grp = prefixGroups.get(p);
              if (!grp) {
                grp = { indices: [], items: [] };
                prefixGroups.set(p, grp);
              }
              grp.indices.push(k);
              grp.items.push({ station: st, stopId });
            }
          }
          for (const [p, grp] of prefixGroups.entries()) {
            if (grp.items.length > 1) {
              const trend = prefixTrend.get(p) ?? 1;
              grp.items.sort((a, b) =>
                trend >= 0 ? a.stopId.localeCompare(b.stopId) : b.stopId.localeCompare(a.stopId)
              );
              for (let m = 0; m < grp.indices.length; m++) {
                corridor[grp.indices[m]!] = grp.items[m]!.station;
              }
            }
          }
          runStart = runEnd;
        }
      }

      allStations = corridor;
    } else {
      allStations = [...stationFirstSeenOrder];
    }
  }

  const stationIndexMap = new Map<string, number>();
  allStations.forEach((st, idx) => stationIndexMap.set(st, idx));

  // Sort each trip's points chronologically and determine trip direction along station axis
  interface ProcessedTrip {
    tripId: string;
    routeId: string;
    routeLabel?: string | undefined;
    agencyId?: string | undefined;
    isReverseDirection: boolean;
    startTime: number;
    lineData: [number, number, MareyStopPoint][];
  }

  const processedTrips: ProcessedTrip[] = [];
  let forwardCount = 0;
  let reverseCount = 0;

  for (const tripData of tripsMap.values()) {
    tripData.points.sort((a, b) => a.arrivalTime - b.arrivalTime || a.departureTime - b.departureTime);

    // Deduplicate consecutive identical station entries while preserving dwell intervals
    const deduped: MareyStopPoint[] = [];
    for (const pt of tripData.points) {
      const prev = deduped[deduped.length - 1];
      if (prev && prev.station === pt.station) {
        prev.arrivalTime = Math.min(prev.arrivalTime, pt.arrivalTime);
        prev.departureTime = Math.max(prev.departureTime, pt.departureTime);
        if (pt.displayValue && !prev.displayValue) prev.displayValue = pt.displayValue;
        if (pt.headwaySec !== undefined && prev.headwaySec === undefined) prev.headwaySec = pt.headwaySec;
      } else {
        deduped.push({ ...pt });
      }
    }

    const rawYIndices = deduped
      .map(p => stationIndexMap.get(p.station))
      .filter((y): y is number => y !== undefined);
    if (new Set(rawYIndices).size < 2) continue;

    const firstRawY = rawYIndices[0]!;
    const lastRawY = rawYIndices[rawYIndices.length - 1]!;
    const forwardStops = extractLongestMonotonicStops(deduped, stationIndexMap, false);
    const reverseStops = extractLongestMonotonicStops(deduped, stationIndexMap, true);
    const isReverse =
      reverseStops.length !== forwardStops.length
        ? reverseStops.length > forwardStops.length
        : lastRawY < firstRawY;
    const monotonicStops = isReverse ? reverseStops : forwardStops;

    const lineData: [number, number, MareyStopPoint][] = [];
    for (const p of monotonicStops) {
      const yIdx = stationIndexMap.get(p.station);
      if (yIdx === undefined) continue;
      lineData.push([p.arrivalTime, yIdx, p]);
      if (p.departureTime > p.arrivalTime + 5000) {
        lineData.push([p.departureTime, yIdx, p]);
      }
    }

    const distinctStations = new Set(lineData.map(d => d[1]));
    if (distinctStations.size < 2) continue;

    if (isReverse) {
      reverseCount += 1;
    } else {
      forwardCount += 1;
    }

    processedTrips.push({
      tripId: tripData.tripId,
      routeId: tripData.routeId,
      routeLabel: tripData.routeLabel,
      agencyId: tripData.agencyId,
      isReverseDirection: isReverse,
      startTime: lineData[0]![0],
      lineData,
    });
  }

  // Sort trips by start time so bullet markers can be spaced cleanly across time
  processedTrips.sort((a, b) => a.startTime - b.startTime);

  const dominantReverse = reverseCount > forwardCount;
  const hasBothDirections = forwardCount > 0 && reverseCount > 0;
  const totalTripsCount = processedTrips.length;

  // Assign official MTA colors and route bullets per route
  const routeColorMap = new Map<string, { color: string; bulletUri: string; agencyId?: string | undefined; routeLabel?: string | undefined }>();
  const trunkColorCounts = new Map<string, number>();
  const legendData: any[] = [];
  const legendSelected: Record<string, boolean> = {};

  for (const t of processedTrips) {
    if (!routeColorMap.has(t.routeId)) {
      const trunkColor = resolveRouteColor(t.routeId || 'subway', t.agencyId);
      const seen = trunkColorCounts.get(trunkColor) ?? 0;
      trunkColorCounts.set(trunkColor, seen + 1);
      const color = differentiateTrunkShade(trunkColor, seen);
      const bulletUri = buildRouteBulletSvgDataUri(t.routeId, t.agencyId, color);
      routeColorMap.set(t.routeId, {
        color,
        bulletUri,
        agencyId: t.agencyId,
        routeLabel: t.routeLabel,
      });
      legendData.push({
        name: t.routeId,
        icon: bulletUri,
      });
      legendSelected[t.routeId] = true;
    }
  }

  // Build series for each trip
  const series: NonNullable<EChartsOption['series']> = [];
  const lastBulletTimeByRoute = new Map<string, number>();
  const seriesPointMetaMap = new Map<
    string,
    { stopMeta: MareyStopPoint; tripId: string; routeId: string }
  >();

  for (const t of processedTrips) {
    // If dataset has many trips in both directions and showBothDirections isn't forced,
    // keep the dominant corridor direction so strings don't form an unreadable X-mesh
    if (
      hasBothDirections &&
      !opts.showBothDirections &&
      totalTripsCount > 6 &&
      t.isReverseDirection !== dominantReverse
    ) {
      continue;
    }

    const routeMeta = routeColorMap.get(t.routeId)!;
    const color = routeMeta.color;
    const isSingleTripTest = totalTripsCount <= 2 && explicitStationOrder.length > 0;
    const seriesName = isSingleTripTest ? `${t.routeId} (${t.tripId})` : t.routeId;

    // Place an authentic MTA Subway Bullet on the origin of spaced trips (or all trips when fewer than 12)
    const lastBulletTs = lastBulletTimeByRoute.get(t.routeId) ?? 0;
    const shouldShowOriginBullet = totalTripsCount <= 12 || t.startTime - lastBulletTs >= 5 * 60 * 1000 || lastBulletTs === 0;
    const markPointData: any[] = [];
    if (shouldShowOriginBullet && t.lineData.length > 0) {
      lastBulletTimeByRoute.set(t.routeId, t.startTime);
      const originPt = t.lineData[0]!;
      markPointData.push({
        coord: [originPt[0], originPt[1]],
        symbol: routeMeta.bulletUri,
        symbolSize: isCompact ? 14 : 18,
      });
    }

    const seriesIdx = series.length;
    const cleanPoints: [number, number][] = t.lineData.map((d, ptIdx) => {
      const meta = { stopMeta: d[2], tripId: t.tripId, routeId: t.routeId };
      seriesPointMetaMap.set(`${seriesIdx}:::${ptIdx}`, meta);
      seriesPointMetaMap.set(`${d[0]}:::${d[1]}`, meta);
      return [d[0], d[1]];
    });

    series.push({
      name: seriesName,
      id: `${t.routeId}:::${t.tripId}`,
      type: 'line',
      data: cleanPoints,
      lineStyle: {
        color,
        width: 2,
        opacity: 0.88,
      },
      itemStyle: {
        color,
        borderColor: '#FFFFFF',
        borderWidth: 1,
      },
      showSymbol: true,
      symbol: 'circle',
      symbolSize: 4,
      smooth: false,
      emphasis: {
        focus: 'series',
        lineStyle: {
          width: 3.5,
          opacity: 1,
        },
      },
      ...(markPointData.length > 0
        ? {
            markPoint: {
              silent: true,
              animation: false,
              label: { show: false },
              data: markPointData,
            },
          }
        : {}),
    });
  }

  // Add horizontal Borough bands (markArea) and river-crossing dividers (markLine) along the Y-axis
  const shouldShowBands = opts.showBoroughBands ?? (stationBoroughMap.size > 0);
  if (shouldShowBands && allStations.length > 1 && series.length > 0) {
    const boroughColors: Record<string, string> = {
      Bronx: 'rgba(15, 23, 42, 0.035)',
      Queens: 'rgba(15, 23, 42, 0.04)',
      Manhattan: 'rgba(255, 255, 255, 0.0)',
      Brooklyn: 'rgba(15, 23, 42, 0.035)',
      'Staten Island': 'rgba(15, 23, 42, 0.035)',
    };

    const spans: { name: string; startIdx: number; endIdx: number; color: string }[] = [];
    const boundaryIndices: number[] = [];
    const firstKnownBorough = allStations.map(s => stationBoroughMap.get(s)).find(Boolean);
    let currentBorough = firstKnownBorough || 'Manhattan';
    let spanStartIdx = 0;

    const resolveSpanColor = (borough: string, prevColor?: string): string => {
      const baseColor = boroughColors[borough] ?? 'rgba(15, 23, 42, 0.03)';
      if (prevColor && prevColor !== 'rgba(255, 255, 255, 0.0)' && baseColor !== 'rgba(255, 255, 255, 0.0)') {
        return 'rgba(255, 255, 255, 0.0)';
      }
      return baseColor;
    };

    for (let i = 1; i < allStations.length; i++) {
      const st = allStations[i]!;
      const b = stationBoroughMap.get(st) || currentBorough;
      if (b !== currentBorough) {
        const displayLabel = currentBorough.toUpperCase() === 'BRONX' ? 'THE BRONX' : currentBorough.toUpperCase();
        const prevColor = spans.length > 0 ? spans[spans.length - 1]!.color : undefined;
        spans.push({
          name: displayLabel,
          startIdx: spanStartIdx,
          endIdx: i - 1,
          color: resolveSpanColor(currentBorough, prevColor),
        });
        boundaryIndices.push(i);
        currentBorough = b;
        spanStartIdx = i;
      }
    }
    const finalLabel = currentBorough.toUpperCase() === 'BRONX' ? 'THE BRONX' : currentBorough.toUpperCase();
    const prevColor = spans.length > 0 ? spans[spans.length - 1]!.color : undefined;
    spans.push({
      name: finalLabel,
      startIdx: spanStartIdx,
      endIdx: allStations.length - 1,
      color: resolveSpanColor(currentBorough, prevColor),
    });

    (series[0] as any).markArea = {
      silent: true,
      data: spans.map(s => [
        {
          name: s.name,
          yAxis: allStations[s.startIdx],
          itemStyle: { color: s.color },
          label: {
            color: '#334155',
            backgroundColor: 'rgba(248, 250, 252, 0.9)',
            padding: isCompact ? [1, 4] : [2, 6],
            borderRadius: 3,
            position: 'insideRight',
            distance: isCompact ? 4 : 10,
            fontSize: isCompact ? 9 : 10,
            fontWeight: 700,
            fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
          },
        },
        {
          yAxis: allStations[s.endIdx],
        },
      ]),
    };

    if (boundaryIndices.length > 0) {
      (series[0] as any).markLine = {
        silent: true,
        symbol: ['none', 'none'],
        label: { show: false },
        lineStyle: {
          color: '#64748B',
          width: 1.25,
          type: 'dashed',
        },
        data: boundaryIndices.map(idx => ({ yAxis: allStations[idx] })),
      };
    }
  }

  return {
    tooltip: {
      trigger: 'item',
      axisPointer: {
        type: 'cross',
        lineStyle: { color: '#475569', width: 1, type: 'dashed' },
        crossStyle: { color: '#475569', width: 1, type: 'dashed' },
        label: {
          backgroundColor: '#0F172A',
          color: '#FFFFFF',
          fontSize: 11,
          fontWeight: 600,
          padding: [4, 8],
          borderRadius: 4,
        },
      },
      backgroundColor: 'rgba(255, 255, 255, 0.98)',
      borderColor: '#CBD5E1',
      borderWidth: 1,
      padding: [10, 14],
      extraCssText: 'box-shadow: 0 8px 24px rgba(15, 23, 42, 0.14); border-radius: 8px;',
      formatter: (params: any) => {
        const valArr = Array.isArray(params.value) ? params.value : [];
        const timeMs = Number(valArr[0] ?? 0);
        const yIdx = Number(valArr[1] ?? 0);
        const lookedUp =
          seriesPointMetaMap.get(`${params.seriesIndex ?? -1}:::${params.dataIndex ?? -1}`) ??
          seriesPointMetaMap.get(`${timeMs}:::${yIdx}`);
        const stopMeta = (lookedUp?.stopMeta ?? valArr[2] ?? {}) as MareyStopPoint;
        const tripId = String(lookedUp?.tripId ?? valArr[3] ?? params.seriesName ?? '');
        const routeId = String(lookedUp?.routeId ?? valArr[4] ?? params.seriesName ?? '');

        const routeMeta = routeColorMap.get(routeId);
        const bulletHtml = buildRouteBulletHtml(routeId, routeMeta?.agencyId, routeMeta?.color, 20);
        const stName = allStations[yIdx] ?? stopMeta.station ?? '';
        const borough = stationBoroughMap.get(stName);
        const boroughTag = borough
          ? `<span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#475569;background:#F1F5F9;padding:2px 6px;border-radius:4px;margin-left:8px;">${borough.toUpperCase() === 'BRONX' ? 'THE BRONX' : borough.toUpperCase()}</span>`
          : '';

        const timeStr = timeMs > 0 ? formatNyTime(timeMs, true) : '';
        const routeTitle = routeMeta?.routeLabel ?? `Line ${routeId}`;

        const extraRows: string[] = [];
        if (stopMeta.displayValue) {
          extraRows.push(
            `<div style="display:flex;justify-content:space-between;gap:12px;margin-top:4px;font-size:12px;"><span style="color:#64748B;">Measure</span><span style="font-weight:700;color:#0F172A;">${stopMeta.displayValue}</span></div>`
          );
        } else if (stopMeta.headwaySec !== undefined && Number.isFinite(stopMeta.headwaySec)) {
          const hw = Math.round(stopMeta.headwaySec);
          const mins = Math.floor(hw / 60);
          const secs = hw % 60;
          extraRows.push(
            `<div style="display:flex;justify-content:space-between;gap:12px;margin-top:4px;font-size:12px;"><span style="color:#64748B;">Headway</span><span style="font-weight:700;color:#0F172A;">${hw.toFixed(0)}s (${mins}m ${secs.toString().padStart(2, '0')}s)</span></div>`
          );
        }
        if (stopMeta.dwellSec !== undefined && Number.isFinite(stopMeta.dwellSec) && stopMeta.dwellSec > 0) {
          extraRows.push(
            `<div style="display:flex;justify-content:space-between;gap:12px;margin-top:4px;font-size:12px;"><span style="color:#64748B;">Station Dwell</span><span style="font-weight:700;color:#0F172A;">${stopMeta.dwellSec.toFixed(0)}s</span></div>`
          );
        }
        if (stopMeta.speedMph !== undefined && Number.isFinite(stopMeta.speedMph) && stopMeta.speedMph > 0) {
          extraRows.push(
            `<div style="display:flex;justify-content:space-between;gap:12px;margin-top:4px;font-size:12px;"><span style="color:#64748B;">Segment Speed</span><span style="font-weight:700;color:#0F172A;">${stopMeta.speedMph.toFixed(1)} mph</span></div>`
          );
        }

        return `<div style="min-width:210px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
          <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #E2E8F0;padding-bottom:6px;margin-bottom:6px;">
            <div style="display:flex;align-items:center;gap:7px;">
              ${bulletHtml}
              <span style="font-size:13px;font-weight:700;color:#0F172A;">${routeTitle}</span>
            </div>
            <span style="font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#64748B;">${shortenTripId(tripId)}</span>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
            <span style="font-size:12px;font-weight:700;color:#1E293B;">${stName}</span>
            ${boroughTag}
          </div>
          <div style="display:flex;justify-content:space-between;gap:12px;font-size:12px;">
            <span style="color:#64748B;">Clock Time (NYC)</span>
            <span style="font-weight:700;color:#0F172A;font-variant-numeric:tabular-nums;">${timeStr}</span>
          </div>
          ${extraRows.join('')}
        </div>`;
      },
    },
    legend: {
      top: 2,
      right: isCompact ? 4 : 16,
      type: isCompact ? 'scroll' : 'plain',
      data: legendData,
      selected: legendSelected,
      itemWidth: isCompact ? 16 : 20,
      itemHeight: isCompact ? 16 : 20,
      itemGap: isCompact ? 10 : 16,
      textStyle: {
        color: '#1E293B',
        fontSize: isCompact ? 11 : 12,
        fontWeight: 700,
        fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
      },
      formatter: (name: string) => {
        const meta = routeColorMap.get(name);
        if (meta?.routeLabel) return meta.routeLabel;
        if (name === '7X') return '<7> Express';
        if (name === '6X') return '<6> Express';
        if (name.endsWith('X') && name.length > 1) return `<${name.slice(0, -1)}> Express`;
        return `Line ${name}`;
      },
    },
    dataZoom: [
      {
        type: 'inside',
        xAxisIndex: 0,
        filterMode: 'none',
      },
    ],
    grid: {
      left: isCompact ? 6 : 16,
      right: isCompact ? 10 : 24,
      top: isCompact ? 36 : 44,
      bottom: 24,
      containLabel: true,
    },
    xAxis: {
      type: 'time',
      name: '',
      ...(isCompact ? { splitNumber: 4 } : {}),
      axisLine: { lineStyle: { color: '#0F172A', width: 1.75 } },
      axisTick: { show: true, length: 5, lineStyle: { color: '#0F172A', width: 1.25 } },
      axisLabel: {
        color: '#334155',
        fontSize: isCompact ? 10 : 11,
        fontWeight: 600,
        ...(isCompact ? { hideOverlap: true } : {}),
        formatter: (val: number) => formatNyTime(val, false),
      },
      axisPointer: {
        label: {
          formatter: (params: any) => formatNyTime(Number(params.value), true),
        },
      },
      splitLine: {
        show: true,
        lineStyle: { color: '#E2E8F0', width: 1, type: 'dashed' },
      },
    },
    yAxis: {
      type: 'category',
      name: '',
      data: allStations,
      inverse: true,
      axisLine: { lineStyle: { color: '#0F172A', width: 1.5 } },
      axisTick: {
        show: true,
        alignWithLabel: true,
        length: 4,
        lineStyle: { color: '#0F172A', width: 1 },
      },
      axisLabel: {
        color: '#1E293B',
        fontSize: isCompact ? 10 : 11,
        fontWeight: 600,
        interval: allStations.length > 28 ? 1 : 0,
        ...(isCompact && compactLabelWidth
          ? {
              width: compactLabelWidth,
              overflow: 'truncate' as const,
              ellipsis: '…',
            }
          : {}),
      },
      splitLine: {
        show: true,
        lineStyle: { color: '#F1F5F9', width: 1, type: 'solid' },
      },
    },
    series,
  };
}
