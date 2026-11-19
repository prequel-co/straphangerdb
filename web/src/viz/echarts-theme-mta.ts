import * as echarts from 'echarts';
import {
  CANONICAL_ROUTES,
  AMBIGUOUS_CROSS_AGENCY_ROUTE_IDS,
  type CanonicalRouteInfo,
} from '../types/straphanger-schema.gen.js';

export const NEUTRAL_SLATE_GREY = '#6E737B';

// Dynamically populated from StraphangerDB canonical schema + live view_dim_routes hydration
export const SUBWAY_TRUNK_COLORS: Record<string, string> = {};

export type CommuterOrBusAgencyId =
  | 'MTA_METRO_NORTH'
  | 'MTA_LIRR'
  | 'PORT_AUTHORITY_PATH'
  | 'MTA_BUS'
  | 'NJ_TRANSIT';

export interface CommuterOrBusRouteSpec {
  readonly code: string;
  readonly canonicalRouteId: string;
  readonly label: string;
  readonly colorHex: string;
  readonly agencyId: CommuterOrBusAgencyId;
}

export interface MtaRouteBulletSwatch {
  readonly id: string;
  readonly bulletRoute: string;
  readonly agencyId?: string;
  readonly routesLabel: string;
  readonly trunkName: string;
  readonly colorHex: string;
}

export const METRO_NORTH_ROUTE_BULLET_SWATCHES: MtaRouteBulletSwatch[] = [];
export const LIRR_ROUTE_BULLET_SWATCHES: MtaRouteBulletSwatch[] = [];
export const PATH_ROUTE_BULLET_SWATCHES: MtaRouteBulletSwatch[] = [];
export const MTA_ROUTE_BULLET_SWATCHES: MtaRouteBulletSwatch[] = [];
export const TAURANAC_ROUTE_BULLET_SWATCHES: MtaRouteBulletSwatch[] = [];
export const IND_1953_ROUTE_BULLET_SWATCHES: MtaRouteBulletSwatch[] = [];
export const MTA_INDIVIDUAL_ROUTE_BULLETS: string[] = [];

const commuterSpecsByAgency: Record<CommuterOrBusAgencyId, Record<string, CommuterOrBusRouteSpec>> = {
  MTA_METRO_NORTH: {},
  MTA_LIRR: {},
  PORT_AUTHORITY_PATH: {},
  MTA_BUS: {},
  NJ_TRANSIT: {},
};
const unambiguousCommuterSpecs: Record<string, CommuterOrBusRouteSpec> = {};
const diamondSubwayRoutes = new Set<string>();
const routeTextColorByKey = new Map<string, string>();
const tauranacRouteColorOverrides: Record<string, string> = {};
const ind1953RouteColorOverrides: Record<string, string> = {};

interface NormalizedRouteCatalogEntry {
  readonly routeId: string;
  readonly agencyId: string;
  readonly routeName: string;
  readonly colorHex: string;
  readonly type: string;
  readonly bulletCode: string;
  readonly textColorHex: string;
  readonly division: string;
  readonly trunkGroup: string;
  readonly isDiamond: boolean;
  readonly aliases: readonly string[];
  readonly tauranacColorHex?: string;
  readonly ind1953ColorHex?: string;
  readonly routeShortLabel?: string;
}

