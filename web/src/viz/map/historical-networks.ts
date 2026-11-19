/**
 * Historical NYC Transit Network Geometry & Elevated Railway Definitions (1929 & 1953).
 *
 * Keeps historical presets accurate by:
 * 1. Stripping post-era routes, stations, and track segments (e.g., Archer Ave, 63rd St,
 *    Second Ave Phase 1, Hudson Yards, Rockaways, Chrystie St, and QBL in 1929).
 * 2. Adding era-accurate subway extensions (e.g., 1953 Jamaica J to 168 St and G to Forest Hills).
 * 3. Providing distinct Historical Elevated Railway corridors (IRT & BMT Els) rendered with
 *    their own elevated trestle schema/styling, distinct from subways and regional commuter rail.
 */

export type HistoricalEra = '1929' | '1953';

export interface HistoricalElevatedSpec {
  readonly id: string;
  readonly name: string;
  readonly badge: string;
  readonly division: 'IRT El' | 'BMT El';
  readonly eras: readonly HistoricalEra[];
  readonly coordinates: readonly [number, number][];
}

export const HISTORICAL_ELEVATED_CORRIDORS: readonly HistoricalElevatedSpec[] = [
  {
    id: 'el-2nd-ave',
    name: '2nd Avenue Elevated (IRT)',
    badge: '2nd Av El',
    division: 'IRT El',
    eras: ['1929'],
    coordinates: [
      [-74.0133, 40.7019], // South Ferry
      [-74.0091, 40.7049], // Hanover Sq
      [-73.9986, 40.7136], // Chatham Sq
      [-73.9923, 40.7166], // Canal St
      [-73.9896, 40.7202], // Grand St
      [-73.9877, 40.7247], // Rivington St
      [-73.9866, 40.7289], // 1 St
      [-73.9845, 40.7319], // 8 St
      [-73.9817, 40.7347], // 14 St
      [-73.9781, 40.7393], // 23 St
      [-73.9742, 40.7448], // 34 St
      [-73.9704, 40.7498], // 42 St
      [-73.9665, 40.7549], // 50 St
      [-73.9628, 40.7595], // 57 St (Queensboro spur)
      [-73.9574, 40.7667], // 65 St
      [-73.9531, 40.7726], // 72 St
      [-73.9491, 40.7782], // 80 St
      [-73.9458, 40.7827], // 86 St
      [-73.9424, 40.7874], // 92 St
      [-73.9390, 40.7920], // 99 St
      [-73.9354, 40.7969], // 105 St
      [-73.9317, 40.8018], // 111 St
      [-73.9285, 40.8062], // 117 St
      [-73.9248, 40.8111], // 125 St
      [-73.9225, 40.8141], // 129 St
    ],
  },
  {
    id: 'el-2nd-ave-queensboro',
    name: '2nd Avenue El Queensboro Bridge & Astoria Branch (IRT)',
    badge: '2nd Av El',
    division: 'IRT El',
    eras: ['1929'],
    coordinates: [
      [-73.9628, 40.7595], // 57 St / 2 Av
      [-73.9522, 40.7568], // Queensboro Bridge
      [-73.9402, 40.7506], // Queensboro Plaza
      [-73.9330, 40.7567], // 39 Av (Astoria)
      [-73.9295, 40.7618], // 36 Av
      [-73.9255, 40.7668], // Broadway (Astoria)
      [-73.9214, 40.7702], // 30 Av
      [-73.9178, 40.7750], // Astoria Blvd
      [-73.9120, 40.7750], // Astoria-Ditmars Blvd
    ],
  },
  {
    id: 'el-3rd-ave',
    name: '3rd Avenue Elevated (IRT)',
    badge: '3rd Av El',
    division: 'IRT El',
    eras: ['1929', '1953'],
    coordinates: [
      [-73.9986, 40.7136], // Chatham Sq
      [-73.9945, 40.7165], // Canal St
      [-73.9930, 40.7192], // Grand St
      [-73.9912, 40.7244], // Houston St
      [-73.9891, 40.7294], // 9 St
      [-73.9869, 40.7336], // 14 St
      [-73.9834, 40.7388], // 23 St
      [-73.9788, 40.7453], // 34 St
      [-73.9749, 40.7506], // 42 St
      [-73.9672, 40.7611], // 59 St
      [-73.9633, 40.7664], // 67 St
      [-73.9592, 40.7720], // 76 St
      [-73.9554, 40.7773], // 84 St
      [-73.9481, 40.7873], // 99 St
      [-73.9445, 40.7921], // 106 St
      [-73.9398, 40.7985], // 116 St
      [-73.9355, 40.8043], // 125 St
      [-73.9334, 40.8072], // 129 St
      [-73.9278, 40.8099], // 133 St
      [-73.9242, 40.8124], // 138 St
      [-73.9195, 40.8152], // 143 St
      [-73.9165, 40.8168], // 149 St-3 Av
      [-73.9114, 40.8211], // 156 St
      [-73.9082, 40.8245], // 161 St
      [-73.9052, 40.8288], // 166 St
      [-73.9036, 40.8323], // 169 St
      [-73.9016, 40.8371], // Claremont Pkwy
      [-73.8995, 40.8419], // 174 St
      [-73.8975, 40.8466], // 177 St (Tremont)
      [-73.8958, 40.8507], // 180 St
      [-73.8938, 40.8551], // 183 St
      [-73.8902, 40.8617], // Fordham Rd
      [-73.8772, 40.8689], // Bronx Park / Botanical Garden
      [-73.8661, 40.8778], // Gun Hill Rd
    ],
  },
  {
    id: 'el-6th-ave',
    name: '6th Avenue Elevated (IRT)',
    badge: '6th Av El',
    division: 'IRT El',
    eras: ['1929'],
    coordinates: [
      [-74.0133, 40.7019], // South Ferry
      [-74.0132, 40.7082], // Rector St
      [-74.0117, 40.7109], // Cortlandt St
      [-74.0087, 40.7155], // Chambers St
      [-74.0068, 40.7222], // Franklin St
      [-74.0033, 40.7285], // Bleecker St
      [-74.0002, 40.7336], // 8 St
      [-73.9970, 40.7376], // 14 St
      [-73.9927, 40.7433], // 23 St
      [-73.9885, 40.7491], // 33 St
      [-73.9844, 40.7547], // 42 St
      [-73.9806, 40.7599], // 50 St
      [-73.9788, 40.7623], // 53 St / 6 Av
      [-73.9765, 40.7654], // 58 St (Central Park South)
    ],
  },
  {
    id: 'el-9th-ave',
    name: '9th Avenue Elevated (IRT)',
    badge: '9th Av El',
    division: 'IRT El',
    eras: ['1929'],
    coordinates: [
      [-74.0133, 40.7019], // South Ferry
      [-74.0132, 40.7082], // Rector St
      [-74.0117, 40.7109], // Cortlandt St
      [-74.0098, 40.7156], // Warren St
      [-74.0094, 40.7219], // Desbrosses St
      [-74.0084, 40.7290], // Houston St
      [-74.0067, 40.7338], // Christopher St
      [-74.0049, 40.7405], // 14 St
      [-74.0014, 40.7466], // 23 St
      [-73.9977, 40.7534], // 34 St
      [-73.9939, 40.7586], // 42 St
      [-73.9854, 40.7698], // 59 St
      [-73.9798, 40.7782], // 72 St
      [-73.9746, 40.7858], // 81 St
      [-73.9681, 40.7950], // 93 St
      [-73.9634, 40.8017], // 104 St
      [-73.9592, 40.8056], // 110 St (Suicide Curve)
      [-73.9547, 40.8052], // 116 St
      [-73.9502, 40.8114], // 125 St
      [-73.9442, 40.8226], // 145 St
      [-73.9372, 40.8299], // 155 St (Polo Grounds)
      [-73.9277, 40.8279], // 161 St-Yankee Stadium
      [-73.9214, 40.8355], // 167 St (Jerome Av)
    ],
  },
  {
    id: 'el-myrtle-ave',
    name: 'Myrtle Avenue Elevated (BMT)',
    badge: 'Myrtle El',
    division: 'BMT El',
    eras: ['1929', '1953'],
    coordinates: [
      [-73.9873, 40.6952], // Bridge-Jay Sts
      [-73.9810, 40.6946], // Navy St
      [-73.9690, 40.6939], // Vanderbilt Av
      [-73.9652, 40.6937], // Washington Av
      [-73.9614, 40.6934], // Grand Av
      [-73.9571, 40.6931], // Franklin Av
      [-73.9513, 40.6942], // Nostrand Av
      [-73.9457, 40.6949], // Tompkins Av
      [-73.9401, 40.6956], // Sumner Av
      [-73.9355, 40.6972], // Broadway-Myrtle
      [-73.9272, 40.6978], // Central Av
      [-73.9197, 40.6986], // Knickerbocker Av
      [-73.9114, 40.6998], // Myrtle-Wyckoff Avs
      [-73.9077, 40.7027], // Seneca Av
      [-73.9031, 40.7044], // Forest Av
      [-73.8958, 40.7061], // Fresh Pond Rd
      [-73.8896, 40.7114], // Middle Village-Metropolitan Av
    ],
  },
  {
    id: 'el-fulton-st',
    name: 'Fulton Street Elevated (BMT)',
    badge: 'Fulton El',
    division: 'BMT El',
    eras: ['1929'],
    coordinates: [
      [-73.9942, 40.7016], // Fulton Ferry / Sands St
      [-73.9896, 40.6932], // Borough Hall
      [-73.9788, 40.6881], // Flatbush Av
      [-73.9565, 40.6806], // Franklin Av
      [-73.9498, 40.6801], // Nostrand Av
      [-73.9325, 40.6789], // Utica Av
      [-73.9199, 40.6780], // Ralph Av
      [-73.9038, 40.6776], // Broadway Junction
      [-73.8819, 40.6758], // Euclid Av
      [-73.8651, 40.6770], // Grant Av
      [-73.8520, 40.6798], // 80 St
      [-73.8371, 40.6834], // Woodhaven Blvd
      [-73.8257, 40.6860], // Lefferts Blvd
    ],
  },
  {
    id: 'el-lexington-bklyn',
    name: 'Lexington Avenue Elevated (Brooklyn BMT)',
    badge: 'Lex El',
    division: 'BMT El',
    eras: ['1929'],
    coordinates: [
      [-73.9614, 40.6934], // Grand Av (Myrtle)
      [-73.9610, 40.6894], // Lexington Av
      [-73.9554, 40.6897], // Franklin Av
      [-73.9495, 40.6902], // Nostrand Av
      [-73.9394, 40.6909], // Sumner Av
      [-73.9317, 40.6915], // Reid Av
      [-73.9222, 40.6893], // Gates Av / Broadway
      [-73.9038, 40.6776], // Broadway Junction
      [-73.8726, 40.6826], // Cypress Hills
    ],
  },
  {
    id: 'el-5th-ave-bklyn',
    name: '5th Avenue Elevated (Brooklyn BMT)',
    badge: '5th Av El',
    division: 'BMT El',
    eras: ['1929'],
    coordinates: [
      [-73.9942, 40.7016], // Fulton Ferry / Brooklyn Bridge
      [-73.9817, 40.6915], // Hudson Av / Myrtle
      [-73.9776, 40.6844], // Atlantic Av / Flatbush
      [-73.9806, 40.6766], // Union St / 5 Av (parallel to 4th Ave)
      [-73.9858, 40.6695], // 9 St / 5 Av
      [-73.9912, 40.6644], // 16 St / 5 Av
      [-73.9958, 40.6594], // 25 St / 5 Av
      [-74.0011, 40.6540], // 36 St / 5 Av
      [-74.0095, 40.6502], // 40 St / 3 Av (parallel to 4th Ave)
      [-74.0138, 40.6463], // 46 St / 3 Av
      [-74.0180, 40.6424], // 52 St / 3 Av
      [-74.0222, 40.6384], // 58 St / 3 Av
      [-74.0258, 40.6349], // 65 St / 3 Av (Bay Ridge)
    ],
  },
  {
    id: 'el-culver-1929',
    name: 'Culver Elevated Line (Brooklyn BMT)',
    badge: 'Culver El',
    division: 'BMT El',
    eras: ['1929'],
    coordinates: [
      [-74.0011, 40.6540], // 36 St / 5 Av junction
      [-73.9946, 40.6463], // 9 Av / 38 St (from 5th Ave El)
      [-73.9891, 40.6416], // Fort Hamilton Pkwy
      [-73.9838, 40.6382], // 13 Av
      [-73.9781, 40.6361], // Ditmas Av
      [-73.9756, 40.6299], // 18 Av
      [-73.9742, 40.6209], // Avenue I
      [-73.9746, 40.6095], // Avenue N
      [-73.9760, 40.6001], // Kings Hwy
      [-73.9777, 40.5920], // Avenue U
      [-73.9794, 40.5844], // Avenue X
      [-73.9812, 40.5774], // Coney Island-Stillwell Av
    ],
  },
  {
    id: 'el-culver-shuttle',
    name: 'Culver Shuttle (9 Av to Ditmas Av)',
    badge: 'Culver',
    division: 'BMT El',
    eras: ['1953'],
    coordinates: [
      [-73.9946, 40.6463], // 9 Av
      [-73.9891, 40.6416], // Fort Hamilton Pkwy
      [-73.9838, 40.6382], // 13 Av
      [-73.9781, 40.6361], // Ditmas Av
    ],
  },
];

