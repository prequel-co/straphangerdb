import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import type { MapVisualThemeId } from '../../types/cell-state.js';
import { getThemeRouteColorOverrides } from '../echarts-theme-mta.js';

export type { MapVisualThemeId };

export const OPENFREEMAP_VECTOR_SOURCE_ID = 'openfreemap-planet';
export const OPENFREEMAP_VECTOR_SOURCE_URL = 'https://tiles.openfreemap.org/planet';
export const OPENFREEMAP_GLYPHS_URL = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

export interface MapVisualThemeSpec {
  readonly id: MapVisualThemeId;
  readonly label: string;
  readonly description: string;
  readonly waterColor: string;
  readonly landFillColor: string;
  readonly landStrokeColor: string;
  readonly landStrokeWidth: number;
  readonly parkFillColor: string;
  readonly parkFillOpacity: number;
  readonly parkStrokeColor: string;
  readonly trunkCasingColor: string;
  readonly trunkCasingWidthScale: number;
  readonly commuterCasingColor: string;
  readonly commuterInnerColor: string;
  readonly waterLabelFillColor: string;
  readonly waterLabelHaloColor: string;
  readonly boroughWatermarkColor: string;
  readonly boroughWatermarkUppercase: boolean;
  readonly statenIslandLabel: string;
  readonly stationLabelFillColor: string;
  readonly stationLabelHaloColor: string;
  readonly stopPillBackgroundColor: string;
  readonly stopPillBorderColor: string;
  readonly isGeographicBasemap?: boolean;
  readonly vectorTileSourceUrl?: string;
  readonly routeColorOverrides?: Readonly<Record<string, string>>;
}