function normalizeHex(raw: unknown, fallback: string): string {
  const s = String(raw ?? '').trim().toUpperCase();
  if (/^#[0-9A-F]{6}$/.test(s)) return s;
  if (/^[0-9A-F]{6}$/.test(s)) return `#${s}`;
  return fallback;
}

function defaultTextColorForHex(hex: string): string {
  const upper = hex.toUpperCase();
  return upper === '#FCCC0A' ||
    upper === '#FFD200' ||
    upper === '#F5D000' ||
    upper === '#F9A51A' ||
    upper === '#CE8E00' ||
    upper === '#00B2A9' ||
    upper === '#00A1DE' ||
    upper === '#65C100'
    ? '#000000'
    : '#FFFFFF';
}

function isCommuterOrBusAgency(agencyId: string): agencyId is CommuterOrBusAgencyId {
  return (
    agencyId === 'MTA_METRO_NORTH' ||
    agencyId === 'MTA_LIRR' ||
    agencyId === 'PORT_AUTHORITY_PATH' ||
    agencyId === 'MTA_BUS' ||
    agencyId === 'NJ_TRANSIT'
  );
}

function slugifyId(prefix: string, raw: string): string {
  return `${prefix}-${raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

function clearRecord(rec: Record<string, unknown>): void {
  for (const k of Object.keys(rec)) {
    delete rec[k];
  }
}

function replaceArrayInPlace<T>(target: T[], next: readonly T[]): void {
  target.splice(0, target.length, ...next);
}

function canonicalEntryToNormalized(c: CanonicalRouteInfo): NormalizedRouteCatalogEntry {
  const colorHex = normalizeHex(c.colorHex, NEUTRAL_SLATE_GREY);
  return {
    routeId: c.routeId.trim().toUpperCase(),
    agencyId: c.agencyId.trim().toUpperCase(),
    routeName: c.routeName,
    colorHex,
    type: c.type,
    bulletCode: (c.bulletCode || c.routeId).trim().toUpperCase(),
    textColorHex: c.textColorHex ? normalizeHex(c.textColorHex, defaultTextColorForHex(colorHex)) : defaultTextColorForHex(colorHex),
    division: c.division ?? '',
    trunkGroup: c.trunkGroup ?? c.routeName,
    isDiamond: Boolean(c.isDiamond),
    aliases: (c.aliases ?? []).map(a => String(a).trim().toUpperCase()).filter(Boolean),
    ...(c.tauranacColorHex ? { tauranacColorHex: normalizeHex(c.tauranacColorHex, colorHex) } : {}),
    ...(c.ind1953ColorHex ? { ind1953ColorHex: normalizeHex(c.ind1953ColorHex, colorHex) } : {}),
    ...(c.routeShortLabel ? { routeShortLabel: c.routeShortLabel } : {}),
  };
}

function rebuildRouteCatalog(entries: readonly NormalizedRouteCatalogEntry[]): void {
  clearRecord(SUBWAY_TRUNK_COLORS);
  clearRecord(commuterSpecsByAgency.MTA_METRO_NORTH);
  clearRecord(commuterSpecsByAgency.MTA_LIRR);
  clearRecord(commuterSpecsByAgency.PORT_AUTHORITY_PATH);
  clearRecord(commuterSpecsByAgency.MTA_BUS);
  clearRecord(commuterSpecsByAgency.NJ_TRANSIT);
  clearRecord(unambiguousCommuterSpecs);
  clearRecord(tauranacRouteColorOverrides);
  clearRecord(ind1953RouteColorOverrides);
  diamondSubwayRoutes.clear();
  routeTextColorByKey.clear();

  const subwaySingleRouteIds = new Set<string>();
  for (const e of entries) {
    if (e.agencyId === 'MTA_NYCT_SUBWAY' || e.agencyId === 'MTA_NYCT_SIR') {
      subwaySingleRouteIds.add(e.routeId);
      for (const alias of e.aliases) subwaySingleRouteIds.add(alias);
    }
  }

  for (const e of entries) {
    routeTextColorByKey.set(`${e.agencyId}:${e.routeId}`, e.textColorHex);
    if (e.agencyId === 'MTA_NYCT_SUBWAY' || e.agencyId === 'MTA_NYCT_SIR') {
      SUBWAY_TRUNK_COLORS[e.routeId] = e.colorHex;
      if (e.tauranacColorHex) tauranacRouteColorOverrides[e.routeId] = e.tauranacColorHex;
      if (e.ind1953ColorHex) ind1953RouteColorOverrides[e.routeId] = e.ind1953ColorHex;
      if (e.isDiamond) diamondSubwayRoutes.add(e.routeId);

      for (const alias of e.aliases) {
        if (!SUBWAY_TRUNK_COLORS[alias]) SUBWAY_TRUNK_COLORS[alias] = e.colorHex;
        if (e.tauranacColorHex && !tauranacRouteColorOverrides[alias]) {
          tauranacRouteColorOverrides[alias] = e.tauranacColorHex;
        }
        if (e.ind1953ColorHex && !ind1953RouteColorOverrides[alias]) {
          ind1953RouteColorOverrides[alias] = e.ind1953ColorHex;
        }
        if (e.isDiamond) diamondSubwayRoutes.add(alias);
        routeTextColorByKey.set(`${e.agencyId}:${alias}`, e.textColorHex);
      }
      continue;
    }

    if (isCommuterOrBusAgency(e.agencyId)) {
      const spec: CommuterOrBusRouteSpec = {
        code: e.bulletCode || e.routeId,
        canonicalRouteId: e.routeId,
        label: e.routeName,
        colorHex: e.colorHex,
        agencyId: e.agencyId,
      };
      const agencyBucket = commuterSpecsByAgency[e.agencyId];
      const candidateKeys = new Set<string>([
        e.routeId,
        spec.code,
        e.routeName.trim().toUpperCase(),
        ...(e.routeShortLabel ? [e.routeShortLabel.trim().toUpperCase()] : []),
        ...e.aliases,
      ]);
      for (const key of candidateKeys) {
        if (!key) continue;
        if (!agencyBucket[key]) {
          agencyBucket[key] = spec;
        }
        const isAmbiguousNumeric = (AMBIGUOUS_CROSS_AGENCY_ROUTE_IDS as readonly string[]).includes(key) || /^\d+$/.test(key);
        const collidesWithSubway = subwaySingleRouteIds.has(key);
        if (!isAmbiguousNumeric && !collidesWithSubway && !unambiguousCommuterSpecs[key]) {
          unambiguousCommuterSpecs[key] = spec;
        }
      }
    }
  }

  // Build commuter / PATH bullet swatch lists
  const mnrSwatches: MtaRouteBulletSwatch[] = [];
  const seenMnrCodes = new Set<string>();
  for (const e of entries) {
    if (e.agencyId !== 'MTA_METRO_NORTH') continue;
    // Trunk swatches: Hudson (1), Harlem (2), New Haven (3), Pascack Valley (14), Port Jervis (15)
    if (e.routeId === '4' || e.routeId === '5' || e.routeId === '6') continue;
    if (seenMnrCodes.has(e.bulletCode)) continue;
    seenMnrCodes.add(e.bulletCode);
    mnrSwatches.push({
      id: slugifyId('mnr', e.routeShortLabel ?? e.bulletCode),
      bulletRoute: e.bulletCode,
      agencyId: 'MTA_METRO_NORTH',
      routesLabel: e.routeShortLabel ?? e.routeName.replace(/\s+(?:Line|Branch)$/i, ''),
      trunkName: e.trunkGroup || `Metro-North ${e.routeName}`,
      colorHex: e.colorHex,
    });
  }

  const lirrSwatches: MtaRouteBulletSwatch[] = [];
  const seenLirrCodes = new Set<string>();
  for (const e of entries) {
    if (e.agencyId !== 'MTA_LIRR') continue;
    if (seenLirrCodes.has(e.bulletCode)) continue;
    seenLirrCodes.add(e.bulletCode);
    lirrSwatches.push({
      id: slugifyId('lirr', e.routeShortLabel ?? e.bulletCode),
      bulletRoute: e.bulletCode,
      agencyId: 'MTA_LIRR',
      routesLabel: e.routeShortLabel ?? e.routeName.replace(/\s+Branch$/i, ''),
      trunkName: e.trunkGroup || `LIRR ${e.routeName}`,
      colorHex: e.colorHex,
    });
  }

  const pathSwatches: MtaRouteBulletSwatch[] = [];
  const seenPathIds = new Set<string>();
  for (const e of entries) {
    if (e.agencyId !== 'PORT_AUTHORITY_PATH') continue;
    if (seenPathIds.has(e.routeId)) continue;
    seenPathIds.add(e.routeId);
    pathSwatches.push({
      id: slugifyId('path', e.routeId),
      bulletRoute: e.routeId,
      agencyId: 'PORT_AUTHORITY_PATH',
      routesLabel: e.routeShortLabel ?? e.routeId,
      trunkName: e.trunkGroup || `PATH ${e.routeName}`,
      colorHex: e.colorHex,
    });
  }

  // Group NYC Subway trunk swatches from canonical/hydrated trunkGroup + colorHex
  const subwayTrunkGroups = new Map<string, { trunkName: string; colorHex: string; routes: string[]; bulletRoute: string }>();
  for (const e of entries) {
    if (e.agencyId !== 'MTA_NYCT_SUBWAY') continue;
    if (e.division === 'SIR' || e.routeId === 'GS' || e.routeId === 'FS' || e.routeId === 'H' || e.routeId === '6X' || e.routeId === 'FX') {
      continue;
    }
    const disp = e.routeId === '7X' ? '<7>' : e.routeId;
    const groupKey = `${e.trunkGroup}|${e.colorHex}`;
    const existing = subwayTrunkGroups.get(groupKey);
    if (existing) {
      if (!existing.routes.includes(disp)) existing.routes.push(disp);
      if (e.routeId === 'F' || e.routeId === 'Q') existing.bulletRoute = e.routeId;
    } else {
      subwayTrunkGroups.set(groupKey, {
        trunkName: e.trunkGroup || e.routeName,
        colorHex: e.colorHex,
        routes: [disp],
        bulletRoute: e.routeId === '7X' ? '7' : e.routeId,
      });
    }
  }
  const subwaySwatches: MtaRouteBulletSwatch[] = Array.from(subwayTrunkGroups.values()).map(g => ({
    id: slugifyId('subway', g.trunkName),
    bulletRoute: g.bulletRoute,
    routesLabel: g.bulletRoute === 'S' ? 'S · Other' : g.routes.join(' · '),
    trunkName: g.trunkName,
    colorHex: g.colorHex,
  }));

  // Group Tauranac swatches from tauranacColorHex
  const tauranacGroups = new Map<string, { trunkName: string; colorHex: string; routes: string[]; bulletRoute: string }>();
  for (const e of entries) {
    if (e.agencyId !== 'MTA_NYCT_SUBWAY' || !e.tauranacColorHex) continue;
    if (e.division === 'SIR' || e.routeId === 'GS' || e.routeId === 'FS' || e.routeId === 'H' || e.routeId === '6X' || e.routeId === '7X' || e.routeId === 'FX' || e.routeId === 'Z' || e.routeId === 'W') {
      continue;
    }
    const existing = tauranacGroups.get(e.tauranacColorHex);
    if (existing) {
      if (!existing.routes.includes(e.routeId)) existing.routes.push(e.routeId);
      if (e.routeId === 'F' || e.routeId === 'Q') existing.bulletRoute = e.routeId;
    } else {
      tauranacGroups.set(e.tauranacColorHex, {
        trunkName: `Tauranac ${e.trunkGroup || e.routeName}`,
        colorHex: e.tauranacColorHex,
        routes: [e.routeId],
        bulletRoute: e.routeId,
      });
    }
  }
  const tauranacSwatches: MtaRouteBulletSwatch[] = [
    ...Array.from(tauranacGroups.values()).map(g => ({
      id: slugifyId('tau', g.bulletRoute),
      bulletRoute: g.bulletRoute,
      routesLabel: g.routes.join(' · '),
      trunkName: g.trunkName,
      colorHex: g.colorHex,
    })),
    ...mnrSwatches,
  ];

  // Group 1953 IND swatches from ind1953ColorHex
  const indGroups = new Map<string, { trunkName: string; colorHex: string; routes: string[]; bulletRoute: string }>();
  for (const e of entries) {
    if (e.agencyId !== 'MTA_NYCT_SUBWAY' || !e.ind1953ColorHex) continue;
    if (e.division === 'SIR' || e.routeId === 'GS' || e.routeId === 'FS' || e.routeId === 'H' || e.routeId === '6X' || e.routeId === '7X' || e.routeId === 'FX' || e.routeId === 'T' || e.routeId === 'Z' || e.routeId === 'W') {
      continue;
    }
    const existing = indGroups.get(e.ind1953ColorHex);
    if (existing) {
      if (!existing.routes.includes(e.routeId)) existing.routes.push(e.routeId);
      if (e.routeId === 'A' || e.routeId === 'D' || e.routeId === 'F' || e.routeId === '1' || e.routeId === 'N') {
        existing.bulletRoute = e.routeId;
      }
    } else {
      indGroups.set(e.ind1953ColorHex, {
        trunkName: `1953 ${e.division || 'Rapid Transit'} (${e.routeName})`,
        colorHex: e.ind1953ColorHex,
        routes: [e.routeId],
        bulletRoute: e.routeId,
      });
    }
  }
  const indSwatches: MtaRouteBulletSwatch[] = Array.from(indGroups.values()).map(g => ({
    id: slugifyId('ind', g.bulletRoute),
    bulletRoute: g.bulletRoute,
    routesLabel: g.routes.slice(0, 4).join(' · '),
    trunkName: g.trunkName,
    colorHex: g.colorHex,
  }));

  const individualBullets: string[] = [];
  const pushUniqueBullet = (b: string) => {
    if (b && !individualBullets.includes(b)) individualBullets.push(b);
  };
  for (const e of entries) {
    if (e.agencyId === 'MTA_NYCT_SUBWAY') {
      if (e.routeId === '6X' || e.routeId === 'FX' || e.routeId === 'GS' || e.routeId === 'FS' || e.routeId === 'H' || e.routeId === 'SI' || e.routeId === 'SS') {
        continue;
      }
      pushUniqueBullet(e.routeId === '7X' ? '<7>' : e.routeId);
    }
  }
  for (const sw of mnrSwatches) pushUniqueBullet(sw.bulletRoute);
  for (const sw of pathSwatches) pushUniqueBullet(commuterSpecsByAgency.PORT_AUTHORITY_PATH[sw.bulletRoute]?.code ?? sw.bulletRoute);

  replaceArrayInPlace(METRO_NORTH_ROUTE_BULLET_SWATCHES, mnrSwatches);
  replaceArrayInPlace(LIRR_ROUTE_BULLET_SWATCHES, lirrSwatches);
  replaceArrayInPlace(PATH_ROUTE_BULLET_SWATCHES, pathSwatches);
  replaceArrayInPlace(MTA_ROUTE_BULLET_SWATCHES, [
    ...subwaySwatches,
    ...mnrSwatches,
    ...pathSwatches,
  ]);
  replaceArrayInPlace(TAURANAC_ROUTE_BULLET_SWATCHES, tauranacSwatches);
  replaceArrayInPlace(IND_1953_ROUTE_BULLET_SWATCHES, indSwatches);
  replaceArrayInPlace(MTA_INDIVIDUAL_ROUTE_BULLETS, individualBullets);

  // Refresh transit palette color lists from the hydrated swatches (multi-route trunks first for high-contrast categorical series)
  const subwayByTrunkSize = Array.from(subwayTrunkGroups.values()).sort((a, b) => b.routes.length - a.routes.length);
  if (subwayByTrunkSize.length > 0) {
    mutableChartPalettes['mta-trunk'] = {
      label: 'MTA & Metro-North Bullets (Default)',
      colors: Array.from(new Set(subwayByTrunkSize.map(s => s.colorHex))),
    };
  }
  const railColors = Array.from(new Set([...mnrSwatches, ...lirrSwatches].map(s => s.colorHex)));
  if (railColors.length > 0) {
    mutableChartPalettes['metro-north'] = {
      label: 'Metro-North & LIRR Rail Bullets',
      colors: railColors,
    };
  }
  const tauByTrunkSize = Array.from(tauranacGroups.values()).sort((a, b) => b.routes.length - a.routes.length);
  const tauColors = Array.from(new Set(tauByTrunkSize.map(s => s.colorHex)));
  if (tauColors.length > 0) {
    mutableChartPalettes['tauranac'] = {
      label: '1979 Tauranac / Hertz',
      colors: tauColors,
    };
  }
  const indColors = Array.from(new Set(indSwatches.map(s => s.colorHex)));
  if (indColors.length > 0) {
    mutableChartPalettes['ind'] = {
      label: '1953 IND Service Guide',
      colors: indColors,
    };
  }
}

export const EDITORIAL_COLOR_SWATCHES: readonly ColorPickerSwatch[] = [
  { id: 'ed-teal', kind: 'color-chip', label: 'Teal', name: 'Editorial Teal', colorHex: '#1D81A2' },
  { id: 'ed-cobalt', kind: 'color-chip', label: 'Cobalt', name: 'Editorial Cobalt', colorHex: '#0039A6' },
  { id: 'ed-petrol', kind: 'color-chip', label: 'Deep Sea', name: 'Deep Sea Petrol', colorHex: '#15607A' },
  { id: 'ed-forest', kind: 'color-chip', label: 'Forest', name: 'Editorial Forest', colorHex: '#00933C' },
  { id: 'ed-ochre', kind: 'color-chip', label: 'Ochre', name: 'Burnt Ochre', colorHex: '#E65100' },
  { id: 'ed-crimson', kind: 'color-chip', label: 'Crimson', name: 'Editorial Crimson', colorHex: '#C62828' },
  { id: 'ed-plum', kind: 'color-chip', label: 'Plum', name: 'Royal Plum', colorHex: '#6A1B9A' },
  { id: 'ed-steel', kind: 'color-chip', label: 'Steel', name: 'Blue Steel', colorHex: '#455A64' },
  { id: 'ed-umber', kind: 'color-chip', label: 'Umber', name: 'Warm Umber', colorHex: '#8D6E63' },
  { id: 'ed-mist', kind: 'color-chip', label: 'Mist', name: 'Cool Mist', colorHex: '#78909C' },
];

export const CIVIC_COLOR_SWATCHES: readonly ColorPickerSwatch[] = [
  { id: 'civ-ink', kind: 'color-chip', label: 'Ink', name: 'Civic Ink Navy', colorHex: '#0F172A' },
  { id: 'civ-blue', kind: 'color-chip', label: 'Blue', name: 'Civic Cobalt Blue', colorHex: '#2563EB' },
  { id: 'civ-red', kind: 'color-chip', label: 'Red', name: 'Signal Red', colorHex: '#DC2626' },
  { id: 'civ-emerald', kind: 'color-chip', label: 'Emerald', name: 'Civic Emerald', colorHex: '#059669' },
  { id: 'civ-amber', kind: 'color-chip', label: 'Amber', name: 'Warning Amber', colorHex: '#D97706' },
  { id: 'civ-violet', kind: 'color-chip', label: 'Violet', name: 'Civic Violet', colorHex: '#7C3AED' },
  { id: 'civ-cyan', kind: 'color-chip', label: 'Cyan', name: 'Transit Cyan', colorHex: '#0891B2' },
  { id: 'civ-rose', kind: 'color-chip', label: 'Rose', name: 'High-Contrast Rose', colorHex: '#BE185D' },
  { id: 'civ-indigo', kind: 'color-chip', label: 'Indigo', name: 'Civic Indigo', colorHex: '#4F46E5' },
  { id: 'civ-slate', kind: 'color-chip', label: 'Slate', name: 'Neutral Slate', colorHex: '#64748B' },
];

const mutableChartPalettes: Record<string, { label: string; colors: readonly string[] }> = {
  'mta-trunk': {
    label: 'MTA & Metro-North Bullets (Default)',
    colors: [],
  },
  'metro-north': {
    label: 'Metro-North & LIRR Rail Bullets',
    colors: [],
  },
  tauranac: {
    label: '1979 Tauranac / Hertz',
    colors: [],
  },
  ind: {
    label: '1953 IND Service Guide',
    colors: [],
  },
  editorial: {
    label: 'Editorial',
    colors: EDITORIAL_COLOR_SWATCHES.map(s => s.colorHex),
  },
  civic: {
    label: 'High-Contrast Civic',
    colors: CIVIC_COLOR_SWATCHES.map(s => s.colorHex),
  },
};

export const CHART_COLOR_PALETTES: Readonly<Record<string, { label: string; colors: readonly string[] }>> =
  mutableChartPalettes;

// Initialize synchronously from StraphangerDB codegen schema so unit tests and offline callers work immediately
rebuildRouteCatalog(Object.values(CANONICAL_ROUTES).map(canonicalEntryToNormalized));

/**
 * Hydrates all route colors, bullet codes, commuter/PATH/bus specs, and theme color swatches
 * directly from `prod.transit_v2.view_dim_routes` rows.
 */
export function hydrateRouteCatalogFromDuckDbRows(rows: readonly Record<string, unknown>[]): void {
  if (!rows || rows.length === 0) return;

  const mergedByKey = new Map<string, NormalizedRouteCatalogEntry>();
  for (const c of Object.values(CANONICAL_ROUTES)) {
    const norm = canonicalEntryToNormalized(c);
    mergedByKey.set(`${norm.agencyId}:${norm.routeId}`, norm);
  }

  for (const row of rows) {
    const routeId = String(row['route_id'] ?? '').trim().toUpperCase();
    const agencyId = String(row['agency_id'] ?? '').trim().toUpperCase();
    if (!routeId || !agencyId) continue;

    const base = mergedByKey.get(`${agencyId}:${routeId}`);
    let payload: Record<string, unknown> = {};
    const rawPayloadVal = row['raw_payload_json'] ?? row['raw_payload'];
    if (typeof rawPayloadVal === 'string' && rawPayloadVal.trim().startsWith('{')) {
      try {
        payload = JSON.parse(rawPayloadVal) as Record<string, unknown>;
      } catch {
        payload = {};
      }
    } else if (rawPayloadVal && typeof rawPayloadVal === 'object') {
      payload = rawPayloadVal as Record<string, unknown>;
    }

    const colorHex = normalizeHex(row['color_hex'] ?? payload['color_hex'], base?.colorHex ?? NEUTRAL_SLATE_GREY);
    const routeName = String(row['route_name'] ?? base?.routeName ?? routeId).trim() || routeId;
    const type = String(row['type'] ?? base?.type ?? 'rail').trim() || 'rail';
    const bulletCode = String(
      row['bullet_code'] ?? payload['bullet_code'] ?? base?.bulletCode ?? routeId
    ).trim().toUpperCase() || routeId;
    const textColorHex = normalizeHex(
      row['text_color_hex'] ?? payload['text_color_hex'] ?? base?.textColorHex,
      defaultTextColorForHex(colorHex)
    );
    const division = String(row['division'] ?? payload['division'] ?? base?.division ?? '').trim();
    const trunkGroup = String(row['trunk_group'] ?? payload['trunk_group'] ?? base?.trunkGroup ?? routeName).trim();
    const isDiamond =
      typeof payload['is_diamond'] === 'boolean'
        ? payload['is_diamond']
        : Boolean(base?.isDiamond);
    const payloadAliases = Array.isArray(payload['aliases'])
      ? (payload['aliases'] as unknown[]).map(a => String(a).trim().toUpperCase()).filter(Boolean)
      : [];
    const aliases = Array.from(new Set([...(base?.aliases ?? []), ...payloadAliases]));
    const tauranacRaw = payload['tauranac_color_hex'] ?? base?.tauranacColorHex;
    const ind1953Raw = payload['ind_1953_color_hex'] ?? base?.ind1953ColorHex;
    const shortLabelRaw = payload['route_short_label'] ?? base?.routeShortLabel;

    mergedByKey.set(`${agencyId}:${routeId}`, {
      routeId,
      agencyId,
      routeName,
      colorHex,
      type,
      bulletCode,
      textColorHex,
      division,
      trunkGroup,
      isDiamond,
      aliases,
      ...(tauranacRaw ? { tauranacColorHex: normalizeHex(tauranacRaw, colorHex) } : {}),
      ...(ind1953Raw ? { ind1953ColorHex: normalizeHex(ind1953Raw, colorHex) } : {}),
      ...(shortLabelRaw ? { routeShortLabel: String(shortLabelRaw) } : {}),
    });
  }

  rebuildRouteCatalog(Array.from(mergedByKey.values()));
}

export function getThemeRouteColorOverrides(
  themeId: 'tauranac-hertz' | 'ind'
): Readonly<Record<string, string>> {
  return themeId === 'ind' ? ind1953RouteColorOverrides : tauranacRouteColorOverrides;
}

export function resolveCommuterOrBusRouteSpec(
  routeId: string,
  agencyId?: string | null
): CommuterOrBusRouteSpec | null {
  const raw = String(routeId ?? '').trim().toUpperCase();
  if (!raw) return null;
  const agUpper = agencyId ? agencyId.trim().toUpperCase() : '';
  if (agUpper === 'MTA_METRO_NORTH') {
    return commuterSpecsByAgency.MTA_METRO_NORTH[raw] ?? null;
  }
  if (agUpper === 'MTA_LIRR') {
    return commuterSpecsByAgency.MTA_LIRR[raw] ?? null;
  }
  if (agUpper === 'PORT_AUTHORITY_PATH' || agUpper === 'PATH' || agUpper === 'PA_PATH') {
    return commuterSpecsByAgency.PORT_AUTHORITY_PATH[raw] ?? null;
  }
  if (agUpper === 'NJ_TRANSIT') {
    return commuterSpecsByAgency.NJ_TRANSIT[raw] ?? null;
  }
  if (agUpper === 'MTA_BUS') {
    const known = commuterSpecsByAgency.MTA_BUS[raw];
    if (known) return known;
    const fallbackHex = raw.includes('SBS') || raw.endsWith('+') ? '#0078C6' : '#0039A6';
    return {
      code: raw.replace(/\+$/, '').replace(/-SBS$/, '').slice(0, 4),
      canonicalRouteId: raw,
      label: `${raw} Bus`,
      colorHex: fallbackHex,
      agencyId: 'MTA_BUS',
    };
  }
  if (!agUpper) {
    return unambiguousCommuterSpecs[raw] ?? null;
  }
  return null;
}

export interface ResolvedRouteStyle {
  readonly routeId: string;
  readonly displayLabel: string;
  readonly isDiamond: boolean;
  readonly colorHex: string;
  readonly textColor: string;
}

export function resolveRouteColor(
  routeId: string,
  agencyId?: string | null,
  colorHex?: string | null
): string {
  if (colorHex && /^#[0-9A-Fa-f]{6}$/.test(colorHex)) {
    return colorHex;
  }

  const raw = routeId.trim().toUpperCase();
  const inner = raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1).trim() : raw;

  const commuterOrBus = resolveCommuterOrBusRouteSpec(raw, agencyId);
  if (commuterOrBus) {
    return commuterOrBus.colorHex;
  }

  if (agencyId) {
    const canonicalKeyRaw = `${agencyId}:${raw}`;
    const canonicalKeyInner = `${agencyId}:${inner}`;
    const canonical =
      (CANONICAL_ROUTES as Record<string, { colorHex: string }>)[canonicalKeyRaw] ??
      (CANONICAL_ROUTES as Record<string, { colorHex: string }>)[canonicalKeyInner];
    if (canonical?.colorHex) {
      return canonical.colorHex;
    }
    if (agencyId === 'MTA_NYCT_SUBWAY' || agencyId === 'MTA_NYCT_SIR') {
      if (SUBWAY_TRUNK_COLORS[raw]) return SUBWAY_TRUNK_COLORS[raw]!;
      if (SUBWAY_TRUNK_COLORS[inner]) return SUBWAY_TRUNK_COLORS[inner]!;
    }
  }

  // Bare numeric routes '1'..'7' without agency_id or color_hex are ambiguous across subway, commuter rail, and bus
  if ((AMBIGUOUS_CROSS_AGENCY_ROUTE_IDS as readonly string[]).includes(raw)) {
    if (!agencyId) {
      return NEUTRAL_SLATE_GREY;
    }
  }

  if (SUBWAY_TRUNK_COLORS[raw]) {
    return SUBWAY_TRUNK_COLORS[raw]!;
  }
  if (SUBWAY_TRUNK_COLORS[inner]) {
    return SUBWAY_TRUNK_COLORS[inner]!;
  }

  return NEUTRAL_SLATE_GREY;
}

export function formatRouteBadge(
  routeId: string,
  agencyId?: string | null,
  colorHex?: string | null
): ResolvedRouteStyle {
  const raw = routeId.trim().toUpperCase();
  const commuterOrBus = resolveCommuterOrBusRouteSpec(raw, agencyId);

  const isSubwayAgency = !agencyId || agencyId === 'MTA_NYCT_SUBWAY';
  const isAngleDiamond =
    isSubwayAgency &&
    ((raw.startsWith('<') && raw.endsWith('>')) || (raw.startsWith('&LT;') && raw.endsWith('&GT;')));
  const isDiamond =
    !commuterOrBus &&
    isSubwayAgency &&
    (isAngleDiamond || diamondSubwayRoutes.has(raw));

  let displayLabel = commuterOrBus ? commuterOrBus.code : raw;
  if (isAngleDiamond) {
    displayLabel = raw.replace(/^<|>$|^&LT;|&GT;$/g, '').trim();
  } else if (isDiamond && raw.endsWith('X') && raw.length > 1) {
    displayLabel = raw.slice(0, -1);
  }

  const color = resolveRouteColor(raw, agencyId, colorHex);
  const explicitTextColor =
    !colorHex && agencyId ? routeTextColorByKey.get(`${agencyId.trim().toUpperCase()}:${raw}`) : undefined;
  const textColor = explicitTextColor ?? defaultTextColorForHex(color);

  return {
    routeId: raw,
    displayLabel,
    isDiamond,
    colorHex: color,
    textColor,
  };
}

/**
 * Generates an ECharts-compatible `image://data:image/svg+xml;utf8,...` symbol URI
 * that renders an authentic NYC transit circular (or express diamond) route bullet.
 */
export function buildRouteBulletSvgDataUri(
  routeId: string,
  agencyId?: string | null,
  colorHex?: string | null
): string {
  const badge = formatRouteBadge(routeId, agencyId, colorHex);
  const label = badge.displayLabel.slice(0, 3);
  const fontSize = label.length === 1 ? 17 : label.length === 2 ? 13 : 9.5;
  const textY = label.length === 1 ? 22 : label.length === 2 ? 20.5 : 19.5;

  const shapeSvg = badge.isDiamond
    ? `<polygon points="16,1.5 30.5,16 16,30.5 1.5,16" fill="${badge.colorHex}" stroke="#FFFFFF" stroke-width="1.5"/>`
    : `<circle cx="16" cy="16" r="14.2" fill="${badge.colorHex}" stroke="#FFFFFF" stroke-width="1.6"/>`;

  const escapedLabel = label
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">${shapeSvg}<text x="16" y="${textY}" text-anchor="middle" fill="${badge.textColor}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="700" font-size="${fontSize}">${escapedLabel}</text></svg>`;
  return `image://data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * Generates an inline HTML MTA transit bullet badge for tooltips and headers.
 */
export function buildRouteBulletHtml(
  routeId: string,
  agencyId?: string | null,
  colorHex?: string | null,
  sizePx = 20
): string {
  const badge = formatRouteBadge(routeId, agencyId, colorHex);
  const label = badge.displayLabel.slice(0, 3);
  const escapedLabel = label
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  if (badge.isDiamond) {
    const fontSize = label.length === 1 ? 17 : label.length === 2 ? 13 : 9.5;
    const textY = label.length === 1 ? 22 : label.length === 2 ? 20.5 : 19.5;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${sizePx}" height="${sizePx}" style="display:inline-block;vertical-align:middle;flex-shrink:0;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,0.18));"><polygon points="16,1.5 30.5,16 16,30.5 1.5,16" fill="${badge.colorHex}" stroke="#FFFFFF" stroke-width="1.5"/><text x="16" y="${textY}" text-anchor="middle" fill="${badge.textColor}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="700" font-size="${fontSize}">${escapedLabel}</text></svg>`;
  }

  const fontSize = Math.round(sizePx * (label.length === 1 ? 0.58 : label.length === 2 ? 0.45 : 0.36));
  return `<span style="display:inline-flex;align-items:center;justify-content:center;width:${sizePx}px;height:${sizePx}px;border-radius:50%;background:${badge.colorHex};color:${badge.textColor};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:700;font-size:${fontSize}px;line-height:1;box-shadow:0 0 0 1.5px #FFFFFF, 0 1px 2px rgba(0,0,0,0.18);flex-shrink:0;vertical-align:middle;">${escapedLabel}</span>`;
}

export const MTA_MODERN_ECHARTS_THEME = {
  color: [...(mutableChartPalettes['mta-trunk']?.colors ?? ['#0039A6'])],
  backgroundColor: 'transparent',
  textStyle: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    color: '#374151',
  },
  title: {
    textStyle: {
      fontWeight: 'bold',
      color: '#111827',
      fontSize: 16,
    },
    subtextStyle: {
      color: '#6B7280',
      fontSize: 12,
    },
  },
  grid: {
    containLabel: true,
    borderColor: '#E5E7EB',
  },
  categoryAxis: {
    axisLine: { lineStyle: { color: '#111827', width: 1.2 } },
    axisTick: { show: false },
    axisLabel: { color: '#4B5563', fontSize: 11, margin: 10 },
    splitLine: { show: false },
  },
  valueAxis: {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: '#6B7280', fontSize: 11 },
    splitLine: { show: true, lineStyle: { color: '#E5E7EB', width: 1, type: 'solid' } },
  },
  tooltip: {
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
    borderColor: '#E5E7EB',
    borderWidth: 1,
    padding: [8, 12],
    textStyle: { color: '#111827', fontSize: 12 },
    extraCssText: 'box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08); border-radius: 6px;',
  },
};