const POST_1953_ROUTES = new Set(['Z', 'W', 'T', 'H', 'IBX', '6X', '7X', 'FX']);
const VALID_1929_ROUTES = new Set([
  '1', '2', '3', '4', '5', '6', '7',
  'J', 'L', 'M', 'N', 'Q', 'R', 'S', 'GS', 'FS',
]);

const POST_1953_STATION_IDS = new Set([
  'G05', 'G06', 'G07', // Archer Ave (1988)
  'B04', 'B06', 'B08', // 63rd St Line & Queensbridge (1989/2001)
  'F01',               // Jamaica-179 St (F & E terminate at 169 St in 1953)
  'Q03', 'Q04', 'Q05', // Second Ave Phase 1 (2017)
  '726',               // 34 St-Hudson Yards (2015)
  '301',               // Harlem-148 St (1968)
  'B10',               // 57 St / 6 Av (1968)
  'D22',               // Grand St / Chrystie St (1967)
  'H01', 'H02', 'H03', 'H04', 'H06', 'H07', 'H08', 'H09', 'H10', 'H11', 'H12', 'H13', 'H14', 'H15', // Rockaways (1956)
]);

const POST_1929_QBL_AND_IND_IDS = new Set([
  ...POST_1953_STATION_IDS,
  'D13', // 57 St / 6 Av / 7 Av
  // Queens Blvd Line (opened 1933-1937)
  'G08', 'G09', 'G10', 'G11', 'G12', 'G13', 'G14', 'G15', 'G16', 'G18', 'G19', 'G20', 'G21',
  'F05', 'F06', 'F07', 'F09',
]);

