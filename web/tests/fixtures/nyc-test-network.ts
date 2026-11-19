import mtaServiceLinesData from './mta-service-lines.json';
import nycBoroughsData from './nyc-boroughs.json';
import { CANONICAL_MTA_STATIONS } from './nyc-test-stations.js';
import {
  buildDefaultMapRoutes,
  setActiveMapNetworkData,
  type AuxiliaryCorridorSpec,
  type CorridorStopInfo,
  type MapNetworkData,
} from '../../src/viz/map/mta-subway-overlay.js';

export const TEST_REGIONAL_LAND_FEATURES: GeoJSON.Feature[] = [
  {
    type: 'Feature',
    properties: { name: 'Long Island', kind: 'regional_land' },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-73.75, 40.58],
        [-73.75, 40.82],
        [-73.40, 40.94],
        [-72.80, 41.00],
        [-72.10, 41.15],
        [-71.82, 41.09],
        [-71.82, 40.98],
        [-72.30, 40.82],
        [-73.10, 40.62],
        [-73.75, 40.58],
      ]],
    },
  },
  {
    type: 'Feature',
    properties: { name: 'Westchester & Connecticut', kind: 'regional_land' },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-74.05, 40.88],
        [-74.05, 42.00],
        [-72.80, 42.00],
        [-72.80, 41.10],
        [-73.60, 40.98],
        [-73.78, 40.88],
        [-74.05, 40.88],
      ]],
    },
  },
  {
    type: 'Feature',
    properties: { name: 'New Jersey', kind: 'regional_land' },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-74.90, 40.45],
        [-74.90, 41.60],
        [-73.92, 41.60],
        [-73.92, 41.20],
        [-74.005, 40.85],
        [-74.024, 40.735],
        [-74.045, 40.695],
        [-74.12, 40.70],
        [-74.16, 40.69],
        [-74.18, 40.66],
        [-74.16, 40.63],
        [-74.26, 40.48],
        [-74.90, 40.45],
      ]],
    },
  },
];

export const TEST_AUXILIARY_CORRIDORS: AuxiliaryCorridorSpec[] = [
  {
    id: 'MNR_HUD',
    agencyId: 'MTA_METRO_NORTH',
    badge: 'HUD',
    name: 'Hudson Line',
    colorHex: '#009B3A',
    aliases: ['MTA_METRO_NORTH:1', 'MTA_METRO_NORTH:HUD', 'HUD'],
    chains: [[[-73.9772, 40.7527], [-73.9658, 40.7646], [-73.9301, 40.8255], [-73.9022, 40.9356], [-73.8680, 41.0760], [-73.9380, 41.7060]]],
  },
  {
    id: 'MNR_HAR',
    agencyId: 'MTA_METRO_NORTH',
    badge: 'HAR',
    name: 'Harlem Line',
    colorHex: '#0039A6',
    aliases: ['MTA_METRO_NORTH:2', 'MTA_METRO_NORTH:HAR', 'HAR'],
    chains: [[[-73.9772, 40.7527], [-73.9180, 40.8250], [-73.8350, 40.9380], [-73.7746, 41.0332], [-73.6800, 41.2500]]],
  },
  {
    id: 'MNR_NH',
    agencyId: 'MTA_METRO_NORTH',
    badge: 'NH',
    name: 'New Haven Line',
    colorHex: '#EE0034',
    aliases: ['MTA_METRO_NORTH:3', 'MTA_METRO_NORTH:NH', 'NH'],
    chains: [[[-73.9772, 40.7527], [-73.8350, 40.9100], [-73.7820, 40.9110], [-73.5418, 41.0468], [-72.9260, 41.2980]]],
  },
  {
    id: 'LIRR_CTZ',
    agencyId: 'MTA_LIRR',
    badge: 'CTZ',
    name: 'City Terminal Zone',
    colorHex: '#4D5357',
    aliases: ['MTA_LIRR:12', 'MTA_LIRR:CTZ', 'CTZ'],
    chains: [
      [[-73.9910, 40.7506], [-73.9540, 40.7440], [-73.9305, 40.7484], [-73.9029, 40.7458], [-73.8087, 40.6996]],
      [[-73.9772, 40.7527], [-73.9658, 40.7646], [-73.9577, 40.7610], [-73.9305, 40.7484], [-73.9225, 40.7472], [-73.9029, 40.7458]],
      [[-73.9785, 40.6842], [-73.9488, 40.6784], [-73.9032, 40.6755], [-73.8087, 40.6996]],
    ],
  },
  {
    id: 'LIRR_PW',
    agencyId: 'MTA_LIRR',
    badge: 'PW',
    name: 'Port Washington Branch',
    colorHex: '#C60C30',
    aliases: ['MTA_LIRR:9', 'MTA_LIRR:PW', 'PW'],
    chains: [
      [[-73.9910, 40.7506], [-73.9305, 40.7484], [-73.9029, 40.7458], [-73.8310, 40.7580], [-73.6810, 40.8290]],
      [[-73.9772, 40.7527], [-73.9658, 40.7646], [-73.9577, 40.7610], [-73.9305, 40.7484], [-73.9225, 40.7472], [-73.9029, 40.7458]],
    ],
  },
  {
    id: 'LIRR_BAB',
    agencyId: 'MTA_LIRR',
    badge: 'BAB',
    name: 'Babylon Branch',
    colorHex: '#00985F',
    aliases: ['MTA_LIRR:1', 'MTA_LIRR:BAB', 'BAB'],
    chains: [
      [[-73.9785, 40.6842], [-73.9488, 40.6784], [-73.9032, 40.6755], [-73.8087, 40.6996], [-73.5880, 40.6550], [-73.3240, 40.7000]],
    ],
  },
  {
    id: 'LIRR_RON',
    agencyId: 'MTA_LIRR',
    badge: 'RON',
    name: 'Ronkonkoma Branch',
    colorHex: '#A626AA',
    aliases: ['MTA_LIRR:10', 'MTA_LIRR:RON', 'RON'],
    chains: [
      [[-73.9910, 40.7506], [-73.8087, 40.6996], [-73.6412, 40.7403], [-73.1155, 40.8080], [-72.6620, 40.9170]],
    ],
  },
  {
    id: 'PATH_NWK',
    agencyId: 'PORT_AUTHORITY_PATH',
    badge: 'NWK',
    name: 'PATH Newark - World Trade Center',
    colorHex: '#D93A30',
    aliases: ['PORT_AUTHORITY_PATH:NWK', 'PORT_AUTHORITY_PATH:859', 'NWK', '859'],
    chains: [[[-74.1640, 40.7347], [-74.0630, 40.7320], [-74.0340, 40.7195], [-74.0110, 40.7126]]],
  },
  {
    id: 'PATH_JSQ',
    agencyId: 'PORT_AUTHORITY_PATH',
    badge: 'JSQ',
    name: 'PATH Journal Square - 33rd Street',
    colorHex: '#FF9900',
    aliases: ['PORT_AUTHORITY_PATH:JSQ', 'PORT_AUTHORITY_PATH:860', 'JSQ', '860'],
    chains: [[[-74.0630, 40.7320], [-74.0340, 40.7195], [-74.0050, 40.7365], [-73.9885, 40.7490]]],
  },
  {
    id: 'PATH_H33',
    agencyId: 'PORT_AUTHORITY_PATH',
    badge: 'H33',
    name: 'PATH Hoboken - 33rd Street',
    colorHex: '#00629B',
    aliases: ['PORT_AUTHORITY_PATH:H33', 'PORT_AUTHORITY_PATH:861', 'H33', '861'],
    chains: [[[-74.0285, 40.7350], [-74.0050, 40.7365], [-73.9970, 40.7430], [-73.9885, 40.7490]]],
  },
  {
    id: 'PATH_HWT',
    agencyId: 'PORT_AUTHORITY_PATH',
    badge: 'HWT',
    name: 'PATH Hoboken - World Trade Center',
    colorHex: '#009E49',
    aliases: ['PORT_AUTHORITY_PATH:HWT', 'PORT_AUTHORITY_PATH:862', 'HWT', '862'],
    chains: [[[-74.0285, 40.7350], [-74.0340, 40.7195], [-74.0110, 40.7126]]],
  },
  {
    id: 'MTA_BUS_M60_SBS',
    agencyId: 'MTA_BUS',
    badge: 'M60-SBS',
    name: 'M60 Select Bus Service (106 St / Broadway - LaGuardia Airport)',
    colorHex: '#0079C2',
    aliases: ['MTA_BUS:M60-SBS', 'MTA_BUS:M60+', 'M60-SBS', 'M60+'],
    chains: [[
      [-73.9682, 40.8015],
      [-73.9600, 40.8094],
      [-73.9525, 40.8111],
      [-73.9454, 40.8077],
      [-73.9375, 40.8042],
      [-73.9225, 40.7772],
      [-73.9178, 40.7703],
      [-73.9102, 40.7681],
      [-73.8895, 40.7646],
      [-73.8856, 40.7723],
      [-73.8721, 40.7744],
      [-73.8634, 40.7702],
    ]],
  },
];