echarts.registerTheme('mta-modern', MTA_MODERN_ECHARTS_THEME);

export interface ColorPickerSwatch {
  readonly id: string;
  readonly kind: 'route-bullet' | 'color-chip';
  readonly bulletRoute?: string;
  readonly agencyId?: string;
  readonly label: string;
  readonly name: string;
  readonly colorHex: string;
}

export interface ThemeColorSwatchGroup {
  readonly paletteId: string;
  readonly sectionTitle: string;
  readonly hintText: string;
  readonly isTransitTheme: boolean;
  readonly swatches: readonly ColorPickerSwatch[];
}

function mapBulletSwatchesToPicker(list: readonly MtaRouteBulletSwatch[]): readonly ColorPickerSwatch[] {
  return list.map(sw => ({
    id: sw.id,
    kind: 'route-bullet' as const,
    bulletRoute: sw.bulletRoute,
    ...(sw.agencyId ? { agencyId: sw.agencyId } : {}),
    label: sw.routesLabel.replace(/\s*·\s*/g, '·'),
    name: `${sw.trunkName} (${sw.routesLabel})`,
    colorHex: sw.colorHex,
  }));
}

export function getThemeColorSwatches(paletteId?: string): ThemeColorSwatchGroup {
  const normalized = paletteId && paletteId in CHART_COLOR_PALETTES ? paletteId : 'mta-trunk';
  if (normalized === 'editorial') {
    return {
      paletteId: 'editorial',
      sectionTitle: 'Editorial Color Swatches',
      hintText: 'Click swatch to apply',
      isTransitTheme: false,
      swatches: EDITORIAL_COLOR_SWATCHES,
    };
  }
  if (normalized === 'civic') {
    return {
      paletteId: 'civic',
      sectionTitle: 'High-Contrast Civic Swatches',
      hintText: 'Click swatch to apply',
      isTransitTheme: false,
      swatches: CIVIC_COLOR_SWATCHES,
    };
  }
  if (normalized === 'metro-north') {
    return {
      paletteId: 'metro-north',
      sectionTitle: 'Metro-North, LIRR & PATH Bullet Swatches',
      hintText: 'Click bullet to apply',
      isTransitTheme: true,
      swatches: mapBulletSwatchesToPicker([
        ...METRO_NORTH_ROUTE_BULLET_SWATCHES,
        ...LIRR_ROUTE_BULLET_SWATCHES,
        ...PATH_ROUTE_BULLET_SWATCHES,
      ]),
    };
  }
  if (normalized === 'tauranac') {
    return {
      paletteId: 'tauranac',
      sectionTitle: '1979 Tauranac & Metro-North Bullet Swatches',
      hintText: 'Click bullet to apply',
      isTransitTheme: true,
      swatches: mapBulletSwatchesToPicker(TAURANAC_ROUTE_BULLET_SWATCHES),
    };
  }
  if (normalized === 'ind') {
    return {
      paletteId: 'ind',
      sectionTitle: '1953 IND Bullet Swatches',
      hintText: 'Click bullet to apply',
      isTransitTheme: true,
      swatches: mapBulletSwatchesToPicker(IND_1953_ROUTE_BULLET_SWATCHES),
    };
  }
  return {
    paletteId: 'mta-trunk',
    sectionTitle: 'MTA & Metro-North Route Bullet Swatches',
    hintText: 'Click bullet to apply',
    isTransitTheme: true,
    swatches: mapBulletSwatchesToPicker(MTA_ROUTE_BULLET_SWATCHES),
  };
}