function splitChainByPredicate(
  coords: readonly [number, number][],
  shouldDrop: (lon: number, lat: number) => boolean
): [number, number][][] {
  const result: [number, number][][] = [];
  let current: [number, number][] = [];
  for (const pt of coords) {
    if (shouldDrop(pt[0], pt[1])) {
      if (current.length >= 2) result.push(current);
      current = [];
    } else {
      current.push([pt[0], pt[1]]);
    }
  }
  if (current.length >= 2) result.push(current);
  return result;
}

function clipGeometryByPredicate(
  geometry: GeoJSON.Geometry,
  shouldDrop: (lon: number, lat: number) => boolean
): GeoJSON.Geometry | null {
  const chains: [number, number][][] =
    geometry.type === 'LineString'
      ? [geometry.coordinates as [number, number][]]
      : geometry.type === 'MultiLineString'
        ? (geometry.coordinates as [number, number][][])
        : [];
  const kept: [number, number][][] = [];
  for (const ch of chains) {
    kept.push(...splitChainByPredicate(ch, shouldDrop));
  }
  if (kept.length === 0) return null;
  if (geometry.type === 'MultiLineString') {
    return { type: 'MultiLineString', coordinates: kept };
  }
  if (kept.length === 1) {
    return { type: 'LineString', coordinates: kept[0]! };
  }
  return { type: 'MultiLineString', coordinates: kept };
}

