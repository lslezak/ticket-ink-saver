// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ladislav Slezák

/**
 * Shared canvas painting for masks, used by both the committed-mask layer and the
 * in-progress preview so the two can never disagree about how a mask looks.
 *
 * Screen-only affordance: a mask is opaque white, which on a white page would be
 * completely invisible. The editor therefore also strokes a thin dashed accent
 * outline so the user can see what they have covered. That outline is drawn here
 * and *only* here -- it never reaches the exported PDF (see pdf/exportPdf.ts).
 */
import type { PageViewport } from '../pdf/pdfjs';
import type { Mask, PdfPoint } from '../types/models';
import {
  pdfLengthToViewport,
  pdfToViewportPoint,
  viewportRectFromPdfRect,
} from '../geometry/coords';
import type { ViewportPoint, ViewportRect } from '../geometry/coords';
import { HANDLE_SIZE_PX, handlePositions, visibleHandles } from '../geometry/maskGeometry';

const MASK_FILL = '#ffffff';
const OUTLINE_COLOR = 'rgba(0, 102, 204, 0.9)';
const OUTLINE_DASH = [4, 3];

export function clearCanvas(context: CanvasRenderingContext2D, viewport: PageViewport): void {
  context.clearRect(0, 0, viewport.width, viewport.height);
}

/** Size a canvas for a viewport at the given device pixel ratio, and return its 2D context. */
export function prepareCanvas(
  canvas: HTMLCanvasElement,
  viewport: PageViewport,
  devicePixelRatio: number,
): CanvasRenderingContext2D | null {
  canvas.width = Math.max(1, Math.floor(viewport.width * devicePixelRatio));
  canvas.height = Math.max(1, Math.floor(viewport.height * devicePixelRatio));
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  const context = canvas.getContext('2d');
  if (!context) return null;
  // Draw in CSS/viewport units; the DPR scaling is applied once, here.
  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  return context;
}

export function paintMask(
  context: CanvasRenderingContext2D,
  mask: Mask,
  viewport: PageViewport,
  withOutline = true,
): void {
  context.save();
  context.fillStyle = MASK_FILL;
  context.strokeStyle = MASK_FILL;

  if (mask.kind === 'RECTANGLE') {
    const rect = viewportRectFromPdfRect(mask.rect, viewport);
    context.fillRect(rect.x, rect.y, rect.width, rect.height);

    if (withOutline) {
      context.strokeStyle = OUTLINE_COLOR;
      context.lineWidth = 1;
      context.setLineDash(OUTLINE_DASH);
      context.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
    }
  } else {
    const points = mask.path.map((point) => pdfToViewportPoint(point, viewport));
    strokePolyline(context, points, pdfLengthToViewport(mask.strokeWidth, viewport), MASK_FILL, []);

    if (withOutline) {
      // A dashed centreline reads as "a stroke lives here" without needing to
      // offset the path to find its true outline.
      strokePolyline(context, points, 1, OUTLINE_COLOR, OUTLINE_DASH);
    }
  }

  context.restore();
}

/** Preview of a rectangle still being dragged, in viewport coordinates. */
export function paintRectanglePreview(
  context: CanvasRenderingContext2D,
  start: ViewportPoint,
  end: ViewportPoint,
): void {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);

  context.save();
  context.fillStyle = MASK_FILL;
  context.fillRect(x, y, width, height);
  context.strokeStyle = OUTLINE_COLOR;
  context.lineWidth = 1;
  context.setLineDash(OUTLINE_DASH);
  context.strokeRect(x + 0.5, y + 0.5, Math.max(0, width - 1), Math.max(0, height - 1));
  context.restore();
}

/** Preview of a freehand stroke still being drawn, in viewport coordinates. */
export function paintFreehandPreview(
  context: CanvasRenderingContext2D,
  points: readonly ViewportPoint[],
  strokeWidthPx: number,
): void {
  if (points.length === 0) return;
  context.save();
  strokePolyline(context, points, strokeWidthPx, MASK_FILL, []);
  strokePolyline(context, points, 1, OUTLINE_COLOR, OUTLINE_DASH);
  context.restore();
}

function strokePolyline(
  context: CanvasRenderingContext2D,
  points: readonly ViewportPoint[],
  lineWidth: number,
  color: string,
  dash: number[],
): void {
  const first = points[0];
  if (!first) return;

  context.save();
  context.strokeStyle = color;
  context.lineWidth = Math.max(lineWidth, 0.5);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.setLineDash(dash);

  context.beginPath();
  if (points.length === 1) {
    // A single point still has to show up: draw a zero-length segment so the
    // round cap paints a dot.
    context.moveTo(first.x, first.y);
    context.lineTo(first.x, first.y);
  } else {
    context.moveTo(first.x, first.y);
    for (let i = 1; i < points.length; i += 1) {
      const point = points[i];
      if (point) context.lineTo(point.x, point.y);
    }
  }
  context.stroke();
  context.restore();
}

/** Convenience for mapping stored PDF points into viewport space. */
export function toViewportPoints(
  points: readonly PdfPoint[],
  viewport: PageViewport,
): ViewportPoint[] {
  return points.map((point) => pdfToViewportPoint(point, viewport));
}


const SELECTION_COLOR = '#06c';
const HANDLE_FILL = '#ffffff';

/**
 * Selection chrome for the mask being edited (FR-9): a solid outline plus the eight
 * resize handles. Editor-only, like the dashed mask outline — none of it reaches the
 * exported PDF.
 */
export function paintSelection(
  context: CanvasRenderingContext2D,
  bounds: ViewportRect,
  withHandles = true,
): void {
  context.save();
  context.strokeStyle = SELECTION_COLOR;
  context.lineWidth = 1.5;
  context.setLineDash([]);
  context.strokeRect(bounds.x + 0.5, bounds.y + 0.5, bounds.width - 1, bounds.height - 1);

  if (withHandles) {
    const positions = handlePositions(bounds);
    const half = HANDLE_SIZE_PX / 2;
    context.lineWidth = 1;
    // Only the grabbable ones, so the chrome never promises a handle that cannot win.
    for (const id of visibleHandles(bounds)) {
      const position = positions[id];
      context.fillStyle = HANDLE_FILL;
      context.fillRect(position.x - half, position.y - half, HANDLE_SIZE_PX, HANDLE_SIZE_PX);
      context.strokeRect(
        position.x - half + 0.5,
        position.y - half + 0.5,
        HANDLE_SIZE_PX - 1,
        HANDLE_SIZE_PX - 1,
      );
    }
  }
  context.restore();
}
