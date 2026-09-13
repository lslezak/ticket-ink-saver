// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ladislav Slezák

/**
 * The cheap layer: committed masks (spec §7.2).
 *
 * Redraws whenever the mask list or the zoom changes. Kept separate from PdfCanvas
 * so adding a mask never triggers a pdf.js re-render.
 */
import { useEffect, useRef } from 'react';
import type { PageViewport } from '../pdf/pdfjs';
import type { Mask, MaskId } from '../types/models';
import { clearCanvas, paintMask, paintSelection, prepareCanvas } from './maskPainting';
import { maskViewportBounds } from '../geometry/maskGeometry';
import { MAX_RENDER_SCALE } from '../constants';

interface MaskCanvasProps {
  masks: readonly Mask[];
  viewport: PageViewport;
  selectedMaskId: MaskId | null;
  /** Mask currently being dragged; painted by the interaction layer instead. */
  hiddenMaskId: MaskId | null;
}

export function MaskCanvas({
  masks,
  viewport,
  selectedMaskId,
  hiddenMaskId,
}: MaskCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = Math.max(
      1,
      Math.min(window.devicePixelRatio || 1, MAX_RENDER_SCALE / Math.max(viewport.scale, 0.01)),
    );
    const context = prepareCanvas(canvas, viewport, dpr);
    if (!context) return;

    clearCanvas(context, viewport);
    for (const mask of masks) {
      if (mask.id === hiddenMaskId) continue;
      paintMask(context, mask, viewport);
      if (mask.id === selectedMaskId) {
        paintSelection(context, maskViewportBounds(mask, viewport));
      }
    }
  }, [masks, viewport, selectedMaskId, hiddenMaskId]);

  return <canvas ref={canvasRef} className="tis-page__layer" aria-hidden="true" />;
}