export function inferRouteBulletColorFromLabel(
  label: string,
  agencyId?: string | null
): { routeId: string; colorHex: string; agencyId?: string } | null {
  const trimmed = String(label ?? '').trim();
  if (!trimmed) return null;
  if (/^(?:other\s+routes?|all\s+other\s+routes?|other)$/i.test(trimmed)) {
    return { routeId: 'S', colorHex: SUBWAY_TRUNK_COLORS['S'] ?? '#808183' };
  }

  const directCommuterOrBus = resolveCommuterOrBusRouteSpec(
    trimmed.replace(/\s+(?:line|branch|train|bus|route)s?$/i, '').trim(),
    agencyId
  );
  if (directCommuterOrBus) {
    return {
      routeId: directCommuterOrBus.code,
      colorHex: directCommuterOrBus.colorHex,
      agencyId: directCommuterOrBus.agencyId,
    };
  }

  const m =
    trimmed.match(/^(?:route|line)\s+(<[0-9A-Z]+>|[0-9A-Z+-]{1,7})$/i) ??
    trimmed.match(/^(<[0-9A-Z]+>|[0-9A-Z+-]{1,7})\s+(?:train|line|route|branch|bus)s?$/i) ??
    trimmed.match(/^(<[0-9A-Z]+>|[0-9A-Z+-]{1,7})$/i);
  if (!m?.[1]) return null;
  const candidate = m[1].toUpperCase();
  const commuterCandidate = resolveCommuterOrBusRouteSpec(candidate, agencyId);
  if (commuterCandidate) {
    return {
      routeId: commuterCandidate.code,
      colorHex: commuterCandidate.colorHex,
      agencyId: commuterCandidate.agencyId,
    };
  }
  const colorHex = SUBWAY_TRUNK_COLORS[candidate];
  if (!colorHex) return null;
  return { routeId: candidate, colorHex };
}

