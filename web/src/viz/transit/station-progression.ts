import type { EChartsOption } from 'echarts';
import {
  resolveRouteColor,
  buildRouteBulletSvgDataUri,
  buildRouteBulletHtml,
} from '../echarts-theme-mta.js';

export interface StationProgressionOptions {
  metricColumn?: string;
  alignmentMode?: 'corridor' | 'normalized';
  showBoroughBands?: boolean;
  showStationLabels?: boolean;
}

// Canonical NYC Subway GTFS station ID to human-readable name and borough mapping
export const KNOWN_NYC_STATION_NAMES: Record<string, { name: string; borough: string }> = {
  // 1 / 2 / 3 line (Broadway - 7th Ave)
  '101': { name: 'Van Cortlandt Park-242 St', borough: 'Bronx' },
  '103': { name: '238 St', borough: 'Bronx' },
  '104': { name: '231 St', borough: 'Bronx' },
  '106': { name: 'Marble Hill-225 St', borough: 'Manhattan' },
  '107': { name: '215 St', borough: 'Manhattan' },
  '108': { name: '207 St', borough: 'Manhattan' },
  '109': { name: 'Dyckman St', borough: 'Manhattan' },
  '110': { name: '191 St', borough: 'Manhattan' },
  '111': { name: '181 St', borough: 'Manhattan' },
  '112': { name: '168 St-Washington Hts', borough: 'Manhattan' },
  '113': { name: '157 St', borough: 'Manhattan' },
  '114': { name: '145 St', borough: 'Manhattan' },
  '115': { name: '137 St-City College', borough: 'Manhattan' },
  '116': { name: '125 St', borough: 'Manhattan' },
  '117': { name: '116 St-Columbia Univ', borough: 'Manhattan' },
  '118': { name: 'Cathedral Pkwy (110 St)', borough: 'Manhattan' },
  '119': { name: '103 St', borough: 'Manhattan' },
  '120': { name: '96 St', borough: 'Manhattan' },
  '121': { name: '86 St', borough: 'Manhattan' },
  '122': { name: '79 St', borough: 'Manhattan' },
  '123': { name: '72 St', borough: 'Manhattan' },
  '124': { name: '66 St-Lincoln Ctr', borough: 'Manhattan' },
  '125': { name: '59 St-Columbus Circle', borough: 'Manhattan' },
  '126': { name: '50 St', borough: 'Manhattan' },
  '127': { name: 'Times Sq-42 St', borough: 'Manhattan' },
  '128': { name: '34 St-Penn Station', borough: 'Manhattan' },
  '129': { name: '28 St', borough: 'Manhattan' },
  '130': { name: '23 St', borough: 'Manhattan' },
  '131': { name: '18 St', borough: 'Manhattan' },
  '132': { name: '14 St', borough: 'Manhattan' },
  '133': { name: 'Christopher St-Sheridan Sq', borough: 'Manhattan' },
  '134': { name: 'Houston St', borough: 'Manhattan' },
  '135': { name: 'Canal St', borough: 'Manhattan' },
  '136': { name: 'Franklin St', borough: 'Manhattan' },
  '137': { name: 'Chambers St', borough: 'Manhattan' },
  '138': { name: 'WTC Cortlandt', borough: 'Manhattan' },
  '139': { name: 'Rector St', borough: 'Manhattan' },
  '142': { name: 'South Ferry', borough: 'Manhattan' },

  // 4 / 5 / 6 line (Jerome Ave, Pelham, White Plains Rd, Dyre Ave & Lexington Ave)
  '401': { name: 'Woodlawn', borough: 'Bronx' },
  '402': { name: 'Mosholu Pkwy', borough: 'Bronx' },
  '405': { name: 'Bedford Park Blvd-Lehman College', borough: 'Bronx' },
  '406': { name: 'Kingsbridge Rd', borough: 'Bronx' },
  '407': { name: 'Fordham Rd', borough: 'Bronx' },
  '408': { name: '183 St', borough: 'Bronx' },
  '409': { name: 'Burnside Av', borough: 'Bronx' },
  '410': { name: '176 St', borough: 'Bronx' },
  '411': { name: 'Mt Eden Av', borough: 'Bronx' },
  '412': { name: '170 St', borough: 'Bronx' },
  '413': { name: '167 St', borough: 'Bronx' },
  '414': { name: '161 St-Yankee Stadium', borough: 'Bronx' },
  '415': { name: '149 St-Grand Concourse', borough: 'Bronx' },
  '416': { name: '138 St-Grand Concourse', borough: 'Bronx' },
  '201': { name: 'Wakefield-241 St', borough: 'Bronx' },
  '204': { name: 'Nereid Av', borough: 'Bronx' },
  '205': { name: '233 St', borough: 'Bronx' },
  '206': { name: '225 St', borough: 'Bronx' },
  '207': { name: '219 St', borough: 'Bronx' },
  '208': { name: 'Gun Hill Rd', borough: 'Bronx' },
  '209': { name: 'Burke Av', borough: 'Bronx' },
  '210': { name: 'Allerton Av', borough: 'Bronx' },
  '211': { name: 'Pelham Pkwy', borough: 'Bronx' },
  '212': { name: 'Bronx Park East', borough: 'Bronx' },
  '213': { name: 'E 180 St', borough: 'Bronx' },
  '214': { name: 'West Farms Sq-E Tremont Av', borough: 'Bronx' },
  '215': { name: '174 St', borough: 'Bronx' },
  '216': { name: 'Freeman St', borough: 'Bronx' },
  '217': { name: 'Simpson St', borough: 'Bronx' },
  '218': { name: 'Intervale Av', borough: 'Bronx' },
  '219': { name: 'Prospect Av', borough: 'Bronx' },
  '220': { name: 'Jackson Av', borough: 'Bronx' },
  '221': { name: '3 Av-149 St', borough: 'Bronx' },
  '222': { name: '149 St-Grand Concourse', borough: 'Bronx' },
  '501': { name: 'Eastchester-Dyre Av', borough: 'Bronx' },
  '502': { name: 'Baychester Av', borough: 'Bronx' },
  '503': { name: 'Gun Hill Rd', borough: 'Bronx' },
  '504': { name: 'Pelham Pkwy', borough: 'Bronx' },
  '505': { name: 'Morris Park', borough: 'Bronx' },
  '601': { name: 'Pelham Bay Park', borough: 'Bronx' },
  '602': { name: 'Buhre Av', borough: 'Bronx' },
  '603': { name: 'Middletown Rd', borough: 'Bronx' },
  '604': { name: 'Westchester Sq-E Tremont Av', borough: 'Bronx' },
  '606': { name: 'Zerega Av', borough: 'Bronx' },
  '607': { name: 'Castle Hill Av', borough: 'Bronx' },
  '608': { name: 'Parkchester', borough: 'Bronx' },
  '609': { name: 'St Lawrence Av', borough: 'Bronx' },
  '610': { name: 'Morrison Av-Soundview', borough: 'Bronx' },
  '611': { name: 'Elder Av', borough: 'Bronx' },
  '612': { name: 'Whitlock Av', borough: 'Bronx' },
  '613': { name: 'Hunts Point Av', borough: 'Bronx' },
  '614': { name: 'Longwood Av', borough: 'Bronx' },
  '615': { name: 'E 149 St', borough: 'Bronx' },
  '616': { name: "E 143 St-St Mary's St", borough: 'Bronx' },
  '617': { name: 'Cypress Av', borough: 'Bronx' },
  '618': { name: 'Brook Av', borough: 'Bronx' },
  '619': { name: '3 Av-138 St', borough: 'Bronx' },
  '621': { name: '125 St', borough: 'Manhattan' },
  '622': { name: '116 St', borough: 'Manhattan' },
  '623': { name: '110 St', borough: 'Manhattan' },
  '624': { name: '103 St', borough: 'Manhattan' },
  '625': { name: '96 St', borough: 'Manhattan' },
  '626': { name: '86 St', borough: 'Manhattan' },
  '627': { name: '77 St', borough: 'Manhattan' },
  '628': { name: '68 St-Hunter College', borough: 'Manhattan' },
  '629': { name: '59 St', borough: 'Manhattan' },
  '630': { name: '51 St', borough: 'Manhattan' },
  '631': { name: 'Grand Central-42 St', borough: 'Manhattan' },
  '632': { name: '33 St', borough: 'Manhattan' },
  '633': { name: '28 St', borough: 'Manhattan' },
  '634': { name: '23 St', borough: 'Manhattan' },
  '635': { name: '14 St-Union Sq', borough: 'Manhattan' },
  '636': { name: 'Astor Pl', borough: 'Manhattan' },
  '637': { name: 'Bleecker St', borough: 'Manhattan' },
  '638': { name: 'Spring St', borough: 'Manhattan' },
  '639': { name: 'Canal St', borough: 'Manhattan' },
  '640': { name: 'Brooklyn Bridge-City Hall', borough: 'Manhattan' },
  '418': { name: 'Fulton St', borough: 'Manhattan' },
  '419': { name: 'Wall St', borough: 'Manhattan' },
  '420': { name: 'Bowling Green', borough: 'Manhattan' },
  '423': { name: 'Borough Hall', borough: 'Brooklyn' },
  '228': { name: 'Park Place', borough: 'Manhattan' },
  '229': { name: 'Fulton St', borough: 'Manhattan' },
  '230': { name: 'Wall St', borough: 'Manhattan' },
  '231': { name: 'Clark St', borough: 'Brooklyn' },
  '232': { name: 'Borough Hall', borough: 'Brooklyn' },
  '233': { name: 'Hoyt St', borough: 'Brooklyn' },
  '234': { name: 'Nevins St', borough: 'Brooklyn' },
  '235': { name: 'Atlantic Av-Barclays Ctr', borough: 'Brooklyn' },
  '236': { name: 'Bergen St', borough: 'Brooklyn' },
  '237': { name: 'Grand Army Plaza', borough: 'Brooklyn' },
  '238': { name: 'Eastern Pkwy-Brooklyn Museum', borough: 'Brooklyn' },
  '239': { name: 'Franklin Av-Medgar Evers College', borough: 'Brooklyn' },
  '241': { name: 'President St-Medgar Evers College', borough: 'Brooklyn' },
  '242': { name: 'Sterling St', borough: 'Brooklyn' },
  '243': { name: 'Winthrop St', borough: 'Brooklyn' },
  '244': { name: 'Church Av', borough: 'Brooklyn' },
  '245': { name: 'Beverly Rd', borough: 'Brooklyn' },
  '246': { name: 'Newkirk Av-Little Haiti', borough: 'Brooklyn' },
  '247': { name: 'Flatbush Av-Brooklyn College', borough: 'Brooklyn' },
  '248': { name: 'Nostrand Av', borough: 'Brooklyn' },
  '249': { name: 'Kingston Av', borough: 'Brooklyn' },
  '250': { name: 'Crown Hts-Utica Av', borough: 'Brooklyn' },
  '251': { name: 'Sutter Av-Rutland Rd', borough: 'Brooklyn' },
  '252': { name: 'Saratoga Av', borough: 'Brooklyn' },
  '253': { name: 'Rockaway Av', borough: 'Brooklyn' },
  '254': { name: 'Junius St', borough: 'Brooklyn' },
  '255': { name: 'Pennsylvania Av', borough: 'Brooklyn' },
  '256': { name: 'Van Siclen Av', borough: 'Brooklyn' },
  '257': { name: 'New Lots Av', borough: 'Brooklyn' },

  // N / Q / R / W line (Broadway)
  'R14': { name: '57 St-7 Av', borough: 'Manhattan' },
  'R15': { name: '49 St', borough: 'Manhattan' },
  'R16': { name: 'Times Sq-42 St', borough: 'Manhattan' },
  'R17': { name: '34 St-Herald Sq', borough: 'Manhattan' },
  'R18': { name: '28 St', borough: 'Manhattan' },
  'R19': { name: '23 St', borough: 'Manhattan' },
  'R20': { name: '14 St-Union Sq', borough: 'Manhattan' },
  'R21': { name: '8 St-NYU', borough: 'Manhattan' },
  'R22': { name: 'Prince St', borough: 'Manhattan' },
  'R23': { name: 'Canal St', borough: 'Manhattan' },
  'R24': { name: 'City Hall', borough: 'Manhattan' },
  'R25': { name: 'Cortlandt St', borough: 'Manhattan' },
  'R26': { name: 'Rector St', borough: 'Manhattan' },
  'R27': { name: 'Whitehall St-South Ferry', borough: 'Manhattan' },

  // A / C / E line (8th Ave)
  'A12': { name: '125 St', borough: 'Manhattan' },
  'A15': { name: '59 St-Columbus Circle', borough: 'Manhattan' },
  'A24': { name: '42 St-Port Authority', borough: 'Manhattan' },
  'A27': { name: '34 St-Penn Station', borough: 'Manhattan' },
  'A31': { name: '14 St', borough: 'Manhattan' },
  'A32': { name: 'W 4 St-Wash Sq', borough: 'Manhattan' },
  'A34': { name: 'Canal St', borough: 'Manhattan' },
  'A36': { name: 'Chambers St', borough: 'Manhattan' },
  'A38': { name: 'Fulton St', borough: 'Manhattan' },
  'A40': { name: 'High St', borough: 'Brooklyn' },
  'A41': { name: 'Jay St-MetroTech', borough: 'Brooklyn' },
  'A42': { name: 'Hoyt-Schermerhorn Sts', borough: 'Brooklyn' },

  // B / D / F / M line (6th Ave, Queens Blvd, Crosstown, Culver)
  'B04': { name: '21 St-Queensbridge', borough: 'Queens' },
  'B06': { name: 'Roosevelt Island', borough: 'Manhattan' },
  'B08': { name: 'Lexington Av/63 St', borough: 'Manhattan' },
  'B10': { name: '57 St', borough: 'Manhattan' },
  'D14': { name: '7 Av', borough: 'Manhattan' },
  'D15': { name: '47-50 Sts-Rockefeller Ctr', borough: 'Manhattan' },
  'D16': { name: '42 St-Bryant Pk', borough: 'Manhattan' },
  'D17': { name: '34 St-Herald Sq', borough: 'Manhattan' },
  'D18': { name: '23 St', borough: 'Manhattan' },
  'D19': { name: '14 St', borough: 'Manhattan' },
  'D20': { name: 'W 4 St-Wash Sq', borough: 'Manhattan' },
  'D21': { name: 'Broadway-Lafayette St', borough: 'Manhattan' },
  'D22': { name: 'Grand St', borough: 'Manhattan' },
  'D24': { name: 'Atlantic Av-Barclays Ctr', borough: 'Brooklyn' },
  'D25': { name: '7 Av', borough: 'Brooklyn' },
  'D26': { name: 'Prospect Park', borough: 'Brooklyn' },
  'D28': { name: 'Church Av', borough: 'Brooklyn' },
  'D42': { name: 'W 8 St-NY Aquarium', borough: 'Brooklyn' },
  'D43': { name: 'Coney Island-Stillwell Av', borough: 'Brooklyn' },
  'F01': { name: 'Jamaica-179 St', borough: 'Queens' },
  'F02': { name: '169 St', borough: 'Queens' },
  'F03': { name: 'Parsons Blvd', borough: 'Queens' },
  'F04': { name: 'Sutphin Blvd', borough: 'Queens' },
  'F05': { name: 'Briarwood', borough: 'Queens' },
  'F06': { name: 'Kew Gardens-Union Tpke', borough: 'Queens' },
  'F07': { name: '75 Av', borough: 'Queens' },
  'F09': { name: 'Court Sq-23 St', borough: 'Queens' },
  'F11': { name: 'Lexington Av/53 St', borough: 'Manhattan' },
  'F12': { name: '5 Av/53 St', borough: 'Manhattan' },
  'F14': { name: '2 Av', borough: 'Manhattan' },
  'F15': { name: 'Delancey St-Essex St', borough: 'Manhattan' },
  'F16': { name: 'East Broadway', borough: 'Manhattan' },
  'F18': { name: 'York St', borough: 'Brooklyn' },
  'F20': { name: 'Bergen St', borough: 'Brooklyn' },
  'F21': { name: 'Carroll St', borough: 'Brooklyn' },
  'F22': { name: 'Smith-9 Sts', borough: 'Brooklyn' },
  'F23': { name: '4 Av-9 St', borough: 'Brooklyn' },
  'F24': { name: '7 Av', borough: 'Brooklyn' },
  'F25': { name: '15 St-Prospect Park', borough: 'Brooklyn' },
  'F26': { name: 'Fort Hamilton Pkwy', borough: 'Brooklyn' },
  'F27': { name: 'Church Av', borough: 'Brooklyn' },
  'F29': { name: 'Ditmas Av', borough: 'Brooklyn' },
  'F30': { name: '18 Av', borough: 'Brooklyn' },
  'F31': { name: 'Avenue I', borough: 'Brooklyn' },
  'F32': { name: 'Bay Pkwy', borough: 'Brooklyn' },
  'F33': { name: 'Avenue N', borough: 'Brooklyn' },
  'F34': { name: 'Avenue P', borough: 'Brooklyn' },
  'F35': { name: 'Kings Hwy', borough: 'Brooklyn' },
  'F36': { name: 'Avenue U', borough: 'Brooklyn' },
  'F38': { name: 'Avenue X', borough: 'Brooklyn' },
  'F39': { name: 'Neptune Av', borough: 'Brooklyn' },
  'G05': { name: 'Jamaica Center-Parsons/Archer', borough: 'Queens' },
  'G06': { name: 'Sutphin Blvd-Archer Av-JFK Airport', borough: 'Queens' },
  'G07': { name: 'Jamaica-Van Wyck', borough: 'Queens' },
  'G08': { name: 'Forest Hills-71 Av', borough: 'Queens' },
  'G09': { name: '67 Av', borough: 'Queens' },
  'G10': { name: '63 Dr-Rego Park', borough: 'Queens' },
  'G11': { name: 'Woodhaven Blvd', borough: 'Queens' },
  'G12': { name: 'Grand Av-Newtown', borough: 'Queens' },
  'G13': { name: 'Elmhurst Av', borough: 'Queens' },
  'G14': { name: 'Jackson Hts-Roosevelt Av', borough: 'Queens' },
  'G15': { name: '65 St', borough: 'Queens' },
  'G16': { name: 'Northern Blvd', borough: 'Queens' },
  'G18': { name: '46 St', borough: 'Queens' },
  'G19': { name: 'Steinway St', borough: 'Queens' },
  'G20': { name: '36 St', borough: 'Queens' },
  'G21': { name: 'Queens Plaza', borough: 'Queens' },
  'G22': { name: 'Court Sq', borough: 'Queens' },
  'G24': { name: '21 St', borough: 'Queens' },
  'G26': { name: 'Greenpoint Av', borough: 'Brooklyn' },
  'G28': { name: 'Nassau Av', borough: 'Brooklyn' },
  'G29': { name: 'Metropolitan Av', borough: 'Brooklyn' },
  'G30': { name: 'Broadway', borough: 'Brooklyn' },
  'G31': { name: 'Flushing Av', borough: 'Brooklyn' },
  'G32': { name: 'Myrtle-Willoughby Avs', borough: 'Brooklyn' },
  'G33': { name: 'Bedford-Nostrand Avs', borough: 'Brooklyn' },
  'G34': { name: 'Classon Av', borough: 'Brooklyn' },
  'G35': { name: 'Clinton-Washington Avs', borough: 'Brooklyn' },
  'G36': { name: 'Fulton St', borough: 'Brooklyn' },

  // 7 line (Flushing)
  '701': { name: 'Flushing-Main St', borough: 'Queens' },
  '702': { name: 'Mets-Willets Point', borough: 'Queens' },
  '705': { name: '111 St', borough: 'Queens' },
  '706': { name: '103 St-Corona Plaza', borough: 'Queens' },
  '707': { name: 'Junction Blvd', borough: 'Queens' },
  '708': { name: '90 St-Elmhurst Av', borough: 'Queens' },
  '709': { name: '82 St-Jackson Hts', borough: 'Queens' },
  '710': { name: '74 St-Broadway', borough: 'Queens' },
  '711': { name: '69 St', borough: 'Queens' },
  '712': { name: '61 St-Woodside', borough: 'Queens' },
  '713': { name: '52 St', borough: 'Queens' },
  '714': { name: '46 St-Bliss St', borough: 'Queens' },
  '715': { name: '40 St-Lowery St', borough: 'Queens' },
  '716': { name: '33 St-Rawson St', borough: 'Queens' },
  '718': { name: 'Queensboro Plaza', borough: 'Queens' },
  '719': { name: 'Court Sq', borough: 'Queens' },
  '720': { name: 'Hunters Point Av', borough: 'Queens' },
  '721': { name: 'Vernon Blvd-Jackson Av', borough: 'Queens' },
  '723': { name: 'Grand Central-42 St', borough: 'Manhattan' },
  '724': { name: '5 Av', borough: 'Manhattan' },
  '725': { name: 'Times Sq-42 St', borough: 'Manhattan' },
  '726': { name: '34 St-Hudson Yards', borough: 'Manhattan' },

  // L line (Canarsie)
  'L01': { name: '8 Av', borough: 'Manhattan' },
  'L02': { name: '6 Av', borough: 'Manhattan' },
  'L03': { name: '14 St-Union Sq', borough: 'Manhattan' },
  'L05': { name: '3 Av', borough: 'Manhattan' },
  'L06': { name: '1 Av', borough: 'Manhattan' },
  'L08': { name: 'Bedford Av', borough: 'Brooklyn' },
  'L10': { name: 'Lorimer St', borough: 'Brooklyn' },
};

