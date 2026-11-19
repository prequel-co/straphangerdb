import type { Map as MapLibreMap } from 'maplibre-gl';
import {
  resolveRouteColor,
  resolveCommuterOrBusRouteSpec,
  hydrateRouteCatalogFromDuckDbRows,
} from '../echarts-theme-mta.js';
import {
  MAP_VISUAL_THEMES,
  getMapThemeSpec,
  OPENFREEMAP_VECTOR_SOURCE_ID,
  OPENFREEMAP_VECTOR_SOURCE_URL,
  GEOGRAPHIC_LAYER_IDS,
  buildGeographicVectorLayers,
  type MapVisualThemeId,
  type MapVisualThemeSpec,
} from './transit-map-style.js';
import { CANONICAL_ROUTES } from '../../types/straphanger-schema.gen.js';
import {
  filterHistoricalServiceLines,
  filterHistoricalStations,
  buildHistoricalElevatedGeoJson,
  applyProposedServiceLines,
  PENN_ACCESS_MNR_CORRIDOR,
  PROPOSED_EXTRA_STATIONS,
  type HistoricalEra,
} from './historical-networks.js';

export { MAP_VISUAL_THEMES, getMapThemeSpec, type MapVisualThemeId, type MapVisualThemeSpec };

export interface StationInfo {
  readonly stationId: string;
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
  readonly borough: string;
  readonly routes: readonly string[];
}

export const TRANSFER_HUB_STATION_IDS = new Set<string>([
  '127', '725', 'R16', // Times Sq
  '631', '723',        // Grand Central
  'D17', 'R17',        // Herald Sq
  '128', 'A28',        // Penn Station
  '635', 'R20',        // Union Sq
  '125',               // Columbus Circle
  'A38',               // Fulton St
  '235',               // Atlantic Av-Barclays Ctr
  'G22', 'F09', '719', // Court Sq
  'G14', '710',        // Jackson Hts-Roosevelt Av / 74 St
  '718', 'R09',        // Queensboro Plaza
  '629', 'R11',        // Lexington/59 St
  'A31',               // 14 St / 8 Av
  'A41',               // Jay St-MetroTech
  'A51',               // Broadway Junction
  'D43',               // Coney Island-Stillwell Av
]);

export function inferBoroughFromCoords(lat: number, lon: number): string {
  if (lat < 40.65 && lon < -74.05) return 'Staten Island';
  if (lat > 40.805 && lon > -73.935) return 'Bronx';
  if (lat < 40.702 && lon > -74.05) return 'Brooklyn';
  // Roosevelt Island is part of Manhattan
  if (lat >= 40.752 && lat <= 40.768 && lon >= -73.958 && lon <= -73.946) return 'Manhattan';
  // East River channel separating Manhattan (Midtown East / Upper East Side / East Harlem) from Queens & Brooklyn
  if (lat >= 40.778 && lat <= 40.805) {
    return lon > -73.928 ? 'Queens' : 'Manhattan';
  }
  if (lat >= 40.762 && lat < 40.778) {
    return lon > -73.940 ? 'Queens' : 'Manhattan';
  }
  if (lat >= 40.738 && lat < 40.762) {
    return lon > -73.958 ? 'Queens' : 'Manhattan';
  }
  if (lat >= 40.702 && lat < 40.738) {
    if (lon > -73.972) {
      return lat >= 40.735 && lon > -73.94 ? 'Queens' : 'Brooklyn';
    }
    return 'Manhattan';
  }
  return 'Manhattan';
}

const VALID_SUBWAY_ROUTE_TOKENS = new Set<string>([
  '1', '2', '3', '4', '5', '6', '6X', '7', '7X',
  'A', 'B', 'C', 'D', 'E', 'F', 'FX', 'G', 'J', 'L',
  'M', 'N', 'Q', 'R', 'S', 'GS', 'FS', 'H', 'W', 'Z',
  'SIR', 'SI',
]);

/**
 * Extracts route bullet identifiers from parenthetical suffixes in station names,
 * such as "Lexington Av/53 St (E,M)" -> ['E', 'M'] or "Steinway St (M,R)" -> ['M', 'R'].
 * Non-route parentheticals like "(Brighton)" or "(8 Av)" are ignored.
 */
export function extractRoutesFromStationText(rawName: string): string[] {
  if (!rawName) return [];
  const extracted: string[] = [];
  const regex = /\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(rawName)) !== null) {
    const inner = match[1]?.trim() ?? '';
    if (!inner) continue;
    const tokens = inner
      .split(/[\s,/&-]+/)
      .map(t => t.replace(/^<|>$/g, '').trim().toUpperCase())
      .filter(Boolean);
    if (tokens.length > 0 && tokens.every(t => VALID_SUBWAY_ROUTE_TOKENS.has(t))) {
      for (const t of tokens) {
        if (!extracted.includes(t)) {
          extracted.push(t);
        }
      }
    }
  }
  return extracted;
}

/**
 * Normalizes a route string or array of route strings into deduplicated route bullet tokens.
 */
export function normalizeStationRoutes(routesInput: string | readonly string[] | undefined | null): string[] {
  if (!routesInput) return [];
  const rawList = Array.isArray(routesInput) ? routesInput : [String(routesInput)];
  const result: string[] = [];
  for (const item of rawList) {
    const tokens = String(item ?? '')
      .split(/[\s,/-]+/)
      .map(t => {
        const cleaned = t.replace(/^<|>$/g, '').replace(/^([67F])X$/i, '$1').trim().toUpperCase();
        if (cleaned === 'GS' || cleaned === 'FS') return 'S';
        return cleaned;
      })
      .filter(Boolean);
    for (const token of tokens) {
      if (!result.includes(token)) {
        result.push(token);
      }
    }
  }
  return result;
}

export function getStopPillIconId(routesInput: string | readonly string[]): string {
  const routes = normalizeStationRoutes(routesInput);
  return `stop-pill-${routes.length > 0 ? routes.join('-') : '1'}`;
}

export function getStationLabelOffset(routeCount: number): [number, number] {
  const clampedCount = Math.max(1, Math.min(6, routeCount));
  if (clampedCount === 1) return [9, 0];
  return [Math.round(6 + clampedCount * 4.5), 0];
}

// Dynamic station cache populated at runtime (subway vs agency-scoped commuter/bus stations)
const SUBWAY_STATION_AGENCIES = new Set(['MTA_NYCT_SUBWAY', 'MTA_NYCT_SIR', 'MTA_SIR']);
const dynamicStationCache = new Map<string, StationInfo>();
const nonSubwayStationCache = new Map<string, StationInfo>();

export function hydrateStationCache(rows: readonly Record<string, unknown>[]): void {
  for (const r of rows) {
    const rawAgency = String(r['agency_id'] ?? '').trim().toUpperCase();
    const isNonSubwayAgency = rawAgency.length > 0 && !SUBWAY_STATION_AGENCIES.has(rawAgency);
    const defaultRoute = r['route_id'] ? normalizeStationRoutes(String(r['route_id'])) : [];
    const rowRoutes = normalizeStationRoutes(
      (r['daytime_routes'] ?? r['routes'] ?? '') as string
    );

    const registerStation = (
      rawId: unknown,
      rawName: unknown,
      rawLat: unknown,
      rawLon: unknown,
      rawBorough?: unknown,
      extraRoutes?: unknown
    ) => {
      const id = String(rawId ?? '').trim();
      if (!id) return;
      const cleanId = isNonSubwayAgency ? id : id.replace(/[NS]$/, '');
      const lat = Number(rawLat ?? 0);
      const lon = Number(rawLon ?? 0);
      if (isNaN(lat) || isNaN(lon) || lat === 0 || lon === 0) return;

      if (isNonSubwayAgency) {
        const scopedKey = `${rawAgency}:${cleanId}`;
        const existing = nonSubwayStationCache.get(scopedKey);
        const rawNameStr = String(rawName ?? existing?.name ?? cleanId).trim();
        const cleanName = cleanStationLabelText(rawNameStr) || existing?.name || cleanId;
        const rawBoro = rawBorough !== undefined && rawBorough !== null ? String(rawBorough).trim() : '';
        const borough = rawBoro || existing?.borough || inferBoroughFromCoords(lat, lon);
        nonSubwayStationCache.set(scopedKey, {
          stationId: cleanId,
          name: cleanName,
          lat,
          lon,
          borough,
          routes: existing?.routes ?? [],
        });
        return;
      }

      const existing = dynamicStationCache.get(cleanId);
      const rawNameStr = String(rawName ?? existing?.name ?? cleanId).trim();
      const parentheticalRoutes = extractRoutesFromStationText(rawNameStr);
      const parsedExtraRoutes = normalizeStationRoutes(extraRoutes as string | readonly string[] | undefined);
      const cleanName = cleanStationLabelText(rawNameStr) || existing?.name || cleanId;
      const rawBoro = rawBorough !== undefined && rawBorough !== null ? String(rawBorough).trim() : '';
      const borough = rawBoro || existing?.borough || inferBoroughFromCoords(lat, lon);

      const mergedRoutes = normalizeStationRoutes([
        ...(existing?.routes ?? []),
        ...defaultRoute,
        ...rowRoutes,
        ...parsedExtraRoutes,
        ...parentheticalRoutes,
      ]);

      dynamicStationCache.set(cleanId, {
        stationId: cleanId,
        name: cleanName,
        lat,
        lon,
        borough,
        routes: mergedRoutes,
      });
    };

    registerStation(
      r['station_id'] ?? r['gtfs_stop_id'] ?? r['parent_station_id'],
      r['station_name'] ?? r['name'],
      r['latitude'] ?? r['lat'] ?? r['st_lat'],
      r['longitude'] ?? r['lon'] ?? r['st_lon'],
      r['borough'] ?? r['boro_name'],
      r['daytime_routes'] ?? r['routes']
    );

    if (r['from_station_id']) {
      registerStation(
        r['from_station_id'],
        r['from_station_name'],
        r['from_lat'],
        r['from_lon'],
        undefined,
        r['from_routes']
      );
    }

    if (r['to_station_id']) {
      registerStation(
        r['to_station_id'],
        r['to_station_name'],
        r['to_lat'],
        r['to_lon'],
        undefined,
        r['to_routes']
      );
    }
  }
}

export function resolveStationInfo(stationId: string, agencyId?: string): StationInfo | null {
  const rawTrimmed = stationId.trim();
  if (!rawTrimmed) return null;
  const agUpper = String(agencyId ?? '').trim().toUpperCase();
  if (agUpper && !SUBWAY_STATION_AGENCIES.has(agUpper)) {
    return (
      nonSubwayStationCache.get(`${agUpper}:${rawTrimmed}`) ??
      nonSubwayStationCache.get(`${agUpper}:${rawTrimmed.replace(/[NS]$/, '')}`) ??
      null
    );
  }
  const clean = rawTrimmed.replace(/[NS]$/, '');
  if (activeMapNetworkData && activeMapNetworkData.stations[clean]) {
    return activeMapNetworkData.stations[clean]!;
  }
  if (dynamicStationCache.has(clean)) {
    return dynamicStationCache.get(clean)!;
  }
  return null;
}

export interface StationChainProjection {
  readonly chainIndex: number;
  readonly arcLen: number;
  readonly distSq: number;
  readonly point: [number, number];
}

interface ChainProjection extends StationChainProjection {
  readonly segIndex: number;
  readonly t: number;
}

function projectPointOntoChain(
  lon: number,
  lat: number,
  chain: readonly [number, number][],
  chainIndex: number
): ChainProjection {
  let bestDistSq = Infinity;
  let bestSeg = 0;
  let bestT = 0;
  let bestArcLen = 0;
  let bestPoint: [number, number] = [lon, lat];
  let cumLen = 0;

  for (let i = 0; i < chain.length - 1; i++) {
    const [x1, y1] = chain[i]!;
    const [x2, y2] = chain[i + 1]!;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const segLenSq = dx * dx + dy * dy;
    const segLen = Math.sqrt(segLenSq);

    let t = 0;
    if (segLenSq > 1e-12) {
      t = Math.max(0, Math.min(1, ((lon - x1) * dx + (lat - y1) * dy) / segLenSq));
    }
    const px = x1 + t * dx;
    const py = y1 + t * dy;
    const dSq = (lon - px) * (lon - px) + (lat - py) * (lat - py);
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestSeg = i;
      bestT = t;
      bestArcLen = cumLen + t * segLen;
      bestPoint = [px, py];
    }
    cumLen += segLen;
  }

  return {
    chainIndex,
    segIndex: bestSeg,
    t: bestT,
    arcLen: bestArcLen,
    distSq: bestDistSq,
    point: bestPoint,
  };
}

const serviceLineChainsCache = new Map<string, [number, number][][]>();

export interface AuxiliaryCorridorSpec {
  readonly id: string;
  readonly agencyId:
    | 'MTA_METRO_NORTH'
    | 'MTA_LIRR'
    | 'PORT_AUTHORITY_PATH'
    | 'NJ_TRANSIT'
    | 'MTA_BUS';
  readonly badge: string;
  readonly name: string;
  readonly colorHex: string;
  readonly aliases: readonly string[];
  readonly chains: readonly (readonly [number, number][])[];
}

export function getActiveAuxiliaryCorridors(
  networkData?: MapNetworkData
): readonly AuxiliaryCorridorSpec[] {
  const net = networkData ?? activeMapNetworkData;
  return net?.auxiliaryCorridors ?? [];
}

export function isAuxiliaryRouteKey(routeId: string): boolean {
  const normalized = routeId
    .trim()
    .replace(/^<|>$/g, '')
    .toUpperCase();
  if (!normalized) return false;
  if (
    normalized.startsWith('MTA_LIRR:') ||
    normalized.startsWith('MTA_METRO_NORTH:') ||
    normalized.startsWith('PORT_AUTHORITY_PATH:') ||
    normalized.startsWith('PATH:') ||
    normalized.startsWith('PA_PATH:') ||
    normalized.startsWith('NJ_TRANSIT:') ||
    normalized.startsWith('MTA_BUS:')
  ) {
    return true;
  }
  for (const spec of getActiveAuxiliaryCorridors()) {
    if (
      spec.badge.toUpperCase() === normalized ||
      spec.aliases.some(a => a.toUpperCase() === normalized)
    ) {
      return true;
    }
  }
  return resolveCommuterOrBusRouteSpec(normalized) !== null;
}

function resolveAuxiliaryCorridorChains(normalizedRoute: string): [number, number][][] | null {
  const corridors = getActiveAuxiliaryCorridors();
  const direct = corridors.find(
    c =>
      c.id.toUpperCase() === normalizedRoute ||
      `${c.agencyId}:${c.badge}`.toUpperCase() === normalizedRoute ||
      c.aliases.some(a => a.toUpperCase() === normalizedRoute)
  );
  if (direct) {
    return direct.chains.map(ch => ch.map(pt => [pt[0], pt[1]] as [number, number]));
  }
  if (normalizedRoute.startsWith('MTA_METRO_NORTH:')) {
    return corridors
      .filter(c => c.agencyId === 'MTA_METRO_NORTH')
      .flatMap(c => c.chains.map(ch => ch.map(pt => [pt[0], pt[1]] as [number, number])));
  }
  if (normalizedRoute.startsWith('MTA_LIRR:')) {
    return corridors
      .filter(c => c.agencyId === 'MTA_LIRR')
      .flatMap(c => c.chains.map(ch => ch.map(pt => [pt[0], pt[1]] as [number, number])));
  }
  if (
    normalizedRoute.startsWith('PORT_AUTHORITY_PATH:') ||
    normalizedRoute.startsWith('PATH:') ||
    normalizedRoute.startsWith('PA_PATH:')
  ) {
    return corridors
      .filter(c => c.agencyId === 'PORT_AUTHORITY_PATH')
      .flatMap(c => c.chains.map(ch => ch.map(pt => [pt[0], pt[1]] as [number, number])));
  }
  if (normalizedRoute.startsWith('NJ_TRANSIT:')) {
    return corridors
      .filter(c => c.agencyId === 'NJ_TRANSIT')
      .flatMap(c => c.chains.map(ch => ch.map(pt => [pt[0], pt[1]] as [number, number])));
  }
  if (normalizedRoute.startsWith('MTA_BUS:')) {
    return corridors
      .filter(c => c.agencyId === 'MTA_BUS')
      .flatMap(c => c.chains.map(ch => ch.map(pt => [pt[0], pt[1]] as [number, number])));
  }
  return null;
}

