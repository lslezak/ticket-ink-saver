// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ladislav Slezák

/**
 * The expensive layer: the actual pdf.js page render (spec §7.2, §8.2).
 *
 * Re-renders only when the page or the zoom changes -- never on pointer movement,
 * which is why the drawing preview lives on its own canvas.
 */
import { useEffect, useRef, useState } from 'react';
import { isRenderCancelled } from '../pdf/pdfjs';
import type { PDFPageProxy, PageViewport, RenderTask } from '../pdf/pdfjs';
import { MAX_RENDER_SCALE } from '../constants';

interface PdfCanvasProps {
  page: PDFPageProxy;
  viewport: PageViewport;
  pageNumber: number;
}

/**
 * §8.2 memory guard: the backing store is (cssPx * dpr) in each axis, so the product
 * of zoom and device pixel ratio has to be capped or a 4x zoom on a 2x display
 * allocates 64x the area of a 1x render.
 */
function effectiveDevicePixelRatio(scale: number): number {
  const raw = window.devicePixelRatio || 1;
  return Math.max(1, Math.min(raw, MAX_RENDER_SCALE / Math.max(scale, 0.01)));
}

export function PdfCanvas({ page, viewport, pageNumber }: PdfCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const dpr = effectiveDevicePixelRatio(viewport.scale);
    canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
    canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    setFailed(false);

    const task: RenderTask = page.render({
      canvas,
      viewport,
      // Applied before the viewport transform, so this is pure DPR upscaling.
      transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
    });

    task.promise.catch((error: unknown) => {
      // A cancelled render is the expected outcome of a zoom change mid-flight.
      if (!isRenderCancelled(error)) {
        setFailed(true);
      }
    });

    return () => {
      // §8.2: without this, an in-flight render can land on the canvas *after* a
      // newer render for a different scale, leaving a stale image.
      task.cancel();
      // Release the backing store immediately when the page scrolls out of range.
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [page, viewport]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="tis-page__canvas"
        // The page image is decorative here; the mask list is the accessible view.
        aria-hidden="true"
      />
      {failed ? (
        <div className="tis-page__render-error" role="status">
          Page {pageNumber} could not be displayed.
        </div>
      ) : null}
    </>
  );
}
