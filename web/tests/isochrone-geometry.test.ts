import { describe, it, expect } from 'vitest';
import {
  generateCirclePolygon,
  buildIsochroneBandsGeoJson,
  type IsochroneStationPoint,
} from '../src/viz/transit/isochrone-map.js';

describe('Isochrone Geometry and Walking Shed Union', () => {
  it('generates a closed circle polygon ring with correct vertex count', () => {
    const centerLon = -73.9851;
    const centerLat = 40.7488;
    const radiusMeters = 400;
    const points = 32;

    const ring = generateCirclePolygon(centerLon, centerLat, radiusMeters, points);

    // Number of vertices must be points + 1 for closed ring
    expect(ring).toHaveLength(points + 1);

    // First and last coordinates must match exactly to form a closed polygon
    const first = ring[0]!;
    const last = ring[ring.length - 1]!;
    expect(first[0]).toBeCloseTo(last[0]!);
    expect(first[1]).toBeCloseTo(last[1]!);
  });

  it('calculates expected radius displacement in meters', () => {
    const centerLon = -73.9851;
    const centerLat = 40.7488;
    const radiusMeters = 1000;

    const ring = generateCirclePolygon(centerLon, centerLat, radiusMeters, 16);

    // Max delta latitude should be approx 1000m / 111,320m per deg = ~0.00898 deg
    let maxDLat = 0;
    for (const [_, lat] of ring) {
      maxDLat = Math.max(maxDLat, Math.abs(lat - centerLat));
    }
    expect(maxDLat).toBeCloseTo(1000 / 111320, 3);
  });

  it('builds multi-band GeoJSON with walking shed cap and descending band ordering', () => {
    const stations: IsochroneStationPoint[] = [
      { stationId: '127', lon: -73.987, lat: 40.751, transitTimeMin: 5 },
      { stationId: '128', lon: -73.982, lat: 40.756, transitTimeMin: 12 },
      { stationId: '129', lon: -73.978, lat: 40.760, transitTimeMin: 22 },
    ];

    const bands = [10, 20, 30];
    const geojson = buildIsochroneBandsGeoJson(stations, bands, 80, 800);

    expect(geojson.type).toBe('FeatureCollection');
    expect(geojson.features.length).toBeGreaterThan(0);

    // Features must be sorted descending by band so smaller/nearer bands render on top
    const featureBands = geojson.features.map(f => (f.properties as any).band);
    expect(featureBands).toEqual([30, 20, 10]);

    // All features must have MultiPolygon geometry
    for (const feat of geojson.features) {
      expect(feat.geometry.type).toBe('MultiPolygon');
    }
  });
});