function appendChainsToGeometry(
  geometry: GeoJSON.Geometry,
  extraChains: readonly [number, number][][]
): GeoJSON.Geometry {
  const baseChains: [number, number][][] =
    geometry.type === 'LineString'
      ? [geometry.coordinates as [number, number][]]
      : geometry.type === 'MultiLineString'
        ? [...(geometry.coordinates as [number, number][][])]
        : [];
  const combined = [...baseChains, ...extraChains.map(c => c.map(p => [p[0], p[1]] as [number, number]))];
  if (combined.length === 1) {
    return { type: 'LineString', coordinates: combined[0]! };
  }
  return { type: 'MultiLineString', coordinates: combined };
}

const JAMAICA_168_EXTENSION: [number, number][] = [
  [-73.8283, 40.7005], // 121 St (Jamaica Av)
  [-73.8142, 40.7027], // Queens Blvd / Sutphin Blvd (Jamaica Av)
  [-73.7995, 40.7048], // 160 St
  [-73.7936, 40.7070], // 168 St (Jamaica Terminal)
];

const G_FOREST_HILLS_EXTENSION: [number, number][] = [
  [-73.9452, 40.7470], // Court Sq
  [-73.9372, 40.7489], // Queens Plaza
  [-73.9296, 40.7520], // 36 St
  [-73.9207, 40.7569], // Steinway St
  [-73.9133, 40.7563], // 46 St
  [-73.9060, 40.7529], // Northern Blvd
  [-73.8985, 40.7497], // 65 St
  [-73.8913, 40.7466], // Jackson Hts-Roosevelt Av
  [-73.8820, 40.7425], // Elmhurst Av
  [-73.8772, 40.7401], // Grand Av-Newtown
  [-73.8692, 40.7331], // Woodhaven Blvd
  [-73.8613, 40.7298], // 63 Dr-Rego Park
  [-73.8527, 40.7265], // 67 Av
  [-73.8445, 40.7217], // Forest Hills-71 Av
];

