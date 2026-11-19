import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'node:path';

const inlineFaviconDataUri =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSI+CiAgPGNpcmNsZSBjeD0iMzIiIGN5PSIzMiIgcj0iMzAiIGZpbGw9IiMwMDM5QTYiLz4KICA8IS0tIFJhaWxzIGluIHBlcnNwZWN0aXZlIC0tPgogIDxwYXRoIGQ9Ik0xOSA1NkwxMCA2M000NSA1Nkw1NCA2MyIgc3Ryb2tlPSIjRkZGRkZGIiBzdHJva2Utd2lkdGg9IjIuNSIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBvcGFjaXR5PSIwLjYiLz4KICA8cGF0aCBkPSJNMTQgNTkuNUg1MCIgc3Ryb2tlPSIjRkZGRkZGIiBzdHJva2Utd2lkdGg9IjEuNSIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBvcGFjaXR5PSIwLjQiLz4KICA8IS0tIFRyYWluIENhciBTdGFpbmxlc3MgU3RlZWwgQm9keSAtLT4KICA8cmVjdCB4PSIxNyIgeT0iMTQiIHdpZHRoPSIzMCIgaGVpZ2h0PSIzNiIgcng9IjYiIGZpbGw9IiNGOEZBRkMiLz4KICA8IS0tIERhcmsgQ2FiIFdpbmRzaGllbGQgLS0+CiAgPHBhdGggZD0iTTIxIDI0QzIxIDIyLjUgMjIgMjEuNSAyMy41IDIxLjVINDAuNUM0MiAyMS41IDQzIDIyLjUgNDMgMjRWMzRIMjFWMjRaIiBmaWxsPSIjMEYxNzJBIi8+CiAgPCEtLSBXaW5kc2hpZWxkIERpdmlkZXIgLS0+CiAgPGxpbmUgeDE9IjMyIiB5MT0iMjEuNSIgeDI9IjMyIiB5Mj0iMzQiIHN0cm9rZT0iIzMzNDE1NSIgc3Ryb2tlLXdpZHRoPSIxLjUiLz4KICA8IS0tIFdpbmRzaGllbGQgUmVmbGVjdGlvbiAtLT4KICA8cGF0aCBkPSJNMjMgMjNMMjkgMzJNMzQgMjNMNDAgMzIiIHN0cm9rZT0iI0ZGRkZGRiIgc3Ryb2tlLXdpZHRoPSIxIiBzdHJva2UtbGluZWNhcD0icm91bmQiIG9wYWNpdHk9IjAuMjUiLz4KICA8IS0tIExFRCBSb3V0ZSBTaWduIEJveCAtLT4KICA8cmVjdCB4PSIyNCIgeT0iMTYuNSIgd2lkdGg9IjE2IiBoZWlnaHQ9IjQiIHJ4PSIxLjUiIGZpbGw9IiMwRjE3MkEiLz4KICA8cmVjdCB4PSIyNiIgeT0iMTcuNSIgd2lkdGg9IjEyIiBoZWlnaHQ9IjIiIHJ4PSIwLjUiIGZpbGw9IiNGQ0NDMEEiLz4KICA8IS0tIEFudGktY2xpbWJlciAvIEZyb250IEJ1bXBlciAtLT4KICA8cmVjdCB4PSIxOSIgeT0iNDIiIHdpZHRoPSIyNiIgaGVpZ2h0PSI0LjUiIHJ4PSIxLjUiIGZpbGw9IiMzMzQxNTUiLz4KICA8bGluZSB4MT0iMjIiIHkxPSI0NC4yNSIgeDI9IjQyIiB5Mj0iNDQuMjUiIHN0cm9rZT0iIzY0NzQ4QiIgc3Ryb2tlLXdpZHRoPSIxIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz4KICA8IS0tIENvdXBsZXIgLS0+CiAgPHJlY3QgeD0iMzAiIHk9IjQ2LjUiIHdpZHRoPSI0IiBoZWlnaHQ9IjMiIHJ4PSIwLjUiIGZpbGw9IiMxRTI5M0IiLz4KICA8IS0tIE1hcmtlciBMaWdodHMgKFJlZCkgLS0+CiAgPGNpcmNsZSBjeD0iMTkuNSIgY3k9IjE3LjUiIHI9IjEuMjUiIGZpbGw9IiNFRTM1MkUiLz4KICA8Y2lyY2xlIGN4PSI0NC41IiBjeT0iMTcuNSIgcj0iMS4yNSIgZmlsbD0iI0VFMzUyRSIvPgogIDwhLS0gRHVhbCBMRUQgSGVhZGxpZ2h0cyAtLT4KICA8Y2lyY2xlIGN4PSIyMy41IiBjeT0iMzgiIHI9IjIuMjUiIGZpbGw9IiNGRkZGRkYiLz4KICA8Y2lyY2xlIGN4PSIyMy41IiBjeT0iMzgiIHI9IjEiIGZpbGw9IiNGRUYwOEEiLz4KICA8Y2lyY2xlIGN4PSI0MC41IiBjeT0iMzgiIHI9IjIuMjUiIGZpbGw9IiNGRkZGRkYiLz4KICA8Y2lyY2xlIGN4PSI0MC41IiBjeT0iMzgiIHI9IjEiIGZpbGw9IiNGRUYwOEEiLz4KPC9zdmc+Cg==';

export default defineConfig({
  root: '.',
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist/bento',
    emptyOutDir: true,
    target: 'esnext',
    chunkSizeWarningLimit: 5000,
  },
  plugins: [
    {
      name: 'bento-file-protocol-guard',
      transformIndexHtml(html) {
        // Strip manifest link in single-file Bento to avoid origin null CORS error on file://
        let clean = html.replace(/<link\s+rel=["']manifest["'][^>]*\/?>/gi, '');
        // Inline SVG favicon to avoid file:// relative path security blocks
        clean = clean.replace(
          /<link\s+rel=["']icon["'][^>]*\/?>/gi,
          `<link rel="icon" type="image/svg+xml" href="${inlineFaviconDataUri}" />`
        );
        clean = clean.replace(
          /<link\s+rel=["']apple-touch-icon["'][^>]*\/?>/gi,
          `<link rel="apple-touch-icon" href="${inlineFaviconDataUri}" />`
        );
        return clean;
      },
    },
    viteSingleFile(),
  ],
});