function normalizeStationLookupKey(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\bave\b/g, 'av')
    .replace(/\bavenue\b/g, 'av')
    .replace(/\bstreet\b/g, 'st')
    .replace(/\broad\b/g, 'rd')
    .replace(/\bboulevard\b/g, 'blvd')
    .replace(/\bparkway\b/g, 'pkwy')
    .replace(/\bsquare\b/g, 'sq')
    .replace(/\s+/g, ' ');
}

const AMBIGUOUS_MULTI_BOROUGH_STATION_NAMES = new Set<string>([
  '36 st',
  '50 st',
  '59 st',
  '7 av',
  '77 st',
  '79 st',
  '8 av',
  '86 st',
  'broadway',
  'fulton st',
  'grand st',
  'halsey st',
  'prospect av',
]);

const STATION_NAME_TO_BOROUGH_MAP: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const entry of Object.values(KNOWN_NYC_STATION_NAMES)) {
    const key = normalizeStationLookupKey(entry.name);
    if (!AMBIGUOUS_MULTI_BOROUGH_STATION_NAMES.has(key) && !m.has(key)) {
      m.set(key, entry.borough);
    }
  }
  // Explicit Bronx stations that might be misclassified by naive latitude thresholds
  const explicitBronxNames = [
    'cypress av',
    'cypress ave',
    'brook av',
    'brook ave',
    '3 av-138 st',
    '3 ave-138 st',
    '138 st-grand concourse',
    '149 st-grand concourse',
    '3 av-149 st',
    'e 143 st-st mary\'s st',
    'e 149 st',
    'longwood av',
    'hunts point av',
    'whitlock av',
    'elder av',
    'morrison av-soundview',
    'st lawrence av',
    'parkchester',
    'castle hill av',
    'zerega av',
    'westchester sq-e tremont av',
    'middletown rd',
    'buhre av',
    'pelham bay park',
    '161 st-yankee stadium',
    '167 st',
    '170 st',
    'mt eden av',
    '176 st',
    'burnside av',
    '183 st',
    'fordham rd',
    'kingsbridge rd',
    'bedford park blvd-lehman college',
    'mosholu pkwy',
    'woodlawn',
  ];
  for (const name of explicitBronxNames) {
    m.set(normalizeStationLookupKey(name), 'Bronx');
  }
  return m;
})();