export const MAP_VISUAL_THEMES: readonly MapVisualThemeSpec[] = [
  {
    id: 'mta',
    label: 'MTA',
    description: 'Current official MTA Subway & Regional Rail Map design with slate-blue water, white landmass, sage parks, Metro-North, LIRR & PATH lines, and black stop pills.',
    waterColor: '#D8E2EB',
    landFillColor: '#FFFFFF',
    landStrokeColor: '#C8D4DF',
    landStrokeWidth: 1.2,
    parkFillColor: '#EEF4DC',
    parkFillOpacity: 0.75,
    parkStrokeColor: '#D5DFBC',
    trunkCasingColor: '#FFFFFF',
    trunkCasingWidthScale: 1.0,
    commuterCasingColor: '#94A3B8',
    commuterInnerColor: '#FFFFFF',
    waterLabelFillColor: '#FFFFFF',
    waterLabelHaloColor: '#B2C4D4',
    boroughWatermarkColor: 'rgba(150, 160, 172, 0.58)',
    boroughWatermarkUppercase: false,
    statenIslandLabel: 'Staten Island',
    stationLabelFillColor: '#111315',
    stationLabelHaloColor: '#FFFFFF',
    stopPillBackgroundColor: '#000000',
    stopPillBorderColor: '#FFFFFF',
  },
  {
    id: 'tauranac-hertz',
    label: 'Tauranac / Hertz',
    description: '1979-2024 Michael Hertz Associates & John Tauranac classic geographic NYC Subway & Regional Rail Map with warm buff/tan landmass, baby-blue water, and lush green parks.',
    waterColor: '#AADAFF',
    landFillColor: '#F5F1E3',
    landStrokeColor: '#8A9BA8',
    landStrokeWidth: 1.3,
    parkFillColor: '#C8E6B4',
    parkFillOpacity: 0.85,
    parkStrokeColor: '#98C47E',
    trunkCasingColor: '#F5F1E3',
    trunkCasingWidthScale: 1.0,
    commuterCasingColor: '#5B6B79',
    commuterInnerColor: '#F5F1E3',
    waterLabelFillColor: '#1D4E78',
    waterLabelHaloColor: '#D6EEFF',
    boroughWatermarkColor: 'rgba(110, 98, 76, 0.55)',
    boroughWatermarkUppercase: true,
    statenIslandLabel: 'STATEN ISLAND',
    stationLabelFillColor: '#1B242B',
    stationLabelHaloColor: '#F5F1E3',
    stopPillBackgroundColor: '#1B242B',
    stopPillBorderColor: '#F5F1E3',
    get routeColorOverrides() {
      return getThemeRouteColorOverrides('tauranac-hertz');
    },
  },
  {
    id: 'ind',
    label: 'IND',
    description: '1953 IND Service Guide ("Independent City Owned Rapid Transit Railroad") style with vintage parchment cream-yellow landmass, grey-taupe water, olive-sage parks, bronze uppercase borough typography, and black-cased trunk lines.',
    waterColor: '#D2CFC6',
    landFillColor: '#FBF0C4',
    landStrokeColor: '#6B5B45',
    landStrokeWidth: 1.6,
    parkFillColor: '#B5C676',
    parkFillOpacity: 0.88,
    parkStrokeColor: '#7E8F45',
    trunkCasingColor: '#1A1A1A',
    trunkCasingWidthScale: 1.15,
    commuterCasingColor: '#594D3C',
    commuterInnerColor: '#FBF0C4',
    waterLabelFillColor: '#3B352C',
    waterLabelHaloColor: '#E5E2D9',
    boroughWatermarkColor: 'rgba(138, 98, 54, 0.72)',
    boroughWatermarkUppercase: true,
    statenIslandLabel: 'RICHMOND',
    stationLabelFillColor: '#14110D',
    stationLabelHaloColor: '#FBF0C4',
    stopPillBackgroundColor: '#14110D',
    stopPillBorderColor: '#FBF0C4',
    get routeColorOverrides() {
      return getThemeRouteColorOverrides('ind');
    },
  },
  {
    id: 'geo-light',
    label: 'Geographic (Light)',
    description: 'Keyless OpenFreeMap / OpenStreetMap light vector street, bridge, airport, shoreline, and neighborhood basemap (no API key required).',
    waterColor: '#C9DCEC',
    landFillColor: '#F6F8FA',
    landStrokeColor: '#CBD5E1',
    landStrokeWidth: 0,
    parkFillColor: '#DFECDA',
    parkFillOpacity: 0,
    parkStrokeColor: '#C5D8BC',
    trunkCasingColor: '#FFFFFF',
    trunkCasingWidthScale: 1.0,
    commuterCasingColor: '#64748B',
    commuterInnerColor: '#FFFFFF',
    waterLabelFillColor: '#475569',
    waterLabelHaloColor: '#F8FAFC',
    boroughWatermarkColor: 'rgba(100, 116, 139, 0.0)',
    boroughWatermarkUppercase: false,
    statenIslandLabel: 'Staten Island',
    stationLabelFillColor: '#0F172A',
    stationLabelHaloColor: '#FFFFFF',
    stopPillBackgroundColor: '#0F172A',
    stopPillBorderColor: '#FFFFFF',
    isGeographicBasemap: true,
    vectorTileSourceUrl: OPENFREEMAP_VECTOR_SOURCE_URL,
  },
  {
    id: 'geo-dark',
    label: 'Geographic (Dark)',
    description: 'Keyless OpenFreeMap / OpenStreetMap dark vector street, bridge, airport, shoreline, and neighborhood basemap (no API key required).',
    waterColor: '#090E17',
    landFillColor: '#141B26',
    landStrokeColor: '#334155',
    landStrokeWidth: 0,
    parkFillColor: '#13241D',
    parkFillOpacity: 0,
    parkStrokeColor: '#1E3A2B',
    trunkCasingColor: '#0F172A',
    trunkCasingWidthScale: 1.05,
    commuterCasingColor: '#94A3B8',
    commuterInnerColor: '#0F172A',
    waterLabelFillColor: '#94A3B8',
    waterLabelHaloColor: '#0F172A',
    boroughWatermarkColor: 'rgba(148, 163, 184, 0.0)',
    boroughWatermarkUppercase: false,
    statenIslandLabel: 'Staten Island',
    stationLabelFillColor: '#F8FAFC',
    stationLabelHaloColor: '#0F172A',
    stopPillBackgroundColor: '#0F172A',
    stopPillBorderColor: '#E2E8F0',
    isGeographicBasemap: true,
    vectorTileSourceUrl: OPENFREEMAP_VECTOR_SOURCE_URL,
  },
];

export function getMapThemeSpec(themeId?: string | null): MapVisualThemeSpec {
  const normalized = (themeId ?? 'mta').trim().toLowerCase();
  return MAP_VISUAL_THEMES.find(t => t.id === normalized) ?? MAP_VISUAL_THEMES[0]!;
}

/**
 * Builds keyless OpenFreeMap (OpenMapTiles schema) vector basemap layers for either
 * `geo-light` (editorial light street map) or `geo-dark` (high-contrast night street map).
 */