const COLOR_KEY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'scheduled service': ['scheduled', 'scheduled trips'],
  scheduled: ['scheduled service', 'scheduled trips'],
  'ghost / missing': ['ghost', 'ghost trips', 'ghost trips (missed)'],
  ghost: ['ghost / missing', 'ghost trips', 'ghost trips (missed)'],
  'unscheduled added': ['unscheduled', 'unscheduled trips', 'unscheduled trips (added)'],
  unscheduled: ['unscheduled added', 'unscheduled trips', 'unscheduled trips (added)'],
  'observed operated': ['observed', 'observed trips'],
  observed: ['observed operated', 'observed trips'],
  'citi bikes available': ['classic bikes', 'citi bikes'],
  'classic bikes': ['citi bikes available', 'citi bikes'],
  'citi e-bikes available': ['e-bikes', 'ebikes'],
  'e-bikes': ['citi e-bikes available', 'ebikes'],
  'empty bike docks': ['available docks', 'empty docks'],
  'available docks': ['empty bike docks', 'empty docks'],
  '10 min': ['10', '10m', '<= 10 min'],
  '20 min': ['20', '20m', '10-20 min'],
  '30 min': ['30', '30m', '20-30 min'],
  '45 min': ['45', '45m', '30-45 min'],
  slow: ['slow zone', 'slow zone (< 14 mph)'],
  standard: ['standard pace', 'standard pace (14-22 mph)'],
  express: ['express pace', 'express pace (>= 22 mph)'],
};