function parseChainsFromServiceLine(
  routeId: string,
  serviceLineGeoJson?: unknown
): [number, number][][] {
  if (serviceLineGeoJson) {
    try {
      const geom =
        typeof serviceLineGeoJson === 'string'
          ? JSON.parse(serviceLineGeoJson)
          : serviceLineGeoJson;
      if (geom && typeof geom === 'object') {
        const g = geom as { type?: string; coordinates?: unknown };
        if (g.type === 'MultiLineString' && Array.isArray(g.coordinates)) {
          return g.coordinates as [number, number][][];
        }
        if (g.type === 'LineString' && Array.isArray(g.coordinates)) {
          return [g.coordinates as [number, number][]];
        }
      }
    } catch {
      // Fall back to active or bundled service lines
    }
  }

  const normalizedRoute = routeId
    .trim()
    .replace(/^<|>$/g, '')
    .toUpperCase();
  const cached = serviceLineChainsCache.get(normalizedRoute);
  if (cached) {
    return cached;
  }

  const auxChains = resolveAuxiliaryCorridorChains(normalizedRoute);
  if (auxChains) {
    serviceLineChainsCache.set(normalizedRoute, auxChains);
    return auxChains;
  }

  const rawBaseRoute = normalizedRoute.replace(/X$/i, '');
  const baseRoute = rawBaseRoute === 'GS' ? 'S' : rawBaseRoute;
  const sourceFc = activeMapNetworkData?.serviceLines ?? { type: 'FeatureCollection', features: [] };
  const fc = sourceFc as unknown as {
    features?: Array<{
      properties?: { route_id?: string };
      geometry?: { type?: string; coordinates?: unknown };
    }>;
  };
  const extractChains = (g: { type?: string; coordinates?: unknown }): [number, number][][] => {
    if (g.type === 'MultiLineString' && Array.isArray(g.coordinates)) {
      return g.coordinates as [number, number][][];
    }
    if (g.type === 'LineString' && Array.isArray(g.coordinates)) {
      return [g.coordinates as [number, number][]];
    }
    return [];
  };

  let matchingFeats =
    fc.features?.filter(f => String(f.properties?.route_id ?? '').toUpperCase() === normalizedRoute) ?? [];
  if (matchingFeats.length === 0) {
    matchingFeats =
      fc.features?.filter(f => String(f.properties?.route_id ?? '').toUpperCase() === baseRoute) ?? [];
  }
  if (matchingFeats.length === 0 && normalizedRoute === 'SIR') {
    matchingFeats =
      fc.features?.filter(f => String(f.properties?.route_id ?? '').toUpperCase() === 'SI') ?? [];
  }

  const primaryChains: [number, number][][] = [];
  for (const feat of matchingFeats) {
    if (feat?.geometry) {
      primaryChains.push(...extractChains(feat.geometry));
    }
  }

  if (primaryChains.length === 0) {
    serviceLineChainsCache.set(normalizedRoute, []);
    return [];
  }
  const augmentedChains: [number, number][][] = [...primaryChains];

  // For multi-chain routes (e.g. A with Rockaway Park & Lefferts branches, 5 with Dyre & Nereid),
  // graft each branch chain onto the main trunk chain at their wye junction so legs crossing
  // the wye (e.g. Broad Channel H04 -> Beach 90 St H12, Rockaway Blvd A55 -> Ozone Park A65)
  // lie on a single continuous chain.
  if (primaryChains.length > 1 && primaryChains[0] && primaryChains[0].length >= 2) {
    const trunk = primaryChains[0];
    for (let b = 1; b < primaryChains.length; b++) {
      const branch = primaryChains[b];
      if (!branch || branch.length < 2) continue;
      const bStart = branch[0]!;
      const bEnd = branch[branch.length - 1]!;
      let bestStartIdx = 0;
      let bestStartDistSq = Infinity;
      let bestEndIdx = 0;
      let bestEndDistSq = Infinity;
      for (let idx = 0; idx < trunk.length; idx++) {
        const pt = trunk[idx]!;
        const ds = (pt[0] - bStart[0]) * (pt[0] - bStart[0]) + (pt[1] - bStart[1]) * (pt[1] - bStart[1]);
        const de = (pt[0] - bEnd[0]) * (pt[0] - bEnd[0]) + (pt[1] - bEnd[1]) * (pt[1] - bEnd[1]);
        if (ds < bestStartDistSq) {
          bestStartDistSq = ds;
          bestStartIdx = idx;
        }
        if (de < bestEndDistSq) {
          bestEndDistSq = de;
          bestEndIdx = idx;
        }
      }
      if (Math.min(bestStartDistSq, bestEndDistSq) <= 0.002 * 0.002) {
        if (bestStartDistSq <= bestEndDistSq) {
          // Branch starts at trunk[bestStartIdx]
          augmentedChains.push([...branch.slice().reverse(), ...trunk.slice(bestStartIdx + 1)]);
          augmentedChains.push([...trunk.slice(0, bestStartIdx + 1), ...branch.slice(1)]);
        } else {
          // Branch ends at trunk[bestEndIdx]
          augmentedChains.push([...branch, ...trunk.slice(bestEndIdx + 1)]);
          augmentedChains.push([...trunk.slice(0, bestEndIdx + 1), ...branch.slice(0, -1).reverse()]);
        }
      }
    }
  }

  if (baseRoute === 'F' || baseRoute === 'M') {
    const companionId = baseRoute === 'F' ? 'M' : 'F';
    const companionFeat = fc.features?.find(
      f => String(f.properties?.route_id ?? '').toUpperCase() === companionId
    );
    if (companionFeat?.geometry) {
      const result = [...augmentedChains, ...extractChains(companionFeat.geometry)];
      serviceLineChainsCache.set(normalizedRoute, result);
      return result;
    }
  }

  if (baseRoute === 'S') {
    for (const shuttleId of ['FS', 'H']) {
      const sFeat = fc.features?.find(
        f => String(f.properties?.route_id ?? '').toUpperCase() === shuttleId
      );
      if (sFeat?.geometry) {
        augmentedChains.push(...extractChains(sFeat.geometry));
      }
    }
  }

  serviceLineChainsCache.set(normalizedRoute, augmentedChains);
  return augmentedChains;
}

/**
 * Projects a station coordinate onto the nearest polyline chain of `routeId`'s service line.
 */
export function projectStationOntoServiceLine(
  routeId: string,
  lon: number,
  lat: number,
  serviceLineGeoJson?: unknown
): StationChainProjection | null {
  const chains = parseChainsFromServiceLine(routeId, serviceLineGeoJson);
  if (chains.length === 0) return null;

  let bestProj: ChainProjection | null = null;
  for (let c = 0; c < chains.length; c++) {
    const chain = chains[c]!;
    if (chain.length < 2) continue;
    const p = projectPointOntoChain(lon, lat, chain, c);
    // Prefer primary chain 0 whenever station is within ~150m of it so shared corridors stay on chainIndex 0
    if (c === 0 && p.distSq <= 0.0015 * 0.0015) {
      bestProj = p;
      break;
    }
    if (!bestProj || p.distSq < bestProj.distSq) {
      bestProj = p;
    }
  }
  if (!bestProj) return null;
  return {
    chainIndex: bestProj.chainIndex,
    arcLen: bestProj.arcLen,
    distSq: bestProj.distSq,
    point: bestProj.point,
  };
}

/**
 * Slices the curved track geometry between (fromLon, fromLat) and (toLon, toLat)
 * along the canonical MTA Subway Service Line for `routeId`.
 * When `strictSnap` is true, returns `[]` if either endpoint is > ~400m (`0.004` deg)
 * from the route's service line or if the arc detours > 2.1x chord distance, and
 * snaps segment endpoints directly onto the `s692-irgq` track centerline.
 */
export function extractCurvedSegmentAlongServiceLine(
  routeId: string,
  fromLon: number,
  fromLat: number,
  toLon: number,
  toLat: number,
  serviceLineGeoJson?: unknown,
  strictSnap?: boolean
): [number, number][] {
  const direct: [number, number][] = [
    [fromLon, fromLat],
    [toLon, toLat],
  ];
  const chains = parseChainsFromServiceLine(routeId, serviceLineGeoJson);
  if (chains.length === 0) return direct;

  let bestChain: [number, number][] | null = null;
  let bestP1: ChainProjection | null = null;
  let bestP2: ChainProjection | null = null;
  let bestWorstDistSq = Infinity;

  for (let c = 0; c < chains.length; c++) {
    const chain = chains[c]!;
    if (chain.length < 2) continue;
    const p1 = projectPointOntoChain(fromLon, fromLat, chain, c);
    const p2 = projectPointOntoChain(toLon, toLat, chain, c);
    const worstDistSq = Math.max(p1.distSq, p2.distSq);
    if (worstDistSq < bestWorstDistSq) {
      bestWorstDistSq = worstDistSq;
      bestChain = chain;
      bestP1 = p1;
      bestP2 = p2;
    }
  }

  const directDist = Math.hypot(toLon - fromLon, toLat - fromLat);
  const arcSpan = bestP1 && bestP2 ? Math.abs(bestP2.arcLen - bestP1.arcLen) : Infinity;
  const maxSnapDist = strictSnap ? 0.004 : 0.008;
  const maxDetourRatio = strictSnap ? 2.1 : 2.2;

  if (
    !bestChain ||
    !bestP1 ||
    !bestP2 ||
    bestWorstDistSq > maxSnapDist * maxSnapDist ||
    arcSpan > Math.max(directDist * maxDetourRatio, 0.008)
  ) {
    return strictSnap ? [] : direct;
  }

  const forward = bestP1.arcLen <= bestP2.arcLen;
  const startProj = forward ? bestP1 : bestP2;
  const endProj = forward ? bestP2 : bestP1;

  const intermediate: [number, number][] = [];
  for (let idx = startProj.segIndex + 1; idx <= endProj.segIndex; idx++) {
    const v = bestChain[idx];
    if (v) {
      intermediate.push([v[0], v[1]]);
    }
  }

  if (!forward) {
    intermediate.reverse();
  }

  if (strictSnap) {
    const snapped: [number, number][] = [bestP1.point];
    for (const [vx, vy] of intermediate) {
      const prev = snapped[snapped.length - 1]!;
      const dPrev = (vx - prev[0]) * (vx - prev[0]) + (vy - prev[1]) * (vy - prev[1]);
      const dEnd =
        (vx - bestP2.point[0]) * (vx - bestP2.point[0]) +
        (vy - bestP2.point[1]) * (vy - bestP2.point[1]);
      if (dPrev > 1e-10 && dEnd > 1e-10) {
        snapped.push([vx, vy]);
      }
    }
    const last = snapped[snapped.length - 1]!;
    const dLast =
      (bestP2.point[0] - last[0]) * (bestP2.point[0] - last[0]) +
      (bestP2.point[1] - last[1]) * (bestP2.point[1] - last[1]);
    if (dLast > 1e-10) {
      snapped.push(bestP2.point);
    }
    return snapped.length >= 2 ? snapped : direct;
  }

  // Include projected track points when station centroids sit slightly off the service line centerline
  const candidateInterior: [number, number][] = [
    bestP1.point,
    ...intermediate,
    bestP2.point,
  ];

  // Filter out interior vertices nearly identical to the endpoints or previous point
  const filtered: [number, number][] = [];
  let prevX = fromLon;
  let prevY = fromLat;
  for (const [vx, vy] of candidateInterior) {
    const dPrev = (vx - prevX) * (vx - prevX) + (vy - prevY) * (vy - prevY);
    const dEnd = (vx - toLon) * (vx - toLon) + (vy - toLat) * (vy - toLat);
    if (dPrev > 1e-9 && dEnd > 1e-9) {
      filtered.push([vx, vy]);
      prevX = vx;
      prevY = vy;
    }
  }

  if (filtered.length === 0) {
    return direct;
  }

  return [[fromLon, fromLat], ...filtered, [toLon, toLat]];
}

function listActiveSubwayRouteIds(): string[] {
  const sourceFc = activeMapNetworkData?.serviceLines ?? { type: 'FeatureCollection', features: [] };
  const fc = sourceFc as unknown as {
    features?: Array<{ properties?: { route_id?: string } }>;
  };
  const seen = new Set<string>();
  const out: string[] = [];
  for (const feat of fc.features ?? []) {
    const r = String(feat.properties?.route_id ?? '').trim().toUpperCase();
    if (r && !seen.has(r)) {
      seen.add(r);
      out.push(r);
    }
  }
  return out;
}

function computeSegmentBearing(a: [number, number], b: [number, number], dirSign = 1): number {
  const dx = (b[0] - a[0]) * dirSign * Math.cos(((a[1] + b[1]) * 0.5 * Math.PI) / 180);
  const dy = (b[1] - a[1]) * dirSign;
  if (dx === 0 && dy === 0) return 0;
  const raw = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  return raw === 0 ? 360 : raw;
}

/**
 * Snaps a coordinate onto the nearest subway service line track (preferring `routeId`'s own chains
 * within ~350m, then searching all network subway routes within `maxDistDeg` so rerouted trains
 * e.g. `2` on New Lots, `N` on 2nd Ave, `E` on Hillside stay strictly on physical rails).
 */
export function snapPointToSubwayTrack(
  routeId: string,
  lon: number,
  lat: number,
  serviceLineGeoJson?: unknown,
  maxDistDeg = 0.0045
): { lon: number; lat: number; bearing: number; distSq: number; matchedRouteId: string; chainIndex: number } | null {
  const maxDistSq = maxDistDeg * maxDistDeg;
  const ownChains = parseChainsFromServiceLine(routeId, serviceLineGeoJson);
  let bestOwn: { proj: ChainProjection; chain: [number, number][]; cIdx: number } | null = null;

  for (let c = 0; c < ownChains.length; c++) {
    const chain = ownChains[c]!;
    if (chain.length < 2) continue;
    const p = projectPointOntoChain(lon, lat, chain, c);
    if (!bestOwn || p.distSq < bestOwn.proj.distSq) {
      bestOwn = { proj: p, chain, cIdx: c };
    }
  }

  if (bestOwn && bestOwn.proj.distSq <= Math.min(maxDistSq, 0.0035 * 0.0035)) {
    const segIdx = Math.min(bestOwn.proj.segIndex, bestOwn.chain.length - 2);
    const brg = computeSegmentBearing(bestOwn.chain[segIdx]!, bestOwn.chain[segIdx + 1]!);
    return {
      lon: bestOwn.proj.point[0],
      lat: bestOwn.proj.point[1],
      bearing: brg,
      distSq: bestOwn.proj.distSq,
      matchedRouteId: routeId,
      chainIndex: bestOwn.cIdx,
    };
  }

  const isAuxRoute = isAuxiliaryRouteKey(routeId);
  if (serviceLineGeoJson || isAuxRoute) {
    if (bestOwn && bestOwn.proj.distSq <= maxDistSq) {
      const segIdx = Math.min(bestOwn.proj.segIndex, bestOwn.chain.length - 2);
      const brg = computeSegmentBearing(bestOwn.chain[segIdx]!, bestOwn.chain[segIdx + 1]!);
      return {
        lon: bestOwn.proj.point[0],
        lat: bestOwn.proj.point[1],
        bearing: brg,
        distSq: bestOwn.proj.distSq,
        matchedRouteId: routeId,
        chainIndex: bestOwn.cIdx,
      };
    }
    return null;
  }

  let bestAny: {
    proj: ChainProjection;
    chain: [number, number][];
    route: string;
    cIdx: number;
  } | null = bestOwn
    ? { proj: bestOwn.proj, chain: bestOwn.chain, route: routeId, cIdx: bestOwn.cIdx }
    : null;

  for (const candRoute of listActiveSubwayRouteIds()) {
    const chains = parseChainsFromServiceLine(candRoute);
    for (let c = 0; c < chains.length; c++) {
      const chain = chains[c]!;
      if (chain.length < 2) continue;
      const p = projectPointOntoChain(lon, lat, chain, c);
      if (!bestAny || p.distSq < bestAny.proj.distSq) {
        bestAny = { proj: p, chain, route: candRoute, cIdx: c };
      }
    }
  }

  if (!bestAny || bestAny.proj.distSq > maxDistSq) {
    return null;
  }

  const segIdx = Math.min(bestAny.proj.segIndex, bestAny.chain.length - 2);
  const brg = computeSegmentBearing(bestAny.chain[segIdx]!, bestAny.chain[segIdx + 1]!);
  return {
    lon: bestAny.proj.point[0],
    lat: bestAny.proj.point[1],
    bearing: brg,
    distSq: bestAny.proj.distSq,
    matchedRouteId: bestAny.route,
    chainIndex: bestAny.cIdx,
  };
}

function sliceChainBetweenProjections(
  chain: readonly [number, number][],
  p1: ChainProjection,
  p2: ChainProjection
): [number, number][] {
  const forward = p1.arcLen <= p2.arcLen;
  const startProj = forward ? p1 : p2;
  const endProj = forward ? p2 : p1;
  const intermediate: [number, number][] = [];
  for (let idx = startProj.segIndex + 1; idx <= endProj.segIndex; idx++) {
    const v = chain[idx];
    if (v) intermediate.push([v[0], v[1]]);
  }
  if (!forward) intermediate.reverse();

  const out: [number, number][] = [p1.point];
  for (const [vx, vy] of intermediate) {
    const prev = out[out.length - 1]!;
    const dPrev = (vx - prev[0]) * (vx - prev[0]) + (vy - prev[1]) * (vy - prev[1]);
    const dEnd = (vx - p2.point[0]) * (vx - p2.point[0]) + (vy - p2.point[1]) * (vy - p2.point[1]);
    if (dPrev > 1e-10 && dEnd > 1e-10) {
      out.push([vx, vy]);
    }
  }
  const last = out[out.length - 1]!;
  const dLast =
    (p2.point[0] - last[0]) * (p2.point[0] - last[0]) +
    (p2.point[1] - last[1]) * (p2.point[1] - last[1]);
  if (dLast > 1e-10) {
    out.push(p2.point);
  }
  return out;
}

/**
 * Slices continuous track geometry along `routeId`'s service-line chain specifically for live/timelapse
 * vehicle trajectories (supporting sharp tunnel curves, East River S-bends, and multi-station express runs).
 */
function extractTrajectoryChainSlice(
  routeId: string,
  fromLon: number,
  fromLat: number,
  toLon: number,
  toLat: number,
  serviceLineGeoJson?: unknown
): [number, number][] {
  const chains = parseChainsFromServiceLine(routeId, serviceLineGeoJson);
  if (chains.length === 0) return [];

  const isAuxRoute = isAuxiliaryRouteKey(routeId);
  const maxSnapDist = isAuxRoute ? 0.015 : 0.0055;
  const maxDetourRatio = 6.5;

  let bestChain: [number, number][] | null = null;
  let bestP1: ChainProjection | null = null;
  let bestP2: ChainProjection | null = null;
  let bestWorstDistSq = Infinity;
  let bestArcSpan = Infinity;

  for (let c = 0; c < chains.length; c++) {
    const chain = chains[c]!;
    if (chain.length < 2) continue;
    const p1 = projectPointOntoChain(fromLon, fromLat, chain, c);
    const p2 = projectPointOntoChain(toLon, toLat, chain, c);
    const worstDistSq = Math.max(p1.distSq, p2.distSq);
    const arcSpan = Math.abs(p2.arcLen - p1.arcLen);
    if (
      worstDistSq <= maxSnapDist * maxSnapDist &&
      (worstDistSq < bestWorstDistSq - 1e-8 ||
        (Math.abs(worstDistSq - bestWorstDistSq) <= 1e-8 && arcSpan < bestArcSpan))
    ) {
      bestWorstDistSq = worstDistSq;
      bestArcSpan = arcSpan;
      bestChain = chain;
      bestP1 = p1;
      bestP2 = p2;
    }
  }

  const directDist = Math.hypot(toLon - fromLon, toLat - fromLat);
  if (
    !bestChain ||
    !bestP1 ||
    !bestP2 ||
    bestWorstDistSq > maxSnapDist * maxSnapDist ||
    bestArcSpan > Math.max(directDist * maxDetourRatio, 0.15)
  ) {
    return [];
  }

  const sliced = sliceChainBetweenProjections(bestChain, bestP1, bestP2);
  return sliced.length >= 2 ? sliced : [bestP1.point, bestP2.point];
}

/**
 * Bridges two adjacent subway service-line chains through their nearest track junction / wye
 * (within ~450m) so inter-line switches (e.g. 5 at 149 St-Grand Concourse, N onto 2nd Ave Q,
 * 2 onto New Lots 3/4) trace continuous rails without cutting across rivers or blocks.
 */
