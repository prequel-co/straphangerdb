import { marked } from 'marked';

const DANGEROUS_CONTAINER_TAGS = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'applet',
  'noscript',
  'template',
  'frame',
  'frameset',
  'head',
  'math',
  'form',
];

const ALLOWED_TAGS = new Set([
  'div',
  'span',
  'p',
  'br',
  'hr',
  'strong',
  'em',
  'b',
  'i',
  'u',
  's',
  'del',
  'ins',
  'mark',
  'kbd',
  'code',
  'pre',
  'blockquote',
  'details',
  'summary',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'colgroup',
  'col',
  'a',
  'img',
  'figure',
  'figcaption',
  'sup',
  'sub',
  'small',
  'abbr',
  'cite',
  'q',
  'time',
  'section',
  'article',
  'aside',
  'header',
  'footer',
  'nav',
  'main',
  'svg',
  'g',
  'path',
  'circle',
  'rect',
  'line',
  'polyline',
  'polygon',
  'text',
  'defs',
  'lineargradient',
  'radialgradient',
  'stop',
  'clippath',
]);

const VOID_TAGS = new Set(['br', 'hr', 'img', 'col']);

const GLOBAL_ALLOWED_ATTRS = new Set([
  'class',
  'style',
  'title',
  'id',
  'role',
  'dir',
  'lang',
]);

const TAG_ALLOWED_ATTRS: Record<string, ReadonlySet<string>> = {
  a: new Set(['href', 'target', 'rel', 'download']),
  img: new Set(['src', 'alt', 'width', 'height', 'loading']),
  th: new Set(['colspan', 'rowspan', 'align', 'scope', 'width']),
  td: new Set(['colspan', 'rowspan', 'align', 'scope', 'width']),
  col: new Set(['span', 'width']),
  colgroup: new Set(['span', 'width']),
  ol: new Set(['start', 'type', 'reversed']),
  li: new Set(['value']),
  details: new Set(['open']),
  time: new Set(['datetime']),
  blockquote: new Set(['cite']),
  q: new Set(['cite']),
  svg: new Set([
    'width',
    'height',
    'viewbox',
    'fill',
    'stroke',
    'stroke-width',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-dasharray',
    'opacity',
    'xmlns',
  ]),
  g: new Set([
    'fill',
    'stroke',
    'stroke-width',
    'stroke-linecap',
    'stroke-linejoin',
    'transform',
    'opacity',
  ]),
  path: new Set([
    'd',
    'fill',
    'stroke',
    'stroke-width',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-dasharray',
    'transform',
    'opacity',
    'fill-opacity',
    'stroke-opacity',
  ]),
  circle: new Set(['cx', 'cy', 'r', 'fill', 'stroke', 'stroke-width', 'opacity']),
  rect: new Set(['x', 'y', 'width', 'height', 'rx', 'ry', 'fill', 'stroke', 'stroke-width', 'opacity']),
  line: new Set(['x1', 'y1', 'x2', 'y2', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity']),
  polyline: new Set(['points', 'fill', 'stroke', 'stroke-width', 'opacity']),
  polygon: new Set(['points', 'fill', 'stroke', 'stroke-width', 'opacity']),
  text: new Set(['x', 'y', 'dx', 'dy', 'text-anchor', 'dominant-baseline', 'font-size', 'font-weight', 'font-family', 'fill']),
  stop: new Set(['offset', 'stop-color', 'stop-opacity']),
};

const SVG_CAMEL_ATTR_MAP: Record<string, string> = {
  viewbox: 'viewBox',
  lineargradient: 'linearGradient',
  radialgradient: 'radialGradient',
  clippath: 'clipPath',
};

function decodeHtmlEntitiesForCheck(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);?/g, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&#([0-9]+);?/g, (_, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&colon;/gi, ':')
    .replace(/&tab;/gi, '\t')
    .replace(/&newline;/gi, '\n')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'");
}

export function isSafeMarkdownUrl(rawUrl: string): boolean {
  const decoded = decodeHtmlEntitiesForCheck(rawUrl)
    .replace(/[\u0000-\u0020\u007f]+/g, '')
    .trim();

  if (!decoded) return false;

  // Relative URLs, anchor links, and root-relative paths are safe
  if (
    decoded.startsWith('#') ||
    decoded.startsWith('/') ||
    decoded.startsWith('./') ||
    decoded.startsWith('../')
  ) {
    // Reject protocol-relative URLs like //evil.com if desired, or allow only single-slash paths
    if (decoded.startsWith('//')) return false;
    return true;
  }

  const schemeMatch = decoded.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (!schemeMatch) {
    // No scheme (relative path like "images/chart.png")
    return true;
  }

  const scheme = (schemeMatch[1] ?? '').toLowerCase();
  return scheme === 'http' || scheme === 'https' || scheme === 'mailto';
}

export function sanitizeInlineStyle(rawStyle: string): string {
  const decoded = decodeHtmlEntitiesForCheck(rawStyle).replace(/\/\*[\s\S]*?\*\//g, '');
  const declarations = decoded.split(';');
  const safeDeclarations: string[] = [];

  for (const decl of declarations) {
    const trimmed = decl.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx <= 0) continue;

    const prop = trimmed.slice(0, colonIdx).trim().toLowerCase();
    const val = trimmed.slice(colonIdx + 1).trim();

    if (!/^[a-z][a-z0-9-]*$/.test(prop) || !val) continue;

    const normalizedCssVal = val
      .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex: string) => {
        const code = Number.parseInt(hex, 16);
        return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
      })
      .replace(/\\(.)/g, '$1');
    const lowerVal = normalizedCssVal.toLowerCase().replace(/\s+/g, '');
    if (
      lowerVal.includes('expression(') ||
      lowerVal.includes('javascript:') ||
      lowerVal.includes('vbscript:') ||
      lowerVal.includes('data:') ||
      lowerVal.includes('url(') ||
      lowerVal.includes('-moz-binding') ||
      lowerVal.includes('behavior:') ||
      lowerVal.includes('@import') ||
      val.includes('\\') ||
      val.includes('<') ||
      val.includes('>')
    ) {
      continue;
    }

    safeDeclarations.push(`${prop}: ${val}`);
  }

  return safeDeclarations.join('; ');
}