const F_53RD_ST_1953_TUNNEL: [number, number][] = [
  [-73.9813, 40.7586], // 47-50 Sts-Rockefeller Ctr
  [-73.9752, 40.7602], // 5 Av / 53 St
  [-73.9691, 40.7576], // Lexington Av / 53 St
  [-73.9489, 40.7478], // Court Sq-23 St
  [-73.9372, 40.7489], // Queens Plaza
  [-73.9296, 40.7520], // 36 St (Queens Blvd)
];

const N_60TH_ST_QUEENSBORO_1929: [number, number][] = [
  [-73.9679, 40.7625], // Lexington Av / 59 St
  [-73.9540, 40.7570], // 60th St East River Tunnel
  [-73.9402, 40.7506], // Queensboro Plaza (1929 terminal)
];

const M_MYRTLE_EL_ONLY: [number, number][] = [
  [-73.9873, 40.6952], // Bridge-Jay Sts (Downtown Brooklyn)
  [-73.9810, 40.6946], // Navy St
  [-73.9690, 40.6939], // Vanderbilt Av
  [-73.9652, 40.6937], // Washington Av
  [-73.9614, 40.6934], // Grand Av
  [-73.9571, 40.6931], // Franklin Av
  [-73.9513, 40.6942], // Nostrand Av
  [-73.9457, 40.6949], // Tompkins Av
  [-73.9401, 40.6956], // Sumner Av
  [-73.9355, 40.6972], // Broadway-Myrtle
  [-73.9272, 40.6978], // Central Av
  [-73.9197, 40.6986], // Knickerbocker Av
  [-73.9114, 40.6998], // Myrtle-Wyckoff Avs
  [-73.9077, 40.7027], // Seneca Av
  [-73.9031, 40.7044], // Forest Av
  [-73.8958, 40.7061], // Fresh Pond Rd
  [-73.8896, 40.7114], // Middle Village-Metropolitan Av
];

const SOUTH_FERRY_LOOP_5: [number, number][] = [
  [-74.0141, 40.7048], // Bowling Green
  [-74.0133, 40.7019], // South Ferry Loop
];

const CITY_HALL_LOOP_1929: [number, number][] = [
  [-74.0041, 40.7131], // Brooklyn Bridge-City Hall
  [-74.0058, 40.7133], // City Hall Loop
  [-74.0048, 40.7124], // Loop return
];

