import type { CellId, CellViewIdentifier, DuckLakeSnapshotId, ResolvedSql } from './brands.js';
import type { TypedOssieConfig } from './straphanger-schema.gen.js';

export type CellKind = 'question' | 'markdown';

export type ChartType =
  // 16 Standard BI types
  | 'table'
  | 'bar'
  | 'stacked-bar'
  | 'line'
  | 'area'
  | 'stacked-area'
  | 'scatter'
  | 'pie'
  | 'donut'
  | 'kpi-metric'
  | 'gauge'
  | 'heatmap'
  | 'treemap'
  | 'funnel'
  | 'radar'
  | 'choropleth-borough'
  // 9 Schema-Unlocked Transit Visuals
  | 'marey-chart'
  | 'station-progression'
  | 'route-segment-map'
  | 'isochrone-map'
  | 'train-position-map'
  | 'headway-horizon'
  | 'adherence-waterfall'
  | 'multimodal-pulse'
  | 'od-ridership-flow';

export type ExecutionMode = 'standard' | 'offline' | 'live';

export type CellExecutionStatus =
  | 'idle'
  | 'booting'
  | 'running'
  | 'success'
  | 'error'
  | 'stale-upstream';

export type CellExecutionState =
  | { readonly status: 'idle' }
  | { readonly status: 'booting'; readonly startTime: number }
  | { readonly status: 'running'; readonly startTime: number }
  | {
      readonly status: 'success';
      readonly executionMs: number;
      readonly rowCount: number;
      readonly executedAt: number;
      readonly executedMode?: ExecutionMode;
    }
  | { readonly status: 'error'; readonly error: string; readonly failedAt: number }
  | { readonly status: 'stale-upstream'; readonly upstreamCellId: CellId };

export type SnapshotResolutionState =
  | { readonly status: 'unpinned' }
  | { readonly status: 'pinned-valid'; readonly snapshotId: DuckLakeSnapshotId; readonly snapshotTimestamp: number }
  | { readonly status: 'expired-fallback-live'; readonly originalSnapshotId: DuckLakeSnapshotId; readonly expiredAt: number }
  | { readonly status: 'snapshot-error'; readonly message: string };

export type MapVisualThemeId = 'mta' | 'tauranac-hertz' | 'ind' | 'geo-light' | 'geo-dark';

export interface MapTableSelectionConfig {
  readonly routesTable: string;
  readonly tracksTable: string;
  readonly stationsTable: string;
  readonly presetId?: string;
  readonly theme?: MapVisualThemeId;
  readonly hideSubwayOverlay?: boolean;
  readonly corridorOverlay?: string;
}

export interface BaseChartConfig {
  readonly title?: string;
  readonly subtitle?: string;
  readonly sourceNote?: string;
  readonly xColumn?: string;
  readonly yColumns?: readonly string[];
  readonly colorColumn?: string;
  readonly aggregation?: 'sum' | 'avg' | 'count' | 'min' | 'max';
  readonly yAxisScale?: 'auto' | 'log' | 'linear';
  readonly useLogScale?: boolean;
  readonly mapTables?: MapTableSelectionConfig;
  readonly columnMapping?: Readonly<Record<string, string>>;
  readonly customColors?: Readonly<Record<string, string>>;
  readonly colorPalette?: string;
  readonly [key: string]: unknown;
}

export interface MareyChartConfig extends BaseChartConfig {
  readonly timeColumn?: string;
  readonly stationOrderColumn?: string;
  readonly tripIdColumn?: string;
  readonly routeIdColumn?: string;
}

export interface StationProgressionConfig extends BaseChartConfig {
  readonly alignmentMode?: 'corridor' | 'normalized';
  readonly metricColumn?: string;
  readonly showBoroughBands?: boolean;
}

export interface RouteSegmentMapConfig extends BaseChartConfig {
  readonly metricColumn?: string;
  readonly showStationBubbles?: boolean;
}

export interface IsochroneMapConfig extends BaseChartConfig {
  readonly originStationId?: string;
  readonly cutoffMinutes?: readonly number[];
  readonly walkSpeedMpm?: number;
}

export interface TrainPositionMapConfig extends BaseChartConfig {
  readonly timeWindowMinutes?: number;
  readonly isLiveNow?: boolean;
  readonly selectedTimestamp?: number;
}

export interface HeadwayHorizonConfig extends BaseChartConfig {
  readonly bunchingThresholdSec?: number;
  readonly gappingThresholdSec?: number;
  readonly yAxisScale?: 'auto' | 'log' | 'linear';
}

export interface AdherenceWaterfallConfig extends BaseChartConfig {
  readonly splitGhostTrips?: boolean;
}

