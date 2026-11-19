import type { Map as MapLibreMap } from 'maplibre-gl';
import maplibregl from 'maplibre-gl';
import {
  resolveStationInfo,
  hydrateStationCache,
  ensureMtaSubwayOverlay,
  ensureStopPillSprite,
  ensureStationLabelSprite,
  cleanStationLabelText,
  extractRoutesFromStationText,
  normalizeStationRoutes,
  getStopPillIconId,
  getStationLabelOffset,
} from '../map/mta-subway-overlay.js';
import {
  CHART_COLOR_PALETTES,
  buildRouteBulletHtml,
  resolveCustomColorForKey,
} from '../echarts-theme-mta.js';

export interface IsochroneStationPoint {
  stationId: string;
  name?: string;
  lat: number;
  lon: number;
  transitTimeMin: number;
  routes?: readonly string[];
}

export function generateCirclePolygon(
  centerLon: number,
  centerLat: number,
  radiusMeters: number,
  points = 32
): [number, number][] {
  const coords: [number, number][] = [];
  const earthRadius = 6371000;
  const dLat = (radiusMeters / earthRadius) * (180 / Math.PI);
  const dLon = (radiusMeters / (earthRadius * Math.cos((centerLat * Math.PI) / 180))) * (180 / Math.PI);

  for (let i = 0; i <= points; i++) {
    const angle = (i * 2 * Math.PI) / points;
    const dx = Math.cos(angle) * dLon;
    const dy = Math.sin(angle) * dLat;
    coords.push([centerLon + dx, centerLat + dy]);
  }
  return coords;
}

interface CircleSpec {
  lon: number;
  lat: number;
  radiusMeters: number;
  dLon: number;
  dLat: number;
}

/**
 * Merges a connected component of overlapping circles into smooth exterior/interior contour rings
 * using Marching Squares with linear edge interpolation.
 */
function signedRingArea(ring: readonly [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i]!;
    const b = ring[i + 1]!;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum * 0.5;
}

function pointInRing(pt: [number, number], ring: readonly [number, number][]): boolean {
  const [px, py] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-15) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Merges a connected component of overlapping circles into smooth GeoJSON polygons
 * ([outerRing, ...holeRings][]) using Marching Squares with linear edge interpolation.
 */