export const TEST_CORRIDOR_STOPS: Readonly<Record<string, readonly CorridorStopInfo[]>> = {
  'M60-SBS': [
    { stopId: 'M60_BWAY_106', name: 'W 106 St / Broadway', lat: 40.8015, lon: -73.9682 },
    { stopId: 'M60_125_STN', name: 'W 125 St / St Nicholas Av', lat: 40.8111, lon: -73.9525 },
    { stopId: 'M60_125_LEX', name: 'E 125 St / Lexington Av', lat: 40.8042, lon: -73.9375 },
    { stopId: 'M60_ASTORIA_NW', name: 'Astoria Blvd / 31 St (N/W)', lat: 40.7703, lon: -73.9178 },
    { stopId: 'M60_LGA_TERMB', name: 'LaGuardia Airport / Terminal B', lat: 40.7744, lon: -73.8721 },
  ],
};

export function buildNycTestNetworkData(): MapNetworkData {
  return {
    routes: buildDefaultMapRoutes(),
    serviceLines: mtaServiceLinesData as unknown as GeoJSON.FeatureCollection,
    stations: { ...CANONICAL_MTA_STATIONS },
    landFeatures: {
      type: 'FeatureCollection',
      features: [
        ...(((nycBoroughsData as unknown as GeoJSON.FeatureCollection).features ?? []).filter(
          f => String((f.properties as any)?.name ?? '') !== 'New Jersey'
        )),
        ...TEST_REGIONAL_LAND_FEATURES,
      ],
    },
    parkFeatures: { type: 'FeatureCollection', features: [] },
    auxiliaryCorridors: TEST_AUXILIARY_CORRIDORS,
    corridorStops: TEST_CORRIDOR_STOPS,
    config: {
      routesTable: 'prod.transit_v2.view_dim_routes',
      tracksTable: 'prod.transit_v2.view_dim_service_lines',
      stationsTable: 'prod.transit_v2.view_dim_stations',
      theme: 'mta',
    },
  };
}

export function setupNycTestNetwork(): MapNetworkData {
  const net = buildNycTestNetworkData();
  setActiveMapNetworkData(net);
  return net;
}