function extractTwoChainJunctionSegment(
  routeA: string,
  chainIdxA: number,
  fromLon: number,
  fromLat: number,
  routeB: string,
  chainIdxB: number,
  toLon: number,
  toLat: number
): [number, number][] {
  const chainsA = parseChainsFromServiceLine(routeA);
  const chainsB = parseChainsFromServiceLine(routeB);
  const chainA = chainsA[chainIdxA];
  const chainB = chainsB[chainIdxB];
  if (!chainA || !chainB || chainA.length < 2 || chainB.length < 2) return [];

  const p1 = projectPointOntoChain(fromLon, fromLat, chainA, chainIdxA);
  const p2 = projectPointOntoChain(toLon, toLat, chainB, chainIdxB);
  const directDist = Math.hypot(toLon - fromLon, toLat - fromLat);
  const maxTotalArc = Math.max(directDist * 6.5, 0.15);
  const maxJunctionDistSq = 0.0045 * 0.0045;

  let bestArcTotal = Infinity;
  let bestJuncA: ChainProjection | null = null;
  let bestJuncB: ChainProjection | null = null;

  for (let i = 0; i < chainA.length; i++) {
    const [vx, vy] = chainA[i]!;
    const projB = projectPointOntoChain(vx, vy, chainB, chainIdxB);
    if (projB.distSq > maxJunctionDistSq) continue;
    const projA = projectPointOntoChain(vx, vy, chainA, chainIdxA);
    const totalArc = Math.abs(projA.arcLen - p1.arcLen) + Math.abs(p2.arcLen - projB.arcLen);
    if (totalArc <= maxTotalArc && totalArc < bestArcTotal) {
      bestArcTotal = totalArc;
      bestJuncA = projA;
      bestJuncB = projB;
    }
  }

  for (let j = 0; j < chainB.length; j++) {
    const [vx, vy] = chainB[j]!;
    const projA = projectPointOntoChain(vx, vy, chainA, chainIdxA);
    if (projA.distSq > maxJunctionDistSq) continue;
    const projB = projectPointOntoChain(vx, vy, chainB, chainIdxB);
    const totalArc = Math.abs(projA.arcLen - p1.arcLen) + Math.abs(p2.arcLen - projB.arcLen);
    if (totalArc <= maxTotalArc && totalArc < bestArcTotal) {
      bestArcTotal = totalArc;
      bestJuncA = projA;
      bestJuncB = projB;
    }
  }

  if (!bestJuncA || !bestJuncB) return [];
  const leg1 = sliceChainBetweenProjections(chainA, p1, bestJuncA);
  const leg2 = sliceChainBetweenProjections(chainB, bestJuncB, p2);
  if (leg1.length === 0 || leg2.length === 0) return [];
  return [...leg1, ...leg2.slice(1)];
}

/**
 * Interpolates a position and compass bearing (0-360 deg clockwise from North) at `ratio` in [0, 1]
 * along the curved MTA service line between (fromLon, fromLat) and (toLon, toLat).
 */
export function interpolateAlongServiceLine(
  routeId: string,
  fromLon: number,
  fromLat: number,
  toLon: number,
  toLat: number,
  ratio: number,
  serviceLineGeoJson?: unknown
): { lon: number; lat: number; bearing: number } {
  const clamped = Math.max(0, Math.min(1, ratio));
  let curve = extractTrajectoryChainSlice(
    routeId,
    fromLon,
    fromLat,
    toLon,
    toLat,
    serviceLineGeoJson
  );

  const isAuxRoute = isAuxiliaryRouteKey(routeId);

  // Fallback 1: Rerouted or shared-corridor subway train (e.g. 2 on New Lots 3/4, N on 2nd Ave Q, E on Hillside F)
  if (curve.length < 2 && !serviceLineGeoJson && !isAuxRoute) {
    let bestRouteCurve: [number, number][] = [];
    let bestCurveLen = Infinity;
    for (const candRoute of listActiveSubwayRouteIds()) {
      const candCurve = extractTrajectoryChainSlice(
        candRoute,
        fromLon,
        fromLat,
        toLon,
        toLat
      );
      if (candCurve.length >= 2) {
        let len = 0;
        for (let i = 0; i < candCurve.length - 1; i++) {
          len += Math.hypot(
            candCurve[i + 1]![0] - candCurve[i]![0],
            candCurve[i + 1]![1] - candCurve[i]![1]
          );
        }
        if (len < bestCurveLen) {
          bestCurveLen = len;
          bestRouteCurve = candCurve;
        }
      }
    }
    if (bestRouteCurve.length >= 2) {
      curve = bestRouteCurve;
    }
  }

  // Fallback 2: Two-chain track junction / wye switch between intersecting subway lines
  const endpointSnapRadius = isAuxRoute ? 0.015 : 0.0055;
  const s1 = snapPointToSubwayTrack(routeId, fromLon, fromLat, serviceLineGeoJson, endpointSnapRadius);
  const s2 = snapPointToSubwayTrack(routeId, toLon, toLat, serviceLineGeoJson, endpointSnapRadius);
  if (curve.length < 2 && !serviceLineGeoJson && s1 && s2) {
    const bridged = extractTwoChainJunctionSegment(
      s1.matchedRouteId,
      s1.chainIndex,
      fromLon,
      fromLat,
      s2.matchedRouteId,
      s2.chainIndex,
      toLon,
      toLat
    );
    if (bridged.length >= 2) {
      curve = bridged;
    }
  }

  if (curve.length < 2) {
    // If either endpoint lies outside the subway track network (e.g. synthetic unit-test coordinates), allow linear interpolation
    if (!s1 || !s2) {
      const lon = fromLon + (toLon - fromLon) * clamped;
      const lat = fromLat + (toLat - fromLat) * clamped;
      const bearing = computeSegmentBearing([fromLon, fromLat], [toLon, toLat]);
      return { lon, lat, bearing };
    }

    // Smoothly glide along s1's matched rail chain in the direction toward s2 so icons always move continuously on rails
    const p1Lon = s1.lon;
    const p1Lat = s1.lat;
    const p2Lon = s2.lon;
    const p2Lat = s2.lat;
    const fallbackChains = parseChainsFromServiceLine(s1.matchedRouteId, serviceLineGeoJson);
    const activeChain = fallbackChains[s1.chainIndex];
    if (activeChain && activeChain.length >= 2) {
      const proj1 = projectPointOntoChain(p1Lon, p1Lat, activeChain, s1.chainIndex);
      const proj2 = projectPointOntoChain(p2Lon, p2Lat, activeChain, s1.chainIndex);
      let deltaArc = proj2.arcLen - proj1.arcLen;
      if (Math.abs(deltaArc) < 0.001) {
        const chordDist = Math.max(0.004, Math.hypot(p2Lon - p1Lon, p2Lat - p1Lat));
        const segIdx = Math.min(proj1.segIndex, activeChain.length - 2);
        const segDx = activeChain[segIdx + 1]![0] - activeChain[segIdx]![0];
        const segDy = activeChain[segIdx + 1]![1] - activeChain[segIdx]![1];
        const dot = segDx * (p2Lon - p1Lon) + segDy * (p2Lat - p1Lat);
        deltaArc = (dot >= 0 ? 1 : -1) * chordDist;
      }
      const moved = advanceAlongServiceLine(
        s1.matchedRouteId,
        p1Lon,
        p1Lat,
        deltaArc,
        clamped,
        serviceLineGeoJson
      );
      return moved;
    }

    const rawLon = p1Lon + (p2Lon - p1Lon) * clamped;
    const rawLat = p1Lat + (p2Lat - p1Lat) * clamped;
    const midSnap = snapPointToSubwayTrack(routeId, rawLon, rawLat, serviceLineGeoJson, 0.02);
    if (midSnap) {
      return {
        lon: midSnap.lon,
        lat: midSnap.lat,
        bearing: computeSegmentBearing([p1Lon, p1Lat], [p2Lon, p2Lat]) || midSnap.bearing,
      };
    }
    return {
      lon: rawLon,
      lat: rawLat,
      bearing: computeSegmentBearing([p1Lon, p1Lat], [p2Lon, p2Lat]),
    };
  }

  const segLens: number[] = [];
  let totalLen = 0;
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i]!;
    const b = curve[i + 1]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segLens.push(len);
    totalLen += len;
  }

  if (totalLen <= 1e-9) {
    const p = curve[0]!;
    return { lon: p[0], lat: p[1], bearing: 0 };
  }

  const targetDist = totalLen * clamped;
  let accum = 0;
  for (let i = 0; i < curve.length - 1; i++) {
    const segLen = segLens[i]!;
    const a = curve[i]!;
    const b = curve[i + 1]!;
    if (accum + segLen >= targetDist || i === curve.length - 2) {
      const localRatio = segLen > 1e-9 ? Math.max(0, Math.min(1, (targetDist - accum) / segLen)) : 0;
      const lon = a[0] + (b[0] - a[0]) * localRatio;
      const lat = a[1] + (b[1] - a[1]) * localRatio;
      const bearing = computeSegmentBearing(a, b);
      return { lon, lat, bearing };
    }
    accum += segLen;
  }

  const end = curve[curve.length - 1]!;
  return { lon: end[0], lat: end[1], bearing: 0 };
}

/**
 * Projects a single (lon, lat) point onto its route's MTA service line chain (falling back to the
 * nearest network subway track when rerouted) and advances along the curved track by `deltaArcDeg * ratio`.
 */
export function advanceAlongServiceLine(
  routeId: string,
  lon: number,
  lat: number,
  deltaArcDeg: number,
  ratio: number,
  serviceLineGeoJson?: unknown
): { lon: number; lat: number; bearing: number } {
  const clamped = Math.max(0, Math.min(1, ratio));
  let activeRoute = routeId;
  let chains = parseChainsFromServiceLine(activeRoute, serviceLineGeoJson);
  let proj = projectStationOntoServiceLine(activeRoute, lon, lat, serviceLineGeoJson);

  const isAuxRoute = isAuxiliaryRouteKey(routeId);
  const maxSnapDeg = isAuxRoute ? 0.012 : 0.0045;
  const maxProjDeg = isAuxRoute ? 0.012 : 0.006;

  if ((!proj || proj.distSq > 0.0035 * 0.0035) && !serviceLineGeoJson) {
    const snapped = snapPointToSubwayTrack(routeId, lon, lat, undefined, maxSnapDeg);
    if (snapped) {
      activeRoute = snapped.matchedRouteId;
      chains = parseChainsFromServiceLine(activeRoute);
      const fallbackChain = chains[snapped.chainIndex];
      if (fallbackChain && fallbackChain.length >= 2) {
        const cp = projectPointOntoChain(lon, lat, fallbackChain, snapped.chainIndex);
        proj = {
          chainIndex: cp.chainIndex,
          arcLen: cp.arcLen,
          distSq: cp.distSq,
          point: cp.point,
        };
      }
    }
  }

  if (!proj || chains.length === 0 || !chains[proj.chainIndex] || proj.distSq > maxProjDeg * maxProjDeg) {
    return { lon, lat, bearing: 0 };
  }

  const chain = chains[proj.chainIndex]!;
  if (chain.length < 2) return { lon, lat, bearing: 0 };

  const segLens: number[] = [];
  let totalChainLen = 0;
  for (let i = 0; i < chain.length - 1; i++) {
    const a = chain[i]!;
    const b = chain[i + 1]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segLens.push(len);
    totalChainLen += len;
  }

  if (totalChainLen <= 1e-9) return { lon, lat, bearing: 0 };

  let endArc = proj.arcLen + deltaArcDeg;
  if (endArc > totalChainLen || endArc < 0) {
    endArc = Math.max(0, Math.min(totalChainLen, proj.arcLen - deltaArcDeg));
  }
  const targetArc = Math.max(0, Math.min(totalChainLen, proj.arcLen + (endArc - proj.arcLen) * clamped));
  const dirSign = endArc >= proj.arcLen ? 1 : -1;

  let accum = 0;
  for (let i = 0; i < chain.length - 1; i++) {
    const segLen = segLens[i]!;
    const a = chain[i]!;
    const b = chain[i + 1]!;
    if (accum + segLen >= targetArc || i === chain.length - 2) {
      const localRatio = segLen > 1e-9 ? Math.max(0, Math.min(1, (targetArc - accum) / segLen)) : 0;
      const outLon = a[0] + (b[0] - a[0]) * localRatio;
      const outLat = a[1] + (b[1] - a[1]) * localRatio;
      const bearing = computeSegmentBearing(a, b, dirSign);
      return { lon: outLon, lat: outLat, bearing };
    }
    accum += segLen;
  }

  return { lon: proj.point[0], lat: proj.point[1], bearing: 0 };
}

export interface MapNetworkTableConfig {
  readonly routesTable: string;
  readonly tracksTable: string;
  readonly stationsTable: string;
  readonly presetId?: string;
  readonly theme?: MapVisualThemeId;
  readonly hideSubwayOverlay?: boolean;
  readonly corridorOverlay?: string;
}

export interface MapRouteRecord {
  readonly routeId: string;
  readonly routeName: string;
  readonly colorHex: string;
  readonly textColorHex?: string;
  readonly division?: string;
  readonly trunkGroup?: string;
}

export interface CorridorStopInfo {
  readonly stopId: string;
  readonly name: string;
  readonly lon: number;
  readonly lat: number;
}

export interface MapNetworkData {
  readonly routes: Record<string, MapRouteRecord>;
  readonly serviceLines: GeoJSON.FeatureCollection;
  readonly stations: Record<string, StationInfo>;
  readonly config: MapNetworkTableConfig;
  readonly landFeatures?: GeoJSON.FeatureCollection;
  readonly parkFeatures?: GeoJSON.FeatureCollection;
  readonly auxiliaryCorridors?: readonly AuxiliaryCorridorSpec[];
  readonly corridorStops?: Readonly<Record<string, readonly CorridorStopInfo[]>>;
}

export interface MapTableSchemaContract {
  readonly role: 'routes' | 'tracks' | 'stations';
  readonly label: string;
  readonly defaultTable: string;
  readonly fallbackLocalTable: string;
  readonly requiredColumns: readonly string[];
  readonly description: string;
}

export const DEFAULT_MAP_NETWORK_TABLE_CONFIG: MapNetworkTableConfig = {
  routesTable: 'prod.transit_v2.view_dim_routes',
  tracksTable: 'prod.transit_v2.view_dim_service_lines',
  stationsTable: 'prod.transit_v2.view_dim_stations',
  presetId: 'current',
  theme: 'mta',
};

export const MAP_TABLE_SCHEMA_CONTRACTS: Record<'routes' | 'tracks' | 'stations', MapTableSchemaContract> = {
  routes: {
    role: 'routes',
    label: 'Routes Table / View',
    defaultTable: 'prod.transit_v2.view_dim_routes',
    fallbackLocalTable: 'local.main.view_dim_routes',
    requiredColumns: ['route_id', 'route_name', 'color_hex'],
    description: 'Defines route bullets, names, and trunk hex colors.',
  },
  tracks: {
    role: 'tracks',
    label: 'Track Placement Table / View',
    defaultTable: 'prod.transit_v2.view_dim_service_lines',
    fallbackLocalTable: 'local.main.view_dim_service_lines',
    requiredColumns: ['route_id', 'color_hex', 'geom_geojson'],
    description: 'Defines curved GeoJSON LineString/MultiLineString geometries per route.',
  },
  stations: {
    role: 'stations',
    label: 'Station Placement Table / View',
    defaultTable: 'prod.transit_v2.view_dim_stations',
    fallbackLocalTable: 'local.main.view_dim_stations',
    requiredColumns: ['station_id', 'name', 'latitude', 'longitude', 'daytime_routes'],
    description: 'Defines station coordinates, clean display names, and stopping route bullets.',
  },
};

export interface MapNetworkPreset {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly theme: MapVisualThemeId;
  readonly config: MapNetworkTableConfig;
}

export const MAP_NETWORK_TABLE_PRESETS: readonly MapNetworkPreset[] = [
  {
    id: 'current',
    label: 'Current MTA Subway Map',
    description: 'Full 26-line modern MTA Subway network using StraphangerDB routes, curved track geometry, and stations with the MTA visual theme.',
    theme: 'mta',
    config: DEFAULT_MAP_NETWORK_TABLE_CONFIG,
  },
  {
    id: '1929',
    label: '1929 Dual Contracts Network (IRT & BMT)',
    description: 'Pre-IND 1929 subway network featuring classic IRT and BMT lines and stations from StraphangerDB with vintage IND Service Guide styling.',
    theme: 'ind',
    config: {
      routesTable: 'prod.transit_v2.view_dim_routes_1929',
      tracksTable: 'prod.transit_v2.view_dim_service_lines_1929',
      stationsTable: 'prod.transit_v2.view_dim_stations_1929',
      presetId: '1929',
      theme: 'ind',
    },
  },
  {
    id: 'proposed',
    label: 'Future Network with 2nd Ave Subway',
    description: 'Includes proposed Second Ave Subway Phase 2 extension to 125 St (Q/T) and QueensLink/IBX nodes from StraphangerDB.',
    theme: 'mta',
    config: {
      routesTable: 'prod.transit_v2.view_dim_routes_proposed',
      tracksTable: 'prod.transit_v2.view_dim_service_lines_proposed',
      stationsTable: 'prod.transit_v2.view_dim_stations_proposed',
      presetId: 'proposed',
      theme: 'mta',
    },
  },
  {
    id: 'ind-1953',
    label: '1953 IND Service Guide',
    description: '1953 Board of Transportation IND Service Guide ("Independent City Owned Rapid Transit Railroad") historical network (excluding post-1953 lines) and aesthetic.',
    theme: 'ind',
    config: {
      routesTable: 'prod.transit_v2.view_dim_routes_1953',
      tracksTable: 'prod.transit_v2.view_dim_service_lines_1953',
      stationsTable: 'prod.transit_v2.view_dim_stations_1953',
      presetId: 'ind-1953',
      theme: 'ind',
    },
  },
  {
    id: 'tauranac-hertz-1979',
    label: '1979 Tauranac / Hertz Geographic Map',
    description: 'Michael Hertz Associates & John Tauranac classic geographic map aesthetic on StraphangerDB network tables.',
    theme: 'tauranac-hertz',
    config: {
      routesTable: 'prod.transit_v2.view_dim_routes',
      tracksTable: 'prod.transit_v2.view_dim_service_lines',
      stationsTable: 'prod.transit_v2.view_dim_stations',
      presetId: 'tauranac-hertz-1979',
      theme: 'tauranac-hertz',
    },
  },
  {
    id: 'geo-light',
    label: 'Geographic Map (Light)',
    description: 'Real-life street, shoreline, and neighborhood cartography (Light Mode) overlaid with transit corridors.',
    theme: 'geo-light',
    config: {
      routesTable: 'prod.transit_v2.view_dim_routes',
      tracksTable: 'prod.transit_v2.view_dim_service_lines',
      stationsTable: 'prod.transit_v2.view_dim_stations',
      presetId: 'geo-light',
      theme: 'geo-light',
    },
  },
  {
    id: 'geo-dark',
    label: 'Geographic Map (Dark)',
    description: 'Real-life street, shoreline, and neighborhood cartography (Dark Mode) overlaid with high-contrast transit corridors.',
    theme: 'geo-dark',
    config: {
      routesTable: 'prod.transit_v2.view_dim_routes',
      tracksTable: 'prod.transit_v2.view_dim_service_lines',
      stationsTable: 'prod.transit_v2.view_dim_stations',
      presetId: 'geo-dark',
      theme: 'geo-dark',
    },
  },
];