function traceMergedComponentPolygons(comp: readonly CircleSpec[]): [number, number][][][] {
  if (comp.length === 1) {
    const c = comp[0]!;
    return [[generateCirclePolygon(c.lon, c.lat, c.radiusMeters, 28)]];
  }

  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const c of comp) {
    if (c.lon - c.dLon < minLon) minLon = c.lon - c.dLon;
    if (c.lon + c.dLon > maxLon) maxLon = c.lon + c.dLon;
    if (c.lat - c.dLat < minLat) minLat = c.lat - c.dLat;
    if (c.lat + c.dLat > maxLat) maxLat = c.lat + c.dLat;
  }

  const padLon = (maxLon - minLon) * 0.08 + 0.0015;
  const padLat = (maxLat - minLat) * 0.08 + 0.0015;
  minLon -= padLon;
  maxLon += padLon;
  minLat -= padLat;
  maxLat += padLat;

  const spanLon = maxLon - minLon;
  const spanLat = maxLat - minLat;
  const targetStep = 0.00065;
  const nx = Math.max(28, Math.min(160, Math.ceil(spanLon / targetStep)));
  const ny = Math.max(28, Math.min(160, Math.ceil(spanLat / targetStep)));
  const stepLon = spanLon / nx;
  const stepLat = spanLat / ny;

  // Evaluate signed field: > 0 inside union of circles, < 0 outside
  const cols = nx + 1;
  const rows = ny + 1;
  const field = new Float32Array(cols * rows);
  for (let iy = 0; iy < rows; iy++) {
    const lat = minLat + iy * stepLat;
    for (let ix = 0; ix < cols; ix++) {
      const lon = minLon + ix * stepLon;
      let maxVal = -Infinity;
      for (let k = 0; k < comp.length; k++) {
        const c = comp[k]!;
        const u = (lon - c.lon) / c.dLon;
        const v = (lat - c.lat) / c.dLat;
        const val = 1 - (u * u + v * v);
        if (val > maxVal) maxVal = val;
      }
      field[iy * cols + ix] = maxVal;
    }
  }

  // Directed segments keyed by quantized start coordinate
  interface Segment {
    p1: [number, number];
    p2: [number, number];
    used: boolean;
  }
  const segments: Segment[] = [];
  const startMap = new Map<string, number[]>();
  const keyOf = (pt: [number, number]): string =>
    `${Math.round((pt[0] - minLon) / (stepLon * 1e-4))}:${Math.round((pt[1] - minLat) / (stepLat * 1e-4))}`;

  const addSeg = (p1: [number, number], p2: [number, number]) => {
    if (Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) < 1e-9) return;
    const idx = segments.length;
    segments.push({ p1, p2, used: false });
    const k = keyOf(p1);
    const list = startMap.get(k);
    if (list) list.push(idx);
    else startMap.set(k, [idx]);
  };

  const interp = (
    x1: number,
    y1: number,
    v1: number,
    x2: number,
    y2: number,
    v2: number
  ): [number, number] => {
    const denom = v1 - v2;
    const t = Math.abs(denom) > 1e-7 ? Math.max(0, Math.min(1, v1 / denom)) : 0.5;
    return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
  };

  for (let iy = 0; iy < ny; iy++) {
    const y0 = minLat + iy * stepLat;
    const y1 = y0 + stepLat;
    for (let ix = 0; ix < nx; ix++) {
      const x0 = minLon + ix * stepLon;
      const x1 = x0 + stepLon;

      const vBL = field[iy * cols + ix]!;
      const vBR = field[iy * cols + (ix + 1)]!;
      const vTR = field[(iy + 1) * cols + (ix + 1)]!;
      const vTL = field[(iy + 1) * cols + ix]!;

      const mask =
        (vBL >= 0 ? 1 : 0) |
        (vBR >= 0 ? 2 : 0) |
        (vTR >= 0 ? 4 : 0) |
        (vTL >= 0 ? 8 : 0);
      if (mask === 0 || mask === 15) continue;

      const eBottom = () => interp(x0, y0, vBL, x1, y0, vBR);
      const eRight = () => interp(x1, y0, vBR, x1, y1, vTR);
      const eTop = () => interp(x0, y1, vTL, x1, y1, vTR);
      const eLeft = () => interp(x0, y0, vBL, x0, y1, vTL);

      // Standard counter-clockwise boundary orientation around positive region
      switch (mask) {
        case 1:
          addSeg(eLeft(), eBottom());
          break;
        case 2:
          addSeg(eBottom(), eRight());
          break;
        case 3:
          addSeg(eLeft(), eRight());
          break;
        case 4:
          addSeg(eRight(), eTop());
          break;
        case 5:
          addSeg(eLeft(), eTop());
          addSeg(eRight(), eBottom());
          break;
        case 6:
          addSeg(eBottom(), eTop());
          break;
        case 7:
          addSeg(eLeft(), eTop());
          break;
        case 8:
          addSeg(eTop(), eLeft());
          break;
        case 9:
          addSeg(eTop(), eBottom());
          break;
        case 10:
          addSeg(eBottom(), eLeft());
          addSeg(eTop(), eRight());
          break;
        case 11:
          addSeg(eTop(), eRight());
          break;
        case 12:
          addSeg(eRight(), eLeft());
          break;
        case 13:
          addSeg(eRight(), eBottom());
          break;
        case 14:
          addSeg(eBottom(), eLeft());
          break;
      }
    }
  }

  const rings: [number, number][][] = [];
  for (let i = 0; i < segments.length; i++) {
    const first = segments[i]!;
    if (first.used) continue;
    first.used = true;
    const ring: [number, number][] = [first.p1, first.p2];
    let currEnd = first.p2;

    for (let step = 0; step < segments.length + 2; step++) {
      const candidates = startMap.get(keyOf(currEnd));
      if (!candidates) break;
      let nextIdx = -1;
      for (const cIdx of candidates) {
        if (!segments[cIdx]!.used) {
          nextIdx = cIdx;
          break;
        }
      }
      if (nextIdx === -1) break;
      const nextSeg = segments[nextIdx]!;
      nextSeg.used = true;
      ring.push(nextSeg.p2);
      currEnd = nextSeg.p2;
      if (Math.hypot(currEnd[0] - first.p1[0], currEnd[1] - first.p1[1]) < 1e-6) {
        break;
      }
    }

    if (ring.length >= 4) {
      const startPt = ring[0]!;
      const endPt = ring[ring.length - 1]!;
      if (startPt[0] !== endPt[0] || startPt[1] !== endPt[1]) {
        ring.push([startPt[0], startPt[1]]);
      }
      rings.push(ring);
    }
  }

  if (rings.length === 0) {
    return comp.map(c => [generateCirclePolygon(c.lon, c.lat, c.radiusMeters, 24)]);
  }

  // Classify exterior rings (signedArea > 0, CCW) and interior hole rings (signedArea < 0, CW)
  const outerPolys: { area: number; rings: [number, number][][] }[] = [];
  const holes: [number, number][][] = [];

  for (const r of rings) {
    const area = signedRingArea(r);
    if (area > 0) {
      outerPolys.push({ area, rings: [r] });
    } else if (area < 0) {
      holes.push(r);
    }
  }

  if (outerPolys.length === 0 && holes.length > 0) {
    // Fallback if all rings had negative winding
    return holes.map(h => [[...h].reverse()]);
  }

  // Sort outer polygons ascending by area so each hole attaches to the smallest enclosing outer ring
  outerPolys.sort((a, b) => a.area - b.area);
  for (const h of holes) {
    const samplePt = h[0]!;
    let attached = false;
    for (const poly of outerPolys) {
      if (pointInRing(samplePt, poly.rings[0]!)) {
        poly.rings.push(h);
        attached = true;
        break;
      }
    }
    if (!attached && outerPolys.length > 0) {
      outerPolys[outerPolys.length - 1]!.rings.push(h);
    }
  }

  return outerPolys.map(p => p.rings);
}