function inferBoroughFromRouteAndStationName(
  routeId: string | undefined,
  normalizedName: string
): string | undefined {
  const r = (routeId ?? '').trim().toUpperCase();
  if (!r) return undefined;
  if (r === 'G') {
    if (normalizedName === 'fulton st' || normalizedName === '7 av' || normalizedName === 'broadway') {
      return 'Brooklyn';
    }
  }
  if (r === 'F' || r === 'FX') {
    if (normalizedName === '7 av') return 'Brooklyn';
    if (normalizedName === '36 st') return 'Queens';
  }
  if (r === 'L') {
    if (normalizedName === '8 av') return 'Manhattan';
    if (normalizedName === 'grand st' || normalizedName === 'halsey st') return 'Brooklyn';
  }
  if (r === 'J' || r === 'Z') {
    if (normalizedName === 'fulton st') return 'Manhattan';
    if (normalizedName === 'halsey st') return 'Brooklyn';
  }
  if (r === 'M') {
    if (normalizedName === '36 st') return 'Queens';
    if (normalizedName === 'fulton st') return 'Manhattan';
  }
  if (r === 'Q') {
    if (normalizedName === '7 av') return 'Brooklyn';
    if (normalizedName === '86 st') return 'Manhattan';
  }
  if (r === 'N' || r === 'W') {
    if (normalizedName === 'broadway') return 'Queens';
    if (normalizedName === '8 av' || normalizedName === '36 st' || normalizedName === '59 st') return 'Brooklyn';
  }
  if (r === '1') {
    if (normalizedName === '50 st' || normalizedName === '79 st' || normalizedName === '86 st') return 'Manhattan';
  }
  if (r === '2' || r === '3') {
    if (normalizedName === 'fulton st' || normalizedName === '79 st' || normalizedName === '86 st') return 'Manhattan';
    if (normalizedName === 'prospect av') return 'Bronx';
  }
  if (r === '4' || r === '5' || r === '6' || r === '6X') {
    if (
      normalizedName === 'fulton st' ||
      normalizedName === '59 st' ||
      normalizedName === '77 st' ||
      normalizedName === '86 st'
    ) {
      return 'Manhattan';
    }
    if (normalizedName === 'prospect av') return 'Bronx';
  }
  if (r === 'A' || r === 'C' || r === 'E') {
    if (
      normalizedName === 'fulton st' ||
      normalizedName === '50 st' ||
      normalizedName === '86 st' ||
      normalizedName === '7 av'
    ) {
      return 'Manhattan';
    }
    if (normalizedName === '36 st') return 'Queens';
  }
  return undefined;
}

