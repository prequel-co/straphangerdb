import type { Map } from 'maplibre-gl';
import { WarpedMapLayer } from '@allmaps/maplibre';

export interface AllmapsPreset {
  readonly id: string;
  readonly title: string;
  readonly year: number;
  readonly description: string;
  readonly annotationUrl: string;
}

export const ALLMAPS_IIIF_PRESETS: readonly AllmapsPreset[] = [
  {
    id: 'ind-1953',
    title: 'IND Service Guide (Independent System)',
    year: 1953,
    description: '1953 Board of Transportation IND Service Guide ("Independent City Owned Rapid Transit Railroad")',
    annotationUrl: 'https://annotations.allmaps.org/manifests/nyct-1953-ind-service-guide',
  },
  {
    id: 'tauranac-hertz-1979',
    title: 'Tauranac / Hertz NYC Subway Map',
    year: 1979,
    description: 'Classic geographic NYC Subway Map designed by Michael Hertz Associates & John Tauranac',
    annotationUrl: 'https://annotations.allmaps.org/manifests/mta-1979-tauranac-hertz',
  },
  {
    id: 'unification-1939',
    title: '1939 NYCT Unification Map',
    year: 1939,
    description: 'City of New York unified transit system map uniting IRT, BMT, and IND networks',
    annotationUrl: 'https://annotations.allmaps.org/manifests/nyct-1939-unification',
  },
  {
    id: 'irt-1904',
    title: '1904 IRT Opening Subway Map',
    year: 1904,
    description: 'Original Interborough Rapid Transit contract 1 subway line from City Hall to 145th St',
    annotationUrl: 'https://annotations.allmaps.org/manifests/irt-1904-opening',
  },
];

export class DbtcAllmapsLayer {
  private layer: WarpedMapLayer | null = null;
  private activePresetId: string | null = null;
  private hostMap: Map | null = null;

  public attachToMap(map: Map): void {
    this.hostMap = map;
    if (!this.layer) {
      this.layer = new WarpedMapLayer();
      map.addLayer(this.layer as any);
    }
  }

  public getActivePreset(): string | null {
    return this.activePresetId;
  }

  public async loadAnnotationUrl(annotationUrl: string): Promise<boolean> {
    if (this.hostMap && this.layer) {
      try {
        if (typeof (this.layer as any).clear === 'function') {
          (this.layer as any).clear();
        } else if (this.hostMap.getLayer(this.layer.id)) {
          this.hostMap.removeLayer(this.layer.id);
          this.layer = new WarpedMapLayer();
          this.hostMap.addLayer(this.layer as any);
        }
        await (this.layer as any).addGeoreferenceAnnotationByUrl(annotationUrl);
        return true;
      } catch (err) {
        console.warn('Failed to load Allmaps georeference annotation:', err);
        return false;
      }
    }
    return false;
  }

  public async loadPreset(presetId: string): Promise<boolean> {
    const preset = ALLMAPS_IIIF_PRESETS.find(p => p.id === presetId);
    if (!preset) return false;
    const loaded = await this.loadAnnotationUrl(preset.annotationUrl);
    if (loaded) {
      this.activePresetId = presetId;
    }
    return loaded;
  }

  public remove(map: Map): void {
    if (this.layer) {
      if (map.getLayer(this.layer.id)) {
        map.removeLayer(this.layer.id);
      }
      this.layer = null;
      this.activePresetId = null;
    }
    if (this.hostMap === map) {
      this.hostMap = null;
    }
  }
}
