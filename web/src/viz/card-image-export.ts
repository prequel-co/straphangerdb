import type { ECharts } from 'echarts';

export interface CardExportOptions {
  readonly title: string;
  readonly subtitle?: string;
  readonly sourceNote?: string;
  readonly fullCard: boolean;
  readonly format: 'png' | 'svg';
  readonly dpiScale?: number;
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function exportDataToCsv(rows: readonly Record<string, unknown>[], filename: string): void {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]!);
  const csvLines: string[] = [];
  csvLines.push(headers.map(h => `"${h.replace(/"/g, '""')}"`).join(','));
  for (const row of rows) {
    const line = headers.map(h => {
      const v = row[h];
      if (v === null || v === undefined) return '';
      const str = String(v);
      return `"${str.replace(/"/g, '""')}"`;
    }).join(',');
    csvLines.push(line);
  }
  const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  downloadDataUrl(url, filename.endsWith('.csv') ? filename : `${filename}.csv`);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportDataToJson(rows: readonly Record<string, unknown>[], filename: string): void {
  const jsonStr = JSON.stringify(rows, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  downloadDataUrl(url, filename.endsWith('.json') ? filename : `${filename}.json`);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function truncateToWidth(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(1, maxChars - 1)).trimEnd() + '…';
}

function drawFittedImage(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number
): void {
  if (srcW <= 0 || srcH <= 0 || boxW <= 0 || boxH <= 0) {
    ctx.drawImage(source, boxX, boxY, boxW, boxH);
    return;
  }
  const scale = Math.min(boxW / srcW, boxH / srcH);
  const drawW = srcW * scale;
  const drawH = srcH * scale;
  const drawX = boxX + (boxW - drawW) / 2;
  const drawY = boxY + (boxH - drawH) / 2;
  ctx.drawImage(source, drawX, drawY, drawW, drawH);
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildTableForeignObject(containerEl: HTMLElement, width: number, height: number): string {
  const tableEl = typeof containerEl?.querySelector === 'function'
    ? (containerEl.querySelector('table') || containerEl.querySelector('.kpi-metric-card') || containerEl)
    : containerEl;
  const clone = typeof tableEl?.cloneNode === 'function' ? (tableEl.cloneNode(true) as HTMLElement) : tableEl;
  const rawHtml = typeof XMLSerializer !== 'undefined'
    ? new XMLSerializer().serializeToString(clone as any)
    : (clone as any)?.outerHTML || '';

  return `
    <foreignObject x="10" y="0" width="${width - 20}" height="${height}">
      <div xmlns="http://www.w3.org/1999/xhtml" style="width: 100%; height: 100%; overflow: auto; background: #FFFFFF; color: #0F172A; font-family: 'Helvetica Neue', Arial, sans-serif;">
        <style>
          table { width: 100%; border-collapse: collapse; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 12px; color: #0F172A; }
          th { background: #F8FAFC; color: #475569; text-align: left; padding: 6px 10px; border-bottom: 1px solid #CBD5E1; }
          td { padding: 6px 10px; border-bottom: 1px solid #E2E8F0; color: #1E293B; }
          .cell-null { color: #94A3B8; font-style: italic; }
          .kpi-metric-card { text-align: center; padding: 40px 20px; font-family: 'Helvetica Neue', Arial, sans-serif; }
          .kpi-metric-value { font-size: 48px; font-weight: 800; color: #0039A6; }
          .kpi-metric-label { font-size: 14px; color: #475569; margin-top: 8px; text-transform: uppercase; }
        </style>
        ${rawHtml}
      </div>
    </foreignObject>
  `;
}

export async function exportCardImage(
  echartsInstance: ECharts | null,
  containerEl: HTMLElement,
  options: CardExportOptions
): Promise<void> {
  const dpi = options.dpiScale ?? 2;
  const filename = `${options.title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_export.${options.format}`;
  const width = containerEl?.clientWidth || 800;
  const height = containerEl?.clientHeight || 500;
  const innerCanvas = typeof containerEl?.querySelector === 'function'
    ? (containerEl.querySelector('canvas') as HTMLCanvasElement | null)
    : null;
  const hasTable = typeof containerEl?.querySelector === 'function'
    ? Boolean(containerEl.querySelector('table') || containerEl.querySelector('.kpi-metric-card'))
    : false;

  // 1. Bare Visual Export (fullCard === false)
  if (!options.fullCard) {
    if (options.format === 'png') {
      if (echartsInstance) {
        const dataUrl = echartsInstance.getDataURL({
          type: 'png',
          pixelRatio: dpi,
          backgroundColor: '#FFFFFF',
        });
        downloadDataUrl(dataUrl, filename);
        return;
      }

      if (innerCanvas) {
        try {
          const dataUrl = innerCanvas.toDataURL('image/png');
          downloadDataUrl(dataUrl, filename);
          return;
        } catch (canvasErr) {
          console.warn('Canvas export tainted or SecurityError, falling back to SVG foreignObject:', canvasErr);
        }
      }

      // Fallback for HTML table or KPI
      const canvas = document.createElement('canvas');
      canvas.width = width * dpi;
      canvas.height = height * dpi;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(dpi, dpi);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        if (typeof Image !== 'undefined') {
          const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${buildTableForeignObject(containerEl, width, height)}</svg>`;
          const img = new Image();
          await new Promise<void>((resolve) => {
            img.onload = () => {
              ctx.drawImage(img, 0, 0, width, height);
              resolve();
            };
            img.onerror = () => resolve();
            img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgContent);
          });
        }
        try {
          const finalUrl = canvas.toDataURL('image/png');
          downloadDataUrl(finalUrl, filename);
          return;
        } catch (canvasErr) {
          console.warn('Canvas export failed:', canvasErr);
        }
      }
    } else if (options.format === 'svg') {
      // Bare SVG export
      let visualSvgContent = '';
      if (echartsInstance) {
        const dataUrl = echartsInstance.getDataURL({
          type: 'png',
          pixelRatio: dpi,
          backgroundColor: 'transparent',
        });
        visualSvgContent = `<image href="${dataUrl}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/>`;
      } else if (innerCanvas) {
        try {
          const dataUrl = innerCanvas.toDataURL('image/png');
          visualSvgContent = `<image href="${dataUrl}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/>`;
        } catch (canvasErr) {
          console.warn('Canvas export tainted or SecurityError:', canvasErr);
          visualSvgContent = buildTableForeignObject(containerEl, width, height);
        }
      } else {
        visualSvgContent = buildTableForeignObject(containerEl, width, height);
      }

      const bareSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <rect width="${width}" height="${height}" fill="#FFFFFF"/>
        ${visualSvgContent}
      </svg>`;
      downloadDataUrl('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(bareSvg), filename);
      return;
    }
  }

  // 2. Full Publication Card Export (fullCard === true)
  const chartImgY = options.subtitle ? 70 : 50;
  const chartHeight = height - chartImgY - 40;
  const footerText = options.sourceNote
    ? `${options.sourceNote} | Data Based Train Control`
    : 'Source: StraphangerDB | Data Based Train Control';

  if (options.format === 'svg') {
    // Generate genuine standalone SVG card
    let visualElement = '';
    if (echartsInstance) {
      const chartDataUrl = echartsInstance.getDataURL({
        type: 'png',
        pixelRatio: dpi,
        backgroundColor: 'transparent',
      });
      visualElement = `<image href="${chartDataUrl}" x="10" y="${chartImgY}" width="${width - 20}" height="${chartHeight}" preserveAspectRatio="xMidYMid meet"/>`;
    } else if (innerCanvas) {
      try {
        const chartDataUrl = innerCanvas.toDataURL('image/png');
        visualElement = `<image href="${chartDataUrl}" x="10" y="${chartImgY}" width="${width - 20}" height="${chartHeight}" preserveAspectRatio="xMidYMid meet"/>`;
      } catch (canvasErr) {
        console.warn('Canvas export tainted or SecurityError:', canvasErr);
        visualElement = `<g transform="translate(0, ${chartImgY})">${buildTableForeignObject(containerEl, width, chartHeight)}</g>`;
      }
    } else {
      visualElement = `<g transform="translate(0, ${chartImgY})">${buildTableForeignObject(containerEl, width, chartHeight)}</g>`;
    }

    const titleText = truncateToWidth(options.title, Math.max(24, Math.floor((width - 40) / 9)));
    const subtitleText = options.subtitle
      ? truncateToWidth(options.subtitle, Math.max(30, Math.floor((width - 40) / 7)))
      : '';
    const safeFooterText = truncateToWidth(footerText, Math.max(36, Math.floor((width - 40) / 6)));

    const fullCardSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="${width}" height="${height}" fill="#FFFFFF" rx="4"/>
      <text x="20" y="36" fill="#0F172A" font-family="'Helvetica Neue', Arial, sans-serif" font-weight="bold" font-size="18">${escapeXml(titleText)}</text>
      ${subtitleText ? `<text x="20" y="58" fill="#475569" font-family="'Helvetica Neue', Arial, sans-serif" font-size="13">${escapeXml(subtitleText)}</text>` : ''}
      ${visualElement}
      <line x1="20" y1="${height - 30}" x2="${width - 20}" y2="${height - 30}" stroke="#E2E8F0" stroke-width="1"/>
      <text x="20" y="${height - 12}" fill="#64748B" font-family="'Helvetica Neue', Arial, sans-serif" font-size="11">${escapeXml(safeFooterText)}</text>
    </svg>`;

    downloadDataUrl('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(fullCardSvg), filename);
    return;
  }

  // 3. Full Publication Card PNG (2x Retina)
  const canvas = document.createElement('canvas');
  canvas.width = width * dpi;
  canvas.height = height * dpi;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.scale(dpi, dpi);

  // Background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  // Top header text (constrained with maxWidth so long strings stay inside margins)
  const maxTextWidth = Math.max(120, width - 40);
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 18px "Helvetica Neue", Arial, sans-serif';
  ctx.fillText(options.title, 20, 36, maxTextWidth);

  if (options.subtitle) {
    ctx.fillStyle = '#475569';
    ctx.font = '13px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText(options.subtitle, 20, 58, maxTextWidth);
  }

  let chartDrawn = false;
  if (echartsInstance) {
    const chartDataUrl = echartsInstance.getDataURL({
      type: 'png',
      pixelRatio: dpi,
      backgroundColor: 'transparent',
    });
    if (typeof Image !== 'undefined') {
      const img = new Image();
      await new Promise<void>((resolve) => {
        img.onload = () => {
          drawFittedImage(ctx, img, img.naturalWidth || width - 20, img.naturalHeight || chartHeight, 10, chartImgY, width - 20, chartHeight);
          resolve();
        };
        img.onerror = () => resolve();
        img.src = chartDataUrl;
      });
      chartDrawn = true;
    }
  }

  if (!chartDrawn && innerCanvas) {
    try {
      drawFittedImage(ctx, innerCanvas, innerCanvas.width, innerCanvas.height, 10, chartImgY, width - 20, chartHeight);
      chartDrawn = true;
    } catch (err) {
      console.warn('Could not draw inner canvas element:', err);
    }
  }

  if (!chartDrawn && hasTable && typeof Image !== 'undefined') {
    try {
      const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${chartHeight}">${buildTableForeignObject(containerEl, width, chartHeight)}</svg>`;
      const img = new Image();
      await new Promise<void>((resolve) => {
        img.onload = () => {
          drawFittedImage(ctx, img, img.naturalWidth || width - 20, img.naturalHeight || chartHeight, 10, chartImgY, width - 20, chartHeight);
          resolve();
        };
        img.onerror = () => resolve();
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgContent);
      });
      chartDrawn = true;
    } catch (err) {
      console.warn('Could not draw table visual to canvas:', err);
    }
  }

  // Footer divider line
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(20, height - 30);
  ctx.lineTo(width - 20, height - 30);
  ctx.stroke();

  // Footer text
  ctx.fillStyle = '#64748B';
  ctx.font = '11px "Helvetica Neue", Arial, sans-serif';
  ctx.fillText(footerText, 20, height - 12, maxTextWidth);

  try {
    const finalUrl = canvas.toDataURL('image/png');
    downloadDataUrl(finalUrl, filename);
  } catch (canvasErr) {
    console.warn('Canvas export failed due to security/taint restrictions:', canvasErr);
  }
}