export function inferNycSubwayBoroughFromStopId(stopId: string): string | undefined {
  const clean = stopId.trim().toUpperCase().replace(/[NS]$/, '');
  if (!clean) return undefined;
  const exact = KNOWN_NYC_STATION_NAMES[clean];
  if (exact) return exact.borough;

  const num = parseInt(clean, 10);
  if (!Number.isNaN(num) && /^\d{3}$/.test(clean)) {
    if (
      (num >= 101 && num <= 104) ||
      (num >= 201 && num <= 222) ||
      (num >= 401 && num <= 416) ||
      (num >= 501 && num <= 505) ||
      (num >= 601 && num <= 619)
    ) {
      return 'Bronx';
    }
    if (
      (num >= 106 && num <= 142) ||
      (num >= 224 && num <= 230) ||
      (num >= 301 && num <= 302) ||
      (num >= 418 && num <= 420) ||
      (num >= 621 && num <= 640) ||
      (num >= 723 && num <= 726) ||
      (num >= 901 && num <= 902)
    ) {
      return 'Manhattan';
    }
    if (num === 423 || (num >= 231 && num <= 257)) {
      return 'Brooklyn';
    }
    if (num >= 701 && num <= 721) {
      return 'Queens';
    }
  }

  const alphaMatch = /^([A-Z])(\d{2})$/.exec(clean);
  if (alphaMatch) {
    const prefix = alphaMatch[1]!;
    const code = parseInt(alphaMatch[2]!, 10);
    switch (prefix) {
      case 'A':
        if (code >= 2 && code <= 38) return 'Manhattan';
        if (code >= 40 && code <= 57) return 'Brooklyn';
        if (code >= 59 && code <= 65) return 'Queens';
        break;
      case 'B':
        if (code === 4) return 'Queens';
        if (code >= 6 && code <= 10) return 'Manhattan';
        if (code >= 12 && code <= 24) return 'Brooklyn';
        break;
      case 'D':
        if (code >= 1 && code <= 11) return 'Bronx';
        if (code >= 12 && code <= 22) return 'Manhattan';
        if (code >= 24 && code <= 43) return 'Brooklyn';
        break;
      case 'E':
        if (code === 1) return 'Manhattan';
        break;
      case 'F':
        if (code >= 1 && code <= 9) return 'Queens';
        if (code >= 11 && code <= 16) return 'Manhattan';
        if (code >= 18 && code <= 39) return 'Brooklyn';
        break;
      case 'G':
        if (code >= 5 && code <= 24) return 'Queens';
        if (code >= 26 && code <= 36) return 'Brooklyn';
        break;
      case 'H':
        if (code >= 1 && code <= 15) return 'Queens';
        break;
      case 'J':
        if (code >= 12 && code <= 17) return 'Queens';
        if (code >= 19 && code <= 31) return 'Brooklyn';
        break;
      case 'L':
        if (code >= 1 && code <= 6) return 'Manhattan';
        if (code >= 8 && code <= 29) return 'Brooklyn';
        break;
      case 'M':
        if (code >= 1 && code <= 6) return 'Queens';
        if (code >= 8 && code <= 16) return 'Brooklyn';
        if (code >= 18 && code <= 23) return 'Manhattan';
        break;
      case 'N':
        if (code >= 2 && code <= 12) return 'Brooklyn';
        break;
      case 'Q':
        if (code >= 1 && code <= 5) return 'Manhattan';
        break;
      case 'R':
        if (code >= 1 && code <= 9) return 'Queens';
        if (code >= 11 && code <= 27) return 'Manhattan';
        if (code >= 28 && code <= 45) return 'Brooklyn';
        break;
      case 'S':
        if (code >= 1 && code <= 4) return 'Brooklyn';
        if (code >= 9 && code <= 31) return 'Staten Island';
        break;
    }
  }
  return undefined;
}