export function filterHistoricalServiceLines(
  features: readonly GeoJSON.Feature[],
  era: HistoricalEra
): GeoJSON.Feature[] {
  const out: GeoJSON.Feature[] = [];
  for (const feat of features) {
    const props = (feat.properties ?? {}) as Record<string, unknown>;
    const routeId = String(props['route_id'] ?? props['service_line'] ?? '').trim().toUpperCase();
    if (!routeId || !feat.geometry) continue;

    if (era === '1953' && POST_1953_ROUTES.has(routeId)) continue;
    if (era === '1929' && !VALID_1929_ROUTES.has(routeId)) continue;

    // M in both 1929 and 1953 is strictly the Myrtle El (never shares Williamsburg Bridge / Marcy Av with J, 6th Ave, or QBL)
    if (routeId === 'M') {
      const mGeom: GeoJSON.Geometry =
        feat.geometry.type === 'MultiLineString'
          ? { type: 'MultiLineString', coordinates: [M_MYRTLE_EL_ONLY.map(p => [p[0], p[1]])] }
          : { type: 'LineString', coordinates: M_MYRTLE_EL_ONLY.map(p => [p[0], p[1]]) };
      out.push({ ...feat, geometry: mGeom });
      continue;
    }

    let geom: GeoJSON.Geometry | null = feat.geometry;

    const dropCommonPostEra = (lon: number, lat: number): boolean => {
      // Archer Ave (1988) & Jamaica 121 St east cut before single 168 St extension
      if ((routeId === 'E' || routeId === 'J') && lon > -73.816 && lat < 40.7065) return true;
      if (routeId === 'J' && lon > -73.827) return true;
      if (routeId === 'E' && lon > -73.820 && lat < 40.713) return true;
      // Jamaica-179 St (exclude east of 169 St on F/E in 1953)
      if (era === '1953' && (routeId === 'F' || routeId === 'E') && lon > -73.792 && lat > 40.708) return true;
      // 63rd St Tunnel/Line, Roosevelt Island, 57 St/6 Av, and 21 St-Queensbridge (1968-2001)
      if ((routeId === 'F' || routeId === 'Q') && lat >= 40.751 && lat <= 40.770 && lon >= -73.980 && lon <= -73.931) return true;
      // Second Ave Subway Phase 1 (2017)
      if (routeId === 'Q' && lat > 40.766 && lon > -74.00 && lon < -73.93) return true;
      // 34 St-Hudson Yards (2015)
      if (routeId === '7' && lon < -73.989) return true;
      // Rockaways (1956)
      if (routeId === 'A' && lat < 40.678 && lon > -73.86) return true;
      // No Chrystie St connection (1967): keep Manhattan Bridge for Broadway (N/Q) & Nassau (J), not B/D to 6th Ave
      if ((routeId === 'B' || routeId === 'D') && lon > -73.998 && lon < -73.982 && lat >= 40.700 && lat <= 40.724) return true;
      // 1929: no Queens Blvd Line for R (R never enters Queens in 1929); N crosses 59th/60th St Tunnel to Queensboro Plaza & terminates there (2nd Ave El serves Astoria); L ends at 6th Ave (8th Ave opened 1931)
      if (era === '1929' && routeId === 'R' && lon > -73.956 && lat > 40.705) return true;
      if (era === '1929' && routeId === 'N' && lon > -73.9395) return true;
      if (era === '1929' && routeId === 'L' && lon < -73.9975) return true;
      return false;
    };

    geom = clipGeometryByPredicate(geom, dropCommonPostEra);

    const fallbackGeom = (chain: [number, number][]): GeoJSON.Geometry =>
      feat.geometry.type === 'MultiLineString'
        ? { type: 'MultiLineString', coordinates: [chain.map(p => [p[0], p[1]])] }
        : { type: 'LineString', coordinates: chain.map(p => [p[0], p[1]]) };

    if (era === '1953') {
      if (routeId === 'J') {
        geom = geom ? appendChainsToGeometry(geom, [JAMAICA_168_EXTENSION]) : fallbackGeom(JAMAICA_168_EXTENSION);
      } else if (routeId === 'G') {
        geom = geom ? appendChainsToGeometry(geom, [G_FOREST_HILLS_EXTENSION]) : fallbackGeom(G_FOREST_HILLS_EXTENSION);
      } else if (routeId === 'F') {
        geom = geom ? appendChainsToGeometry(geom, [F_53RD_ST_1953_TUNNEL]) : fallbackGeom(F_53RD_ST_1953_TUNNEL);
      } else if (routeId === '5' && geom) {
        geom = appendChainsToGeometry(geom, [SOUTH_FERRY_LOOP_5]);
      }
    } else if (era === '1929') {
      if (routeId === 'J') {
        geom = geom ? appendChainsToGeometry(geom, [JAMAICA_168_EXTENSION]) : fallbackGeom(JAMAICA_168_EXTENSION);
      } else if (routeId === 'N') {
        geom = geom ? appendChainsToGeometry(geom, [N_60TH_ST_QUEENSBORO_1929]) : fallbackGeom(N_60TH_ST_QUEENSBORO_1929);
      } else if (routeId === '5' && geom) {
        geom = appendChainsToGeometry(geom, [SOUTH_FERRY_LOOP_5]);
      } else if (routeId === '6' && geom) {
        geom = appendChainsToGeometry(geom, [CITY_HALL_LOOP_1929]);
      }
    }
    if (!geom) continue;

    out.push({
      ...feat,
      geometry: geom,
    });
  }
  return out;
}