export interface MapTableValidationResult {
  readonly valid: boolean;
  readonly tableName: string;
  readonly role: 'routes' | 'tracks' | 'stations';
  readonly presentColumns: readonly string[];
  readonly missingColumns: readonly string[];
  readonly error?: string;
}

export type DuckDbMapQueryExecutor = (sql: string) => Promise<{
  readonly columns: readonly { readonly name: string; readonly type: string }[];
  readonly rows: readonly Record<string, unknown>[];
}>;

export function buildDefaultMapRoutes(): Record<string, MapRouteRecord> {
  const routes: Record<string, MapRouteRecord> = {};
  for (const r of Object.values(CANONICAL_ROUTES)) {
    if (r.agencyId !== 'MTA_NYCT_SUBWAY' && r.agencyId !== 'MTA_NYCT_SIR') continue;
    routes[r.routeId] = {
      routeId: r.routeId,
      routeName: r.routeName,
      colorHex: r.colorHex,
      textColorHex: r.textColorHex ?? '#FFFFFF',
      ...(r.division ? { division: r.division } : {}),
      ...(r.trunkGroup ? { trunkGroup: r.trunkGroup } : {}),
    };
  }
  return routes;
}

export function getDefaultMapNetworkData(): MapNetworkData {
  return {
    routes: buildDefaultMapRoutes(),
    serviceLines: { type: 'FeatureCollection', features: [] },
    stations: {},
    config: DEFAULT_MAP_NETWORK_TABLE_CONFIG,
  };
}

let activeMapNetworkData: MapNetworkData | null = null;
let activeMapVisualTheme: MapVisualThemeId = 'mta';
const perMapInstanceState = new WeakMap<
  object,
  { networkData?: MapNetworkData | null; visualTheme?: MapVisualThemeId }
>();

export function setMapInstanceNetworkData(map: object | null | undefined, data: MapNetworkData | null): void {
  if (!map) {
    setActiveMapNetworkData(data);
    return;
  }
  const prev = perMapInstanceState.get(map) ?? {};
  perMapInstanceState.set(map, {
    ...prev,
    networkData: data,
    ...(data?.config?.theme ? { visualTheme: data.config.theme } : {}),
  });
  (map as any)._dbtcNetworkData = data;
}

export function getMapInstanceNetworkData(map: object | null | undefined): MapNetworkData {
  if (map) {
    const inst = perMapInstanceState.get(map)?.networkData ?? ((map as any)._dbtcNetworkData as MapNetworkData | undefined);
    if (inst) return inst;
  }
  return getActiveMapNetworkData();
}

export function setMapInstanceVisualTheme(map: object | null | undefined, theme: MapVisualThemeId): void {
  if (!map) {
    setActiveMapVisualTheme(theme);
    return;
  }
  const prev = perMapInstanceState.get(map) ?? {};
  const nextNet = prev.networkData
    ? { ...prev.networkData, config: { ...prev.networkData.config, theme } }
    : prev.networkData;
  perMapInstanceState.set(map, {
    ...prev,
    visualTheme: theme,
    ...(nextNet !== undefined ? { networkData: nextNet } : {}),
  });
  if (nextNet) {
    (map as any)._dbtcNetworkData = nextNet;
  }
}

export function getMapInstanceVisualTheme(map: object | null | undefined): MapVisualThemeId {
  if (map) {
    const inst = perMapInstanceState.get(map);
    if (inst?.networkData?.config?.theme) return inst.networkData.config.theme;
    if (inst?.visualTheme) return inst.visualTheme;
  }
  return getActiveMapVisualTheme();
}

export function getActiveMapVisualTheme(): MapVisualThemeId {
  return activeMapNetworkData?.config?.theme ?? activeMapVisualTheme;
}

export function setActiveMapVisualTheme(theme: MapVisualThemeId): void {
  activeMapVisualTheme = theme;
  if (activeMapNetworkData) {
    activeMapNetworkData = {
      ...activeMapNetworkData,
      config: {
        ...activeMapNetworkData.config,
        theme,
      },
    };
  }
}

export function getActiveMapNetworkData(): MapNetworkData {
  return activeMapNetworkData ?? getDefaultMapNetworkData();
}

export function setActiveMapNetworkData(data: MapNetworkData | null): void {
  activeMapNetworkData = data;
  if (data?.config?.theme) {
    activeMapVisualTheme = data.config.theme;
  }
  serviceLineChainsCache.clear();
}

export function resetActiveMapNetworkData(): void {
  activeMapNetworkData = null;
  activeMapVisualTheme = 'mta';
  serviceLineChainsCache.clear();
}