function normalizeBoroughLabel(rawBorough?: string): string | undefined {
  if (!rawBorough) return undefined;
  const trimmed = rawBorough.trim();
  const upper = trimmed.toUpperCase();
  if (upper === 'BX' || upper === 'THE BRONX' || upper === 'BRONX') return 'Bronx';
  if (upper === 'M' || upper === 'MN' || upper === 'MANHATTAN') return 'Manhattan';
  if (upper === 'BK' || upper === 'BROOKLYN') return 'Brooklyn';
  if (upper === 'Q' || upper === 'QN' || upper === 'QUEENS') return 'Queens';
  if (upper === 'SI' || upper === 'STATEN ISLAND') return 'Staten Island';
  return trimmed;
}

export function resolveStationDisplay(r: Record<string, unknown>): { name: string; borough?: string | undefined } {
  const customStationLabel = r['station_label'] ?? r['display_label'] ?? r['stop_label'];
  const explicitName =
    customStationLabel ??
    r['station_name'] ??
    r['name'] ??
    r['stop_name'] ??
    r['complex_name'] ??
    r['from_station_name'] ??
    r['to_station_name'];
  const rawId = String(
    r['parent_station_id'] ??
    r['station_id'] ??
    r['from_station_id'] ??
    r['to_station_id'] ??
    ''
  ).trim();
  const routeId = r['route_id'] !== undefined ? String(r['route_id']).trim() : undefined;

  const sqlBorough = normalizeBoroughLabel(r['borough'] ? String(r['borough']) : undefined);

  // Lookup in known station directory (supporting raw ID or stripping trailing N/S direction suffix)
  const normalizedId = rawId.toUpperCase().replace(/[NS]$/, '');
  const matched = KNOWN_NYC_STATION_NAMES[rawId] || KNOWN_NYC_STATION_NAMES[normalizedId];
  const stopIdBorough = inferNycSubwayBoroughFromStopId(rawId);
  const isPelhamSouthBronxStop =
    normalizedId === '617' || normalizedId === '618' || normalizedId === '619';

  if (explicitName && String(explicitName).trim().length > 0) {
    const cleanName = String(explicitName).trim();
    const cleanIdCandidate = cleanName.toUpperCase().replace(/[NS]$/, '');
    const nameKeyMatch =
      /^[1-9A-Z]\d{2}$/.test(cleanIdCandidate)
        ? KNOWN_NYC_STATION_NAMES[cleanName] || KNOWN_NYC_STATION_NAMES[cleanIdCandidate]
        : undefined;
    if (nameKeyMatch) {
      return {
        name: nameKeyMatch.name,
        borough: (isPelhamSouthBronxStop ? 'Bronx' : undefined) || sqlBorough || nameKeyMatch.borough || stopIdBorough,
      };
    }
    const normalizedKey = normalizeStationLookupKey(cleanName);
    const canonicalNameBorough = STATION_NAME_TO_BOROUGH_MAP.get(normalizedKey);
    const routeNameBorough = inferBoroughFromRouteAndStationName(routeId, normalizedKey);
    // Prefer spatial-join sqlBorough (except Pelham 617-619 guard), then stop-ID/station-directory fallbacks
    const resolvedBorough =
      (isPelhamSouthBronxStop ? 'Bronx' : undefined) ||
      sqlBorough ||
      stopIdBorough ||
      matched?.borough ||
      routeNameBorough ||
      canonicalNameBorough;
    return { name: cleanName, borough: resolvedBorough };
  }

  if (matched) {
    return {
      name: matched.name,
      borough: (isPelhamSouthBronxStop ? 'Bronx' : undefined) || sqlBorough || matched.borough || stopIdBorough,
    };
  }

  return {
    name: rawId || 'Unknown',
    borough: (isPelhamSouthBronxStop ? 'Bronx' : undefined) || sqlBorough || stopIdBorough,
  };
}

export function differentiateTrunkShade(hexColor: string, occurrenceIndex: number): string {
  if (occurrenceIndex === 0 || !/^#[0-9A-Fa-f]{6}$/.test(hexColor)) {
    return hexColor;
  }
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);
  // Shift brightness/tone slightly for 2nd and 3rd routes sharing the same trunk color
  const factors = [1, 0.72, 1.28, 0.55];
  const factor = factors[occurrenceIndex % factors.length] ?? 1;
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const nr = clamp(factor > 1 ? r + (255 - r) * 0.28 : r * factor);
  const ng = clamp(factor > 1 ? g + (255 - g) * 0.28 : g * factor);
  const nb = clamp(factor > 1 ? b + (255 - b) * 0.28 : b * factor);
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

const NON_METRIC_COLUMNS = new Set([
  'event_date',
  'event_time',
  'agency_id',
  'route_id',
  'route_name',
  'route_label',
  'line_label',
  'series_label',
  'station_id',
  'parent_station_id',
  'from_station_id',
  'to_station_id',
  'station_name',
  'station_label',
  'display_label',
  'stop_label',
  'name',
  'stop_name',
  'complex_name',
  'complex_id',
  'trip_id',
  'vehicle_id',
  'direction_id',
  'borough',
  'latitude',
  'longitude',
  'stop_sequence',
  'ordinal',
  'color_hex',
  'display_value',
  'formatted_value',
  'measure_display',
  'value_label',
  'measure_label',
  'metric_label',
  'y_axis_label',
  'axis_label',
  'measure_unit',
  'unit',
  'value_unit',
]);

function detectMeasureColumn(rows: readonly Record<string, unknown>[], requestedCol?: string): string {
  const firstRow = rows[0];
  if (!firstRow) return requestedCol || 'headway_sec';

  if (requestedCol && rows.some(r => r[requestedCol] !== undefined)) {
    return requestedCol;
  }

  const priorityCandidates = [
    'headway_sec',
    'avg_headway_sec',
    'effective_speed_mph',
    'leg_speed_mps',
    'service_completion_pct',
    'passenger_count',
    'total_entries',
    'total_exits',
    'dwell_sec',
    'travel_time_sec',
    'leg_travel_time_sec',
    'value',
    'measure',
    'metric_value',
    'amount',
    'revenue',
    'income',
    'median_income',
    'ridership',
  ];

  const sampleRows = rows.slice(0, 25);
  for (const col of priorityCandidates) {
    const firstNonNull = sampleRows.find(r => r[col] != null)?.[col];
    if (typeof firstNonNull === 'number' && Number.isFinite(firstNonNull)) {
      return col;
    }
  }

  for (const key of Object.keys(firstRow)) {
    const lower = key.toLowerCase();
    if (NON_METRIC_COLUMNS.has(lower)) continue;
    const firstNonNull = sampleRows.find(r => r[key] != null)?.[key];
    if (typeof firstNonNull === 'number' && Number.isFinite(firstNonNull)) {
      return key;
    }
  }

  return requestedCol || 'headway_sec';
}

