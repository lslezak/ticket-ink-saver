// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ladislav Slezák

/**
 * The scrollable workspace (spec FR-2, §8.2).
 *
 * Zoom is debounced here so a held-down zoom button issues one render pass, and the
 * scroll position is re-anchored afterwards so the content under the middle of the
 * viewport stays put (AC-3.2).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import type { DocumentInfo, Mask, MaskId, MaskList, ToolId } from '../types/models';
import type { PageViewport } from '../pdf/pdfjs';
import { PageView } from './PageView';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { ZOOM_DEBOUNCE_MS } from '../constants';

interface DocumentViewerProps {
  info: DocumentInfo;
  masks: MaskList;
  zoom: number;
  activeTool: ToolId;
  strokeWidth: number;
  scrollRef: RefObject<HTMLDivElement>;
  selectedMaskId: MaskId | null;
  onCommitMask: (mask: Mask) => void;
  onCommitGeometry: (mask: Mask) => void;
  onSelect: (maskId: MaskId | null) => void;
  onViewport: (pageIndex: number, viewport: PageViewport | null) => void;
  /** Which page is currently under the middle of the viewport (for "clear page"). */
  onVisiblePageChange: (pageIndex: number) => void;
}

export function DocumentViewer({
  info,
  masks,
  zoom,
  activeTool,
  strokeWidth,
  scrollRef,
  selectedMaskId,
  onCommitMask,
  onCommitGeometry,
  onSelect,
  onViewport,
  onVisiblePageChange,
}: DocumentViewerProps): JSX.Element {
  const renderedZoom = useDebouncedValue(zoom, ZOOM_DEBOUNCE_MS);
  const previousZoomRef = useRef(renderedZoom);
  const frameRef = useRef(0);

  // AC-3.2: keep the content at the vertical centre of the viewport fixed across a
  // zoom change, instead of letting the scroll offset silently mean something else.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const previousZoom = previousZoomRef.current;
    previousZoomRef.current = renderedZoom;
    if (!element || previousZoom === renderedZoom || previousZoom === 0) return;

    const ratio = renderedZoom / previousZoom;
    const centre = element.scrollTop + element.clientHeight / 2;
    element.scrollTop = Math.max(0, centre * ratio - element.clientHeight / 2);
  }, [renderedZoom, scrollRef]);

  // Group masks by page once per change, rather than filtering inside every page.
  const masksByPage = useMemo(() => {
    const grouped = new Map<number, Mask[]>();
    for (const mask of masks) {
      const list = grouped.get(mask.pageIndex);
      if (list) list.push(mask);
      else grouped.set(mask.pageIndex, [mask]);
    }
    return grouped;
  }, [masks]);

  const emptyMasks = useMemo<readonly Mask[]>(() => [], []);
  const handleCommit = useCallback((mask: Mask) => onCommitMask(mask), [onCommitMask]);

  /**
   * Drag-to-pan for the SELECT tool. The interaction layer captures the pointer, so
   * the browser's own scroll gesture is suppressed and we move the container by hand.
   */
  const handlePan = useCallback(
    (dx: number, dy: number) => {
      const element = scrollRef.current;
      if (!element) return;
      element.scrollLeft += dx;
      element.scrollTop += dy;
    },
    [scrollRef],
  );

  // rAF-throttled: scroll fires far more often than we need this answer.
  const handleScroll = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = 0;
      const element = scrollRef.current;
      if (!element) return;

      const centre = element.getBoundingClientRect().top + element.clientHeight / 2;
      const pages = element.querySelectorAll<HTMLElement>('[data-page-index]');
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      pages.forEach((page) => {
        const rect = page.getBoundingClientRect();
        const distance = Math.abs(rect.top + rect.height / 2 - centre);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = Number(page.dataset['pageIndex'] ?? 0);
        }
      });
      onVisiblePageChange(best);
    });
  }, [scrollRef, onVisiblePageChange]);

  useEffect(
    () => () => {
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  // A new document should start at the top.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    onVisiblePageChange(0);
  }, [info, scrollRef, onVisiblePageChange]);

  return (
    <div className="tis-viewer" ref={scrollRef} data-tool={activeTool} onScroll={handleScroll}>
      <div className="tis-viewer__pages">
        {info.pageSizes.map((size, index) => (
          <PageView
            key={index}
            pageIndex={index}
            displaySize={size}
            zoom={renderedZoom}
            masks={masksByPage.get(index) ?? emptyMasks}
            activeTool={activeTool}
            strokeWidth={strokeWidth}
            selectedMaskId={selectedMaskId}
            onCommitMask={handleCommit}
            onCommitGeometry={onCommitGeometry}
            onSelect={onSelect}
            onPan={handlePan}
            onViewport={onViewport}
          />
        ))}
      </div>
    </div>
  );
}
