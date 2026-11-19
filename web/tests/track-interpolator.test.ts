import { describe, it, expect } from 'vitest';
import { interpolateTrainPosition, type TrackPoint } from '../src/viz/transit/track-interpolator.js';

describe('Track Interpolator for Train Centerlines', () => {
  it('returns pos1 coordinates when event times are identical', () => {
    const p1: TrackPoint = { lon: -73.9851, lat: 40.7488, eventTime: 1000 };
    const p2: TrackPoint = { lon: -73.9800, lat: 40.7500, eventTime: 1000 };
    const [lon, lat] = interpolateTrainPosition(p1, p2, 1000);
    expect(lon).toBeCloseTo(-73.9851);
    expect(lat).toBeCloseTo(40.7488);
  });

  it('interpolates exact midpoint when targetTime is halfway between observations', () => {
    const p1: TrackPoint = { lon: -73.9800, lat: 40.7500, eventTime: 1000 };
    const p2: TrackPoint = { lon: -73.9700, lat: 40.7600, eventTime: 2000 };
    const [lon, lat] = interpolateTrainPosition(p1, p2, 1500);
    expect(lon).toBeCloseTo(-73.9750);
    expect(lat).toBeCloseTo(40.7550);
  });

  it('clamps ratio between 0 and 1 when targetTime is outside observation window', () => {
    const p1: TrackPoint = { lon: -73.9800, lat: 40.7500, eventTime: 1000 };
    const p2: TrackPoint = { lon: -73.9700, lat: 40.7600, eventTime: 2000 };

    const [lonEarly, latEarly] = interpolateTrainPosition(p1, p2, 500);
    expect(lonEarly).toBeCloseTo(-73.9800);
    expect(latEarly).toBeCloseTo(40.7500);

    const [lonLate, latLate] = interpolateTrainPosition(p1, p2, 2500);
    expect(lonLate).toBeCloseTo(-73.9700);
    expect(latLate).toBeCloseTo(40.7600);
  });

  it('accurately interpolates Lexington Avenue subway stops', () => {
    // Grand Central (-73.9772, 40.7527) to 59th St (-73.9679, 40.7628)
    const grandCentral: TrackPoint = { lon: -73.9772, lat: 40.7527, eventTime: 0 };
    const fiftyNinth: TrackPoint = { lon: -73.9679, lat: 40.7628, eventTime: 120 };

    // At 60 seconds (halfway through the leg)
    const [lon, lat] = interpolateTrainPosition(grandCentral, fiftyNinth, 60);
    expect(lon).toBeCloseTo((-73.9772 + -73.9679) / 2);
    expect(lat).toBeCloseTo((40.7527 + 40.7628) / 2);
  });
});
