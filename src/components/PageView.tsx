// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ladislav Slezák

/**
 * One page: the three stacked layers of spec §7.2, plus the virtualisation gate.
 *
 * The outer box is always laid out at the correct size (from DocumentInfo.pageSizes,
 * measured once at load), so the scroll bar is stable even though only nearby pages
 * are actually rendered.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Mask, MaskId, PageDisplaySize, ToolId } from '../types/models';
import { usePageViewport, usePdfPage } from '../hooks/usePdfPage';
import type { PageViewport } from '../pdf/pdfjs';
import { useIsVisible } from '../hooks/useIsVisible';
import { RENDER_OVERSCAN_PX } from '../constants';
import { PdfCanvas } from './PdfCanvas';
import { MaskCanvas } from './MaskCanvas';
import { InteractionLayer } from './InteractionLayer';

interface PageViewProps {
  pageIndex: number;
  displaySize: PageDisplaySize;
  zoom: number;
  masks: readonly Mask[];
  activeTool: ToolId;
  strokeWidth: number;
  selectedMaskId: MaskId | null;
  onCommitMask: (mask: Mask) => void;
  onCommitGeometry: (mask: Mask) => void;
  onSelect: (maskId: MaskId | null) => void;
  onPan: (dx: number, dy: number) => void;
  /** Publishes this page's live viewport so keyboard editing can use the same maths. */
  onViewport: (pageIndex: number, viewport: PageViewport | null) => void;
}

function PageViewImpl({
  pageIndex,
  displaySize,
  zoom,
  masks,
  activeTool,
  strokeWidth,
  selectedMaskId,
  onCommitMask,
  onCommitGeometry,
  onSelect,
  onPan,
  onViewport,
}: PageViewProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  /*
   * While a mask is being dragged the interaction layer paints it live, so the
   * committed layer must stop painting it or the original would show through beneath
   * the preview. This is set once on pointer-down and once on pointer-up, not per move.
   */
  const [draggingMaskId, setDraggingMaskId] = useState<MaskId | null>(null);
  const handleDragMask = useCallback((maskId: MaskId | null) => setDraggingMaskId(maskId), []);
  const isVisible = useIsVisible(containerRef, RENDER_OVERSCAN_PX);
  const page = usePdfPage(pageIndex, isVisible);
  const viewport = usePageViewport(page, zoom);

  /*
   * Arrow-key editing happens in screen space (so it feels the same at any zoom) but
   * must respect page rotation, which only the viewport knows. Publishing it upward is
   * cheaper and less fragile than resolving the page proxy again inside a key handler.
   */
  useEffect(() => {
    onViewport(pageIndex, viewport);
    return () => onViewport(pageIndex, null);
  }, [pageIndex, viewport, onViewport]);

  // Known before the page proxy resolves, so layout never jumps.
  const style = useMemo(
    () => ({ width: `${displaySize.width * zoom}px`, height: `${displaySize.height * zoom}px` }),
    [displaySize.width, displaySize.height, zoom],
  );

  return (
    <div className="tis-page" ref={containerRef} data-page-index={pageIndex}>
      <div className="tis-page__sheet" style={style}>
        {page && viewport ? (
          <>
            <PdfCanvas page={page} viewport={viewport} pageNumber={pageIndex + 1} />
            <MaskCanvas
              masks={masks}
              viewport={viewport}
              selectedMaskId={selectedMaskId}
              hiddenMaskId={draggingMaskId}
            />
            <InteractionLayer
              pageIndex={pageIndex}
              viewport={viewport}
              activeTool={activeTool}
              strokeWidth={strokeWidth}
              masks={masks}
              selectedMaskId={selectedMaskId}
              onCommitNew={onCommitMask}
              onCommitGeometry={onCommitGeometry}
              onSelect={onSelect}
              onDragMask={handleDragMask}
              onPan={onPan}
            />
          </>
        ) : (
          <div className="tis-page__placeholder" aria-hidden="true" />
        )}
      </div>
      <div className="tis-page__label">
        Page {pageIndex + 1}
        {masks.length > 0 ? ` — ${masks.length} mask${masks.length === 1 ? '' : 's'}` : ''}
      </div>
    </div>
  );
}

/**
 * Memoised: without this, committing a mask on page 1 re-renders every page,
 * and each re-render would rebuild the viewport object and retrigger PdfCanvas.
 */
export const PageView = memo(PageViewImpl);
