export interface TrackPoint {
  readonly lon: number;
  readonly lat: number;
  readonly eventTime: number;
  readonly bearing?: number;
  readonly speed?: number;
}

export function interpolateTrainPosition(
  pos1: TrackPoint,
  pos2: TrackPoint,
  targetTime: number
): [number, number] {
  if (pos2.eventTime === pos1.eventTime) {
    return [pos1.lon, pos1.lat];
  }
  const ratio = Math.max(0, Math.min(1, (targetTime - pos1.eventTime) / (pos2.eventTime - pos1.eventTime)));
  const lon = pos1.lon + ratio * (pos2.lon - pos1.lon);
  const lat = pos1.lat + ratio * (pos2.lat - pos1.lat);
  return [lon, lat];
}

export const interpolateTrainPositions = interpolateTrainPosition;