export function resolveCustomColorForKey(
  key: string,
  customColors?: Readonly<Record<string, string>>
): string | null {
  if (!customColors) return null;
  const raw = String(key ?? '').trim();
  if (!raw) return null;
  if (customColors[raw]) return customColors[raw]!;

  const lower = raw.toLowerCase();
  for (const [k, v] of Object.entries(customColors)) {
    if (k.toLowerCase() === lower && v) return v;
  }

  const aliases = COLOR_KEY_ALIASES[lower];
  if (aliases) {
    for (const alias of aliases) {
      for (const [k, v] of Object.entries(customColors)) {
        if (k.toLowerCase() === alias && v) return v;
      }
    }
  }

  const inferred = inferRouteBulletColorFromLabel(raw);
  if (inferred) {
    const rId = inferred.routeId;
    if (customColors[rId]) return customColors[rId]!;
    if (customColors[`${rId} Train`]) return customColors[`${rId} Train`]!;
    if (customColors[`Line ${rId}`]) return customColors[`Line ${rId}`]!;
    if (rId === '<7>' && customColors['7X']) return customColors['7X']!;
    if (rId === '7X' && customColors['<7>']) return customColors['<7>']!;
  }
  return null;
}

export function applyChartColorOverrides(
  option: echarts.EChartsOption,
  chartConfig?: Readonly<Record<string, unknown>>
): echarts.EChartsOption {
  if (!option || !chartConfig) return option;

  const paletteId = typeof chartConfig['colorPalette'] === 'string' ? chartConfig['colorPalette'] : undefined;
  const paletteSpec = paletteId ? CHART_COLOR_PALETTES[paletteId] : undefined;
  const customColors =
    chartConfig['customColors'] && typeof chartConfig['customColors'] === 'object'
      ? (chartConfig['customColors'] as Readonly<Record<string, string>>)
      : undefined;

  if (paletteSpec) {
    option.color = [...paletteSpec.colors];
  }

  const hasCustomColors = Boolean(customColors && Object.keys(customColors).length > 0);
  if (!hasCustomColors && !paletteSpec) return option;

  const seriesList: any[] = Array.isArray(option.series)
    ? (option.series as any[])
    : option.series
      ? [option.series as any]
      : [];

  const xAxisObj = Array.isArray(option.xAxis) ? option.xAxis[0] : option.xAxis;
  const yAxisObj = Array.isArray(option.yAxis) ? option.yAxis[0] : option.yAxis;
  const categoryLabels: string[] | null =
    Array.isArray((xAxisObj as any)?.data)
      ? ((xAxisObj as any).data as string[])
      : Array.isArray((yAxisObj as any)?.data)
        ? ((yAxisObj as any).data as string[])
        : null;

  const distinctSeriesNameIndex = new Map<string, number>();
  let visibleSeriesSlot = 0;

  seriesList.forEach((s, sIdx) => {
    if (!s || typeof s !== 'object') return;
    const sName = String(s.name ?? '');
    const isTransparentHelper =
      sName === 'Placeholder Base' || s.itemStyle?.color === 'transparent';

    if (isTransparentHelper) return;

    let seriesSlot = sIdx;
    if (sName) {
      if (!distinctSeriesNameIndex.has(sName)) {
        distinctSeriesNameIndex.set(sName, visibleSeriesSlot++);
      }
      seriesSlot = distinctSeriesNameIndex.get(sName)!;
    } else {
      seriesSlot = visibleSeriesSlot++;
    }

    const customSeriesColor =
      resolveCustomColorForKey(sName, customColors) ??
      (seriesSlot === 0 ? resolveCustomColorForKey('Series 1', customColors) : null);
    const inferredSeriesRoute = sName ? inferRouteBulletColorFromLabel(sName) : null;
    const paletteFallbackColor =
      !customSeriesColor && paletteSpec
        ? (paletteId === 'mta-trunk' || paletteId === 'metro-north') && inferredSeriesRoute
          ? (typeof s.itemStyle?.color === 'string' ? s.itemStyle.color : inferredSeriesRoute.colorHex)
          : paletteSpec.colors[seriesSlot % paletteSpec.colors.length]
        : null;
    const effectiveSeriesColor = customSeriesColor ?? paletteFallbackColor;

    if (
      effectiveSeriesColor &&
      s.type !== 'pie' &&
      s.type !== 'treemap' &&
      s.type !== 'funnel' &&
      s.type !== 'sankey' &&
      s.type !== 'radar'
    ) {
      s.itemStyle = { ...(s.itemStyle || {}), color: effectiveSeriesColor };
      if (s.lineStyle || s.type === 'line') {
        s.lineStyle = { ...(s.lineStyle || {}), color: effectiveSeriesColor };
      }
      if (s.areaStyle && typeof s.areaStyle === 'object') {
        s.areaStyle = { ...s.areaStyle, color: effectiveSeriesColor };
      }
      const inferred = inferRouteBulletColorFromLabel(sName);
      if (inferred) {
        const retintedUri = buildRouteBulletSvgDataUri(
          inferred.routeId,
          inferred.agencyId ?? 'MTA_NYCT_SUBWAY',
          effectiveSeriesColor
        );
        if (typeof s.symbol === 'string' && s.symbol.startsWith('image://data:image/svg+xml')) {
          s.symbol = retintedUri;
        }
        if (s.markPoint && Array.isArray(s.markPoint.data)) {
          s.markPoint = {
            ...s.markPoint,
            data: s.markPoint.data.map((mp: any) =>
              mp && typeof mp.symbol === 'string' && mp.symbol.startsWith('image://data:image/svg+xml')
                ? { ...mp, symbol: retintedUri }
                : mp
            ),
          };
        }
        const leg = option.legend as any;
        const legList = Array.isArray(leg) ? leg : leg ? [leg] : [];
        for (const lObj of legList) {
          if (lObj && Array.isArray(lObj.data)) {
            lObj.data = lObj.data.map((ld: any) =>
              ld &&
              typeof ld === 'object' &&
              ld.name === sName &&
              typeof ld.icon === 'string' &&
              ld.icon.startsWith('image://data:image/svg+xml')
                ? { ...ld, icon: retintedUri }
                : ld
            );
          }
        }
      }
    }

    if (Array.isArray(s.data) && s.type !== 'sankey' && s.type !== 'graph') {
      s.data = s.data.map((d: any, dIdx: number) => {
        const itemName =
          d && typeof d === 'object' && !Array.isArray(d) && typeof d.name === 'string'
            ? d.name
            : categoryLabels && categoryLabels[dIdx] !== undefined
              ? String(categoryLabels[dIdx])
              : '';
        const itemCustomColor = itemName ? resolveCustomColorForKey(itemName, customColors) : null;
        const inferredItemRoute = itemName ? inferRouteBulletColorFromLabel(itemName) : null;
        const hasItemPresetColor = Boolean(
          d && typeof d === 'object' && !Array.isArray(d) && d.itemStyle?.color
        );
        const itemPaletteColor =
          !itemCustomColor &&
          paletteSpec &&
          (s.type === 'pie' ||
            s.type === 'treemap' ||
            s.type === 'funnel' ||
            s.type === 'radar' ||
            (s.type === 'bar' && hasItemPresetColor && !customSeriesColor))
            ? (paletteId === 'mta-trunk' || paletteId === 'metro-north') && inferredItemRoute
              ? inferredItemRoute.colorHex
              : paletteSpec.colors[dIdx % paletteSpec.colors.length]
            : null;
        const chosenItemColor = itemCustomColor ?? itemPaletteColor;

        if (!chosenItemColor) return d;

        if (d && typeof d === 'object' && !Array.isArray(d)) {
          return {
            ...d,
            itemStyle: { ...(d.itemStyle || {}), color: chosenItemColor },
            ...(s.type === 'radar'
              ? {
                  lineStyle: { ...(d.lineStyle || {}), color: chosenItemColor },
                }
              : {}),
          };
        }
        return {
          value: d,
          itemStyle: { color: chosenItemColor },
        };
      });
    }

    if ((s.type === 'sankey' || s.type === 'graph') && Array.isArray(s.data)) {
      const stripStationAffix = (str: string) =>
        str.replace(/^(?:Origin|Dest):\s*/i, '').replace(/\s*\((?:Origin|Dest)\)$/i, '').trim();

      const stationColorMap = new Map<string, string>();
      let stationIdx = 0;

      s.data = s.data.map((node: any) => {
        if (!node || typeof node !== 'object') return node;
        const rawName = String(node.stationName ?? node.name ?? '');
        const cleanStation = stripStationAffix(rawName);
        let c =
          resolveCustomColorForKey(cleanStation, customColors) ??
          resolveCustomColorForKey(rawName, customColors);
        if (!c && paletteSpec && cleanStation) {
          if (cleanStation.toLowerCase() === 'other stations') {
            c = '#94A3B8';
          } else {
            if (!stationColorMap.has(cleanStation)) {
              stationColorMap.set(cleanStation, paletteSpec.colors[stationIdx % paletteSpec.colors.length]!);
              stationIdx++;
            }
            c = stationColorMap.get(cleanStation) ?? null;
          }
        }
        if (c && cleanStation) {
          stationColorMap.set(cleanStation, c);
        }
        if (!c) return node;
        return {
          ...node,
          itemStyle: { ...(node.itemStyle || {}), color: c, borderColor: c },
        };
      });
      if (Array.isArray(s.links)) {
        s.links = s.links.map((link: any) => {
          if (!link || typeof link !== 'object') return link;
          const rawSrc = String(link.originName ?? link.source ?? '');
          const cleanSrc = stripStationAffix(rawSrc);
          const c =
            resolveCustomColorForKey(cleanSrc, customColors) ??
            resolveCustomColorForKey(rawSrc, customColors) ??
            stationColorMap.get(cleanSrc);
          if (!c) return link;
          return {
            ...link,
            lineStyle: { ...(link.lineStyle || {}), color: c },
          };
        });
      }
    }
  });

  const vMap = (option as any).visualMap;
  if (vMap && typeof vMap === 'object' && !Array.isArray(vMap)) {
    const customPrimary = resolveCustomColorForKey('Series 1', customColors);
    if (customPrimary) {
      vMap.inRange = { ...(vMap.inRange || {}), color: ['#F8FAFC', customPrimary] };
    } else if (paletteSpec && paletteSpec.colors.length >= 2) {
      vMap.inRange = {
        ...(vMap.inRange || {}),
        color: ['#F8FAFC', paletteSpec.colors[1]!, paletteSpec.colors[0]!],
      };
    }
  }

  return option;
}