function extractRowDisplayValue(r: Record<string, unknown>, metricCol: string): string | undefined {
  const candidates = [
    r['display_value'],
    r['formatted_value'],
    r['measure_display'],
    r['value_label'],
    r[`${metricCol}_display`],
    r[`${metricCol}_formatted`],
    r[`${metricCol}_label`],
  ];
  for (const c of candidates) {
    if (c !== undefined && c !== null && String(c).trim().length > 0) {
      return String(c).trim();
    }
  }
  return undefined;
}

function formatNumericMeasure(
  numVal: number,
  metricCol: string,
  unitHint?: string,
  sampleDisplayValue?: string
): string {
  if (!Number.isFinite(numVal)) return String(numVal);

  const lowerCol = metricCol.toLowerCase();
  const unit = (unitHint ?? '').trim();
  const upperUnit = unit.toUpperCase();

  // Currency formatting if unit is $ / USD or if sample display_value starts with $ or column is income/revenue
  if (
    unit === '$' ||
    upperUnit === 'USD' ||
    (sampleDisplayValue && sampleDisplayValue.startsWith('$')) ||
    lowerCol.includes('income') ||
    lowerCol.includes('revenue') ||
    lowerCol.includes('dollar') ||
    lowerCol.includes('usd') ||
    lowerCol.includes('fare')
  ) {
    return `$${numVal.toLocaleString('en-US', {
      maximumFractionDigits: Math.abs(numVal) >= 100 ? 0 : 2,
    })}`;
  }

  // Percentage formatting
  if (
    unit === '%' ||
    upperUnit === 'PCT' ||
    upperUnit === 'PERCENT' ||
    (sampleDisplayValue && sampleDisplayValue.endsWith('%')) ||
    lowerCol.includes('pct') ||
    lowerCol.includes('percent') ||
    lowerCol.includes('rate')
  ) {
    return `${numVal.toFixed(1)}%`;
  }

  // Seconds / Headway / Duration formatting
  if (lowerCol.includes('sec') || upperUnit === 'SEC' || upperUnit === 'S' || upperUnit === 'SECONDS') {
    const rounded = Math.round(numVal);
    const mins = Math.floor(rounded / 60);
    const secs = rounded % 60;
    if (mins > 0) {
      return `${rounded.toFixed(0)}s <span style="color:#64748B;font-weight:500;">(${mins}m ${secs.toString().padStart(2, '0')}s)</span>`;
    }
    return `${rounded.toFixed(0)}s`;
  }

  if (unit) {
    return `${numVal.toLocaleString('en-US', { maximumFractionDigits: 1 })} ${unit}`;
  }

  return Number.isInteger(numVal)
    ? numVal.toLocaleString('en-US')
    : numVal.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

export function buildStationProgressionOption(
  rows: readonly Record<string, unknown>[],
  options: StationProgressionOptions = {}
): EChartsOption {
  const metricCol = detectMeasureColumn(rows, options.metricColumn);
  const alignment = options.alignmentMode || 'corridor';
  const showStationLabels = options.showStationLabels ?? false;

  // Group by route_id
  const routesMap = new Map<
    string,
    { station: string; val: number; displayVal?: string | undefined; agencyId?: string | undefined }[]
  >();
  const stationsSet = new Set<string>();
  const stationBoroughMap = new Map<string, string>();
  const stationMinStopIdMap = new Map<string, string>();
  const routeMetaMap = new Map<
    string,
    { agencyId?: string | undefined; color: string; trunkColor: string; routeLabel?: string | undefined }
  >();
  // Map of `${routeId}:::${station}` -> custom display string from SQL
  const customPointDisplayMap = new Map<string, string>();

  let customMeasureLabel: string | undefined;
  let customMeasureUnit: string | undefined;
  let sampleDisplayValue: string | undefined;

  for (const r of rows) {
    const routeId = String(r['route_id'] ?? 'Unknown');
    const { name: station, borough } = resolveStationDisplay(r);
    if (!station) continue;

    const rawStopId = String(
      r['parent_station_id'] ??
      r['station_id'] ??
      r['from_station_id'] ??
      r['to_station_id'] ??
      ''
    )
      .trim()
      .toUpperCase()
      .replace(/[NS]$/, '');
    if (/^[1-9A-Z]\d{2}$/.test(rawStopId)) {
      const prevId = stationMinStopIdMap.get(station);
      if (!prevId || rawStopId.localeCompare(prevId) < 0) {
        stationMinStopIdMap.set(station, rawStopId);
      }
    }

    const rawMetric = r[metricCol] ?? r['avg_headway_sec'] ?? r['effective_speed_mph'] ?? r['value'] ?? r['measure'] ?? 0;
    const val = Number(rawMetric);
    if (!Number.isFinite(val)) continue;
    const agencyId = r['agency_id'] ? String(r['agency_id']) : undefined;
    const displayVal = extractRowDisplayValue(r, metricCol);
    if (displayVal && !sampleDisplayValue) {
      sampleDisplayValue = displayVal;
    }

    if (!customMeasureLabel) {
      const ml = r['measure_label'] ?? r['metric_label'] ?? r['y_axis_label'] ?? r['axis_label'];
      if (ml && String(ml).trim().length > 0) {
        customMeasureLabel = String(ml).trim();
      }
    }
    if (!customMeasureUnit) {
      const mu = r['measure_unit'] ?? r['unit'] ?? r['value_unit'];
      if (mu && String(mu).trim().length > 0) {
        customMeasureUnit = String(mu).trim();
      }
    }

    const rLabelRaw = r['route_label'] ?? r['line_label'] ?? r['series_label'];
    const routeLabel = rLabelRaw && String(rLabelRaw).trim().length > 0 ? String(rLabelRaw).trim() : undefined;

    stationsSet.add(station);
    if (borough && !stationBoroughMap.has(station)) {
      stationBoroughMap.set(station, borough);
    }

    if (!routesMap.has(routeId)) {
      routesMap.set(routeId, []);
    }
    routesMap.get(routeId)!.push({ station, val, displayVal, agencyId });

    if (displayVal) {
      customPointDisplayMap.set(`${routeId}:::${station}`, displayVal);
    }
    if (routeLabel && !routeMetaMap.has(routeId)) {
      routeMetaMap.set(routeId, { agencyId, color: '', trunkColor: '', routeLabel });
    }
  }

  const shouldShowBands = options.showBoroughBands ?? (stationBoroughMap.size > 0);

  // Order stations along corridor: group into contiguous borough bands (preventing alternating bands across parallel branches)
  // and ensure monotonic GTFS stop ID order along curving branch segments within each borough.
  const rawStations = Array.from(stationsSet);
  const sortBranchPrefixesWithinBucket = (bucket: string[]): string[] => {
    const out = [...bucket];
    const prefixSlots = new Map<string, { indices: number[]; stations: { station: string; stopId: string }[] }>();
    for (let i = 0; i < out.length; i++) {
      const st = out[i]!;
      const stopId = stationMinStopIdMap.get(st);
      if (stopId && /^[1-9A-Z]\d{2}$/.test(stopId)) {
        const prefix = stopId.charAt(0);
        let group = prefixSlots.get(prefix);
        if (!group) {
          group = { indices: [], stations: [] };
          prefixSlots.set(prefix, group);
        }
        group.indices.push(i);
        group.stations.push({ station: st, stopId });
      }
    }
    for (const group of prefixSlots.values()) {
      if (group.stations.length > 1) {
        group.stations.sort((a, b) => a.stopId.localeCompare(b.stopId));
        for (let k = 0; k < group.indices.length; k++) {
          out[group.indices[k]!] = group.stations[k]!.station;
        }
      }
    }
    return out;
  };

  let allStations: string[];
  if (alignment === 'corridor' && shouldShowBands && stationBoroughMap.size > 0) {
    const boroughOrder: string[] = [];
    const boroughBuckets = new Map<string, string[]>();
    let currentFallback = rawStations.map(s => stationBoroughMap.get(s)).find(Boolean) || 'Manhattan';
    for (const st of rawStations) {
      const b = stationBoroughMap.get(st) || currentFallback;
      currentFallback = b;
      if (!boroughBuckets.has(b)) {
        boroughOrder.push(b);
        boroughBuckets.set(b, []);
      }
      boroughBuckets.get(b)!.push(st);
    }
    allStations = [];
    for (const b of boroughOrder) {
      const sortedBucket = sortBranchPrefixesWithinBucket(boroughBuckets.get(b)!);
      allStations.push(...sortedBucket);
    }
  } else if (alignment === 'corridor') {
    allStations = sortBranchPrefixesWithinBucket(rawStations);
  } else {
    allStations = rawStations;
  }

  const series: NonNullable<EChartsOption['series']> = [];
  const legendData: NonNullable<EChartsOption['legend']> extends { data?: infer D } ? D : unknown[] = [];
  const trunkColorCounts = new Map<string, number>();

  for (const [routeId, points] of routesMap.entries()) {
    const agencyId = points[0]?.agencyId;
    const trunkColor = resolveRouteColor(routeId, agencyId);
    const seenCount = trunkColorCounts.get(trunkColor) ?? 0;
    trunkColorCounts.set(trunkColor, seenCount + 1);
    const lineColor = differentiateTrunkShade(trunkColor, seenCount);
    const bulletIcon = buildRouteBulletSvgDataUri(routeId, agencyId, lineColor);
    const existingMeta = routeMetaMap.get(routeId);

    routeMetaMap.set(routeId, {
      agencyId,
      color: lineColor,
      trunkColor,
      routeLabel: existingMeta?.routeLabel,
    });
    (legendData as any[]).push({
      name: routeId,
      icon: bulletIcon,
    });

    if (alignment === 'normalized') {
      // 0% -> 100% normalized axis
      const sorted = points.map((p, idx) => {
        const pct = points.length > 1 ? (idx / (points.length - 1)) * 100 : 0;
        return [pct, p.val] as [number, number];
      });

      const firstPt = sorted[0];
      const lastPt = sorted[sorted.length - 1];
      const bulletMarks: any[] = [];
      if (firstPt) {
        bulletMarks.push({ coord: [firstPt[0], firstPt[1]], symbol: bulletIcon, symbolSize: 22 });
      }
      if (lastPt && sorted.length > 1) {
        bulletMarks.push({ coord: [lastPt[0], lastPt[1]], symbol: bulletIcon, symbolSize: 22 });
      }

      series.push({
        name: routeId,
        type: 'line',
        data: sorted,
        smooth: 0.18,
        lineStyle: { color: lineColor, width: 2.5 },
        itemStyle: { color: lineColor, borderColor: '#FFFFFF', borderWidth: 1.2 },
        symbol: 'circle',
        symbolSize: 4.5,
        markPoint: {
          silent: true,
          animation: false,
          label: { show: false },
          data: bulletMarks,
        },
      });
    } else {
      // Shared Corridor alignment (average multiple observations per station)
      const stationSumMap = new Map<string, { sum: number; count: number; displayVal?: string | undefined }>();
      for (const p of points) {
        const cur = stationSumMap.get(p.station);
        if (cur) {
          cur.sum += p.val;
          cur.count += 1;
          if (!cur.displayVal && p.displayVal) cur.displayVal = p.displayVal;
        } else {
          stationSumMap.set(p.station, { sum: p.val, count: 1, displayVal: p.displayVal });
        }
      }

      // Map across all stations; if station skipped, connect across nulls
      const lineData: (number | null)[] = [];
      let firstValidIdx = -1;
      let lastValidIdx = -1;
      let peakIdx = -1;
      let peakVal = -Infinity;

      for (let idx = 0; idx < allStations.length; idx++) {
        const st = allStations[idx]!;
        const entry = stationSumMap.get(st);
        if (entry) {
          const avg = entry.count === 1 ? entry.sum : Math.round((entry.sum / entry.count) * 10) / 10;
          lineData.push(avg);
          if (entry.displayVal) {
            customPointDisplayMap.set(`${routeId}:::${st}`, entry.displayVal);
          }
          if (firstValidIdx === -1) firstValidIdx = idx;
          lastValidIdx = idx;
          if (avg > peakVal) {
            peakVal = avg;
            peakIdx = idx;
          }
        } else {
          lineData.push(null);
        }
      }

      // Place actual NYC Subway route bullets directly on the line (start, peak, and terminus)
      const bulletMarks: any[] = [];
      if (firstValidIdx !== -1) {
        bulletMarks.push({
          coord: [allStations[firstValidIdx], lineData[firstValidIdx]],
          symbol: bulletIcon,
          symbolSize: 22,
        });
      }
      if (
        peakIdx !== -1 &&
        peakIdx !== firstValidIdx &&
        peakIdx !== lastValidIdx &&
        Math.abs(peakIdx - firstValidIdx) > 2 &&
        Math.abs(lastValidIdx - peakIdx) > 2
      ) {
        bulletMarks.push({
          coord: [allStations[peakIdx], lineData[peakIdx]],
          symbol: bulletIcon,
          symbolSize: 20,
        });
      }
      if (lastValidIdx !== -1 && lastValidIdx !== firstValidIdx) {
        bulletMarks.push({
          coord: [allStations[lastValidIdx], lineData[lastValidIdx]],
          symbol: bulletIcon,
          symbolSize: 22,
        });
      }

      series.push({
        name: routeId,
        type: 'line',
        data: lineData,
        connectNulls: true,
        smooth: 0.18,
        lineStyle: {
          color: lineColor,
          width: 2.5,
          type: routeId.toUpperCase().endsWith('X') || points.length < allStations.length * 0.2 ? 'dashed' : 'solid',
        },
        itemStyle: { color: lineColor, borderColor: '#FFFFFF', borderWidth: 1.2 },
        symbol: 'circle',
        symbolSize: 4.5,
        markPoint: {
          silent: true,
          animation: false,
          label: { show: false },
          data: bulletMarks,
        },
      });
    }
  }

  // Borough bands markArea + vertical dashed boundary lines (Editorial Corridor style)
  const boroughColors: Record<string, string> = {
    Bronx: 'rgba(15, 23, 42, 0.035)',
    Manhattan: 'rgba(255, 255, 255, 0.0)',
    Brooklyn: 'rgba(15, 23, 42, 0.035)',
    Queens: 'rgba(15, 23, 42, 0.055)',
    'Staten Island': 'rgba(15, 23, 42, 0.035)',
  };

  if (shouldShowBands && alignment === 'corridor' && allStations.length > 0 && series.length > 0) {
    const spans: { name: string; start: string; end: string; color: string }[] = [];
    const boundaryStations: string[] = [];
    const firstKnownBorough = allStations.map(s => stationBoroughMap.get(s)).find(Boolean);
    let currentBorough = firstKnownBorough || 'Manhattan';
    let spanStart = allStations[0]!;

    for (let i = 1; i < allStations.length; i++) {
      const st = allStations[i]!;
      const b = stationBoroughMap.get(st) || currentBorough;
      if (b !== currentBorough) {
        const displayLabel = currentBorough.toUpperCase() === 'BRONX' ? 'THE BRONX' : currentBorough.toUpperCase();
        spans.push({
          name: displayLabel,
          start: spanStart,
          end: allStations[i - 1]!,
          color: boroughColors[currentBorough] ?? 'rgba(15, 23, 42, 0.03)',
        });
        boundaryStations.push(st);
        currentBorough = b;
        spanStart = st;
      }
    }
    const finalLabel = currentBorough.toUpperCase() === 'BRONX' ? 'THE BRONX' : currentBorough.toUpperCase();
    spans.push({
      name: finalLabel,
      start: spanStart,
      end: allStations[allStations.length - 1]!,
      color: boroughColors[currentBorough] ?? 'rgba(15, 23, 42, 0.03)',
    });

    (series[0] as any).markArea = {
      silent: true,
      data: spans.map(s => [
        {
          name: s.name,
          xAxis: s.start,
          itemStyle: { color: s.color },
          label: {
            color: '#334155',
            position: 'insideTop',
            distance: 8,
            fontSize: 11,
            fontWeight: 700,
            fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
          },
        },
        {
          xAxis: s.end,
        },
      ]),
    };

    if (boundaryStations.length > 0) {
      (series[0] as any).markLine = {
        silent: true,
        symbol: ['none', 'none'],
        label: { show: false },
        lineStyle: {
          color: '#94A3B8',
          width: 1.25,
          type: 'dashed',
        },
        data: boundaryStations.map(st => ({ xAxis: st })),
      };
    }
  }

  const metricLabel =
    customMeasureLabel ??
    metricCol
      .replace(/_/g, ' ')
      .replace(/\bsec\b/i, '(sec)')
      .replace(/\bmph\b/i, '(mph)')
      .replace(/\busd\b/i, '(USD)');

  const isCurrencyAxis =
    customMeasureUnit === '$' ||
    customMeasureUnit?.toUpperCase() === 'USD' ||
    (sampleDisplayValue && sampleDisplayValue.startsWith('$')) ||
    metricCol.toLowerCase().includes('income') ||
    metricCol.toLowerCase().includes('revenue') ||
    metricCol.toLowerCase().includes('usd');

  const isPercentAxis =
    customMeasureUnit === '%' ||
    (sampleDisplayValue && sampleDisplayValue.endsWith('%')) ||
    metricCol.toLowerCase().includes('pct') ||
    metricCol.toLowerCase().includes('percent');

  const xAxis = alignment === 'normalized'
    ? {
        type: 'value' as const,
        name: 'Progression (%)',
        min: 0,
        max: 100,
        axisLine: { lineStyle: { color: '#0F172A', width: 1.75 } },
        axisTick: { show: true, length: 5, lineStyle: { color: '#0F172A', width: 1.25 } },
        axisLabel: { formatter: '{value}%', color: '#475569', fontSize: 11 },
        splitLine: { show: false },
      }
    : {
        type: 'category' as const,
        name: '',
        data: allStations,
        axisLine: { lineStyle: { color: '#0F172A', width: 1.75 } },
        axisTick: {
          show: true,
          alignWithLabel: true,
          interval: 0,
          length: 5,
          lineStyle: { color: '#0F172A', width: 1.25 },
        },
        axisLabel: {
          show: showStationLabels,
          interval: 0,
          rotate: allStations.length > 8 ? 35 : 0,
          color: '#334155',
          fontSize: 11,
        },
        axisPointer: {
          show: true,
          label: {
            show: true,
            backgroundColor: '#0F172A',
            color: '#FFFFFF',
            fontSize: 11,
            fontWeight: 600,
            padding: [4, 8],
            borderRadius: 4,
          },
        },
        splitLine: { show: false },
      };

  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255, 255, 255, 0.98)',
      borderColor: '#CBD5E1',
      borderWidth: 1,
      padding: [10, 14],
      extraCssText: 'box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12); border-radius: 8px;',
      axisPointer: {
        type: 'line',
        lineStyle: { color: '#475569', width: 1.25, type: 'dashed' },
      },
      formatter: (params: unknown) => {
        const items = Array.isArray(params) ? params : [params];
        if (items.length === 0) return '';
        const first = items[0] as Record<string, unknown>;
        const stationName = String(first['axisValueLabel'] ?? first['name'] ?? '');
        const borough = stationBoroughMap.get(stationName);
        const boroughTag = borough
          ? `<span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#475569;background:#F1F5F9;padding:2px 6px;border-radius:4px;margin-left:8px;">${borough.toUpperCase() === 'BRONX' ? 'THE BRONX' : borough.toUpperCase()}</span>`
          : '';

        const rowsHtml = items
          .filter((item: any) => item && item.value !== null && item.value !== undefined)
          .map((item: any) => {
            const rId = String(item.seriesName ?? '');
            const meta = routeMetaMap.get(rId);
            const rawVal = Array.isArray(item.value) ? item.value[1] : item.value;
            const numVal = Number(rawVal);
            const bulletHtml = buildRouteBulletHtml(rId, meta?.agencyId, meta?.color, 20);
            const customFormatted = customPointDisplayMap.get(`${rId}:::${stationName}`);
            const formattedVal =
              customFormatted ??
              (Number.isFinite(numVal)
                ? formatNumericMeasure(numVal, metricCol, customMeasureUnit, sampleDisplayValue)
                : String(rawVal));
            const routeTitle = meta?.routeLabel ?? `Line ${rId}`;

            return `<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:6px;">
              <div style="display:flex;align-items:center;gap:7px;">
                ${bulletHtml}
                <span style="font-size:12px;font-weight:600;color:#1E293B;">${routeTitle}</span>
              </div>
              <span style="font-size:12px;font-weight:700;color:#0F172A;font-variant-numeric:tabular-nums;">${formattedVal}</span>
            </div>`;
          })
          .join('');

        return `<div style="min-width:190px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
          <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #E2E8F0;padding-bottom:6px;margin-bottom:2px;">
            <span style="font-size:13px;font-weight:700;color:#0F172A;">${stationName}</span>
            ${boroughTag}
          </div>
          ${rowsHtml}
        </div>`;
      },
    },
    legend: {
      top: 2,
      right: 16,
      data: legendData as any,
      itemWidth: 20,
      itemHeight: 20,
      itemGap: 16,
      textStyle: {
        color: '#1E293B',
        fontSize: 12,
        fontWeight: 700,
        fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
      },
      formatter: (name: string) => routeMetaMap.get(name)?.routeLabel ?? `Line ${name}`,
    },
    grid: {
      left: 52,
      right: 24,
      top: 38,
      bottom: showStationLabels ? (allStations.length > 8 ? 65 : 40) : 22,
      containLabel: true,
    },
    xAxis,
    yAxis: {
      type: 'value',
      name: metricLabel,
      nameTextStyle: { color: '#475569', fontSize: 11, fontWeight: 600, align: 'right', padding: [0, 8, 0, 0] },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: '#64748B',
        fontSize: 11,
        fontWeight: 500,
        formatter: (val: number) => {
          if (isCurrencyAxis) {
            if (Math.abs(val) >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
            if (Math.abs(val) >= 1_000) return `$${(val / 1_000).toFixed(0)}k`;
            return `$${val}`;
          }
          if (isPercentAxis) {
            return `${val}%`;
          }
          return `${val}`;
        },
      },
      splitLine: { show: true, lineStyle: { color: '#E2E8F0', width: 1, type: 'dashed' } },
    },
    series,
  };
}