export function filterHistoricalStations(
  features: readonly GeoJSON.Feature[],
  era: HistoricalEra
): GeoJSON.Feature[] {
  return features.filter(feat => {
    const props = (feat.properties ?? {}) as Record<string, unknown>;
    const stopId = String(props['gtfs_stop_id'] ?? props['station_id'] ?? '').trim().toUpperCase();
    const name = String(props['name'] ?? '').trim();
    const routesRaw = String(props['daytime_routes'] ?? props['routes'] ?? '').trim();

    if (era === '1953') {
      if (POST_1953_STATION_IDS.has(stopId)) return false;
      if (/queensbridge|roosevelt\s*island|63\s*st|179\s*st|archer|hudson\s*yards|harlem.*148/i.test(name)) {
        return false;
      }
      const tokens = routesRaw.split(/[\s,]+/).filter(Boolean).map(t => t.toUpperCase());
      if (tokens.length > 0 && tokens.every(t => POST_1953_ROUTES.has(t))) return false;
      return true;
    }

    // 1929: exclude IND / post-1929 stations, QBL, and L 8th Ave (opened 1931)
    if (POST_1929_QBL_AND_IND_IDS.has(stopId) || stopId === 'L01') return false;
    if (/^[ABDFGH]/.test(stopId) && !stopId.startsWith('B1') && !stopId.startsWith('B2')) {
      // Allow BMT West End/Sea Beach/4th Ave B-prefixed stations, exclude IND A/D/F/G/H
      if (/^[ADFGH]/.test(stopId)) return false;
    }
    if (routesRaw) {
      const tokens = routesRaw.split(/[\s,]+/).filter(Boolean).map(t => t.toUpperCase());
      if (tokens.length > 0 && tokens.every(t => !VALID_1929_ROUTES.has(t))) return false;
    }
    return true;
  });
}

export function buildHistoricalElevatedGeoJson(era: HistoricalEra): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: HISTORICAL_ELEVATED_CORRIDORS
      .filter(spec => spec.eras.includes(era))
      .map(spec => ({
        type: 'Feature' as const,
        properties: {
          id: spec.id,
          name: spec.name,
          badge: spec.badge,
          division: spec.division,
          era,
          structure: 'elevated',
        },
        geometry: {
          type: 'LineString' as const,
          coordinates: spec.coordinates.map(pt => [pt[0], pt[1]]),
        },
      })),
  };
}

export const QUEENSLINK_M_EXTENSION: [number, number][] = [
  [-73.8616, 40.7298], // 63 Dr-Rego Park (QBL)
  [-73.8565, 40.7262], // Whitepot Junction (67 Av / 98 St)
  [-73.8536, 40.7195], // Fleet St / Yellowstone Blvd (98 St corridor)
  [-73.8520, 40.7130], // Metropolitan Av (QueensLink)
  [-73.8505, 40.7042], // Myrtle Av / Forest Park (QueensLink)
  [-73.8477, 40.6950], // Jamaica Av / Woodhaven
  [-73.8455, 40.6890], // Atlantic Av-Woodhaven (QueensLink)
  [-73.8412, 40.6808], // Liberty Av-Rockaway Blvd (QueensLink)
  [-73.8358, 40.6721], // Aqueduct Racetrack
  [-73.8342, 40.6682], // Aqueduct-North Conduit Av
  [-73.8303, 40.6605], // Howard Beach-JFK Airport
  [-73.8159, 40.6084], // Broad Channel
  [-73.8136, 40.5880], // Beach 90 St
  [-73.8206, 40.5853], // Beach 98 St
  [-73.8278, 40.5832], // Beach 105 St
  [-73.8356, 40.5801], // Rockaway Park-Beach 116 St
];