function isAllowedAttribute(tagName: string, attrName: string): boolean {
  if (attrName.startsWith('on')) return false;
  if (attrName === 'srcdoc' || attrName === 'formaction' || attrName === 'xlink:href') {
    return false;
  }
  if (GLOBAL_ALLOWED_ATTRS.has(attrName)) return true;
  if (/^data-[a-z0-9-]+$/.test(attrName)) return true;
  if (/^aria-[a-z0-9-]+$/.test(attrName)) return true;

  const tagSet = TAG_ALLOWED_ATTRS[tagName];
  return Boolean(tagSet && tagSet.has(attrName));
}

function escapeAttrValue(val: string): string {
  return val
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function sanitizeMarkdownHtml(rawHtml: string): string {
  let html = rawHtml;

  // 1. Remove HTML comments (both closed and unclosed)
  html = html.replace(/<!--[\s\S]*?(?:-->|$)/g, '');

  // 2. Remove dangerous container blocks along with their inner content (including unclosed trailing tags)
  const containerPattern = new RegExp(
    `<(${DANGEROUS_CONTAINER_TAGS.join('|')})\\b[^>]*>[\\s\\S]*?(?:<\\/\\1\\s*>|$)`,
    'gi'
  );
  let prev = '';
  while (prev !== html) {
    prev = html;
    html = html.replace(containerPattern, '');
  }

  // 3. Tokenize and sanitize remaining tags, escaping any malformed/unclosed '<' outside valid tags
  const tagPattern = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^<>]*?)?)(\s*\/?)>/g;
  let result = '';
  let lastIndex = 0;
  let tagMatch: RegExpExecArray | null;

  while ((tagMatch = tagPattern.exec(html)) !== null) {
    if (tagMatch.index > lastIndex) {
      result += html.slice(lastIndex, tagMatch.index).replace(/</g, '&lt;');
    }
    lastIndex = tagPattern.lastIndex;

    const slash = tagMatch[1] ?? '';
    const rawTagName = tagMatch[2] ?? '';
    const rawAttrs = tagMatch[3] ?? '';
    const selfClose = tagMatch[4] ?? '';

    const lowerTag = rawTagName.toLowerCase();
    if (!ALLOWED_TAGS.has(lowerTag)) {
      continue;
    }

    const canonicalTag = SVG_CAMEL_ATTR_MAP[lowerTag] ?? lowerTag;

    if (slash === '/') {
      if (VOID_TAGS.has(lowerTag)) continue;
      result += `</${canonicalTag}>`;
      continue;
    }

    const sanitizedAttrs: string[] = [];
    let hasTargetBlank = false;
    let hasRel = false;

    if (rawAttrs && rawAttrs.trim().length > 0) {
      const attrRegex = /([a-zA-Z_:][a-zA-Z0-9_.:-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
      let match: RegExpExecArray | null;
      while ((match = attrRegex.exec(rawAttrs)) !== null) {
        const rawAttrName = match[1] ?? '';
        const lowerAttr = rawAttrName.toLowerCase();
        if (!isAllowedAttribute(lowerTag, lowerAttr)) {
          continue;
        }

        const hasExplicitValue = match[2] !== undefined || match[3] !== undefined || match[4] !== undefined;
        const rawVal = match[2] ?? match[3] ?? match[4] ?? '';

        if ((lowerAttr === 'href' || lowerAttr === 'src' || lowerAttr === 'cite') && !isSafeMarkdownUrl(rawVal)) {
          continue;
        }

        if (lowerAttr === 'style') {
          const cleanStyle = sanitizeInlineStyle(rawVal);
          if (cleanStyle) {
            sanitizedAttrs.push(`style="${escapeAttrValue(cleanStyle)}"`);
          }
          continue;
        }

        if (lowerTag === 'a' && lowerAttr === 'target' && rawVal.trim().toLowerCase() === '_blank') {
          hasTargetBlank = true;
        }
        if (lowerTag === 'a' && lowerAttr === 'rel') {
          hasRel = true;
        }

        const canonicalAttr = SVG_CAMEL_ATTR_MAP[lowerAttr] ?? lowerAttr;
        if (!hasExplicitValue && (lowerAttr === 'open' || lowerAttr === 'reversed')) {
          sanitizedAttrs.push(canonicalAttr);
        } else {
          const unescapedVal = rawVal
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#0*39;|&apos;/g, "'")
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
          sanitizedAttrs.push(`${canonicalAttr}="${escapeAttrValue(unescapedVal)}"`);
        }
      }
    }

    if (lowerTag === 'a' && hasTargetBlank && !hasRel) {
      sanitizedAttrs.push('rel="noopener noreferrer"');
    }

    const attrStr = sanitizedAttrs.length > 0 ? ` ${sanitizedAttrs.join(' ')}` : '';
    if (VOID_TAGS.has(lowerTag)) {
      result += `<${canonicalTag}${attrStr}>`;
      continue;
    }
    const closingSuffix = selfClose.includes('/') && lowerTag !== 'div' && lowerTag !== 'span' && lowerTag !== 'p' ? ' /' : '';
    result += `<${canonicalTag}${attrStr}${closingSuffix}>`;
  }

  if (lastIndex < html.length) {
    result += html.slice(lastIndex).replace(/</g, '&lt;');
  }

  return result;
}

export function renderMarkdownWithSafeHtml(markdownText: string): string {
  const source =
    markdownText && markdownText.trim().length > 0
      ? markdownText
      : '*Empty narrative. Click Edit Story or double-click here to write.*';
  const parsed = marked.parse(source, { async: false, gfm: true }) as string;
  return sanitizeMarkdownHtml(parsed);
}
