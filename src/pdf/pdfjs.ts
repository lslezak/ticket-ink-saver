// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ladislav Slezák

/**
 * pdf.js bootstrap (spec §8.1).
 *
 * The worker is imported from the *installed* pdfjs-dist so its version can never
 * drift from the main-thread library (a mismatch throws at runtime). It is bundled
 * locally rather than pulled from a CDN, which would break NFR-7 (offline) and
 * weaken NFR-1 (privacy).
 */
import * as pdfjs from 'pdfjs-dist';
// eslint-disable-next-line import/no-unresolved -- Vite ?url import
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjs };
export type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  PageViewport,
  RenderTask,
} from 'pdfjs-dist';

/** pdf.js rejects cancelled renders with this; it is expected, not an error. */
export function isRenderCancelled(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: string }).name === 'RenderingCancelledException'
  );
}