export function buildIsochroneBandsGeoJson(
  stations: readonly IsochroneStationPoint[],
  bands: readonly number[] = [10, 20, 30, 45],
  walkSpeedMpm = 80,
  maxWalkMeters = 800
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  const earthRadius = 6371000;

  // Sort bands descending so smaller bands render on top
  const sortedBands = [...bands].sort((a, b) => b - a);

  // MTA editorial travel-time palette tailored for clean white map
  const bandColors: Record<number, { fill: string; stroke: string }> = {
    10: { fill: '#0039A6', stroke: '#002B7F' }, // IND 8th Ave Blue
    20: { fill: '#00ADD0', stroke: '#0088A8' }, // Second Ave Teal
    30: { fill: '#6CBE45', stroke: '#4E9A2A' }, // Crosstown Lime
    45: { fill: '#FF6319', stroke: '#D94E0F' }, // 6th Ave Orange
  };

  for (const band of sortedBands) {
    const circles: CircleSpec[] = [];

    for (const st of stations) {
      if (st.transitTimeMin <= band) {
        const remainingMinutes = band - st.transitTimeMin;
        const walkRadius = Math.min(maxWalkMeters, Math.max(120, remainingMinutes * walkSpeedMpm));
        if (walkRadius > 10) {
          const dLat = (walkRadius / earthRadius) * (180 / Math.PI);
          const dLon =
            (walkRadius / (earthRadius * Math.cos((st.lat * Math.PI) / 180))) * (180 / Math.PI);
          circles.push({
            lon: st.lon,
            lat: st.lat,
            radiusMeters: walkRadius,
            dLon,
            dLat,
          });
        }
      }
    }

    if (circles.length > 0) {
      // Group overlapping circles into connected components so overlapping rings merge cleanly
      const visited = new Uint8Array(circles.length);
      const polygons: [number, number][][][] = [];

      for (let i = 0; i < circles.length; i++) {
        if (visited[i]) continue;
        visited[i] = 1;
        const comp: CircleSpec[] = [circles[i]!];
        const queue: number[] = [i];

        while (queue.length > 0) {
          const currIdx = queue.pop()!;
          const c1 = circles[currIdx]!;
          for (let j = 0; j < circles.length; j++) {
            if (visited[j]) continue;
            const c2 = circles[j]!;
            const sumDLon = c1.dLon + c2.dLon;
            const sumDLat = c1.dLat + c2.dLat;
            const normDist = Math.hypot((c1.lon - c2.lon) / sumDLon, (c1.lat - c2.lat) / sumDLat);
            if (normDist <= 0.98) {
              visited[j] = 1;
              comp.push(c2);
              queue.push(j);
            }
          }
        }

        const mergedPolygons = traceMergedComponentPolygons(comp);
        for (const poly of mergedPolygons) {
          polygons.push(poly);
        }
      }

      const colors = bandColors[band] ?? { fill: '#6366F1', stroke: '#4338CA' };
      features.push({
        type: 'Feature',
        geometry: {
          type: 'MultiPolygon',
          coordinates: polygons,
        },
        properties: {
          band,
          color: colors.fill,
          strokeColor: colors.stroke,
        },
      });
    }
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}

export const WALK_RADIUS_STEPS_METERS = [100, 200, 300, 400, 500, 600, 700, 800] as const;
export const MAJOR_WALK_RINGS_METERS = [200, 400, 600, 800] as const;

/**
 * Builds concentric radial walk-distance gradient bands around each reachable station.
 * Each station is assigned to its earliest reachable transit travel-time tier so slower
 * transit bands never stack underneath faster stations, and each tier radiates outward
 * in smooth 100m concentric gradient steps (100m -> 200m -> ... -> 800m) with major
 * distance rings at 200m (2.5m walk), 400m (5m walk), 600m (7.5m walk), and 800m (10m walk).
 */
export function buildStationWalkGradientGeoJson(
  stations: readonly IsochroneStationPoint[],
  bands: readonly number[] = [10, 20, 30, 45],
  walkSpeedMpm = 80,
  maxWalkMeters = 800,
  radiusStepsMeters: readonly number[] = WALK_RADIUS_STEPS_METERS,
  colorOverrides?: {
    customColors?: Readonly<Record<string, string>>;
    colorPalette?: string;
  }
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  const earthRadius = 6371000;

  const effectiveBands = bands.length > 0 ? bands : [10, 20, 30, 45];
  const ascBands = [...effectiveBands].sort((a, b) => a - b);
  const descBands = [...effectiveBands].sort((a, b) => b - a);
  const descRadii = [...radiusStepsMeters]
    .filter(r => r > 0 && r <= maxWalkMeters)
    .sort((a, b) => b - a);

  const customColors = colorOverrides?.customColors;
  const paletteSpec =
    typeof colorOverrides?.colorPalette === 'string'
      ? CHART_COLOR_PALETTES[colorOverrides.colorPalette]
      : undefined;

  const defaultBandColors: Record<number, { fill: string; stroke: string }> = {
    10: { fill: '#0039A6', stroke: '#002B7F' }, // IND 8th Ave Blue
    20: { fill: '#00ADD0', stroke: '#0088A8' }, // Second Ave Teal
    30: { fill: '#6CBE45', stroke: '#4E9A2A' }, // Crosstown Lime
    45: { fill: '#FF6319', stroke: '#D94E0F' }, // 6th Ave Orange
  };

  const bandColors: Record<number, { fill: string; stroke: string }> = {};
  ascBands.forEach((b, idx) => {
    const def = defaultBandColors[b] ?? { fill: '#6366F1', stroke: '#4338CA' };
    const customFill =
      resolveCustomColorForKey(`${b} min`, customColors) ??
      resolveCustomColorForKey(String(b), customColors) ??
      (paletteSpec ? paletteSpec.colors[idx % paletteSpec.colors.length] : null);
    bandColors[b] = customFill
      ? { fill: customFill, stroke: customFill }
      : def;
  });

  // Group each station into its earliest reachable transit band (clamping stations beyond max cutoff to the outer tier)
  const stationsByBand = new Map<number, IsochroneStationPoint[]>();
  for (const b of ascBands) {
    stationsByBand.set(b, []);
  }
  const maxBandCutoff = ascBands[ascBands.length - 1]!;
  for (const st of stations) {
    const matchedBand = ascBands.find(b => st.transitTimeMin <= b) ?? maxBandCutoff;
    stationsByBand.get(matchedBand)!.push(st);
  }

  for (const band of descBands) {
    const tierStations = stationsByBand.get(band) ?? [];
    if (tierStations.length === 0) continue;

    const colors = bandColors[band] ?? { fill: '#6366F1', stroke: '#4338CA' };

    for (const radiusMeters of descRadii) {
      const circles: CircleSpec[] = [];

      for (const st of tierStations) {
        if (radiusMeters <= maxWalkMeters) {
          const dLat = (radiusMeters / earthRadius) * (180 / Math.PI);
          const dLon =
            (radiusMeters / (earthRadius * Math.cos((st.lat * Math.PI) / 180))) * (180 / Math.PI);
          circles.push({
            lon: st.lon,
            lat: st.lat,
            radiusMeters,
            dLon,
            dLat,
          });
        }
      }

      if (circles.length === 0) continue;

      const visited = new Uint8Array(circles.length);
      const polygons: [number, number][][][] = [];

      for (let i = 0; i < circles.length; i++) {
        if (visited[i]) continue;
        visited[i] = 1;
        const comp: CircleSpec[] = [circles[i]!];
        const queue: number[] = [i];

        while (queue.length > 0) {
          const currIdx = queue.pop()!;
          const c1 = circles[currIdx]!;
          for (let j = 0; j < circles.length; j++) {
            if (visited[j]) continue;
            const c2 = circles[j]!;
            const sumDLon = c1.dLon + c2.dLon;
            const sumDLat = c1.dLat + c2.dLat;
            const normDist = Math.hypot((c1.lon - c2.lon) / sumDLon, (c1.lat - c2.lat) / sumDLat);
            if (normDist <= 0.98) {
              visited[j] = 1;
              comp.push(c2);
              queue.push(j);
            }
          }
        }

        const mergedPolygons = traceMergedComponentPolygons(comp);
        for (const poly of mergedPolygons) {
          polygons.push(poly);
        }
      }

      const isMajorWalkRing = (MAJOR_WALK_RINGS_METERS as readonly number[]).includes(radiusMeters);
      const walkMinutes = Math.round((radiusMeters / walkSpeedMpm) * 10) / 10;
      // Calibrated concentric step opacity: cumulative stack yields ~0.51 at 100m core fading to 0.065 at 800m outer edge
      const normalizedInner = Math.max(
        0,
        Math.min(1, 1 - (radiusMeters - 100) / Math.max(100, maxWalkMeters - 100))
      );
      const stepOpacity = Number((0.065 + normalizedInner * 0.045).toFixed(3));
      const ringStrokeOpacity =
        radiusMeters === 800
          ? 0.72
          : radiusMeters === 600
            ? 0.42
            : radiusMeters === 400
              ? 0.50
              : radiusMeters === 200
                ? 0.58
                : 0;
      const ringStrokeWidth = radiusMeters === 800 ? 1.4 : isMajorWalkRing ? 0.95 : 0;

      features.push({
        type: 'Feature',
        geometry: {
          type: 'MultiPolygon',
          coordinates: polygons,
        },
        properties: {
          band,
          radiusMeters,
          walkMinutes,
          walkLabel: `${radiusMeters}m (${walkMinutes} min walk)`,
          isMajorWalkRing,
          color: colors.fill,
          strokeColor: colors.stroke,
          stepOpacity,
          ringStrokeOpacity,
          ringStrokeWidth,
        },
      });
    }
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}

export function ensureIsochroneBadgeSprite(map: MapLibreMap, badgeText: string): string {
  const iconId = `isochrone-badge-${badgeText}`;
  if (!map.hasImage(iconId)) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const font = 'bold 10px "Helvetica Neue", Helvetica, Arial, sans-serif';
      ctx.font = font;
      const metrics = ctx.measureText(badgeText);
      const textWidth = Math.ceil(metrics.width);
      const paddingX = 5;
      const virtualWidth = Math.max(textWidth + paddingX * 2, 22);
      const virtualHeight = 16;

      canvas.width = Math.ceil(virtualWidth * 2);
      canvas.height = Math.ceil(virtualHeight * 2);

      const ctx2 = canvas.getContext('2d');
      if (ctx2) {
        ctx2.clearRect(0, 0, canvas.width, canvas.height);
        ctx2.scale(2, 2);

        // Pill background
        const r = virtualHeight / 2;
        ctx2.beginPath();
        ctx2.moveTo(r, 0.5);
        ctx2.lineTo(virtualWidth - r, 0.5);
        ctx2.arc(virtualWidth - r, r, r - 0.5, -Math.PI / 2, Math.PI / 2);
        ctx2.lineTo(r, virtualHeight - 0.5);
        ctx2.arc(r, r, r - 0.5, Math.PI / 2, -Math.PI / 2);
        ctx2.closePath();
        ctx2.fillStyle = '#FFFFFF';
        ctx2.fill();
        ctx2.lineWidth = 1;
        ctx2.strokeStyle = '#94A3B8';
        ctx2.stroke();

        ctx2.font = font;
        ctx2.textAlign = 'center';
        ctx2.textBaseline = 'middle';
        ctx2.fillStyle = '#0F172A';
        ctx2.fillText(badgeText, virtualWidth / 2, virtualHeight / 2 + 0.5);

        const imgData = ctx2.getImageData(0, 0, canvas.width, canvas.height);
        map.addImage(iconId, imgData, { pixelRatio: 2 });
      }
    }
  }
  return iconId;
}