export function buildGeographicVectorLayers(
  themeId: 'geo-light' | 'geo-dark',
  sourceId: string = OPENFREEMAP_VECTOR_SOURCE_ID
): LayerSpecification[] {
  const isDark = themeId === 'geo-dark';
  const prefix = `dbtc-ofm-${themeId}`;

  const waterFill = isDark ? '#090E17' : '#C9DCEC';
  const waterwayLine = isDark ? '#0D1522' : '#B8D0E4';
  const parkFill = isDark ? '#13241D' : '#E2EEDB';
  const landuseFill = isDark ? '#182130' : '#EEF2F6';
  const aerowayFill = isDark ? '#1D2738' : '#E6ECF2';
  const aerowayLine = isDark ? '#2B3950' : '#CBD5E1';
  const buildingFill = isDark ? '#1B2434' : '#EAEEF3';
  const buildingStroke = isDark ? '#232F44' : '#DDE4EC';
  const minorRoadColor = isDark ? '#243044' : '#FFFFFF';
  const minorRoadCasing = isDark ? '#101620' : '#DCE3EC';
  const majorRoadCasing = isDark ? '#0E141E' : '#CBD5E1';
  const majorRoadColor = isDark ? '#31415C' : '#FFFFFF';
  const highwayColor = isDark ? '#3B4F70' : '#F8FAFC';
  const boundaryColor = isDark ? '#475569' : '#94A3B8';
  const roadLabelColor = isDark ? '#94A3B8' : '#475569';
  const roadLabelHalo = isDark ? '#141B26' : '#FFFFFF';
  const placeLabelColor = isDark ? '#CBD5E1' : '#334155';
  const placeLabelHalo = isDark ? '#0F172A' : '#FFFFFF';
  const waterLabelColor = isDark ? '#64748B' : '#4A6B88';
  const waterLabelHalo = isDark ? '#090E17' : '#E6F0F7';

  return [
    {
      id: `${prefix}-landuse`,
      type: 'fill',
      source: sourceId,
      'source-layer': 'landuse',
      filter: ['in', 'class', 'residential', 'commercial', 'industrial', 'hospital', 'school', 'university', 'stadium'],
      paint: {
        'fill-color': landuseFill,
        'fill-opacity': 0.7,
      },
    },
    {
      id: `${prefix}-park`,
      type: 'fill',
      source: sourceId,
      'source-layer': 'park',
      paint: {
        'fill-color': parkFill,
        'fill-opacity': 0.85,
      },
    },
    {
      id: `${prefix}-landcover-grass`,
      type: 'fill',
      source: sourceId,
      'source-layer': 'landcover',
      filter: ['in', 'class', 'grass', 'wood'],
      paint: {
        'fill-color': parkFill,
        'fill-opacity': 0.65,
      },
    },
    {
      id: `${prefix}-waterway`,
      type: 'line',
      source: sourceId,
      'source-layer': 'waterway',
      paint: {
        'line-color': waterwayLine,
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 13, 1.8],
      },
    },
    {
      id: `${prefix}-water`,
      type: 'fill',
      source: sourceId,
      'source-layer': 'water',
      paint: {
        'fill-color': waterFill,
      },
    },
    {
      id: `${prefix}-aeroway-poly`,
      type: 'fill',
      source: sourceId,
      'source-layer': 'aeroway',
      minzoom: 10,
      paint: {
        'fill-color': aerowayFill,
        'fill-opacity': 0.9,
      },
    },
    {
      id: `${prefix}-aeroway-line`,
      type: 'line',
      source: sourceId,
      'source-layer': 'aeroway',
      minzoom: 10,
      paint: {
        'line-color': aerowayLine,
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.2, 14, 5],
      },
    },
    {
      id: `${prefix}-building`,
      type: 'fill',
      source: sourceId,
      'source-layer': 'building',
      minzoom: 13,
      paint: {
        'fill-color': buildingFill,
        'fill-outline-color': buildingStroke,
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0.35, 15, 0.8],
      },
    },
    {
      id: `${prefix}-road-minor-casing`,
      type: 'line',
      source: sourceId,
      'source-layer': 'transportation',
      minzoom: 12,
      filter: ['in', 'class', 'minor', 'service', 'street'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': minorRoadCasing,
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.2, 15, 4.8],
      },
    },
    {
      id: `${prefix}-road-minor`,
      type: 'line',
      source: sourceId,
      'source-layer': 'transportation',
      minzoom: 12,
      filter: ['in', 'class', 'minor', 'service', 'street'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': minorRoadColor,
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.7, 15, 3.4],
      },
    },
    {
      id: `${prefix}-road-major-casing`,
      type: 'line',
      source: sourceId,
      'source-layer': 'transportation',
      minzoom: 7,
      filter: ['in', 'class', 'motorway', 'trunk', 'primary', 'secondary', 'tertiary'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': majorRoadCasing,
        'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.1, 11, 2.8, 14, 6.8, 16, 11],
      },
    },
    {
      id: `${prefix}-road-major`,
      type: 'line',
      source: sourceId,
      'source-layer': 'transportation',
      minzoom: 7,
      filter: ['in', 'class', 'primary', 'secondary', 'tertiary'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': majorRoadColor,
        'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.6, 11, 1.8, 14, 5.0, 16, 8.8],
      },
    },
    {
      id: `${prefix}-road-highway`,
      type: 'line',
      source: sourceId,
      'source-layer': 'transportation',
      minzoom: 6,
      filter: ['in', 'class', 'motorway', 'trunk'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': highwayColor,
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.8, 11, 2.4, 14, 5.8, 16, 10],
      },
    },
    {
      id: `${prefix}-boundary`,
      type: 'line',
      source: sourceId,
      'source-layer': 'boundary',
      filter: ['<=', 'admin_level', 4],
      paint: {
        'line-color': boundaryColor,
        'line-width': 1.1,
        'line-dasharray': [3, 2],
        'line-opacity': 0.65,
      },
    },
    {
      id: `${prefix}-water-label`,
      type: 'symbol',
      source: sourceId,
      'source-layer': 'water_name',
      minzoom: 8,
      layout: {
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': ['Noto Sans Italic'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 8, 10, 13, 12],
      },
      paint: {
        'text-color': waterLabelColor,
        'text-halo-color': waterLabelHalo,
        'text-halo-width': 1.5,
      },
    },
    {
      id: `${prefix}-road-label`,
      type: 'symbol',
      source: sourceId,
      'source-layer': 'transportation_name',
      minzoom: 12,
      layout: {
        'symbol-placement': 'line',
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 12, 9.5, 15, 11.5],
      },
      paint: {
        'text-color': roadLabelColor,
        'text-halo-color': roadLabelHalo,
        'text-halo-width': 1.4,
      },
    },
    {
      id: `${prefix}-place-label`,
      type: 'symbol',
      source: sourceId,
      'source-layer': 'place',
      minzoom: 7,
      filter: ['in', 'class', 'city', 'town', 'borough', 'suburb', 'neighbourhood', 'quarter'],
      layout: {
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': ['Noto Sans Bold'],
        'text-size': [
          'interpolate',
          ['linear'],
          ['zoom'],
          7, 10.5,
          11, 12.5,
          14, 14,
        ],
      },
      paint: {
        'text-color': placeLabelColor,
        'text-halo-color': placeLabelHalo,
        'text-halo-width': 1.6,
      },
    },
  ];
}

