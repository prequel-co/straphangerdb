import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ECharts } from 'echarts';
import {
  exportCardImage,
  downloadDataUrl,
  type CardExportOptions,
} from '../src/viz/card-image-export.js';

describe('Editorial Card Image Export', () => {
  let savedDocument: unknown;

  beforeEach(() => {
    savedDocument = (globalThis as any).document;
  });

  afterEach(() => {
    (globalThis as any).document = savedDocument;
  });

  it('validates CardExportOptions data structures', () => {
    const fullOptions: CardExportOptions = {
      title: 'Lexington Avenue Corridor Headway Distribution',
      subtitle: 'Rush-hour train spacing between 125th St and Bowling Green',
      sourceNote: 'Source: MTA GTFS-RT · StraphangerDB',
      fullCard: true,
      format: 'png',
      dpiScale: 2,
    };

    expect(fullOptions.title).toBe('Lexington Avenue Corridor Headway Distribution');
    expect(fullOptions.fullCard).toBe(true);
    expect(fullOptions.dpiScale).toBe(2);
    expect(fullOptions.format).toBe('png');
  });

  it('triggers downloadDataUrl on bare-canvas export when fullCard is false', async () => {
    const fakeAnchor = {
      href: '',
      download: '',
      click: vi.fn(),
    };
    const fakeBody = {
      appendChild: vi.fn(),
      removeChild: vi.fn(),
    };

    (globalThis as any).document = {
      body: fakeBody,
      createElement: vi.fn().mockImplementation((tag: string) => {
        if (tag === 'a') return fakeAnchor;
        return {};
      }),
    };

    const mockEcharts = {
      getDataURL: vi.fn().mockReturnValue('data:image/png;base64,FAKE_IMAGE_DATA'),
    } as unknown as ECharts;

    const fakeContainer = {} as HTMLElement;

    await exportCardImage(mockEcharts, fakeContainer, {
      title: 'Test Chart',
      fullCard: false,
      format: 'png',
      dpiScale: 2,
    });

    expect(mockEcharts.getDataURL).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'png',
        pixelRatio: 2,
      })
    );
    expect(fakeAnchor.download).toBe('test_chart_export.png');
    expect(fakeAnchor.href).toBe('data:image/png;base64,FAKE_IMAGE_DATA');
    expect(fakeAnchor.click).toHaveBeenCalledTimes(1);
    expect(fakeBody.appendChild).toHaveBeenCalledTimes(1);
    expect(fakeBody.removeChild).toHaveBeenCalledTimes(1);
  });

  it('exports bare SVG visual when fullCard is false and format is svg', async () => {
    const fakeAnchor = {
      href: '',
      download: '',
      click: vi.fn(),
    };
    const fakeBody = {
      appendChild: vi.fn(),
      removeChild: vi.fn(),
    };

    (globalThis as any).document = {
      body: fakeBody,
      createElement: vi.fn().mockImplementation((tag: string) => {
        if (tag === 'a') return fakeAnchor;
        return {};
      }),
    };

    const mockEcharts = {
      getDataURL: vi.fn().mockReturnValue('data:image/png;base64,CHART_PNG'),
    } as unknown as ECharts;

    const fakeContainer = {
      clientWidth: 800,
      clientHeight: 500,
      querySelector: vi.fn().mockReturnValue(null),
    } as unknown as HTMLElement;

    await exportCardImage(mockEcharts, fakeContainer, {
      title: 'Bare Vector Visual',
      fullCard: false,
      format: 'svg',
      dpiScale: 2,
    });

    expect(fakeAnchor.download).toBe('bare_vector_visual_export.svg');
    expect(fakeAnchor.href).toContain('data:image/svg+xml');
    const decodedSvg = decodeURIComponent(fakeAnchor.href);
    expect(decodedSvg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(decodedSvg).toContain('width="800"');
    expect(decodedSvg).toContain('<image href="data:image/png;base64,CHART_PNG"');
    expect(fakeAnchor.click).toHaveBeenCalledTimes(1);
  });

  it('exports publication card SVG with titles and footer when fullCard is true', async () => {
    const fakeAnchor = {
      href: '',
      download: '',
      click: vi.fn(),
    };
    const fakeBody = {
      appendChild: vi.fn(),
      removeChild: vi.fn(),
    };

    (globalThis as any).document = {
      body: fakeBody,
      createElement: vi.fn().mockImplementation((tag: string) => {
        if (tag === 'a') return fakeAnchor;
        return {};
      }),
    };

    const mockEcharts = {
      getDataURL: vi.fn().mockReturnValue('data:image/png;base64,CHART_PNG'),
    } as unknown as ECharts;

    const fakeContainer = {
      clientWidth: 900,
      clientHeight: 600,
      querySelector: vi.fn().mockReturnValue(null),
    } as unknown as HTMLElement;

    await exportCardImage(mockEcharts, fakeContainer, {
      title: 'Full Publication Card',
      subtitle: 'Corridor analysis subtitle',
      sourceNote: 'MTA Open Data',
      fullCard: true,
      format: 'svg',
      dpiScale: 2,
    });

    expect(fakeAnchor.download).toBe('full_publication_card_export.svg');
    const decodedSvg = decodeURIComponent(fakeAnchor.href);
    expect(decodedSvg).toContain('Full Publication Card');
    expect(decodedSvg).toContain('Corridor analysis subtitle');
    expect(decodedSvg).toContain('MTA Open Data');
    expect(decodedSvg).toContain('width="900"');
    expect(decodedSvg).toContain('height="600"');
    expect(fakeAnchor.click).toHaveBeenCalledTimes(1);
  });

  it('exports MapLibre canvas element when echartsInstance is null', async () => {
    const fakeAnchor = {
      href: '',
      download: '',
      click: vi.fn(),
    };
    const fakeBody = {
      appendChild: vi.fn(),
      removeChild: vi.fn(),
    };

    (globalThis as any).document = {
      body: fakeBody,
      createElement: vi.fn().mockImplementation((tag: string) => {
        if (tag === 'a') return fakeAnchor;
        return {};
      }),
    };

    const fakeMapCanvas = {
      toDataURL: vi.fn().mockReturnValue('data:image/png;base64,MAP_CANVAS_DATA'),
    };

    const fakeContainer = {
      clientWidth: 850,
      clientHeight: 480,
      querySelector: vi.fn().mockImplementation((selector: string) => {
        if (selector === 'canvas') return fakeMapCanvas;
        return null;
      }),
    } as unknown as HTMLElement;

    // Bare export of MapLibre canvas
    await exportCardImage(null, fakeContainer, {
      title: 'Route Speed Map',
      fullCard: false,
      format: 'png',
      dpiScale: 2,
    });

    expect(fakeMapCanvas.toDataURL).toHaveBeenCalledWith('image/png');
    expect(fakeAnchor.download).toBe('route_speed_map_export.png');
    expect(fakeAnchor.href).toBe('data:image/png;base64,MAP_CANVAS_DATA');

    // SVG export of MapLibre canvas
    await exportCardImage(null, fakeContainer, {
      title: 'Route Speed Map SVG',
      fullCard: true,
      format: 'svg',
      dpiScale: 2,
    });

    expect(fakeAnchor.download).toBe('route_speed_map_svg_export.svg');
    const decodedSvg = decodeURIComponent(fakeAnchor.href);
    expect(decodedSvg).toContain('Route Speed Map SVG');
    expect(decodedSvg).toContain('MAP_CANVAS_DATA');
  });

  it('handles tainted canvas gracefully during SVG export without throwing', async () => {
    const fakeAnchor = {
      href: '',
      download: '',
      click: vi.fn(),
    };
    const fakeBody = {
      appendChild: vi.fn(),
      removeChild: vi.fn(),
    };

    (globalThis as any).document = {
      body: fakeBody,
      createElement: vi.fn().mockImplementation((tag: string) => {
        if (tag === 'a') return fakeAnchor;
        return {};
      }),
    };

    const taintedMapCanvas = {
      toDataURL: vi.fn().mockImplementation(() => {
        throw new Error('SecurityError: The operation is insecure.');
      }),
    };

    const fakeContainer = {
      clientWidth: 850,
      clientHeight: 480,
      querySelector: vi.fn().mockImplementation((selector: string) => {
        if (selector === 'canvas') return taintedMapCanvas;
        return null;
      }),
      innerHTML: '<div class="fallback-content">Tainted Fallback</div>',
    } as unknown as HTMLElement;

    await expect(
      exportCardImage(null, fakeContainer, {
        title: 'Tainted Map SVG',
        fullCard: true,
        format: 'svg',
        dpiScale: 2,
      })
    ).resolves.not.toThrow();

    expect(fakeAnchor.click).toHaveBeenCalledTimes(1);
    const decodedSvg = decodeURIComponent(fakeAnchor.href);
    expect(decodedSvg).toContain('Tainted Map SVG');
  });

  it('downloads data URL via dynamic anchor element', () => {
    const fakeAnchor = {
      href: '',
      download: '',
      click: vi.fn(),
    };
    const fakeBody = {
      appendChild: vi.fn(),
      removeChild: vi.fn(),
    };

    (globalThis as any).document = {
      body: fakeBody,
      createElement: vi.fn().mockImplementation((tag: string) => {
        if (tag === 'a') return fakeAnchor;
        return {};
      }),
    };

    downloadDataUrl('data:image/svg+xml;utf8,<svg></svg>', 'test_vector.svg');

    expect(fakeAnchor.href).toBe('data:image/svg+xml;utf8,<svg></svg>');
    expect(fakeAnchor.download).toBe('test_vector.svg');
    expect(fakeAnchor.click).toHaveBeenCalled();
  });

  it('exports rows to CSV and JSON formats', async () => {
    const fakeAnchor = {
      href: '',
      download: '',
      click: vi.fn(),
    };
    const fakeBody = {
      appendChild: vi.fn(),
      removeChild: vi.fn(),
    };
    (globalThis as any).document = {
      body: fakeBody,
      createElement: vi.fn().mockReturnValue(fakeAnchor),
    };
    (globalThis as any).URL.createObjectURL = vi.fn().mockReturnValue('blob:fake-csv-url');
    (globalThis as any).URL.revokeObjectURL = vi.fn();

    const { exportDataToCsv, exportDataToJson } = await import('../src/viz/card-image-export.js');
    const testRows = [
      { route_id: 'L', headway_sec: 240, status: 'on-time' },
      { route_id: 'G', headway_sec: 480, status: 'delayed' },
    ];

    exportDataToCsv(testRows, 'test_export.csv');
    expect(fakeAnchor.download).toBe('test_export.csv');
    expect(fakeAnchor.click).toHaveBeenCalledTimes(1);

    exportDataToJson(testRows, 'test_export.json');
    expect(fakeAnchor.download).toBe('test_export.json');
    expect(fakeAnchor.click).toHaveBeenCalledTimes(2);
  });
});