function sanitizeSqlIdentifierPath(tableName: string): string {
  const trimmed = tableName.trim();
  if (!/^[A-Za-z0-9_."]+$/.test(trimmed)) {
    throw new Error(`Invalid DuckDB table or view identifier: "${tableName}"`);
  }
  return trimmed;
}

/**
 * Validates that a DuckDB table or view exists and contains all required schema columns
 * for the given map layer role ('routes', 'tracks', or 'stations').
 */
export async function validateMapTableSchema(
  queryFn: DuckDbMapQueryExecutor,
  tableName: string,
  role: 'routes' | 'tracks' | 'stations'
): Promise<MapTableValidationResult> {
  const contract = MAP_TABLE_SCHEMA_CONTRACTS[role];
  let safeTable: string;
  try {
    safeTable = sanitizeSqlIdentifierPath(tableName);
  } catch (err) {
    return {
      valid: false,
      tableName,
      role,
      presentColumns: [],
      missingColumns: [...contract.requiredColumns],
      error: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    let presentColumns: string[] = [];
    try {
      const descRes = await queryFn(`DESCRIBE ${safeTable}`);
      const cols = descRes.rows
        .map(r => String(r['column_name'] ?? '').trim())
        .filter(Boolean);
      if (cols.length > 0) {
        presentColumns = cols;
      }
    } catch {
      // Fallback for mock queryFn implementations that only handle SELECT
    }
    if (presentColumns.length === 0) {
      const res = await queryFn(`SELECT * FROM ${safeTable} LIMIT 0`);
      presentColumns = res.columns.map(c => c.name);
    }
    const presentSet = new Set(presentColumns.map(c => c.toLowerCase()));
    const missing = contract.requiredColumns.filter(req => !presentSet.has(req.toLowerCase()));
    return {
      valid: missing.length === 0,
      tableName: safeTable,
      role,
      presentColumns,
      missingColumns: missing,
      ...(missing.length > 0
        ? {
            error: `Table "${safeTable}" is missing required ${role} column(s): ${missing.join(', ')}`,
          }
        : {}),
    };
  } catch (err) {
    return {
      valid: false,
      tableName: safeTable,
      role,
      presentColumns: [],
      missingColumns: [...contract.requiredColumns],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Lists candidate tables and views currently registered in DuckDB so the customization modal
 * can offer autocomplete suggestions alongside custom user-entered table/view names.
 */
export async function listDuckDbMapCandidateTables(
  queryFn: DuckDbMapQueryExecutor
): Promise<string[]> {
  const defaults = [
    DEFAULT_MAP_NETWORK_TABLE_CONFIG.routesTable,
    'prod.transit_v2.view_dim_routes_1929',
    'prod.transit_v2.view_dim_routes_1953',
    'prod.transit_v2.view_dim_routes_proposed',
    DEFAULT_MAP_NETWORK_TABLE_CONFIG.tracksTable,
    'prod.transit_v2.view_dim_service_lines_1929',
    'prod.transit_v2.view_dim_service_lines_1953',
    'prod.transit_v2.view_dim_service_lines_proposed',
    DEFAULT_MAP_NETWORK_TABLE_CONFIG.stationsTable,
    'prod.transit_v2.view_dim_stations_1929',
    'prod.transit_v2.view_dim_stations_1953',
    'prod.transit_v2.view_dim_stations_proposed',
  ];
  try {
    const res = await queryFn(`
      SELECT table_catalog || '.' || table_schema || '.' || table_name AS full_name
      FROM information_schema.tables
      WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
      ORDER BY full_name
    `);
    const discovered = res.rows
      .map(r => String(r['full_name'] ?? '').trim())
      .filter(Boolean);
    return Array.from(new Set([...defaults, ...discovered]));
  } catch {
    return defaults;
  }
}

/**
 * Bootstraps a complete MapNetworkData state (routes, curved track geometries, and station placements)
 * directly from the configured DuckDB tables/views after validating their exact schema contracts.
 */
export async function bootstrapMapNetworkFromDuckDb(
  queryFn: DuckDbMapQueryExecutor,
  config: Partial<MapNetworkTableConfig> = {},
  options?: { activateGlobal?: boolean }
): Promise<MapNetworkData> {
  const normalizedPresetId =
    config.presetId &&
    config.presetId !== 'custom' &&
    !MAP_NETWORK_TABLE_PRESETS.some(p => p.id === config.presetId)
      ? 'current'
      : config.presetId;
  const normalizedTheme: MapVisualThemeId | undefined = config.theme
    ? (MAP_VISUAL_THEMES.find(t => t.id === config.theme)?.id ?? 'mta')
    : undefined;

  const resolvedConfig: MapNetworkTableConfig = {
    routesTable: config.routesTable?.trim() || DEFAULT_MAP_NETWORK_TABLE_CONFIG.routesTable,
    tracksTable: config.tracksTable?.trim() || DEFAULT_MAP_NETWORK_TABLE_CONFIG.tracksTable,
    stationsTable: config.stationsTable?.trim() || DEFAULT_MAP_NETWORK_TABLE_CONFIG.stationsTable,
    ...(normalizedPresetId ? { presetId: normalizedPresetId } : {}),
    ...(normalizedTheme ? { theme: normalizedTheme } : {}),
    ...(config.hideSubwayOverlay !== undefined ? { hideSubwayOverlay: config.hideSubwayOverlay } : {}),
    ...(config.corridorOverlay ? { corridorOverlay: config.corridorOverlay } : {}),
  };

  const is1953Preset =
    resolvedConfig.presetId === 'ind-1953' ||
    resolvedConfig.routesTable.endsWith('_1953') ||
    resolvedConfig.tracksTable.endsWith('_1953') ||
    resolvedConfig.stationsTable.endsWith('_1953');

  const resolveTableWithFallback = async (
    requested: string,
    role: 'routes' | 'tracks' | 'stations'
  ): Promise<{ tableName: string; presentColumns: readonly string[] }> => {
    const primaryCheck = await validateMapTableSchema(queryFn, requested, role);
    if (primaryCheck.valid) return { tableName: primaryCheck.tableName, presentColumns: primaryCheck.presentColumns };
    if (requested.startsWith('prod.transit_v2.')) {
      const localMirror = requested.replace(/^prod\.transit_v2\./, 'local.main.');
      const mirrorCheck = await validateMapTableSchema(queryFn, localMirror, role);
      if (mirrorCheck.valid) return { tableName: mirrorCheck.tableName, presentColumns: mirrorCheck.presentColumns };
    }
    const contract = MAP_TABLE_SCHEMA_CONTRACTS[role];
    if (requested.endsWith('_1953')) {
      const baseDefaultCheck = await validateMapTableSchema(queryFn, contract.defaultTable, role);
      if (baseDefaultCheck.valid) return { tableName: baseDefaultCheck.tableName, presentColumns: baseDefaultCheck.presentColumns };
      const baseLocalCheck = await validateMapTableSchema(queryFn, contract.fallbackLocalTable, role);
      if (baseLocalCheck.valid) return { tableName: baseLocalCheck.tableName, presentColumns: baseLocalCheck.presentColumns };
    }
    if (requested === contract.defaultTable && contract.fallbackLocalTable !== requested) {
      const fallbackCheck = await validateMapTableSchema(queryFn, contract.fallbackLocalTable, role);
      if (fallbackCheck.valid) return { tableName: fallbackCheck.tableName, presentColumns: fallbackCheck.presentColumns };
    }
    throw new Error(primaryCheck.error ?? `Invalid ${role} table "${requested}"`);
  };

  const buildSafeSelectSql = (tableName: string, presentColumns: readonly string[]): string => {
    const needsProjection = presentColumns.some(
      c => c.toLowerCase() === 'raw_payload' || c.toLowerCase() === 'geom_wkt'
    );
    if (!needsProjection || presentColumns.length === 0) {
      return `SELECT * FROM ${tableName}`;
    }
    const hasGeoJson = presentColumns.some(c => c.toLowerCase() === 'geom_geojson');
    const cols = presentColumns
      .filter(c => !(hasGeoJson && c.toLowerCase() === 'geom_wkt'))
      .map(c => {
        const quoted = `"${c.replace(/"/g, '""')}"`;
        return c.toLowerCase() === 'raw_payload' ? `CAST(${quoted} AS VARCHAR) AS raw_payload` : quoted;
      });
    return `SELECT ${cols.join(', ')} FROM ${tableName}`;
  };

  const [routesInfo, tracksInfo, stationsInfo] = await Promise.all([
    resolveTableWithFallback(resolvedConfig.routesTable, 'routes'),
    resolveTableWithFallback(resolvedConfig.tracksTable, 'tracks'),
    resolveTableWithFallback(resolvedConfig.stationsTable, 'stations'),
  ]);

  const [routesRes, tracksRes, stationsRes] = await Promise.all([
    queryFn(buildSafeSelectSql(routesInfo.tableName, routesInfo.presentColumns)),
    queryFn(buildSafeSelectSql(tracksInfo.tableName, tracksInfo.presentColumns)),
    queryFn(buildSafeSelectSql(stationsInfo.tableName, stationsInfo.presentColumns)),
  ]);

  if (routesRes.rows.length > 0) {
    hydrateRouteCatalogFromDuckDbRows(routesRes.rows);
  }

  const SUBWAY_MAP_AGENCIES = new Set(['MTA_NYCT_SUBWAY', 'MTA_NYCT_SIR', 'MTA_SIR']);
  const isSubwayAgencyRow = (r: Record<string, unknown>): boolean => {
    const ag = String(r['agency_id'] ?? '').trim().toUpperCase();
    return !ag || SUBWAY_MAP_AGENCIES.has(ag);
  };
  const filterToSubwayAgencyRows = (
    rows: readonly Record<string, unknown>[]
  ): readonly Record<string, unknown>[] => {
    const hasAnyAgencyCol = rows.some(
      r => r['agency_id'] !== undefined && r['agency_id'] !== null && String(r['agency_id']).trim() !== ''
    );
    if (!hasAnyAgencyCol) return rows;
    const filtered = rows.filter(isSubwayAgencyRow);
    return filtered.length > 0 ? filtered : rows;
  };

  const filteredRouteRows = filterToSubwayAgencyRows(routesRes.rows);
  const filteredTrackRows = filterToSubwayAgencyRows(tracksRes.rows);
  const auxTrackRowsFromPrimary = tracksRes.rows.filter(r => !isSubwayAgencyRow(r));
  const filteredStationRows = filterToSubwayAgencyRows(stationsRes.rows);
  const nonSubwayStationRows = stationsRes.rows.filter(r => !isSubwayAgencyRow(r));

  if (nonSubwayStationRows.length > 0) {
    hydrateStationCache(nonSubwayStationRows);
  }
  if (filteredStationRows.length > 0) {
    hydrateStationCache(filteredStationRows);
  }

  const routes: Record<string, MapRouteRecord> = {};
  for (const r of filteredRouteRows) {
    const routeId = String(r['route_id'] ?? '').trim();
    if (!routeId) continue;
    const colorHex = String(r['color_hex'] ?? resolveRouteColor(routeId, 'MTA_NYCT_SUBWAY')).trim();
    routes[routeId] = {
      routeId,
      routeName: String(r['route_name'] ?? `${routeId} Line`).trim(),
      colorHex,
      textColorHex: String(
        r['text_color_hex'] ?? (colorHex.toUpperCase() === '#FCCC0A' ? '#000000' : '#FFFFFF')
      ).trim(),
      division: String(r['division'] ?? ''),
      trunkGroup: String(r['trunk_group'] ?? ''),
    };
  }

  const extractChainsFromRow = (rawGeo: unknown): [number, number][][] => {
    if (!rawGeo) return [];
    try {
      const parsed = typeof rawGeo === 'string' ? JSON.parse(rawGeo) : rawGeo;
      const geom: GeoJSON.Geometry | null =
        parsed?.type === 'Feature' ? parsed.geometry : parsed;
      if (!geom) return [];
      if (geom.type === 'MultiLineString' && Array.isArray(geom.coordinates)) {
        return geom.coordinates as [number, number][][];
      }
      if (geom.type === 'LineString' && Array.isArray(geom.coordinates)) {
        return [geom.coordinates as [number, number][]];
      }
    } catch {
      // Skip malformed geometry
    }
    return [];
  };

  const trackFeatures: GeoJSON.Feature[] = [];
  for (const r of filteredTrackRows) {
    const routeId = String(r['route_id'] ?? r['service_line'] ?? '').trim();
    const rawGeo = r['geom_geojson'];
    if (!routeId || !rawGeo) continue;
    try {
      const parsed = typeof rawGeo === 'string' ? JSON.parse(rawGeo) : rawGeo;
      const geometry: GeoJSON.Geometry | null =
        parsed?.type === 'Feature' ? parsed.geometry : parsed;
      if (!geometry || !geometry.type) continue;
      const colorHex = String(
        r['color_hex'] ?? routes[routeId]?.colorHex ?? resolveRouteColor(routeId, 'MTA_NYCT_SUBWAY')
      ).trim();
      trackFeatures.push({
        type: 'Feature',
        properties: {
          route_id: routeId,
          service_line: String(r['service_line'] ?? routeId),
          route_short_name: String(r['route_short_name'] ?? routeId),
          division: String(r['division'] ?? routes[routeId]?.division ?? ''),
          trunk_group: String(r['trunk_group'] ?? routes[routeId]?.trunkGroup ?? ''),
          color_hex: colorHex,
        },
        geometry,
      });
    } catch {
      // Skip malformed geometry rows
    }
  }

  const effectiveServiceLines: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: trackFeatures,
  };

  // Build auxiliary rail/bus corridors (MNR, LIRR, PATH, NJT, M60-SBS) from StraphangerDB rows
  let rawAuxRows: readonly Record<string, unknown>[] = auxTrackRowsFromPrimary;
  if (rawAuxRows.length === 0) {
    try {
      const auxRes = await queryFn(
        `SELECT line_id, agency_id, route_id, service_name, division, line_name, color_hex, geom_geojson, CAST(raw_payload AS VARCHAR) AS raw_payload FROM prod.transit_v2.view_dim_service_lines WHERE agency_id NOT IN ('MTA_NYCT_SUBWAY', 'MTA_NYCT_SIR')`
      );
      rawAuxRows = auxRes.rows;
    } catch {
      // Mock queryFn in unit tests may only serve the primary tables
    }
  }

  const auxiliaryCorridors: AuxiliaryCorridorSpec[] = [];
  const seenAuxIds = new Set<string>();
  const ALLOWED_AUX_AGENCIES = new Set([
    'MTA_METRO_NORTH',
    'MTA_LIRR',
    'PORT_AUTHORITY_PATH',
    'NJ_TRANSIT',
    'MTA_BUS',
  ]);
  for (const r of rawAuxRows) {
    const agUpper = String(r['agency_id'] ?? '').trim().toUpperCase();
    if (!ALLOWED_AUX_AGENCIES.has(agUpper)) continue;
    const routeId = String(r['route_id'] ?? '').trim();
    const chains = extractChainsFromRow(r['geom_geojson']);
    if (!routeId || chains.length === 0) continue;

    let payloadObj: Record<string, unknown> = {};
    if (r['raw_payload']) {
      try {
        payloadObj =
          typeof r['raw_payload'] === 'string'
            ? JSON.parse(r['raw_payload'])
            : (r['raw_payload'] as Record<string, unknown>);
      } catch {
        payloadObj = {};
      }
    }

    const specMatch = resolveCommuterOrBusRouteSpec(routeId, agUpper);
    const badge = String(
      payloadObj['bullet_code'] ??
        r['service_name'] ??
        specMatch?.code ??
        routeId
    )
      .trim()
      .toUpperCase();
    const id = `${agUpper}_${badge}`.replace(/[^A-Za-z0-9_]+/g, '_');
    if (seenAuxIds.has(id)) continue;
    seenAuxIds.add(id);

    const rawAliases = Array.isArray(payloadObj['aliases'])
      ? (payloadObj['aliases'] as unknown[]).map(a => String(a).trim()).filter(Boolean)
      : [];
    const aliases = Array.from(
      new Set([
        `${agUpper}:${routeId}`,
        `${agUpper}:${badge}`,
        badge,
        ...rawAliases.map(a => `${agUpper}:${a}`),
      ])
    );

    auxiliaryCorridors.push({
      id,
      agencyId: agUpper as AuxiliaryCorridorSpec['agencyId'],
      badge,
      name: String(r['line_name'] ?? r['service_name'] ?? specMatch?.label ?? `${agUpper} ${badge}`).trim(),
      colorHex: String(r['color_hex'] ?? specMatch?.colorHex ?? '#4D5357').trim(),
      aliases,
      chains,
    });
  }

  // Extract M60-SBS bus stops dynamically from MTA_BUS station rows
  const m60Stops: CorridorStopInfo[] = [];
  const seenM60StopIds = new Set<string>();
  for (const r of nonSubwayStationRows) {
    const agUpper = String(r['agency_id'] ?? '').trim().toUpperCase();
    if (agUpper !== 'MTA_BUS') continue;
    const daytime = String(r['daytime_routes'] ?? '').toUpperCase();
    if (!daytime.includes('M60')) continue;
    const stopId = String(r['gtfs_stop_id'] ?? r['station_id'] ?? '').trim();
    const lat = Number(r['latitude'] ?? 0);
    const lon = Number(r['longitude'] ?? 0);
    if (!stopId || isNaN(lat) || isNaN(lon) || lat === 0 || lon === 0 || seenM60StopIds.has(stopId)) {
      continue;
    }
    seenM60StopIds.add(stopId);
    m60Stops.push({
      stopId,
      name: cleanStationLabelText(String(r['name'] ?? stopId).trim()) || stopId,
      lon,
      lat,
    });
  }

  // Query regional landmass & park polygons from prod.transit_v2.view_dim_map_geography (or view_dim_boroughs)
  const landFeats: GeoJSON.Feature[] = [];
  const parkFeats: GeoJSON.Feature[] = [];
  try {
    let geoRows: readonly Record<string, unknown>[] = [];
    try {
      const geoRes = await queryFn(
        `SELECT boro_code, boro_name, region_kind, geom_geojson FROM prod.transit_v2.view_dim_map_geography`
      );
      geoRows = geoRes.rows;
    } catch {
      const boroRes = await queryFn(
        `SELECT boro_code, boro_name, geom_geojson FROM prod.transit_v2.view_dim_boroughs`
      );
      geoRows = boroRes.rows;
    }
    for (const gr of geoRows) {
      const boroName = String(gr['boro_name'] ?? '').trim();
      const boroCode = Number(gr['boro_code'] ?? 0);
      const rawGeo = gr['geom_geojson'];
      if (!rawGeo) continue;
      const regionKind = String(
        gr['region_kind'] ??
          (boroCode >= 1 && boroCode <= 5
            ? 'nyc_borough'
            : boroCode >= 100 && boroCode <= 199
              ? 'regional_land'
              : 'park')
      ).trim();
      try {
        const parsed = typeof rawGeo === 'string' ? JSON.parse(rawGeo) : rawGeo;
        const geometry: GeoJSON.Geometry | null =
          parsed?.type === 'Feature' ? parsed.geometry : parsed;
        if (!geometry || !geometry.type) continue;
        const feat: GeoJSON.Feature = {
          type: 'Feature',
          properties: { name: boroName, boro_code: boroCode, region_kind: regionKind },
          geometry,
        };
        if (regionKind === 'park') {
          parkFeats.push(feat);
        } else {
          landFeats.push(feat);
        }
      } catch {
        // Skip malformed geography row
      }
    }
  } catch {
    // Geography view optional in mock unit test environments
  }

  const PRIMARY_HUB_ID_SET = new Set<string>([
    '127', '631', 'D17', '128', '635', '125', 'A38',
    '235', 'G22', 'G14', '719', '629', 'A31', 'A41',
    'A51', 'D43', 'G08',
  ]);

  const stations: Record<string, StationInfo> = {};
  const stationHasAgency = new Map<string, boolean>();
  const complexClusterMap = new Map<string, string[]>();

  for (const r of filteredStationRows) {
    const rawStopId = String(r['gtfs_stop_id'] ?? '').trim();
    const rawStationId = String(r['station_id'] ?? '').trim();
    const rawId = rawStopId || rawStationId;
    if (!rawId) continue;
    const cleanId = rawId.replace(/[NS]$/, '');
    const lat = Number(r['latitude'] ?? 0);
    const lon = Number(r['longitude'] ?? 0);
    if (isNaN(lat) || isNaN(lon) || lat === 0 || lon === 0) continue;

    const agencyUpper = String(r['agency_id'] ?? '').trim().toUpperCase();
    const rawName = String(r['name'] ?? cleanId).trim();
    const parentheticalRoutes = extractRoutesFromStationText(rawName);
    const daytimeRoutes = normalizeStationRoutes(String(r['daytime_routes'] ?? ''));
    let mergedRoutes = normalizeStationRoutes([...daytimeRoutes, ...parentheticalRoutes]);
    if (mergedRoutes.length === 0 && (agencyUpper === 'MTA_NYCT_SIR' || agencyUpper === 'MTA_SIR')) {
      mergedRoutes = ['SIR'];
    }
    if (mergedRoutes.length === 0 && agencyUpper !== '') {
      continue;
    }
    if (mergedRoutes.length === 0) {
      mergedRoutes = ['1'];
    }

    const cleanName = cleanStationLabelText(rawName) || cleanId;
    const borough = String(r['borough'] ?? '').trim() || inferBoroughFromCoords(lat, lon);
    const complexId = String(r['complex_id'] ?? '').trim();

    if (stations[cleanId]) {
      const prev = stations[cleanId]!;
      stations[cleanId] = {
        ...prev,
        routes: normalizeStationRoutes([...prev.routes, ...mergedRoutes]),
      };
      continue;
    }

    // Merge co-located constituent platforms of the same transfer complex (within ~250m)
    if (complexId) {
      const siblingIds = complexClusterMap.get(complexId) ?? [];
      const nearbySiblingId = siblingIds.find(sid => {
        const sib = stations[sid];
        return sib && Math.hypot(sib.lon - lon, sib.lat - lat) <= 0.0025;
      });
      if (nearbySiblingId && stations[nearbySiblingId]) {
        const sib = stations[nearbySiblingId]!;
        const combinedRoutes = normalizeStationRoutes([...sib.routes, ...mergedRoutes]);
        const preferNewKey =
          PRIMARY_HUB_ID_SET.has(cleanId) && !PRIMARY_HUB_ID_SET.has(nearbySiblingId);
        if (preferNewKey) {
          delete stations[nearbySiblingId];
          stationHasAgency.delete(nearbySiblingId);
          stations[cleanId] = {
            stationId: cleanId,
            name: cleanName,
            lat,
            lon,
            borough,
            routes: combinedRoutes,
          };
          stationHasAgency.set(cleanId, agencyUpper !== '');
          complexClusterMap.set(
            complexId,
            siblingIds.map(id => (id === nearbySiblingId ? cleanId : id))
          );
        } else {
          stations[nearbySiblingId] = {
            ...sib,
            routes: combinedRoutes,
          };
        }
        continue;
      }
      complexClusterMap.set(complexId, [...siblingIds, cleanId]);
    }

    stations[cleanId] = {
      stationId: cleanId,
      name: cleanName,
      lat,
      lon,
      borough,
      routes: mergedRoutes,
    };
    stationHasAgency.set(cleanId, agencyUpper !== '');
  }

  // Align stations onto their rendered service line ribbons and drop stray off-network rows
  if (effectiveServiceLines.features.length > 0) {
    for (const [id, st] of Object.entries(stations)) {
      let bestProj: StationChainProjection | null = null;
      const routeCandidates = new Set<string>();
      for (const rt of st.routes) {
        routeCandidates.add(rt);
        routeCandidates.add(rt.replace(/X$/i, ''));
        if (rt === 'SIR') routeCandidates.add('SI');
        if (rt === 'SI') routeCandidates.add('SIR');
        if (rt === 'S') {
          routeCandidates.add('GS');
          routeCandidates.add('FS');
          routeCandidates.add('H');
        }
      }
      for (const cand of routeCandidates) {
        const proj = projectStationOntoServiceLine(cand, st.lon, st.lat, effectiveServiceLines);
        if (proj && (!bestProj || proj.distSq < bestProj.distSq)) {
          bestProj = proj;
        }
      }

      const trunkCount = new Set(
        st.routes.map(rt => resolveRouteColor(rt, 'MTA_NYCT_SUBWAY'))
      ).size;

      if (bestProj) {
        if (
          (trunkCount === 1 && bestProj.distSq <= 0.0032 * 0.0032) ||
          (trunkCount > 1 &&
            bestProj.distSq > 0.0005 * 0.0005 &&
            bestProj.distSq <= 0.0025 * 0.0025)
        ) {
          stations[id] = {
            ...st,
            lon: bestProj.point[0],
            lat: bestProj.point[1],
          };
          continue;
        }
      }

      if (stationHasAgency.get(id) && !id.startsWith('T0') && !id.startsWith('IBX')) {
        const anyTrack = snapPointToSubwayTrack(
          st.routes[0] ?? '1',
          st.lon,
          st.lat,
          effectiveServiceLines,
          0.008
        );
        if (!anyTrack) {
          delete stations[id];
        }
      }
    }
  }

  const finalRoutes = Object.keys(routes).length > 0 ? routes : buildDefaultMapRoutes();
  const prevNet = activeMapNetworkData;
  const effectiveLandFeatures: GeoJSON.FeatureCollection | undefined =
    landFeats.length > 0
      ? { type: 'FeatureCollection', features: landFeats }
      : prevNet?.landFeatures;
  const effectiveParkFeatures: GeoJSON.FeatureCollection | undefined =
    parkFeats.length > 0
      ? { type: 'FeatureCollection', features: parkFeats }
      : prevNet?.parkFeatures;
  const effectiveAuxCorridors =
    auxiliaryCorridors.length > 0 ? auxiliaryCorridors : prevNet?.auxiliaryCorridors;
  const effectiveCorridorStops =
    m60Stops.length > 0
      ? { 'M60-SBS': m60Stops }
      : prevNet?.corridorStops;

  const networkData: MapNetworkData = {
    routes: finalRoutes,
    serviceLines: effectiveServiceLines,
    stations,
    config: resolvedConfig,
    ...(effectiveLandFeatures ? { landFeatures: effectiveLandFeatures } : {}),
    ...(effectiveParkFeatures ? { parkFeatures: effectiveParkFeatures } : {}),
    ...(effectiveAuxCorridors ? { auxiliaryCorridors: effectiveAuxCorridors } : {}),
    ...(effectiveCorridorStops ? { corridorStops: effectiveCorridorStops } : {}),
  };

  if (options?.activateGlobal !== false) {
    setActiveMapNetworkData(networkData);
  }
  return networkData;
}

/**
 * GeoJSON for the Current MTA Map visual aesthetic:
 * 1. Parks and Green Space (Central Park, Prospect Park, Flushing Meadows) in sage cream #EEF4DC
 * 2. Waterways (Hudson, East, Harlem Rivers, Upper Bay) in slate blue #D8E2EB
 * 3. Waterway text labels in uppercase white
 * 4. Borough watermark labels in muted cool grey #A8B0B8
 * 5. Commuter rail corridors (Metro-North & LIRR branch colors + NJ Transit / PATH)
 * 6. Canonical MTA Subway trunk line ribbons with white casing
 * 7. Major transfer capsules and individual station stop nodes
 */
export function buildMtaSubwayMapGeoJson(
  networkData?: MapNetworkData,
  theme?: MapVisualThemeId
): {
  land: GeoJSON.FeatureCollection;
  parks: GeoJSON.FeatureCollection;
  waterways: GeoJSON.FeatureCollection;
  waterwayLabels: GeoJSON.FeatureCollection;
  boroughWatermarks: GeoJSON.FeatureCollection;
  commuterRail: GeoJSON.FeatureCollection;
  historicalElevated: GeoJSON.FeatureCollection;
  subwayTrunks: GeoJSON.FeatureCollection;
  transferCapsules: GeoJSON.FeatureCollection;
  stationStops: GeoJSON.FeatureCollection;
  terminalBullets: GeoJSON.FeatureCollection;
} {
  const net = networkData ?? getActiveMapNetworkData();
  const effectiveThemeId = theme ?? net.config?.theme ?? getActiveMapVisualTheme();
  const themeSpec = getMapThemeSpec(effectiveThemeId);
  const is1929Map =
    net.config?.presetId === '1929' ||
    Boolean(net.config?.tracksTable?.endsWith('_1929'));
  const is1953Map =
    !is1929Map &&
    (net.config?.presetId === 'ind-1953' ||
      Boolean(net.config?.tracksTable?.endsWith('_1953')) ||
      themeSpec.id === 'ind');
  const isProposedMap =
    net.config?.presetId === 'proposed' ||
    Boolean(net.config?.tracksTable?.endsWith('_proposed'));
  const historicalEra: HistoricalEra | null = is1929Map ? '1929' : is1953Map ? '1953' : null;
  const activeServiceLines: GeoJSON.FeatureCollection = historicalEra
    ? {
        type: 'FeatureCollection',
        features: filterHistoricalServiceLines(net.serviceLines.features ?? [], historicalEra),
      }
    : isProposedMap
      ? {
          type: 'FeatureCollection',
          features: applyProposedServiceLines(net.serviceLines.features ?? []),
        }
      : net.serviceLines;
  const activeStations = historicalEra
    ? (() => {
        const keptFeatures = filterHistoricalStations(
          Object.values(net.stations).map(st => ({
            type: 'Feature' as const,
            properties: {
              station_id: st.stationId,
              gtfs_stop_id: st.stationId,
              name: st.name,
              daytime_routes: st.routes.join(' '),
            },
            geometry: { type: 'Point' as const, coordinates: [st.lon, st.lat] },
          })),
          historicalEra
        );
        const keptIds = new Set(
          keptFeatures.map(f => String((f.properties as Record<string, unknown>)?.['station_id'] ?? ''))
        );
        const filtered: typeof net.stations = {};
        for (const [k, st] of Object.entries(net.stations)) {
          if (keptIds.has(st.stationId)) filtered[k] = st;
        }
        return filtered;
      })()
    : isProposedMap
      ? (() => {
          const merged = { ...net.stations };
          for (const st of PROPOSED_EXTRA_STATIONS) {
            if (!merged[st.stationId]) {
              merged[st.stationId] = {
                stationId: st.stationId,
                name: st.name,
                borough: st.borough,
                lon: st.lon,
                lat: st.lat,
                routes: st.routes,
              };
            }
          }
          return merged;
        })()
      : net.stations;
  const historicalElevated: GeoJSON.FeatureCollection = historicalEra
    ? buildHistoricalElevatedGeoJson(historicalEra)
    : { type: 'FeatureCollection', features: [] };
  const formatBoroughName = (name: string): string =>
    themeSpec.boroughWatermarkUppercase ? name.toUpperCase() : name;

  // Landmass & Park Polygons hydrated from StraphangerDB (view_dim_map_geography / view_dim_boroughs)
  const land: GeoJSON.FeatureCollection =
    net.landFeatures ?? { type: 'FeatureCollection', features: [] };
  const parks: GeoJSON.FeatureCollection =
    net.parkFeatures ?? { type: 'FeatureCollection', features: [] };

  // Waterways polygons: MTA style background is #D8E2EB (MTA Water Blue),
  // with vector landmass cutting out boroughs, avoiding rectangular overlay artifacts.
  const waterways: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [],
  };

  // Waterway Labels (MTA clean white uppercase rendered as offline canvas sprites)
  const waterwayLabels: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { label: 'Hudson River', iconId: 'water-label-hudson-river' },
        geometry: { type: 'Point', coordinates: [-74.018, 40.752] },
      },
      {
        type: 'Feature',
        properties: { label: 'East River', iconId: 'water-label-east-river' },
        geometry: { type: 'Point', coordinates: [-73.956, 40.742] },
      },
      {
        type: 'Feature',
        properties: { label: 'Harlem River', iconId: 'water-label-harlem-river' },
        geometry: { type: 'Point', coordinates: [-73.928, 40.818] },
      },
      {
        type: 'Feature',
        properties: { label: 'Upper New York Bay', iconId: 'water-label-upper-new-york-bay' },
        geometry: { type: 'Point', coordinates: [-74.042, 40.665] },
      },
      {
        type: 'Feature',
        properties: { label: 'Newark Bay', iconId: 'water-label-newark-bay' },
        geometry: { type: 'Point', coordinates: [-74.138, 40.688] },
      },
      {
        type: 'Feature',
        properties: { label: 'Long Island Sound', iconId: 'water-label-long-island-sound' },
        geometry: { type: 'Point', coordinates: [-73.320, 41.015] },
      },
    ],
  };

  // Borough & Regional Watermarks (rendered as offline canvas sprites, honoring theme casing and Richmond/Staten Island label)
  const boroughWatermarks: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: formatBoroughName('Manhattan'), iconId: 'watermark-manhattan' },
        geometry: { type: 'Point', coordinates: [-73.968, 40.772] },
      },
      {
        type: 'Feature',
        properties: { name: formatBoroughName('Brooklyn'), iconId: 'watermark-brooklyn' },
        geometry: { type: 'Point', coordinates: [-73.950, 40.645] },
      },
      {
        type: 'Feature',
        properties: { name: formatBoroughName('Queens'), iconId: 'watermark-queens' },
        geometry: { type: 'Point', coordinates: [-73.830, 40.730] },
      },
      {
        type: 'Feature',
        properties: { name: formatBoroughName('The Bronx'), iconId: 'watermark-the-bronx' },
        geometry: { type: 'Point', coordinates: [-73.865, 40.850] },
      },
      {
        type: 'Feature',
        properties: {
          name: formatBoroughName(themeSpec.statenIslandLabel),
          iconId: 'watermark-staten-island',
        },
        geometry: { type: 'Point', coordinates: [-74.150, 40.580] },
      },
      {
        type: 'Feature',
        properties: { name: formatBoroughName('New Jersey'), iconId: 'watermark-new-jersey' },
        geometry: { type: 'Point', coordinates: [-74.195, 40.785] },
      },
      {
        type: 'Feature',
        properties: { name: formatBoroughName('Long Island'), iconId: 'watermark-long-island' },
        geometry: { type: 'Point', coordinates: [-73.380, 40.790] },
      },
      {
        type: 'Feature',
        properties: { name: formatBoroughName('Westchester'), iconId: 'watermark-westchester' },
        geometry: { type: 'Point', coordinates: [-73.795, 41.085] },
      },
      {
        type: 'Feature',
        properties: { name: formatBoroughName('Connecticut'), iconId: 'watermark-connecticut' },
        geometry: { type: 'Point', coordinates: [-73.310, 41.250] },
      },
    ],
  };

  // Commuter & Regional Rail Corridors: Metro-North, LIRR, PATH & NJ Transit from StraphangerDB
  const useColoredCommuterBranches = themeSpec.id !== 'ind';
  const commuterFeatures: GeoJSON.Feature[] = getActiveAuxiliaryCorridors(net)
    .filter(spec => spec.agencyId !== 'MTA_BUS')
    .flatMap(spec => {
      const activeChains =
        is1953Map && spec.agencyId === 'MTA_LIRR'
          ? spec.chains.filter(ch => {
              const start = ch[0];
              // Exclude 2023 Grand Central Madison / East Side Access 63rd St Tunnel from 1953 historical map
              return !(
                start &&
                Math.abs(start[0] - (-73.9772)) < 0.002 &&
                Math.abs(start[1] - 40.7527) < 0.002
              );
            })
          : spec.chains;
      if (activeChains.length === 0) return [];
      const lineColor =
        spec.agencyId === 'NJ_TRANSIT' || !useColoredCommuterBranches
          ? themeSpec.commuterCasingColor
          : spec.colorHex;
      return [
        {
          type: 'Feature' as const,
          properties: {
            id: spec.id,
            name: spec.name,
            badge: spec.badge,
            route_id: spec.badge,
            agency_id: spec.agencyId,
            color: lineColor,
          },
          geometry:
            activeChains.length === 1
              ? {
                  type: 'LineString' as const,
                  coordinates: activeChains[0]!.map(pt => [pt[0], pt[1]]),
                }
              : {
                  type: 'MultiLineString' as const,
                  coordinates: activeChains.map(ch => ch.map(pt => [pt[0], pt[1]])),
                },
        },
      ];
    });
  if (isProposedMap) {
    commuterFeatures.push({
      type: 'Feature' as const,
      properties: {
        id: 'mnr-penn-access',
        name: 'Metro-North Penn Station Access (via Hell Gate Bridge & East Bronx)',
        badge: 'MNR-PSA',
        route_id: 'MNR',
        agency_id: 'MTA_METRO_NORTH',
        color: useColoredCommuterBranches ? '#0039A6' : themeSpec.commuterCasingColor,
      },
      geometry: {
        type: 'LineString' as const,
        coordinates: PENN_ACCESS_MNR_CORRIDOR.map(pt => [pt[0], pt[1]]),
      },
    });
  }
  const commuterRail: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: commuterFeatures,
  };

  // Canonical NYC Subway Service Lines from active MapNetworkData (default s692-irgq)
  // Deduplicate same-color express/shuttle/SIR aliases so they are not double-drawn in subwayTrunks
  const duplicateTrunkAliases = new Set(['6X', '7X', 'FX', 'GS', 'SIR']);
  const resolveTrunkOffsetSlot = (rt: string): number => {
    const clean = rt.toUpperCase();
    if (['A', 'C', 'E', '1', '2', '3', 'G'].includes(clean)) return -1;
    if (['N', 'Q', 'R', 'W', '4', '5', '6', '6X', 'J', 'Z'].includes(clean)) return 1;
    return 0;
  };

  const rawServiceFeatures = (activeServiceLines.features ?? [])
    .filter(feat => {
      const props = (feat.properties ?? {}) as Record<string, unknown>;
      const routeId = String(props['route_id'] ?? props['service_line'] ?? '').trim().toUpperCase();
      return !duplicateTrunkAliases.has(routeId);
    })
    .map(feat => {
      const props = (feat.properties ?? {}) as Record<string, unknown>;
      const routeId = String(props['route_id'] ?? props['service_line'] ?? '1').trim();
      const routeMeta = net.routes[routeId];
      const themeColor = themeSpec.routeColorOverrides?.[routeId.toUpperCase()];
      const color = String(
        themeColor ?? routeMeta?.colorHex ?? props['color_hex'] ?? resolveRouteColor(routeId, 'MTA_NYCT_SUBWAY')
      );
      const offsetSlot = resolveTrunkOffsetSlot(routeId);
      return {
        type: 'Feature' as const,
        properties: {
          trunk: routeId,
          route_id: routeId,
          route_short_name: String(props['route_short_name'] ?? routeId),
          trunk_group: String(routeMeta?.trunkGroup ?? props['trunk_group'] ?? ''),
          division: String(routeMeta?.division ?? props['division'] ?? ''),
          color,
          offset_slot: offsetSlot,
        },
        geometry: feat.geometry,
      };
    });

  const subwayTrunks: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: rawServiceFeatures,
  };

  // Terminal Route Bullets computed dynamically from outer chain endpoints of rendered subwayTrunks
  const rawEndpoints: { iconId: string; lon: number; lat: number }[] = [];
  for (const feat of rawServiceFeatures) {
    const props = (feat.properties ?? {}) as Record<string, unknown>;
    const routeId = String(props['route_id'] ?? '').trim();
    if (!routeId) continue;
    const displayId = routeId.toUpperCase() === 'SIR' ? 'SI' : routeId;
    const geom = feat.geometry;
    if (!geom) continue;
    const chains: [number, number][][] =
      geom.type === 'LineString'
        ? [geom.coordinates as [number, number][]]
        : geom.type === 'MultiLineString'
          ? (geom.coordinates as [number, number][][])
          : [];
    if (chains.length === 0) continue;

    for (let ci = 0; ci < chains.length; ci++) {
      const ch = chains[ci]!;
      if (ch.length < 2) continue;
      for (const isStart of [true, false]) {
        const pt = isStart ? ch[0]! : ch[ch.length - 1]!;
        const adj = isStart ? ch[1]! : ch[ch.length - 2]!;
        // Skip branch wye junctions that meet another chain of the same route
        const meetsOtherChain = chains.some((other, oi) => {
          if (oi === ci) return false;
          return other.some(op => Math.hypot(op[0] - pt[0], op[1] - pt[1]) < 0.002);
        });
        if (meetsOtherChain) continue;
        const dx = pt[0] - adj[0];
        const dy = pt[1] - adj[1];
        const len = Math.hypot(dx, dy) || 1;
        const nudgedLon = pt[0] + (dx / len) * 0.0022;
        const nudgedLat = pt[1] + (dy / len) * 0.0022;
        rawEndpoints.push({ iconId: `bullet-${displayId}`, lon: nudgedLon, lat: nudgedLat });
        if (
          displayId === '7' &&
          !is1953Map &&
          (Boolean(net.routes['7X']) || Boolean(net.routes['<7>']))
        ) {
          rawEndpoints.push({ iconId: 'diamond-7', lon: nudgedLon + 0.0034, lat: nudgedLat });
        }
      }
    }
  }

  // Cluster co-located terminal bullets horizontally so overlapping lines (e.g. D/F/N/Q at Coney Island) stay distinct
  const terminalBulletsList: GeoJSON.Feature[] = [];
  const usedIdx = new Set<number>();
  for (let i = 0; i < rawEndpoints.length; i++) {
    if (usedIdx.has(i)) continue;
    const group = [rawEndpoints[i]!];
    usedIdx.add(i);
    for (let j = i + 1; j < rawEndpoints.length; j++) {
      if (usedIdx.has(j)) continue;
      const cand = rawEndpoints[j]!;
      if (Math.hypot(cand.lon - group[0]!.lon, cand.lat - group[0]!.lat) < 0.0035) {
        if (!group.some(g => g.iconId === cand.iconId)) {
          group.push(cand);
        }
        usedIdx.add(j);
      }
    }
    const mid = (group.length - 1) / 2;
    group.forEach((item, idx) => {
      terminalBulletsList.push({
        type: 'Feature',
        properties: { iconId: item.iconId },
        geometry: {
          type: 'Point',
          coordinates: [item.lon + (idx - mid) * 0.0034, item.lat],
        },
      });
    });
  }
  const terminalBullets: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: terminalBulletsList,
  };

  // Major Transfer Complexes (rendered as pure black capsules with stopping route bullets)
  const primaryTransferIds = [
    '127', '631', 'D17', '128', '635', '125', 'A38',
    '235', 'G22', 'G14', '719', '629', 'A31', 'A41',
    'A51', 'D43', 'G08',
  ];
  const transferHubsList: StationInfo[] = [];
  const usedHubIds = new Set<string>();
  for (const id of primaryTransferIds) {
    const st = activeStations[id];
    if (st) {
      transferHubsList.push(st);
      usedHubIds.add(id);
    }
  }
  for (const st of Object.values(activeStations)) {
    if (!usedHubIds.has(st.stationId) && (st as any).isTransferHub === true) {
      transferHubsList.push(st);
      usedHubIds.add(st.stationId);
    }
  }
  if (transferHubsList.length === 0) {
    for (const st of Object.values(activeStations)) {
      if (st.routes.length >= 4) {
        transferHubsList.push(st);
        usedHubIds.add(st.stationId);
      }
    }
  }

  const transferCapsules: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: transferHubsList.map(hub => {
      const cleanName = cleanStationLabelText(hub.name);
      const normalizedRoutes = normalizeStationRoutes(hub.routes);
      return {
        type: 'Feature',
        properties: {
          stationId: hub.stationId,
          name: cleanName,
          routes: normalizedRoutes.join('-'),
          routeCount: normalizedRoutes.length,
          iconId: `capsule-${hub.stationId}`,
          labelIconId: `station-label-${hub.stationId}`,
        },
        geometry: {
          type: 'Point',
          coordinates: [hub.lon, hub.lat],
        },
      };
    }),
  };

  // Individual Station Stop Nodes (pure black circles for single route, pure black multi-bullet pills for multiple routes)
  const stationStops: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: Object.values(activeStations)
      .filter(st => !TRANSFER_HUB_STATION_IDS.has(st.stationId) && !usedHubIds.has(st.stationId))
      .map(st => {
        const normalizedRoutes = normalizeStationRoutes(st.routes);
        const primaryRoute = normalizedRoutes[0] ?? '1';
        const cleanName = cleanStationLabelText(st.name);
        return {
          type: 'Feature',
          properties: {
            stationId: st.stationId,
            name: cleanName,
            primaryRoute,
            routes: normalizedRoutes.join('-'),
            routeCount: normalizedRoutes.length,
            iconId: getStopPillIconId(normalizedRoutes),
            labelIconId: `station-label-${st.stationId}`,
            labelOffset: getStationLabelOffset(normalizedRoutes.length),
          },
          geometry: {
            type: 'Point',
            coordinates: [st.lon, st.lat],
          },
        };
      }),
  };

  return {
    land,
    parks,
    waterways,
    waterwayLabels,
    boroughWatermarks,
    commuterRail,
    historicalElevated,
    subwayTrunks,
    transferCapsules,
    stationStops,
    terminalBullets,
  };
}

