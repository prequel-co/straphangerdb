import { describe, it, expect } from 'vitest';
import {
  normalizeOssieColumnName,
  matchesTileContract,
  detectUnlockedTransitTiles,
  TILE_CONTRACTS,
} from '../src/types/schema-contracts.js';

describe('Schema Detector and Transit Tile Contracts', () => {
  it('strips dataset prefix from Ossie column names', () => {
    expect(normalizeOssieColumnName('station_headways.headway_sec')).toBe('headway_sec');
    expect(normalizeOssieColumnName('turnstile_flows.event_date')).toBe('event_date');
    expect(normalizeOssieColumnName('headway_sec')).toBe('headway_sec');
  });

  it('matches Marey chart contract when trip_id, arrival_time, and station_id are present', () => {
    const cols = ['trip_id', 'arrival_time', 'station_id', 'stop_sequence'];
    expect(matchesTileContract(cols, TILE_CONTRACTS['marey-chart'])).toBe(true);

    const missingTrip = ['arrival_time', 'station_id'];
    expect(matchesTileContract(missingTrip, TILE_CONTRACTS['marey-chart'])).toBe(false);
  });

  it('matches Isochrone Map contract when latitude, longitude, and travel time are present', () => {
    const cols = ['station_id', 'latitude', 'longitude', 'travel_time_sec'];
    expect(matchesTileContract(cols, TILE_CONTRACTS['isochrone-map'])).toBe(true);

    const missingLat = ['station_id', 'longitude', 'travel_time_sec'];
    expect(matchesTileContract(missingLat, TILE_CONTRACTS['isochrone-map'])).toBe(false);
  });

  it('matches Train Position Map contract when vehicle_id, coordinates, and event_time are present', () => {
    const cols = ['vehicle_id', 'latitude', 'longitude', 'event_time', 'speed'];
    expect(matchesTileContract(cols, TILE_CONTRACTS['train-position-map'])).toBe(true);
  });

  it('matches Adherence Waterfall contract when scheduled and observed trips are present', () => {
    const cols = ['scheduled_trips_count', 'observed_trips_count', 'route_id'];
    expect(matchesTileContract(cols, TILE_CONTRACTS['adherence-waterfall'])).toBe(true);
  });

  it('detects multiple unlocked transit tiles simultaneously', () => {
    const richCols = [
      'trip_id',
      'arrival_time',
      'station_id',
      'route_id',
      'headway_sec',
      'latitude',
      'longitude',
      'travel_time_sec',
    ];

    const unlocked = detectUnlockedTransitTiles(richCols);
    expect(unlocked).toContain('marey-chart');
    expect(unlocked).toContain('station-progression');
    expect(unlocked).toContain('headway-horizon');
    expect(unlocked).toContain('isochrone-map');
  });

  it('returns empty array when columns match no transit contracts', () => {
    const genericCols = ['id', 'user_name', 'email_address'];
    const unlocked = detectUnlockedTransitTiles(genericCols);
    expect(unlocked).toEqual([]);
  });
});
