// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ladislav Slezák

/**
 * Lazily resolve a PDFPageProxy for one page, and the viewport for the current zoom.
 *
 * The proxy is fetched only once the page is near the viewport (§8.2); pdf.js caches
 * page proxies internally, so scrolling back is cheap.
 */
import { useEffect, useMemo, useState } from 'react';
import { useLoadedDocument } from '../state/EditorContext';
import type { PDFPageProxy, PageViewport } from '../pdf/pdfjs';

export function usePdfPage(pageIndex: number, enabled: boolean): PDFPageProxy | null {
  const { handle } = useLoadedDocument();
  const [page, setPage] = useState<PDFPageProxy | null>(null);

  useEffect(() => {
    if (!enabled || !handle) {
      return undefined;
    }

    let cancelled = false;
    handle.proxy
      .getPage(pageIndex + 1)
      .then((resolved) => {
        if (!cancelled) setPage(resolved);
      })
      .catch(() => {
        if (!cancelled) setPage(null);
      });

    return () => {
      cancelled = true;
    };
  }, [handle, pageIndex, enabled]);

  // A new document invalidates any page proxy from the previous one.
  useEffect(() => setPage(null), [handle]);

  return page;
}

export function usePageViewport(page: PDFPageProxy | null, zoom: number): PageViewport | null {
  return useMemo(() => (page ? page.getViewport({ scale: zoom }) : null), [page, zoom]);
}
