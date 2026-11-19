import { describe, expect, it } from 'vitest';
import {
  applyProposedServiceLines,
  buildHistoricalElevatedGeoJson,
  filterHistoricalServiceLines,
  filterHistoricalStations,
  PENN_ACCESS_MNR_CORRIDOR,
  PROPOSED_EXTRA_STATIONS,
} from '../src/viz/map/historical-networks.js';

describe('Historical Network Eras (1953 & 1929)', () => {
  it('excludes Archer Ave, 63rd St, Rockaways, and post-1953 routes in 1953 while extending J to 168 St and G to Forest Hills', () => {
    const sampleLines: GeoJSON.Feature[] = [
      {
        type: 'Feature',
        properties: { route_id: 'Z' },
        geometry: { type: 'LineString', coordinates: [[-73.9, 40.7], [-73.85, 40.7]] },
      },
      {
        type: 'Feature',
        properties: { route_id: 'J' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [-73.85, 40.695],
            [-73.8283, 40.7005],
            [-73.803, 40.702], // Archer Ave (1988)
          ],
        },
      },
      {
        type: 'Feature',
        properties: { route_id: 'G' },
        geometry: {
          type: 'LineString',
          coordinates: [[-73.979, 40.644], [-73.9452, 40.747]],
        },
      },
      {
        type: 'Feature',
        properties: { route_id: 'F' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [-73.985, 40.745],
            [-73.98, 40.75],
            [-73.95, 40.764], // 63rd St Tunnel (1989)
            [-73.86, 40.73],
            [-73.84, 40.72],
          ],
        },
      },
    ];

    const filtered = filterHistoricalServiceLines(sampleLines, '1953');
    const routeIds = filtered.map(f => (f.properties as Record<string, unknown>)['route_id']);
    expect(routeIds).not.toContain('Z');
    expect(routeIds).toContain('J');
    expect(routeIds).toContain('G');

    const jFeat = filtered.find(f => (f.properties as Record<string, unknown>)['route_id'] === 'J')!;
    const jCoords = JSON.stringify(jFeat.geometry);
    expect(jCoords).not.toContain('-73.803');
    expect(jCoords).toContain('-73.7936'); // 168 St terminal

    const gFeat = filtered.find(f => (f.properties as Record<string, unknown>)['route_id'] === 'G')!;
    const gCoords = JSON.stringify(gFeat.geometry);
    expect(gCoords).toContain('-73.8445'); // Forest Hills-71 Av

    const fFeat = filtered.find(f => (f.properties as Record<string, unknown>)['route_id'] === 'F')!;
    expect(JSON.stringify(fFeat.geometry)).not.toContain('-73.95,40.764');
  });

  it('provides 1953 elevateds (3rd Ave El, Myrtle El, Culver Shuttle) and 1929 elevateds (2nd/3rd/6th/9th/Myrtle/Fulton/Lex/Culver) with elevated schema', () => {
    const el1953 = buildHistoricalElevatedGeoJson('1953');
    const ids1953 = el1953.features.map(f => (f.properties as Record<string, unknown>)['id']);
    expect(ids1953).toContain('el-3rd-ave');
    expect(ids1953).toContain('el-myrtle-ave');
    expect(ids1953).toContain('el-culver-shuttle');
    expect(ids1953).not.toContain('el-2nd-ave');
    expect((el1953.features[0]?.properties as Record<string, unknown>)['structure']).toBe('elevated');

    const el1929 = buildHistoricalElevatedGeoJson('1929');
    const ids1929 = el1929.features.map(f => (f.properties as Record<string, unknown>)['id']);
    expect(ids1929).toContain('el-2nd-ave');
    expect(ids1929).toContain('el-2nd-ave-queensboro');
    expect(ids1929).toContain('el-3rd-ave');
    expect(ids1929).toContain('el-5th-ave-bklyn');
    expect(ids1929).toContain('el-6th-ave');
    expect(ids1929).toContain('el-9th-ave');
    expect(ids1929).toContain('el-fulton-st');
    expect(ids1929).toContain('el-lexington-bklyn');
    expect(ids1929).toContain('el-culver-1929');
    const astoriaEl = el1929.features.find(f => (f.properties as Record<string, unknown>)['id'] === 'el-2nd-ave-queensboro')!;
    expect(JSON.stringify(astoriaEl.geometry)).toContain('-73.912,40.775');
  });

  it('removes Queens Blvd Line (QBL) from M and R and removes IND stations in 1929', () => {
    const sample1929Lines: GeoJSON.Feature[] = [
      {
        type: 'Feature',
        properties: { route_id: 'A' },
        geometry: { type: 'LineString', coordinates: [[-73.99, 40.75], [-73.98, 40.71]] },
      },
      {
        type: 'Feature',
        properties: { route_id: 'R' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [-73.985, 40.755], // Midtown BMT
            [-73.891, 40.746], // Queens Blvd Line (did not exist in 1929)
          ],
        },
      },
    ];
    const filtered = filterHistoricalServiceLines(sample1929Lines, '1929');
    const routeIds = filtered.map(f => (f.properties as Record<string, unknown>)['route_id']);
    expect(routeIds).not.toContain('A');
    const rFeat = filtered.find(f => (f.properties as Record<string, unknown>)['route_id'] === 'R');
    if (rFeat) {
      expect(JSON.stringify(rFeat.geometry)).not.toContain('-73.891');
    }

    const stations: GeoJSON.Feature[] = [
      { type: 'Feature', properties: { gtfs_stop_id: 'G14', daytime_routes: 'E F M R' }, geometry: { type: 'Point', coordinates: [-73.891, 40.746] } },
      { type: 'Feature', properties: { gtfs_stop_id: '127', daytime_routes: '1 2 3' }, geometry: { type: 'Point', coordinates: [-73.987, 40.755] } },
    ];
    const kept1929 = filterHistoricalStations(stations, '1929');
    expect(kept1929.map(s => (s.properties as Record<string, unknown>)['gtfs_stop_id'])).toEqual(['127']);
  });

  it('keeps M on Myrtle El only (no Marcy Av / Williamsburg Bridge overlap with J) in 1929 & 1953, connects 1929 N via 59th St to Queensboro Plaza, and includes QueensLink & Penn Access in Proposed', () => {
    const mModern: GeoJSON.Feature[] = [
      {
        type: 'Feature',
        properties: { route_id: 'M' },
        geometry: {
          type: 'MultiLineString',
          coordinates: [
            [[-73.9575, 40.7083], [-73.9878, 40.7183], [-73.8445, 40.7217]], // Marcy Av -> Essex -> Forest Hills
          ],
        },
      },
      {
        type: 'Feature',
        properties: { route_id: 'N' },
        geometry: {
          type: 'MultiLineString',
          coordinates: [
            [[-73.9679, 40.7625], [-73.9402, 40.7506], [-73.912, 40.775]], // 59 St -> Queensboro -> Ditmars
          ],
        },
      },
    ];
    const m1953 = filterHistoricalServiceLines(mModern, '1953').find(
      f => (f.properties as Record<string, unknown>)['route_id'] === 'M'
    )!;
    expect(JSON.stringify(m1953.geometry)).not.toContain('-73.9575'); // No Marcy Av
    expect(JSON.stringify(m1953.geometry)).toContain('-73.9873'); // Bridge-Jay Sts

    const n1929All = filterHistoricalServiceLines(
      [
        ...mModern,
        {
          type: 'Feature',
          properties: { route_id: 'L' },
          geometry: {
            type: 'LineString',
            coordinates: [[-74.0017, 40.74], [-73.9967, 40.7378], [-73.9906, 40.7351]], // 8 Av -> 6 Av -> Union Sq
          },
        },
      ],
      '1929'
    );
    const n1929 = n1929All.find(f => (f.properties as Record<string, unknown>)['route_id'] === 'N')!;
    expect(JSON.stringify(n1929.geometry)).toContain('-73.9402'); // Queensboro Plaza
    expect(JSON.stringify(n1929.geometry)).not.toContain('-73.912'); // Not Astoria (2nd Ave El serves Astoria)

    const l1929 = n1929All.find(f => (f.properties as Record<string, unknown>)['route_id'] === 'L')!;
    expect(JSON.stringify(l1929.geometry)).not.toContain('-74.0017'); // No 8 Av in 1929
    expect(JSON.stringify(l1929.geometry)).toContain('-73.9967'); // Ends at 6 Av

    const lStations = filterHistoricalStations(
      [
        { type: 'Feature', properties: { gtfs_stop_id: 'L01', name: '8 Av', daytime_routes: 'L' }, geometry: { type: 'Point', coordinates: [-74.0017, 40.74] } },
        { type: 'Feature', properties: { gtfs_stop_id: 'L02', name: '6 Av', daytime_routes: 'L' }, geometry: { type: 'Point', coordinates: [-73.9967, 40.7378] } },
      ],
      '1929'
    );
    expect(lStations.map(s => (s.properties as Record<string, unknown>)['gtfs_stop_id'])).toEqual(['L02']);

    const el5th = buildHistoricalElevatedGeoJson('1929').features.find(
      f => (f.properties as Record<string, unknown>)['id'] === 'el-5th-ave-bklyn'
    )!;
    expect(JSON.stringify(el5th.geometry)).toContain('-73.9806,40.6766'); // Parallel on 5th Ave, not 4th Ave
    expect(JSON.stringify(el5th.geometry)).not.toContain('-73.9946,40.6463'); // No 9th Ave detour

    const proposed = applyProposedServiceLines(mModern);
    const mProp = proposed.find(f => (f.properties as Record<string, unknown>)['route_id'] === 'M')!;
    expect(JSON.stringify(mProp.geometry)).toContain('-73.8356'); // Rockaway Park (QueensLink)
    expect(JSON.stringify(mProp.geometry)).toContain('-73.8412,40.6808'); // Liberty Av / Rockaway Blvd along 99 St
    expect(PENN_ACCESS_MNR_CORRIDOR.length).toBeGreaterThanOrEqual(8);
    expect(PROPOSED_EXTRA_STATIONS.some(s => s.stationId === 'PSA01')).toBe(true);
  });
});