export function cleanStationLabelText(rawName: string): string {
  let text = rawName.trim();
  // Strip parenthetical route or line suffixes like " (M,R)", " (N,W)", " (Brighton)"
  text = text.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  if (/^Jackson Hts-Roosevelt Av\s*\/\s*74 St/i.test(text)) {
    return 'Jackson Hts-Roosevelt Av';
  }
  if (/^59 St\s*\/\s*Lexington Av\/59 St/i.test(text) || /^Lexington Av\/59 St/i.test(text)) {
    return 'Lexington Av-59 St';
  }
  if (/^47-50 Sts-Rockefeller Ctr/i.test(text)) {
    return '47-50 Sts';
  }
  if (/^42 St-Port Authority Bus Terminal/i.test(text)) {
    return '42 St-Port Authority';
  }
  if (/^42 St-Bryant Park\s*\/\s*5 Av/i.test(text)) {
    return '42 St-Bryant Pk';
  }
  return text;
}

function putMapSpriteImage(
  map: MapLibreMap,
  iconId: string,
  imgData: ImageData,
  forceReplace = false
): void {
  if (map.hasImage(iconId)) {
    if (!forceReplace) return;
    if (typeof (map as any).removeImage === 'function') {
      try {
        (map as any).removeImage(iconId);
      } catch {
        // Ignore remove error
      }
    } else if (typeof (map as any).updateImage === 'function') {
      try {
        (map as any).updateImage(iconId, imgData);
        return;
      } catch {
        // Fall through
      }
    } else {
      return;
    }
  }
  map.addImage(iconId, imgData, { pixelRatio: 2 });
}

export function ensureStationLabelSprite(
  map: MapLibreMap,
  stationId: string,
  name: string,
  theme?: MapVisualThemeId,
  forceReplace = false
): string {
  const iconId = `station-label-${stationId}`;
  if (!map.hasImage(iconId) || forceReplace) {
    const themeSpec = getMapThemeSpec(theme ?? getActiveMapVisualTheme());
    const cleanName = cleanStationLabelText(name);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const font = 'bold 10px "Helvetica Neue", Helvetica, Arial, sans-serif';
      ctx.font = font;
      const metrics = ctx.measureText(cleanName);
      const textWidth = Math.ceil(metrics.width);
      const paddingX = 4;
      const virtualWidth = Math.max(textWidth + paddingX * 2, 20);
      const virtualHeight = 15;

      canvas.width = Math.ceil(virtualWidth * 2);
      canvas.height = Math.ceil(virtualHeight * 2);

      const ctx2 = canvas.getContext('2d');
      if (ctx2) {
        ctx2.clearRect(0, 0, canvas.width, canvas.height);
        ctx2.scale(2, 2);
        ctx2.font = font;
        ctx2.textAlign = 'left';
        ctx2.textBaseline = 'middle';

        // Draw theme-specific halo
        ctx2.lineWidth = 3;
        ctx2.strokeStyle = themeSpec.stationLabelHaloColor;
        ctx2.strokeText(cleanName, paddingX, virtualHeight / 2);

        // Draw theme-specific label text
        ctx2.fillStyle = themeSpec.stationLabelFillColor;
        ctx2.fillText(cleanName, paddingX, virtualHeight / 2);

        const imgData = ctx2.getImageData(0, 0, canvas.width, canvas.height);
        putMapSpriteImage(map, iconId, imgData, forceReplace);
      }
    }
  }
  return iconId;
}

/**
 * Creates high-DPI crisp MTA station stop pill sprite images on the MapLibre instance.
 * - Single-route stations render as a circle (`stop-pill-7`) with theme-aware background and border.
 * - Multi-route stations render as a horizontal pill (`stop-pill-E-M`, `stop-pill-1-2-3`)
 *   whose width scales with the number of stopping routes ("different route spans per bullet"),
 *   displaying each route's colored bullet inside.
 */