export const GEOGRAPHIC_LAYER_IDS: Record<'geo-light' | 'geo-dark', readonly string[]> = {
  'geo-light': buildGeographicVectorLayers('geo-light').map(l => l.id),
  'geo-dark': buildGeographicVectorLayers('geo-dark').map(l => l.id),
};

export function buildMapStyleForTheme(themeId: MapVisualThemeId = 'mta'): StyleSpecification {
  const spec = getMapThemeSpec(themeId);
  const isGeo = Boolean(spec.isGeographicBasemap && (themeId === 'geo-light' || themeId === 'geo-dark'));
  return {
    version: 8,
    name: `${spec.label} Map Style`,
    glyphs: OPENFREEMAP_GLYPHS_URL,
    sources: isGeo
      ? {
          [OPENFREEMAP_VECTOR_SOURCE_ID]: {
            type: 'vector',
            url: OPENFREEMAP_VECTOR_SOURCE_URL,
            attribution: 'OpenFreeMap, OpenStreetMap contributors',
          },
        }
      : {},
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: {
          'background-color': isGeo ? spec.landFillColor : spec.waterColor,
        },
      },
      ...(isGeo ? buildGeographicVectorLayers(themeId as 'geo-light' | 'geo-dark') : []),
    ],
  };
}

export const MTA_SUBWAY_MAP_STYLE: StyleSpecification = buildMapStyleForTheme('mta');
export const TAURANAC_HERTZ_SUBWAY_MAP_STYLE: StyleSpecification = buildMapStyleForTheme('tauranac-hertz');
export const IND_SUBWAY_MAP_STYLE: StyleSpecification = buildMapStyleForTheme('ind');
export const GEO_LIGHT_MAP_STYLE: StyleSpecification = buildMapStyleForTheme('geo-light');
export const GEO_DARK_MAP_STYLE: StyleSpecification = buildMapStyleForTheme('geo-dark');
