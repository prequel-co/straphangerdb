import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  buildMapStyleForTheme,
  getMapThemeSpec,
  type MapVisualThemeId,
} from './transit-map-style.js';
import { DbtcAllmapsLayer, ALLMAPS_IIIF_PRESETS, type AllmapsPreset } from './allmaps-layer.js';

export { ALLMAPS_IIIF_PRESETS, type AllmapsPreset };

export class DbtcMapController {
  private map: maplibregl.Map | null = null;
  private isManhattanTilted = false;
  private allmapsLayer: DbtcAllmapsLayer | null = null;
  private activeTheme: MapVisualThemeId = 'mta';

  constructor(private container: HTMLElement) {}

  public initMap(
    center: [number, number] = [-73.985, 40.748],
    zoom = 12,
    theme: MapVisualThemeId = 'mta'
  ): maplibregl.Map {
    if (this.map) {
      this.map.remove();
    }
    this.activeTheme = theme;

    this.map = new maplibregl.Map({
      container: this.container,
      style: buildMapStyleForTheme(theme),
      center,
      zoom,
      bearing: 0,
      pitch: 0,
      maxPitch: 0,
      preserveDrawingBuffer: true,
    });

    this.map.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: true }), 'top-right');
    return this.map;
  }

  public getVisualTheme(): MapVisualThemeId {
    return this.activeTheme;
  }

  public setVisualTheme(theme: MapVisualThemeId): void {
    this.activeTheme = theme;
    if (this.map && typeof (this.map as any).setPaintProperty === 'function') {
      const spec = getMapThemeSpec(theme);
      try {
        if (this.map.getLayer('background')) {
          this.map.setPaintProperty(
            'background',
            'background-color',
            spec.isGeographicBasemap ? spec.landFillColor : spec.waterColor
          );
        }
      } catch {
        // Ignore if background layer is not ready yet
      }
    }
  }

  public getMap(): maplibregl.Map | null {
    return this.map;
  }

  public toggleManhattanTilt(): boolean {
    if (!this.map) return false;
    this.isManhattanTilted = !this.isManhattanTilted;
    const targetBearing = this.isManhattanTilted ? 29 : 0;
    this.map.easeTo({
      bearing: targetBearing,
      duration: 800,
    });
    return this.isManhattanTilted;
  }

  public async enableAllmapsPreset(presetId: string): Promise<boolean> {
    if (!this.map) return false;
    if (this.allmapsLayer) {
      this.allmapsLayer.remove(this.map);
      this.allmapsLayer = null;
    }
    this.allmapsLayer = new DbtcAllmapsLayer();
    this.allmapsLayer.attachToMap(this.map);
    return await this.allmapsLayer.loadPreset(presetId);
  }

  public async enableAllmapsAnnotation(annotationUrl: string): Promise<boolean> {
    if (!this.map) return false;
    if (this.allmapsLayer) {
      this.allmapsLayer.remove(this.map);
      this.allmapsLayer = null;
    }
    this.allmapsLayer = new DbtcAllmapsLayer();
    this.allmapsLayer.attachToMap(this.map);
    return await this.allmapsLayer.loadAnnotationUrl(annotationUrl);
  }

  public removeAllmaps(): void {
    if (this.map && this.allmapsLayer) {
      this.allmapsLayer.remove(this.map);
      this.allmapsLayer = null;
    }
  }

  public getAllmapsLayer(): DbtcAllmapsLayer | null {
    return this.allmapsLayer;
  }

  public destroy(): void {
    if (this.map) {
      const mAny = this.map as any;
      if (mAny._timelapseAnimId) {
        cancelAnimationFrame(mAny._timelapseAnimId);
        mAny._timelapseAnimId = null;
      }
      if (mAny._liveSyncBadgeTimer) {
        clearTimeout(mAny._liveSyncBadgeTimer);
        mAny._liveSyncBadgeTimer = null;
      }
      if (this.allmapsLayer) {
        this.allmapsLayer.remove(this.map);
        this.allmapsLayer = null;
      }
      this.map.remove();
      this.map = null;
    }
  }
}
