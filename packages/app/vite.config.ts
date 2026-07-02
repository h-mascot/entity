import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined;
          }

          const normalizedId = id.replace(/\\/g, '/');

          if (normalizedId.includes('/node_modules/react/') || normalizedId.includes('/node_modules/react-dom/')) {
            return 'react-vendor';
          }

          if (normalizedId.includes('/node_modules/@sentry/')) {
            return 'sentry';
          }

          if (
            normalizedId.includes('/node_modules/@codemirror/') ||
            normalizedId.includes('/node_modules/codemirror/') ||
            normalizedId.includes('/node_modules/@lezer/')
          ) {
            return 'codemirror';
          }

          if (normalizedId.includes('/node_modules/@xterm/')) {
            return 'xterm';
          }

          if (
            normalizedId.includes('/node_modules/react-markdown/') ||
            normalizedId.includes('/node_modules/rehype-') ||
            normalizedId.includes('/node_modules/remark-') ||
            normalizedId.includes('/node_modules/refractor/') ||
            normalizedId.includes('/node_modules/highlight.js/') ||
            normalizedId.includes('/node_modules/lowlight/') ||
            normalizedId.includes('/node_modules/unified/') ||
            normalizedId.includes('/node_modules/micromark') ||
            normalizedId.includes('/node_modules/mdast-') ||
            normalizedId.includes('/node_modules/hast-') ||
            normalizedId.includes('/node_modules/unist-') ||
            normalizedId.includes('/node_modules/vfile') ||
            normalizedId.includes('/node_modules/property-information/') ||
            normalizedId.includes('/node_modules/space-separated-tokens/') ||
            normalizedId.includes('/node_modules/comma-separated-tokens/') ||
            normalizedId.includes('/node_modules/decode-named-character-reference/') ||
            normalizedId.includes('/node_modules/character-entities')
          ) {
            return 'markdown';
          }

          if (
            normalizedId.includes('/node_modules/@tiptap/') ||
            normalizedId.includes('/node_modules/@prosemirror/') ||
            normalizedId.includes('/node_modules/prosemirror-')
          ) {
            return 'tiptap';
          }

          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_API_TARGET || 'http://localhost:3000',
        changeOrigin: true,
      },
      '/ws': {
        target: process.env.VITE_PROXY_WS_TARGET || 'ws://localhost:3002',
        ws: true,
      },
    },
  },
});