export const PENN_ACCESS_MNR_CORRIDOR: [number, number][] = [
  [-73.9935, 40.7506], // New York Penn Station
  [-73.9720, 40.7475], // East River Tunnel (33 St / 1 Av)
  [-73.9520, 40.7448], // Long Island City / Hunterspoint Av
  [-73.9340, 40.7488], // Sunnyside Yard
  [-73.9185, 40.7525], // Woodside / Northern Blvd (Hell Gate Line)
  [-73.9105, 40.7615], // Astoria / 46-49 St viaduct
  [-73.9135, 40.7720], // Astoria Blvd / 31-33 St curve
  [-73.9217, 40.7827], // Hell Gate Bridge
  [-73.9210, 40.7935], // Randalls Island viaduct
  [-73.9145, 40.7995], // Bronx Kill / Port Morris
  [-73.9030, 40.8065], // Oak Point / Leggett Av
  [-73.8900, 40.8170], // Hunts Point (MNR Penn Access)
  [-73.8780, 40.8295], // Bronx River crossing
  [-73.8675, 40.8385], // West Farms / E 177 St
  [-73.8580, 40.8430], // Parkchester / Van Nest (MNR Penn Access)
  [-73.8450, 40.8460], // Morris Park (MNR Penn Access)
  [-73.8390, 40.8585], // Pelham Pkwy / Hutchinson River Pkwy
  [-73.8320, 40.8750], // Co-op City (MNR Penn Access)
  [-73.8160, 40.8895], // Pelham Bay / Baychester
  [-73.7840, 40.9114], // New Rochelle (New Haven Line)
];

export const PROPOSED_EXTRA_STATIONS: ReadonlyArray<{
  stationId: string;
  name: string;
  borough: string;
  lon: number;
  lat: number;
  routes: string[];
}> = [
  { stationId: 'QL01', name: 'Metropolitan Av (QueensLink)', borough: 'Queens', lon: -73.8520, lat: 40.7130, routes: ['M'] },
  { stationId: 'QL02', name: 'Atlantic Av-Woodhaven (QueensLink)', borough: 'Queens', lon: -73.8455, lat: 40.6890, routes: ['M'] },
  { stationId: 'QL03', name: 'Liberty Av-Rockaway Blvd (QueensLink)', borough: 'Queens', lon: -73.8412, lat: 40.6808, routes: ['M'] },
  { stationId: 'PSA01', name: 'Hunts Point (MNR Penn Access)', borough: 'Bronx', lon: -73.8900, lat: 40.8170, routes: ['MNR'] },
  { stationId: 'PSA02', name: 'Parkchester / Van Nest (MNR Penn Access)', borough: 'Bronx', lon: -73.8580, lat: 40.8430, routes: ['MNR'] },
  { stationId: 'PSA03', name: 'Morris Park (MNR Penn Access)', borough: 'Bronx', lon: -73.8450, lat: 40.8460, routes: ['MNR'] },
  { stationId: 'PSA04', name: 'Co-op City (MNR Penn Access)', borough: 'Bronx', lon: -73.8320, lat: 40.8750, routes: ['MNR'] },
];

export function applyProposedServiceLines(features: readonly GeoJSON.Feature[]): GeoJSON.Feature[] {
  return features.map(feat => {
    const props = (feat.properties ?? {}) as Record<string, unknown>;
    const routeId = String(props['route_id'] ?? props['service_line'] ?? '').trim().toUpperCase();
    if (routeId === 'M' && feat.geometry) {
      return {
        ...feat,
        geometry: appendChainsToGeometry(feat.geometry, [QUEENSLINK_M_EXTENSION]),
      };
    }
    return feat;
  });
}