export interface MultimodalPulseConfig extends BaseChartConfig {
  readonly radiusMeters?: number;
}

export interface OdFlowConfig extends BaseChartConfig {
  readonly topNLanes?: number;
}

export type TypedChartConfig =
  | { readonly chartType: 'table'; readonly config: BaseChartConfig }
  | { readonly chartType: 'bar'; readonly config: BaseChartConfig }
  | { readonly chartType: 'stacked-bar'; readonly config: BaseChartConfig }
  | { readonly chartType: 'line'; readonly config: BaseChartConfig }
  | { readonly chartType: 'area'; readonly config: BaseChartConfig }
  | { readonly chartType: 'stacked-area'; readonly config: BaseChartConfig }
  | { readonly chartType: 'scatter'; readonly config: BaseChartConfig }
  | { readonly chartType: 'pie'; readonly config: BaseChartConfig }
  | { readonly chartType: 'donut'; readonly config: BaseChartConfig }
  | { readonly chartType: 'kpi-metric'; readonly config: BaseChartConfig }
  | { readonly chartType: 'gauge'; readonly config: BaseChartConfig }
  | { readonly chartType: 'heatmap'; readonly config: BaseChartConfig }
  | { readonly chartType: 'treemap'; readonly config: BaseChartConfig }
  | { readonly chartType: 'funnel'; readonly config: BaseChartConfig }
  | { readonly chartType: 'radar'; readonly config: BaseChartConfig }
  | { readonly chartType: 'choropleth-borough'; readonly config: BaseChartConfig }
  | { readonly chartType: 'marey-chart'; readonly config: MareyChartConfig }
  | { readonly chartType: 'station-progression'; readonly config: StationProgressionConfig }
  | { readonly chartType: 'route-segment-map'; readonly config: RouteSegmentMapConfig }
  | { readonly chartType: 'isochrone-map'; readonly config: IsochroneMapConfig }
  | { readonly chartType: 'train-position-map'; readonly config: TrainPositionMapConfig }
  | { readonly chartType: 'headway-horizon'; readonly config: HeadwayHorizonConfig }
  | { readonly chartType: 'adherence-waterfall'; readonly config: AdherenceWaterfallConfig }
  | { readonly chartType: 'multimodal-pulse'; readonly config: MultimodalPulseConfig }
  | { readonly chartType: 'od-ridership-flow'; readonly config: OdFlowConfig };

// Safe reactive cell state
export interface ReactiveCellState {
  readonly cellId: CellId;
  ordinal: number;
  viewName: CellViewIdentifier;
  kind: CellKind;
  title: string;
  subtitle: string;
  sourceNote: string;
  markdownText: string;
  sqlText: string;
  params: Record<string, string>;
  ossieConfig: TypedOssieConfig | null;
  chartType: ChartType;
  chartConfig: Record<string, unknown>;
  ducklakeSnapshotId: DuckLakeSnapshotId | null;
  executionState: CellExecutionState;
  snapshotState: SnapshotResolutionState;
  showSqlEditor: boolean;
  showOssiePillBar: boolean;
}

export interface ReactiveSourceState {
  readonly sourceName: string;
  readonly kind: 'local_upload' | 'remote_csv_url' | 'remote_parquet_url';
  readonly urlOrFilename: string;
  readonly byteSize: number;
  includeInOfflineExport: boolean;
  readonly createdAt: number;
}

export interface ReactiveNotebookState {
  docId: string;
  schemaVersion: string;
  title: string;
  mode: ExecutionMode;
  liveIntervalSec: number;
  catalogUrl: string;
  ossieIndexUrl: string;
  modifiedAt: number;
  readOnlyStoryMode: boolean;
  activeView: 'studio' | 'data';
  activeCellId: CellId | null;
  manhattanTilt: boolean;
  engineStatus?: 'booting' | 'ready' | 'error';
  lastLiveRefreshAt?: number | undefined;
  nextLiveRefreshAt?: number | undefined;
  isLiveRefreshing?: boolean | undefined;
}

// Compile-time deep safety check for ArrowJS reactive state
type ForbiddenTypes =
  | bigint
  | Function
  | ArrayBuffer
  | SharedArrayBuffer
  | DataView
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array
  | Map<unknown, unknown>
  | Set<unknown>
  | WeakMap<object, unknown>
  | WeakSet<object>
  | Node;

export type DeepReactiveSafe<T> = T extends ForbiddenTypes
  ? never
  : T extends (...args: unknown[]) => unknown
  ? never
  : T extends readonly (infer U)[]
  ? readonly DeepReactiveSafe<U>[]
  : T extends (infer U)[]
  ? DeepReactiveSafe<U>[]
  : T extends object
  ? { [K in keyof T]: DeepReactiveSafe<T[K]> }
  : T;