export function renderIsochroneMap(
  map: MapLibreMap,
  rows: readonly Record<string, unknown>[],
  options?: {
    cutoffMinutes?: readonly number[];
    defaultOriginStationId?: string;
    onSelectStation?: (stationId: string) => void;
    customColors?: Readonly<Record<string, string>>;
    colorPalette?: string;
  } | readonly number[],
  onSelectStationCallback?: (stationId: string) => void
): void {
  hydrateStationCache(rows);

  const isArr = Array.isArray(options);
  const optObj = !isArr && typeof options === 'object' && options !== null
    ? (options as {
        cutoffMinutes?: readonly number[];
        defaultOriginStationId?: string;
        onSelectStation?: (stationId: string) => void;
        customColors?: Readonly<Record<string, string>>;
        colorPalette?: string;
      })
    : undefined;
  const bands = isArr ? options : (optObj?.cutoffMinutes ?? [10, 20, 30, 45]);
  const onSelectStation = optObj?.onSelectStation ?? onSelectStationCallback;

  // 1. Ensure authentic MTA base subway network, water/park tints, and borough watermarks
  // Hide default background station circles so our reachable station pure-black multi-route pills stand out cleanly
  ensureMtaSubwayOverlay(map, {
    baseTrunkOpacity: 0.72,
    showStationStops: false,
    showTransferCapsules: false,
  });

  const points: IsochroneStationPoint[] = [];

  for (const r of rows) {
    const stationId = String(r['station_id'] ?? r['gtfs_stop_id'] ?? r['parent_station_id'] ?? '').trim();
    if (!stationId) continue;

    const stInfo = resolveStationInfo(stationId);
    const lat = Number(r['latitude'] ?? r['st_lat'] ?? stInfo?.lat ?? 0);
    const lon = Number(r['longitude'] ?? r['st_lon'] ?? stInfo?.lon ?? 0);
    const rawName = String(r['station_name'] ?? r['name'] ?? stInfo?.name ?? stationId);
    const cleanName = cleanStationLabelText(rawName) || rawName;
    const parentheticalRoutes = extractRoutesFromStationText(rawName);
    const rowRoutes = normalizeStationRoutes(
      String(r['daytime_routes'] ?? r['routes'] ?? r['route_id'] ?? '')
    );
    const mergedRoutes =
      rowRoutes.length > 0
        ? normalizeStationRoutes([...rowRoutes, ...parentheticalRoutes])
        : normalizeStationRoutes([...parentheticalRoutes, ...(stInfo?.routes ?? [])]);

    const timeSec = Number(r['travel_time_sec'] ?? r['leg_travel_time_sec'] ?? 0);
    const timeMin = timeSec > 0 ? timeSec / 60 : Number(r['travel_time_min'] ?? r['cumulative_time_min'] ?? 0);

    if (lat !== 0 && lon !== 0) {
      points.push({
        stationId,
        name: cleanName,
        lat,
        lon,
        transitTimeMin: timeMin,
        routes: mergedRoutes,
      });
    }
  }

  // Identify Origin Station: station with min travel time, or default '237' (Grand Army Plaza)
  let originPoint = points.find(p => p.transitTimeMin === 0);
  if (!originPoint && points.length > 0) {
    originPoint = points.reduce((min, p) => (p.transitTimeMin < min.transitTimeMin ? p : min), points[0]!);
  }

  // If no points or origin is missing, default to Grand Army Plaza (user requirement)
  const defaultOriginId = optObj?.defaultOriginStationId ?? '237';
  if (!originPoint) {
    const gap = resolveStationInfo(defaultOriginId);
    if (gap) {
      originPoint = {
        stationId: gap.stationId,
        name: cleanStationLabelText(gap.name),
        lat: gap.lat,
        lon: gap.lon,
        transitTimeMin: 0,
        routes: gap.routes,
      };
    }
  }

  // Center map on origin only when initial load or origin station changes (preserve pan/zoom on color/theme edits)
  const mapAny = map as any;
  const originKey = originPoint ? `${originPoint.lon.toFixed(5)},${originPoint.lat.toFixed(5)}` : 'default';
  if (mapAny._lastIsochroneOriginKey !== originKey) {
    mapAny._lastIsochroneOriginKey = originKey;
    if (originPoint) {
      map.easeTo({
        center: [originPoint.lon, originPoint.lat],
        zoom: 12.5,
        duration: 600,
      });
    } else {
      // Grand Army Plaza fallback center
      map.easeTo({
        center: [-73.97042, 40.67514],
        zoom: 12.5,
        duration: 600,
      });
    }
  }

  // 2. Concentric Station Walk-Radius Gradient & Ring Contours Layer
  const geojson = buildStationWalkGradientGeoJson(
    points,
    bands,
    80,
    800,
    WALK_RADIUS_STEPS_METERS,
    optObj
      ? {
          ...(optObj.customColors ? { customColors: optObj.customColors } : {}),
          ...(optObj.colorPalette ? { colorPalette: optObj.colorPalette } : {}),
        }
      : undefined
  );
  const sourceId = 'isochrone-source';
  const fillLayerId = 'isochrone-fill';
  const lineLayerId = 'isochrone-line';

  if (map.getSource(sourceId)) {
    (map.getSource(sourceId) as any).setData(geojson);
  } else {
    map.addSource(sourceId, {
      type: 'geojson',
      data: geojson,
    });

    map.addLayer({
      id: fillLayerId,
      type: 'fill',
      source: sourceId,
      paint: {
        'fill-color': ['get', 'color'],
        'fill-opacity': ['coalesce', ['get', 'stepOpacity'], 0.08],
      },
    });

    map.addLayer({
      id: lineLayerId,
      type: 'line',
      source: sourceId,
      filter: ['==', ['get', 'isMajorWalkRing'], true],
      paint: {
        'line-color': ['get', 'strokeColor'],
        'line-width': ['coalesce', ['get', 'ringStrokeWidth'], 1.1],
        'line-dasharray': [2, 2],
        'line-opacity': ['coalesce', ['get', 'ringStrokeOpacity'], 0.58],
      },
    });
  }

  // 3. Reachable Station Markers Layer (Pure Black Multi-Route Pills + Station Name + Time Badge)
  const stationsSourceId = 'isochrone-stations-source';
  const stationsLayerId = 'isochrone-stations-layer';
  const stationsNameLabelId = 'isochrone-stations-name-label';
  const stationsLabelId = 'isochrone-stations-time-label';

  // Pre-generate badge, multi-route stop pill, and station name sprites
  for (const p of points) {
    const badgeText = `${Math.round(p.transitTimeMin)}m`;
    const stRoutes = normalizeStationRoutes(p.routes ?? []);
    try {
      ensureIsochroneBadgeSprite(map, badgeText);
      ensureStopPillSprite(map, stRoutes);
      ensureStationLabelSprite(map, p.stationId, p.name ?? p.stationId);
    } catch {
      // Headless fallback
    }
  }

  const stationsGeoJson: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: points.map(p => {
      const badgeText = `${Math.round(p.transitTimeMin)}m`;
      const stRoutes = normalizeStationRoutes(p.routes ?? []);
      const cleanName = cleanStationLabelText(p.name ?? p.stationId) || p.stationId;
      const bandColor =
        p.transitTimeMin <= 10
          ? '#0039A6'
          : p.transitTimeMin <= 20
            ? '#00ADD0'
            : p.transitTimeMin <= 30
              ? '#00933C'
              : '#FF6319';
      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [p.lon, p.lat],
        },
        properties: {
          stationId: p.stationId,
          name: cleanName,
          transitTimeMin: Math.round(p.transitTimeMin * 10) / 10,
          timeBadge: badgeText,
          badgeIconId: `isochrone-badge-${badgeText}`,
          iconId: getStopPillIconId(stRoutes),
          labelIconId: `station-label-${p.stationId}`,
          labelOffset: getStationLabelOffset(stRoutes.length),
          badgeOffset: [Math.round(5 + Math.max(1, stRoutes.length) * 4), -4],
          bandColor,
          routes: stRoutes.join(','),
          routeCount: stRoutes.length,
        },
      };
    }),
  };

  if (map.getSource(stationsSourceId)) {
    (map.getSource(stationsSourceId) as any).setData(stationsGeoJson);
  } else {
    map.addSource(stationsSourceId, {
      type: 'geojson',
      data: stationsGeoJson,
    });

    map.addLayer({
      id: stationsLayerId,
      type: 'symbol',
      source: stationsSourceId,
      layout: {
        'icon-image': ['get', 'iconId'],
        'icon-size': [
          'interpolate', ['linear'], ['zoom'],
          10, 0.56,
          12, 0.72,
          14, 0.88,
        ],
        'icon-padding': 2,
        'icon-allow-overlap': true,
        'icon-ignore-placement': false,
      },
    });

    map.addLayer({
      id: stationsNameLabelId,
      type: 'symbol',
      source: stationsSourceId,
      minzoom: 12.0,
      layout: {
        'icon-image': ['get', 'labelIconId'],
        'icon-anchor': 'left',
        'icon-offset': ['coalesce', ['get', 'labelOffset'], ['literal', [9, 0]]],
        'icon-padding': 4,
        'icon-allow-overlap': false,
        'icon-ignore-placement': false,
      },
    });

    map.addLayer({
      id: stationsLabelId,
      type: 'symbol',
      source: stationsSourceId,
      minzoom: 10.5,
      layout: {
        'icon-image': ['get', 'badgeIconId'],
        'icon-anchor': 'bottom-left',
        'icon-offset': ['coalesce', ['get', 'badgeOffset'], ['literal', [8, -4]]],
        'icon-allow-overlap': false,
        'icon-ignore-placement': false,
      },
    });
  }

  // 4. Origin Pulse Marker Layer
  if (originPoint) {
    const originSourceId = 'isochrone-origin-source';
    const originGeoJson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [originPoint.lon, originPoint.lat],
          },
          properties: {
            stationId: originPoint.stationId,
            name: cleanStationLabelText(originPoint.name ?? 'Origin Hub'),
          },
        },
      ],
    };

    if (map.getSource(originSourceId)) {
      (map.getSource(originSourceId) as any).setData(originGeoJson);
    } else {
      map.addSource(originSourceId, {
        type: 'geojson',
        data: originGeoJson,
      });

      // Outer pulsing ring
      map.addLayer({
        id: 'isochrone-origin-pulse-ring',
        type: 'circle',
        source: originSourceId,
        paint: {
          'circle-radius': 15,
          'circle-color': '#0039A6',
          'circle-opacity': 0.2,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#0039A6',
        },
      });
    }
  }

  // 5. Interactive Hover Tooltips & Station Selection (bound once per map instance)
  mapAny._onSelectStationHandler = onSelectStation;

  if (!mapAny._isochroneEventsBound) {
    mapAny._isochroneEventsBound = true;
    let popup: maplibregl.Popup | null = null;

    map.on('mouseenter', stationsLayerId, (e: any) => {
      map.getCanvas().style.cursor = 'pointer';
      const feat = e.features?.[0];
      if (!feat) return;

      const p = feat.properties as { stationId: string; name: string; transitTimeMin: number; routes: string };
      const cleanPopupName = cleanStationLabelText(p.name);
      const routeBullets = (p.routes || '')
        .split(',')
        .filter(Boolean)
        .map(r => buildRouteBulletHtml(r, 'MTA_NYCT_SUBWAY', null, 18))
        .join(' ');
      const routeBulletsRow = routeBullets
        ? `<div style="margin-bottom:6px;display:flex;align-items:center;gap:4px;">${routeBullets}</div>`
        : '';

      const minutes = Math.floor(p.transitTimeMin);
      const seconds = Math.round((p.transitTimeMin - minutes) * 60);

      const contentHtml = `
        <div style="font-family:'Inter',-apple-system,sans-serif;line-height:1.45;">
          <div style="font-weight:800;font-size:13px;color:#0F172A;margin-bottom:4px;">
            ${cleanPopupName}
          </div>
          ${routeBulletsRow}
          <div>
            <strong>Transit Travel Time:</strong>
            <span style="font-size:13px;font-weight:700;color:#0F172A;font-variant-numeric:tabular-nums;">
              ${minutes}m ${seconds}s
            </span>
          </div>
          <div style="font-size:11px;color:#334155;margin-top:3px;">
            <strong>Walk Radius Gradient:</strong> 200m (2.5 min) &middot; 400m (5 min) &middot; 600m (7.5 min) &middot; 800m (10 min)
          </div>
          <div style="font-size:11px;color:#64748B;margin-top:4px;">
            Click station to re-anchor origin travel shed
          </div>
        </div>
      `;

      if (!popup) {
        popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });
      }
      popup.setLngLat(e.lngLat).setHTML(contentHtml).addTo(map);
    });

    map.on('mouseleave', stationsLayerId, () => {
      map.getCanvas().style.cursor = '';
      if (popup) {
        popup.remove();
        popup = null;
      }
    });

    map.on('click', stationsLayerId, (e: any) => {
      const feat = e.features?.[0];
      const sid = feat?.properties?.stationId;
      if (sid && mapAny._onSelectStationHandler) {
        mapAny._onSelectStationHandler(sid);
      }
    });
  }

  // 6. Origin Hub Banner HUD (Clean name + stopping route bullets inside a pure black capsule + dynamic station/route summary)
  const container = map.getContainer();
  let originBanner = container.querySelector('.dbtc-map-hud-origin-banner') as HTMLElement | null;
  if (!originBanner) {
    originBanner = document.createElement('div');
    originBanner.className = 'dbtc-map-hud dbtc-map-hud-origin-banner';
    container.appendChild(originBanner);
  }

  const originName = cleanStationLabelText(originPoint?.name ?? 'Grand Army Plaza');
  const originRoutes = normalizeStationRoutes(
    originPoint?.routes && originPoint.routes.length > 0
      ? originPoint.routes
      : originPoint?.stationId === '237'
        ? ['2', '3']
        : []
  );
  const originBulletsHtml = originRoutes
    .map(r => buildRouteBulletHtml(r, 'MTA_NYCT_SUBWAY', null, 16))
    .join('');
  const originCapsuleHtml = originBulletsHtml
    ? `<span style="display:inline-flex;align-items:center;gap:2px;background:#000000;padding:2px 5px;border-radius:999px;border:1.5px solid #FFFFFF;box-shadow:0 1px 2px rgba(0,0,0,0.2);">${originBulletsHtml}</span>`
    : '';
  const allQueryRoutes = normalizeStationRoutes(points.flatMap(p => p.routes ?? []));
  const queryRoutesPrefix =
    allQueryRoutes.length > 0
      ? allQueryRoutes.length <= 7
        ? `Lines ${allQueryRoutes.join(', ')} &middot; `
        : `${allQueryRoutes.length} Lines &middot; `
      : '';
  const stationCountLabel =
    points.length > 0
      ? `${queryRoutesPrefix}${points.length} ${points.length === 1 ? 'Station' : 'Stations'} + Walk Gradient`
      : '800m Walk Shed';

  originBanner.innerHTML = `
    <span style="color:#0039A6;font-weight:800;">Origin:</span>
    <span style="color:#0F172A;font-weight:700;">${originName}</span>
    ${originCapsuleHtml}
    <span style="color:#64748B;font-size:11px;font-weight:600;">&middot; ${stationCountLabel}</span>
    <button class="dbtc-btn btn-xs btn-secondary center-shed-btn" style="margin-left:4px;padding:2px 8px;font-size:11px;cursor:pointer;">Center shed</button>
  `;

  const centerBtn = originBanner.querySelector('.center-shed-btn') as HTMLButtonElement | null;
  if (centerBtn && originPoint) {
    centerBtn.onclick = (e) => {
      e.stopPropagation();
      map.easeTo({
        center: [originPoint.lon, originPoint.lat],
        zoom: Math.max(map.getZoom(), 12.5),
        duration: 800,
      });
    };
  }

  // 7. Travel Shed & Walk Radius Gradient Legend HUD
  let legendHud = container.querySelector('.dbtc-map-hud-legend') as HTMLElement | null;
  if (!legendHud) {
    legendHud = document.createElement('div');
    legendHud.className = 'dbtc-map-hud dbtc-map-hud-legend';
    container.appendChild(legendHud);
  }

  const tierDefaults = ['#0039A6', '#00ADD0', '#6CBE45', '#FF6319'];
  const tierBorderDefaults = ['#002B7F', '#0088A8', '#4E9A2A', '#D94E0F'];
  const bandRowsHtml = bands
    .map((cutoff, idx) => {
      const customKey = `band_${cutoff}`;
      const col =
        optObj?.customColors?.[customKey] ??
        optObj?.customColors?.[String(cutoff)] ??
        tierDefaults[idx % tierDefaults.length]!;
      const border = tierBorderDefaults[idx % tierBorderDefaults.length]!;
      const label = idx === 0 ? `&le; ${cutoff} min transit arrival` : `${bands[idx - 1]}&ndash;${cutoff} min transit arrival`;
      return `<div style="display:flex;align-items:center;gap:6px;">
        <span style="width:14px;height:14px;background:${col};opacity:0.75;border:1px dashed ${border};border-radius:50%;display:inline-block;"></span>
        <span>${label}</span>
      </div>`;
    })
    .join('');

  legendHud.innerHTML = `
    <div style="font-weight:700;font-size:11px;margin-bottom:2px;letter-spacing:0.3px;color:#0F172A;text-transform:uppercase;">
      Transit Reachability &amp; Walk Sheds
    </div>
    <div style="font-size:10px;color:#64748B;margin-bottom:5px;">
      Transit arrival tier + concentric walk radius gradient
    </div>
    <div style="display:flex;flex-direction:column;gap:3px;font-size:11px;margin-bottom:7px;">
      ${bandRowsHtml}
    </div>
    <div style="border-top:1px solid #E2E8F0;padding-top:5px;">
      <div style="font-weight:700;font-size:10px;color:#334155;margin-bottom:3px;text-transform:uppercase;letter-spacing:0.25px;">
        Station Walk Radius Gradient (80m/min)
      </div>
      <div style="height:6px;border-radius:999px;background:linear-gradient(90deg, rgba(0,57,166,0.70) 0%, rgba(0,57,166,0.46) 33%, rgba(0,57,166,0.25) 66%, rgba(0,57,166,0.08) 100%);border:1px solid rgba(0,43,127,0.3);margin-bottom:3px;"></div>
      <div style="display:flex;justify-content:space-between;font-size:9.5px;color:#475569;font-variant-numeric:tabular-nums;">
        <span><strong>200m</strong> (2.5 min)</span>
        <span><strong>400m</strong> (5 min)</span>
        <span><strong>600m</strong> (7.5 min)</span>
        <span><strong>800m</strong> (10 min)</span>
      </div>
    </div>
  `;
}

