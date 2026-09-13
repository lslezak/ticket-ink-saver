// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ladislav Slezák

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Spec NFR-1/NFR-7: the app is a static bundle with no backend. Nothing here may
// introduce a runtime origin other than 'self'.
export default defineConfig({
  /*
   * GitHub Pages serves a project site from https://<user>.github.io/<repo>/, so every
   * asset URL has to carry that prefix. CI sets BASE_PATH; leaving it unset keeps the
   * root path that `npm run dev` and `npm run preview` expect.
   *
   * Getting this wrong is the classic Vite-on-Pages failure: the page loads and then
   * every script, stylesheet and the pdf.js worker 404s.
   */
  base: process.env['BASE_PATH'] || '/',
  plugins: [react()],
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        /*
         * pdf.js, pdf-lib and PatternFly are each large. Splitting them out lets the
         * app shell paint before the PDF engines are parsed.
         *
         * Vite 8 bundles with Rolldown, which replaced Rollup's object-form
         * `manualChunks` with `codeSplitting.groups`.
         */
        codeSplitting: {
          groups: [
            { name: 'pdfjs', test: /node_modules[\\/]pdfjs-dist[\\/]/ },
            { name: 'pdflib', test: /node_modules[\\/]pdf-lib[\\/]/ },
            { name: 'patternfly', test: /node_modules[\\/]@patternfly[\\/]/ },
          ],
        },
      },
    },
  },
  worker: { format: 'es' },
});