export function ensureStopPillSprite(
  map: MapLibreMap,
  routesInput: string | readonly string[],
  networkData?: MapNetworkData,
  theme?: MapVisualThemeId,
  forceReplace = false
): string {
  const net = networkData ?? getActiveMapNetworkData();
  const themeSpec = getMapThemeSpec(theme ?? net.config?.theme ?? getActiveMapVisualTheme());
  const routes = normalizeStationRoutes(routesInput);
  const effectiveRoutes = routes.length > 0 ? routes : ['1'];
  const stopPillId = `stop-pill-${effectiveRoutes.join('-')}`;

  if (!map.hasImage(stopPillId) || forceReplace) {
    if (effectiveRoutes.length === 1) {
      const displayLabel = effectiveRoutes[0]!;
      const canvas = document.createElement('canvas');
      canvas.width = 36;
      canvas.height = 36;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, 36, 36);
        ctx.scale(1.5, 1.5); // 24x24 virtual coordinates

        ctx.beginPath();
        ctx.arc(12, 12, 10, 0, Math.PI * 2);
        ctx.fillStyle = themeSpec.stopPillBackgroundColor;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = themeSpec.stopPillBorderColor;
        ctx.stroke();

        ctx.fillStyle = '#FFFFFF';
        ctx.font = displayLabel.length > 2
          ? 'bold 7.5px "Helvetica Neue", Helvetica, Arial, sans-serif'
          : displayLabel.length === 2
            ? 'bold 8.5px "Helvetica Neue", Helvetica, Arial, sans-serif'
            : 'bold 10px "Helvetica Neue", Helvetica, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(displayLabel, 12, 12.5);

        const imgData = ctx.getImageData(0, 0, 36, 36);
        putMapSpriteImage(map, stopPillId, imgData, forceReplace);
      }
    } else {
      const pillRoutes = effectiveRoutes.slice(0, 6);
      const bulletDiameter = 14;
      const bulletRadius = bulletDiameter / 2;
      const paddingX = 4;
      const gap = 2;
      const virtualWidth =
        paddingX * 2 + pillRoutes.length * bulletDiameter + (pillRoutes.length - 1) * gap;
      const virtualHeight = 20;

      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(virtualWidth * 2);
      canvas.height = Math.ceil(virtualHeight * 2);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.scale(2, 2);

        const r = virtualHeight / 2;
        ctx.beginPath();
        ctx.moveTo(r, 0.75);
        ctx.lineTo(virtualWidth - r, 0.75);
        ctx.arc(virtualWidth - r, r, r - 0.75, -Math.PI / 2, Math.PI / 2);
        ctx.lineTo(r, virtualHeight - 0.75);
        ctx.arc(r, r, r - 0.75, Math.PI / 2, -Math.PI / 2);
        ctx.closePath();
        ctx.fillStyle = themeSpec.stopPillBackgroundColor;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = themeSpec.stopPillBorderColor;
        ctx.stroke();

        // Colored route bullets inside the station pill
        pillRoutes.forEach((rt, idx) => {
          const cx = paddingX + bulletRadius + idx * (bulletDiameter + gap);
          const cy = virtualHeight / 2;
          const color =
            themeSpec.routeColorOverrides?.[rt.toUpperCase()] ??
            net.routes[rt]?.colorHex ??
            resolveRouteColor(rt, 'MTA_NYCT_SUBWAY');
          const textColor = ['#FCCC0A', '#E6B800'].includes(color.toUpperCase()) ? '#000000' : '#FFFFFF';

          ctx.beginPath();
          ctx.arc(cx, cy, bulletRadius - 0.5, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();

          ctx.fillStyle = textColor;
          ctx.font =
            rt.length > 2
              ? 'bold 6.5px "Helvetica Neue", Helvetica, Arial, sans-serif'
              : rt.length === 2
                ? 'bold 7.5px "Helvetica Neue", Helvetica, Arial, sans-serif'
                : 'bold 9px "Helvetica Neue", Helvetica, Arial, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(rt, cx, cy + 0.4);
        });

        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        putMapSpriteImage(map, stopPillId, imgData, forceReplace);
      }
    }
  }
  return stopPillId;
}

/**
 * Selects up to 3 representative trunk bullets of distinct colors for a transfer capsule so
 * major hubs (Times Sq, Atlantic Av, Fulton St) stay sleek, compact, and legible.
 */
export function selectCompactCapsuleRoutes(routes: readonly string[], maxBullets = 3): string[] {
  if (routes.length <= maxBullets) return [...routes];
  const chosen: string[] = [];
  const seenColors = new Set<string>();
  for (const rt of routes) {
    const color = resolveRouteColor(rt, 'MTA_NYCT_SUBWAY');
    if (!seenColors.has(color)) {
      seenColors.add(color);
      chosen.push(rt);
      if (chosen.length === maxBullets) return chosen;
    }
  }
  for (const rt of routes) {
    if (!chosen.includes(rt)) {
      chosen.push(rt);
      if (chosen.length === maxBullets) break;
    }
  }
  return chosen;
}

/**
 * Creates high-DPI crisp MTA route bullet and stop pill sprite images
 * on the MapLibre instance for hardware-accelerated WebGL symbol rendering.
 */
export function ensureMtaMapSprites(
  map: MapLibreMap,
  networkData?: MapNetworkData,
  theme?: MapVisualThemeId
): void {
  const net = networkData ?? getActiveMapNetworkData();
  const activeThemeId = theme ?? net.config?.theme ?? getActiveMapVisualTheme();
  const themeSpec = getMapThemeSpec(activeThemeId);
  const spriteThemeKey = `${activeThemeId}|${net.config?.presetId ?? ''}|${net.config?.routesTable ?? ''}|${net.config?.stationsTable ?? ''}`;
  const prevThemeKey = (map as any)._mtaSpriteThemeKey as string | undefined;
  const forceReplace = prevThemeKey !== undefined && prevThemeKey !== spriteThemeKey;
  (map as any)._mtaSpriteThemeKey = spriteThemeKey;

  const routes = Array.from(
    new Set([
      '1', '2', '3', '4', '5', '6', '7',
      'A', 'C', 'E', 'B', 'D', 'F', 'M',
      'N', 'Q', 'R', 'W', 'G', 'J', 'Z',
      'L', 'S', '<6>', '<7>', 'SIR', 'SI',
      ...Object.keys(net.routes),
    ])
  );

  for (const r of routes) {
    const isDiamond = r.startsWith('<') && r.endsWith('>');
    const displayLabel = isDiamond ? r.replace(/^<|>$/g, '') : r;
    const color =
      themeSpec.routeColorOverrides?.[displayLabel.toUpperCase()] ??
      themeSpec.routeColorOverrides?.[r.toUpperCase()] ??
      net.routes[r]?.colorHex ??
      resolveRouteColor(r, 'MTA_NYCT_SUBWAY');
    const textColor = ['#FCCC0A', '#E6B800'].includes(color.toUpperCase()) ? '#000000' : '#FFFFFF';
    const iconId = isDiamond ? `diamond-${displayLabel}` : `bullet-${displayLabel}`;

    if (!map.hasImage(iconId) || forceReplace) {
      const canvas = document.createElement('canvas');
      canvas.width = 48;
      canvas.height = 48;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, 48, 48);
        ctx.scale(1.5, 1.5); // 32x32 virtual coordinates

        if (isDiamond) {
          ctx.beginPath();
          ctx.moveTo(16, 2);
          ctx.lineTo(30, 16);
          ctx.lineTo(16, 30);
          ctx.lineTo(2, 16);
          ctx.closePath();
          ctx.fillStyle = color;
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = themeSpec.stopPillBorderColor;
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(16, 16, 14, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = themeSpec.stopPillBorderColor;
          ctx.stroke();
        }

        ctx.fillStyle = textColor;
        ctx.font = displayLabel.length > 2
          ? 'bold 10px "Helvetica Neue", Helvetica, Arial, sans-serif'
          : displayLabel.length === 2
            ? 'bold 12px "Helvetica Neue", Helvetica, Arial, sans-serif'
            : 'bold 15px "Helvetica Neue", Helvetica, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(displayLabel, 16, 16.5);

        const imgData = ctx.getImageData(0, 0, 48, 48);
        putMapSpriteImage(map, iconId, imgData, forceReplace);
      }
    }

    ensureStopPillSprite(map, r, net, activeThemeId, forceReplace);
  }

  // Heading indicator chevron sprite for live trains
  if (!map.hasImage('train-heading-chevron')) {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, 32, 32);
      ctx.beginPath();
      ctx.moveTo(16, 4);
      ctx.lineTo(26, 24);
      ctx.lineTo(16, 19);
      ctx.lineTo(6, 24);
      ctx.closePath();
      ctx.fillStyle = '#111315';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#FFFFFF';
      ctx.stroke();

      const imgData = ctx.getImageData(0, 0, 32, 32);
      map.addImage('train-heading-chevron', imgData, { pixelRatio: 2 });
    }
  }

  // Water label sprites
  const waterLabelsList = [
    { id: 'water-label-hudson-river', text: 'Hudson River' },
    { id: 'water-label-east-river', text: 'East River' },
    { id: 'water-label-harlem-river', text: 'Harlem River' },
    { id: 'water-label-upper-new-york-bay', text: 'Upper New York Bay' },
    { id: 'water-label-newark-bay', text: 'Newark Bay' },
    { id: 'water-label-long-island-sound', text: 'Long Island Sound' },
  ];
  for (const wl of waterLabelsList) {
    if (!map.hasImage(wl.id) || forceReplace) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const font = 'italic bold 12px "Helvetica Neue", Helvetica, Arial, sans-serif';
        ctx.font = font;
        const metrics = ctx.measureText(wl.text);
        const textWidth = Math.ceil(metrics.width);
        const virtualWidth = textWidth + 8;
        const virtualHeight = 18;

        canvas.width = Math.ceil(virtualWidth * 2);
        canvas.height = Math.ceil(virtualHeight * 2);

        const ctx2 = canvas.getContext('2d');
        if (ctx2) {
          ctx2.clearRect(0, 0, canvas.width, canvas.height);
          ctx2.scale(2, 2);
          ctx2.font = font;
          ctx2.textAlign = 'center';
          ctx2.textBaseline = 'middle';

          // Theme-aware water label halo
          ctx2.lineWidth = 3;
          ctx2.strokeStyle = themeSpec.waterLabelHaloColor;
          ctx2.strokeText(wl.text, virtualWidth / 2, virtualHeight / 2);

          // Theme-aware water label text
          ctx2.fillStyle = themeSpec.waterLabelFillColor;
          ctx2.fillText(wl.text, virtualWidth / 2, virtualHeight / 2);

          const imgData = ctx2.getImageData(0, 0, canvas.width, canvas.height);
          putMapSpriteImage(map, wl.id, imgData, forceReplace);
        }
      }
    }
  }

  // Borough watermark sprites (honoring theme uppercase & 'RICHMOND' vs 'Staten Island')
  const formatBoroughName = (name: string): string =>
    themeSpec.boroughWatermarkUppercase ? name.toUpperCase() : name;
  const watermarksList = [
    { id: 'watermark-manhattan', text: formatBoroughName('Manhattan') },
    { id: 'watermark-brooklyn', text: formatBoroughName('Brooklyn') },
    { id: 'watermark-queens', text: formatBoroughName('Queens') },
    { id: 'watermark-the-bronx', text: formatBoroughName('The Bronx') },
    { id: 'watermark-staten-island', text: formatBoroughName(themeSpec.statenIslandLabel) },
    { id: 'watermark-new-jersey', text: formatBoroughName('New Jersey') },
    { id: 'watermark-long-island', text: formatBoroughName('Long Island') },
    { id: 'watermark-westchester', text: formatBoroughName('Westchester') },
    { id: 'watermark-connecticut', text: formatBoroughName('Connecticut') },
  ];
  for (const wm of watermarksList) {
    if (!map.hasImage(wm.id) || forceReplace) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const isManhattan = wm.id === 'watermark-manhattan';
        const font = isManhattan
          ? 'bold 32px "Helvetica Neue", Helvetica, Arial, sans-serif'
          : 'bold 24px "Helvetica Neue", Helvetica, Arial, sans-serif';
        ctx.font = font;
        const metrics = ctx.measureText(wm.text);
        const textWidth = Math.ceil(metrics.width);
        const virtualWidth = textWidth + (isManhattan ? 16 : 12);
        const virtualHeight = isManhattan ? 42 : 32;

        canvas.width = Math.ceil(virtualWidth * 2);
        canvas.height = Math.ceil(virtualHeight * 2);

        const ctx2 = canvas.getContext('2d');
        if (ctx2) {
          ctx2.clearRect(0, 0, canvas.width, canvas.height);
          ctx2.scale(2, 2);
          ctx2.font = font;
          ctx2.textAlign = 'center';
          ctx2.textBaseline = 'middle';
          ctx2.fillStyle = themeSpec.boroughWatermarkColor;
          ctx2.fillText(wm.text, virtualWidth / 2, virtualHeight / 2);

          const imgData = ctx2.getImageData(0, 0, canvas.width, canvas.height);
          putMapSpriteImage(map, wm.id, imgData, forceReplace);
        }
      }
    }
  }

  // Register multi-bullet stop pills and transfer capsules for all stations in the network
  const stationById = new Map<string, StationInfo>();
  for (const st of Object.values(net.stations)) {
    stationById.set(st.stationId, st);
  }
  const replacedPillIds = new Set<string>();
  for (const st of stationById.values()) {
    const normalizedRoutes = normalizeStationRoutes(st.routes);
    const pillKey = getStopPillIconId(normalizedRoutes);
    const shouldReplacePill = forceReplace && !replacedPillIds.has(pillKey);
    if (shouldReplacePill) replacedPillIds.add(pillKey);
    ensureStopPillSprite(map, normalizedRoutes, net, activeThemeId, shouldReplacePill);

    const capsuleId = `capsule-${st.stationId}`;
    if (!map.hasImage(capsuleId) || forceReplace) {
      const rawRoutes = normalizedRoutes.length > 0 ? normalizedRoutes : ['1'];
      const capsuleRoutes = selectCompactCapsuleRoutes(rawRoutes, 5);
      const bulletDiameter = 9.5;
      const bulletRadius = bulletDiameter / 2;
      const padding = 2.5;
      const gap = 1.4;
      const virtualWidth =
        padding * 2 + capsuleRoutes.length * bulletDiameter + (capsuleRoutes.length - 1) * gap;
      const virtualHeight = 14;

      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(virtualWidth * 2);
      canvas.height = Math.ceil(virtualHeight * 2);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.scale(2, 2);

        const r = virtualHeight / 2;
        ctx.beginPath();
        ctx.moveTo(r, 0.5);
        ctx.lineTo(virtualWidth - r, 0.5);
        ctx.arc(virtualWidth - r, r, r - 0.5, -Math.PI / 2, Math.PI / 2);
        ctx.lineTo(r, virtualHeight - 0.5);
        ctx.arc(r, r, r - 0.5, Math.PI / 2, -Math.PI / 2);
        ctx.closePath();
        ctx.fillStyle = themeSpec.stopPillBackgroundColor;
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = themeSpec.stopPillBorderColor;
        ctx.stroke();

        // Draw route bullets inside
        capsuleRoutes.forEach((rt, idx) => {
          const cx = padding + bulletRadius + idx * (bulletDiameter + gap);
          const cy = virtualHeight / 2;
          const color =
            themeSpec.routeColorOverrides?.[rt.toUpperCase()] ??
            net.routes[rt]?.colorHex ??
            resolveRouteColor(rt, 'MTA_NYCT_SUBWAY');
          const textColor = ['#FCCC0A', '#E6B800'].includes(color.toUpperCase()) ? '#000000' : '#FFFFFF';

          ctx.beginPath();
          ctx.arc(cx, cy, 4.2, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();

          ctx.fillStyle = textColor;
          ctx.font = 'bold 5.8px "Helvetica Neue", Helvetica, Arial, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(rt, cx, cy + 0.3);
        });

        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        putMapSpriteImage(map, capsuleId, imgData, forceReplace);
      }
    }

    // Pre-generate station label sprites
    ensureStationLabelSprite(map, st.stationId, st.name, activeThemeId, forceReplace);
  }
}

/**
 * Idempotently injects the authentic MTA subway network, water/park tints,
 * borough watermarks, and transfer complex styling into any MapLibre instance.
 */
export function ensureMtaSubwayOverlay(
  map: MapLibreMap,
  options: {
    baseTrunkOpacity?: number;
    showStationStops?: boolean;
    showTransferCapsules?: boolean;
    showTerminalBullets?: boolean;
    networkData?: MapNetworkData;
    theme?: MapVisualThemeId;
    hideSubwayOverlay?: boolean;
    corridorOverlay?: string;
  } = {}
): void {
  const net = options.networkData ?? getMapInstanceNetworkData(map);
  const rawTheme = options.theme ?? net.config?.theme ?? getMapInstanceVisualTheme(map);
  const activeThemeId: MapVisualThemeId =
    MAP_VISUAL_THEMES.find(t => t.id === rawTheme)?.id ?? 'mta';
  const themeSpec = getMapThemeSpec(activeThemeId);
  const hideSubway =
    options.hideSubwayOverlay ?? net.config?.hideSubwayOverlay ?? false;
  const corridorOverlayId = (
    options.corridorOverlay ?? net.config?.corridorOverlay ?? ''
  ).trim().toUpperCase();
  const geojson = buildMtaSubwayMapGeoJson(net, activeThemeId);

  const setLayerVisibilitySafe = (layerId: string, visible: boolean) => {
    try {
      if ((map as any).getLayer?.(layerId) && typeof (map as any).setLayoutProperty === 'function') {
        (map as any).setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
      }
    } catch {
      // Ignore on mock MapLibre instances
    }
  };

  const isGeo = Boolean(themeSpec.isGeographicBasemap);

  if (typeof (map as any).setPaintProperty === 'function') {
    try {
      if ((map as any).getLayer?.('background')) {
        (map as any).setPaintProperty(
          'background',
          'background-color',
          isGeo ? themeSpec.landFillColor : themeSpec.waterColor
        );
      }
    } catch {
      // Ignore if background layer is unavailable
    }
  }

  // Try to register sprites
  const m60Stops = net.corridorStops?.['M60-SBS'] ?? [];
  const m60Corridor = getActiveAuxiliaryCorridors(net).find(
    c =>
      c.agencyId === 'MTA_BUS' &&
      (c.badge === 'M60' || c.aliases.some(a => a.toUpperCase().includes('M60')))
  );
  try {
    ensureMtaMapSprites(map, net, activeThemeId);
    if (corridorOverlayId === 'M60-SBS' || corridorOverlayId === 'M60') {
      for (const st of m60Stops) {
        ensureStationLabelSprite(map, st.stopId, st.name, activeThemeId, true);
      }
    }
  } catch {
    // Canvas context might be limited in headless tests
  }

  // Geographic Keyless Vector Basemap Layers (OpenFreeMap planet street/shoreline cartography)
  for (const geoThemeId of ['geo-light', 'geo-dark'] as const) {
    const shouldShowThisGeo = isGeo && activeThemeId === geoThemeId;
    if (shouldShowThisGeo) {
      try {
        if (!map.getSource(OPENFREEMAP_VECTOR_SOURCE_ID)) {
          map.addSource(OPENFREEMAP_VECTOR_SOURCE_ID, {
            type: 'vector',
            url: OPENFREEMAP_VECTOR_SOURCE_URL,
          } as any);
        }
        const beforeId = (map as any).getLayer?.('mta-land-fill')
          ? 'mta-land-fill'
          : (map as any).getLayer?.('mta-commuter-rail-casing')
            ? 'mta-commuter-rail-casing'
            : (map as any).getLayer?.('m60-corridor-casing')
              ? 'm60-corridor-casing'
              : undefined;
        for (const vecLayer of buildGeographicVectorLayers(geoThemeId)) {
          if (!(map as any).getLayer?.(vecLayer.id)) {
            map.addLayer(vecLayer as any, beforeId);
          }
        }
      } catch {
        // Ignore if vector sources are unsupported in headless mock
      }
    }
    for (const layerId of GEOGRAPHIC_LAYER_IDS[geoThemeId]) {
      setLayerVisibilitySafe(layerId, shouldShowThisGeo);
    }
  }

  // 0. Landmass Polygons (NYC Boroughs + NJ shoreline)
  const landSourceId = 'mta-land-src';
  if (map.getSource(landSourceId)) {
    (map.getSource(landSourceId) as any).setData(geojson.land);
    if (typeof (map as any).setPaintProperty === 'function') {
      try {
        (map as any).setPaintProperty('mta-land-fill', 'fill-color', themeSpec.landFillColor);
        (map as any).setPaintProperty('mta-land-stroke', 'line-color', themeSpec.landStrokeColor);
        (map as any).setPaintProperty('mta-land-stroke', 'line-width', themeSpec.landStrokeWidth);
      } catch {
        // Ignore if layers are not present
      }
    }
  } else {
    map.addSource(landSourceId, { type: 'geojson', data: geojson.land });
    map.addLayer({
      id: 'mta-land-fill',
      type: 'fill',
      source: landSourceId,
      paint: {
        'fill-color': themeSpec.landFillColor,
        'fill-opacity': 1.0,
      },
    });
    map.addLayer({
      id: 'mta-land-stroke',
      type: 'line',
      source: landSourceId,
      paint: {
        'line-color': themeSpec.landStrokeColor,
        'line-width': themeSpec.landStrokeWidth,
      },
    });
  }
  setLayerVisibilitySafe('mta-land-fill', !isGeo);
  setLayerVisibilitySafe('mta-land-stroke', !isGeo);

  // 1. Parks
  const parksSourceId = 'mta-parks-src';
  if (map.getSource(parksSourceId)) {
    (map.getSource(parksSourceId) as any).setData(geojson.parks);
    if (typeof (map as any).setPaintProperty === 'function') {
      try {
        (map as any).setPaintProperty('mta-parks-fill', 'fill-color', themeSpec.parkFillColor);
        (map as any).setPaintProperty('mta-parks-fill', 'fill-opacity', themeSpec.parkFillOpacity);
        (map as any).setPaintProperty('mta-parks-line', 'line-color', themeSpec.parkStrokeColor);
      } catch {
        // Ignore if layers are not present
      }
    }
  } else {
    map.addSource(parksSourceId, { type: 'geojson', data: geojson.parks });
    map.addLayer({
      id: 'mta-parks-fill',
      type: 'fill',
      source: parksSourceId,
      paint: {
        'fill-color': themeSpec.parkFillColor,
        'fill-opacity': themeSpec.parkFillOpacity,
      },
    });
    map.addLayer({
      id: 'mta-parks-line',
      type: 'line',
      source: parksSourceId,
      paint: {
        'line-color': themeSpec.parkStrokeColor,
        'line-width': 1,
      },
    });
  }
  setLayerVisibilitySafe('mta-parks-fill', !isGeo);
  setLayerVisibilitySafe('mta-parks-line', !isGeo);

  // 2. Waterways (only if explicitly provided)
  if (geojson.waterways && geojson.waterways.features && geojson.waterways.features.length > 0) {
    const waterSourceId = 'mta-water-src';
    if (map.getSource(waterSourceId)) {
      (map.getSource(waterSourceId) as any).setData(geojson.waterways);
    } else {
      map.addSource(waterSourceId, { type: 'geojson', data: geojson.waterways });
      map.addLayer({
        id: 'mta-water-fill',
        type: 'fill',
        source: waterSourceId,
        paint: {
          'fill-color': themeSpec.waterColor,
          'fill-opacity': 0.85,
        },
      });
    }
    setLayerVisibilitySafe('mta-water-fill', !isGeo);
  }

  // 3. Waterway Labels
  const waterLabelsSourceId = 'mta-water-labels-src';
  if (map.getSource(waterLabelsSourceId)) {
    (map.getSource(waterLabelsSourceId) as any).setData(geojson.waterwayLabels);
  } else {
    map.addSource(waterLabelsSourceId, { type: 'geojson', data: geojson.waterwayLabels });
    map.addLayer({
      id: 'mta-water-labels',
      type: 'symbol',
      source: waterLabelsSourceId,
      layout: {
        'icon-image': ['get', 'iconId'],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    });
  }
  setLayerVisibilitySafe('mta-water-labels', !isGeo);

  // 4. Borough Watermarks
  const boroughSourceId = 'mta-borough-src';
  if (map.getSource(boroughSourceId)) {
    (map.getSource(boroughSourceId) as any).setData(geojson.boroughWatermarks);
  } else {
    map.addSource(boroughSourceId, { type: 'geojson', data: geojson.boroughWatermarks });
    map.addLayer({
      id: 'mta-borough-watermarks',
      type: 'symbol',
      source: boroughSourceId,
      layout: {
        'icon-image': ['get', 'iconId'],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    });
  }
  setLayerVisibilitySafe('mta-borough-watermarks', !isGeo);

  // 5. Commuter Rail Corridors (Metro-North & LIRR branch colors on MTA / Tauranac / Geographic maps)
  const commuterSourceId = 'mta-commuter-src';
  const commuterColorExpr: any =
    themeSpec.id === 'ind'
      ? themeSpec.commuterCasingColor
      : ['case', ['has', 'color'], ['get', 'color'], themeSpec.commuterCasingColor];
  if (map.getSource(commuterSourceId)) {
    (map.getSource(commuterSourceId) as any).setData(geojson.commuterRail);
    if (typeof (map as any).setPaintProperty === 'function') {
      try {
        (map as any).setPaintProperty('mta-commuter-rail-casing', 'line-color', commuterColorExpr);
        (map as any).setPaintProperty('mta-commuter-rail-inner', 'line-color', themeSpec.commuterInnerColor);
      } catch {
        // Ignore if layers are not present
      }
    }
  } else {
    map.addSource(commuterSourceId, { type: 'geojson', data: geojson.commuterRail });
    map.addLayer({
      id: 'mta-commuter-rail-casing',
      type: 'line',
      source: commuterSourceId,
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': commuterColorExpr,
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          8.5, 2.5,
          11, 3.2,
          13.5, 4.2,
        ],
        'line-opacity': 0.88,
      },
    });
    map.addLayer({
      id: 'mta-commuter-rail-inner',
      type: 'line',
      source: commuterSourceId,
      layout: {
        'line-cap': 'butt',
        'line-join': 'round',
      },
      paint: {
        'line-color': themeSpec.commuterInnerColor,
        'line-width': 1.1,
        'line-dasharray': [2.5, 2.5],
        'line-opacity': 0.92,
      },
    });
  }
  setLayerVisibilitySafe('mta-commuter-rail-casing', !hideSubway);
  setLayerVisibilitySafe('mta-commuter-rail-inner', !hideSubway);

  // 5b. Historical Elevated Railways (1929 & 1953 IRT/BMT Els — distinct iron-bronze trestle styling)
  const historicalElSourceId = 'mta-historical-el-src';
  const showHistoricalEl = !hideSubway && geojson.historicalElevated.features.length > 0;
  if (map.getSource(historicalElSourceId)) {
    (map.getSource(historicalElSourceId) as any).setData(geojson.historicalElevated);
  } else {
    map.addSource(historicalElSourceId, { type: 'geojson', data: geojson.historicalElevated });
    map.addLayer({
      id: 'mta-historical-el-casing',
      type: 'line',
      source: historicalElSourceId,
      layout: {
        'line-cap': 'butt',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#78350F',
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          9.5, 3.2,
          12, 4.6,
          14, 6.2,
        ],
        'line-opacity': 0.92,
      },
    });
    map.addLayer({
      id: 'mta-historical-el-ties',
      type: 'line',
      source: historicalElSourceId,
      layout: {
        'line-cap': 'butt',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#F59E0B',
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          9.5, 1.4,
          12, 2.0,
          14, 2.6,
        ],
        'line-dasharray': [2.2, 2.2],
        'line-opacity': 0.95,
      },
    });
  }
  setLayerVisibilitySafe('mta-historical-el-casing', showHistoricalEl);
  setLayerVisibilitySafe('mta-historical-el-ties', showHistoricalEl);

  // 6. Canonical Subway Trunk Corridors (curved MTA Subway Service Lines with parallel trunk offsets)
  const trunksSourceId = 'mta-subway-trunks-src';
  const baseOpacity = options.baseTrunkOpacity ?? 0.90;
  const casingScale = themeSpec.trunkCasingWidthScale ?? 1.0;
  const trunkCasingWidthExpr: any = [
    'interpolate', ['linear'], ['zoom'],
    9.5, Number((3.6 * casingScale).toFixed(2)),
    11, Number((5.4 * casingScale).toFixed(2)),
    12.5, Number((7.4 * casingScale).toFixed(2)),
    14, Number((10.0 * casingScale).toFixed(2)),
    15.5, Number((13.0 * casingScale).toFixed(2)),
  ];
  const trunkLineOffsetExpr: any = [
    'interpolate',
    ['linear'],
    ['zoom'],
    9.5,
    ['*', ['get', 'offset_slot'], 1.2],
    12,
    ['*', ['get', 'offset_slot'], 2.5],
    14,
    ['*', ['get', 'offset_slot'], 4.0],
  ];
  if (map.getSource(trunksSourceId)) {
    (map.getSource(trunksSourceId) as any).setData(geojson.subwayTrunks);
    if (typeof (map as any).setPaintProperty === 'function') {
      try {
        (map as any).setPaintProperty('mta-trunks-casing', 'line-color', themeSpec.trunkCasingColor);
        (map as any).setPaintProperty('mta-trunks-casing', 'line-width', trunkCasingWidthExpr);
        (map as any).setPaintProperty('mta-trunks-casing', 'line-opacity', baseOpacity);
        (map as any).setPaintProperty('mta-trunks-line', 'line-opacity', baseOpacity);
      } catch {
        // Ignore if layers are not present
      }
    }
  } else {
    map.addSource(trunksSourceId, { type: 'geojson', data: geojson.subwayTrunks });
    // Outer casing (white in MTA, cream in Tauranac, black in 1953 IND)
    map.addLayer({
      id: 'mta-trunks-casing',
      type: 'line',
      source: trunksSourceId,
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': themeSpec.trunkCasingColor,
        'line-offset': trunkLineOffsetExpr,
        'line-width': trunkCasingWidthExpr,
        'line-opacity': baseOpacity,
      },
    });
    // Colored trunk ribbon
    map.addLayer({
      id: 'mta-trunks-line',
      type: 'line',
      source: trunksSourceId,
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': ['get', 'color'],
        'line-offset': trunkLineOffsetExpr,
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          9.5, 2.2,
          11, 3.4,
          12.5, 5.0,
          14, 7.0,
          15.5, 9.5,
        ],
        'line-opacity': baseOpacity,
      },
    });
  }
  setLayerVisibilitySafe('mta-trunks-casing', !hideSubway);
  setLayerVisibilitySafe('mta-trunks-line', !hideSubway);

  // 7. Terminal Route Bullets
  if (options.showTerminalBullets !== false) {
    const terminalBulletsSourceId = 'mta-terminal-bullets-src';
    if (map.getSource(terminalBulletsSourceId)) {
      (map.getSource(terminalBulletsSourceId) as any).setData(geojson.terminalBullets);
    } else {
      map.addSource(terminalBulletsSourceId, { type: 'geojson', data: geojson.terminalBullets });
      map.addLayer({
        id: 'mta-terminal-bullets',
        type: 'symbol',
        source: terminalBulletsSourceId,
        layout: {
          'icon-image': ['get', 'iconId'],
          'icon-size': [
            'interpolate', ['linear'], ['zoom'],
            9.5, 0.56,
            11, 0.68,
            13, 0.84,
          ],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });
    }
    setLayerVisibilitySafe('mta-terminal-bullets', !hideSubway);
  }

  // 8. Transfer Capsules
  if (options.showTransferCapsules !== false) {
    const capsulesSourceId = 'mta-transfer-capsules-src';
    if (map.getSource(capsulesSourceId)) {
      (map.getSource(capsulesSourceId) as any).setData(geojson.transferCapsules);
    } else {
      map.addSource(capsulesSourceId, { type: 'geojson', data: geojson.transferCapsules });
      map.addLayer({
        id: 'mta-transfer-capsules-symbol',
        type: 'symbol',
        source: capsulesSourceId,
        minzoom: 10.5,
        layout: {
          'icon-image': ['get', 'iconId'],
          'icon-size': [
            'interpolate', ['linear'], ['zoom'],
            9.5, 0.50,
            11, 0.64,
            13, 0.78,
          ],
          'icon-padding': 2,
          'icon-allow-overlap': false,
          'icon-ignore-placement': false,
        },
      });
      map.addLayer({
        id: 'mta-transfer-labels',
        type: 'symbol',
        source: capsulesSourceId,
        minzoom: 11.8,
        layout: {
          'icon-image': ['get', 'labelIconId'],
          'icon-anchor': 'top',
          'icon-offset': [0, 9],
          'icon-padding': 6,
          'icon-allow-overlap': false,
          'icon-ignore-placement': false,
        },
      });
    }
    setLayerVisibilitySafe('mta-transfer-capsules-symbol', !hideSubway);
    setLayerVisibilitySafe('mta-transfer-labels', !hideSubway);
  }

  // 9. Individual Station Stops
  if (options.showStationStops !== false) {
    const stopsSourceId = 'mta-station-stops-src';
    if (map.getSource(stopsSourceId)) {
      (map.getSource(stopsSourceId) as any).setData(geojson.stationStops);
    } else {
      map.addSource(stopsSourceId, { type: 'geojson', data: geojson.stationStops });
      map.addLayer({
        id: 'mta-station-stops-symbol',
        type: 'symbol',
        source: stopsSourceId,
        minzoom: 11.8,
        layout: {
          'icon-image': ['get', 'iconId'],
          'icon-size': [
            'interpolate', ['linear'], ['zoom'],
            11.8, 0.55,
            13.5, 0.72,
          ],
          'icon-padding': 2,
          'icon-allow-overlap': false,
          'icon-ignore-placement': false,
        },
      });
      map.addLayer({
        id: 'mta-station-stops-label',
        type: 'symbol',
        source: stopsSourceId,
        minzoom: 12.2,
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
    setLayerVisibilitySafe('mta-station-stops-symbol', !hideSubway);
    setLayerVisibilitySafe('mta-station-stops-label', !hideSubway);
  }

  // 10. Dedicated Surface Transit Corridor Overlay (e.g. M60 Select Bus Service)
  const corridorLineSrcId = 'dbtc-corridor-line-src';
  const corridorStopsSrcId = 'dbtc-corridor-stops-src';
  const showM60Corridor = corridorOverlayId === 'M60-SBS' || corridorOverlayId === 'M60';
  const m60Color = m60Corridor?.colorHex ?? '#0078C6';
  if (showM60Corridor) {
    const m60Coords = m60Corridor?.chains?.[0]?.map(pt => [pt[0], pt[1]]) ?? [];
    const m60LineFc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features:
        m60Coords.length >= 2
          ? [
              {
                type: 'Feature',
                properties: {
                  route_id: 'M60-SBS',
                  name: m60Corridor?.name ?? 'M60 Select Bus Service',
                  color: m60Color,
                },
                geometry: {
                  type: 'LineString',
                  coordinates: m60Coords,
                },
              },
            ]
          : [],
    };
    const m60StopsFc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: m60Stops.map(st => ({
        type: 'Feature',
        properties: {
          stopId: st.stopId,
          name: st.name,
          labelIconId: `station-label-${st.stopId}`,
        },
        geometry: {
          type: 'Point',
          coordinates: [st.lon, st.lat],
        },
      })),
    };
    if (map.getSource(corridorLineSrcId)) {
      (map.getSource(corridorLineSrcId) as any).setData(m60LineFc);
    } else {
      map.addSource(corridorLineSrcId, { type: 'geojson', data: m60LineFc });
      map.addLayer({
        id: 'dbtc-corridor-casing',
        type: 'line',
        source: corridorLineSrcId,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': themeSpec.trunkCasingColor,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 6.5, 13, 9.5, 15, 12.5],
          'line-opacity': 0.95,
        },
      });
      map.addLayer({
        id: 'dbtc-corridor-line',
        type: 'line',
        source: corridorLineSrcId,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4.0, 13, 6.0, 15, 8.5],
          'line-opacity': 0.92,
        },
      });
    }
    if (map.getSource(corridorStopsSrcId)) {
      (map.getSource(corridorStopsSrcId) as any).setData(m60StopsFc);
    } else {
      map.addSource(corridorStopsSrcId, { type: 'geojson', data: m60StopsFc });
      map.addLayer({
        id: 'dbtc-corridor-stops-circle',
        type: 'circle',
        source: corridorStopsSrcId,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3.5, 13, 5.2],
          'circle-color': '#FFFFFF',
          'circle-stroke-color': m60Color,
          'circle-stroke-width': 2.2,
        },
      });
      map.addLayer({
        id: 'dbtc-corridor-stops-label',
        type: 'symbol',
        source: corridorStopsSrcId,
        minzoom: 11.0,
        layout: {
          'icon-image': ['get', 'labelIconId'],
          'icon-anchor': 'top',
          'icon-offset': [0, 7],
          'icon-padding': 4,
          'icon-allow-overlap': false,
          'icon-ignore-placement': false,
        },
      });
    }
  }
  setLayerVisibilitySafe('dbtc-corridor-casing', showM60Corridor);
  setLayerVisibilitySafe('dbtc-corridor-line', showM60Corridor);
  setLayerVisibilitySafe('dbtc-corridor-stops-circle', showM60Corridor);
  setLayerVisibilitySafe('dbtc-corridor-stops-label', showM60Corridor);
}
