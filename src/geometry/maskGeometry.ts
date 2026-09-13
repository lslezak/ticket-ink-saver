// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ladislav Slezák

/**
 * Geometry for selecting, moving and resizing existing masks (FR-9).
 *
 * Everything here works in *viewport* space and converts back to PDF user space at
 * the end. That is deliberate: a drag delta is naturally expressed in screen pixels,
 * hit-test tolerances are only meaningful in pixels, and — most importantly — going
 * through `pdfRectFromViewportCorners` means page rotation and CropBox offsets are
 * handled by the same tested conversion the drawing path already uses (§8.3), rather
 * than by a second, subtly different implementation here.
 */
import type { PageViewport } from '../pdf/pdfjs';
import type { Mask, PdfPoint } from '../types/models';
import {
  pdfLengthToViewport,
  pdfRectFromViewportCorners,
  pdfToViewportPoint,
  viewportRectFromPdfRect,
  viewportToPdfPoint,
} from './coords';
import type { ViewportPoint, ViewportRect } from './coords';

/** Resize handles, named by compass direction on screen. */
export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const CORNER_HANDLE_IDS: readonly HandleId[] = ['nw', 'ne', 'se', 'sw'];
export const EDGE_HANDLE_IDS: readonly HandleId[] = ['n', 'e', 's', 'w'];
export const HANDLE_IDS: readonly HandleId[] = [...CORNER_HANDLE_IDS, ...EDGE_HANDLE_IDS];

/**
 * Below this on-screen size the eight handles would overlap each other, so only the
 * four corners are offered — they can still resize on both axes.
 */
export const EDGE_HANDLE_MIN_BOX_PX = 32;

/** Drawn size of a handle, and the slop allowed when grabbing one (CSS px). */
export const HANDLE_SIZE_PX = 9;
export const HANDLE_GRAB_TOLERANCE_PX = 5;

/** Extra slop when clicking a thin freehand stroke (CSS px). */
export const STROKE_HIT_TOLERANCE_PX = 4;

/** Smallest a mask may be shrunk to, in viewport px. */
export const MIN_MASK_SIZE_PX = 6;

/** The on-screen box of a mask, including a freehand stroke's half-width. */
export function maskViewportBounds(mask: Mask, viewport: PageViewport): ViewportRect {
  if (mask.kind === 'RECTANGLE') {
    return viewportRectFromPdfRect(mask.rect, viewport);
  }

  const points = mask.path.map((point) => pdfToViewportPoint(point, viewport));
  const first = points[0];
  if (!first) return { x: 0, y: 0, width: 0, height: 0 };

  let minX = first.x;
  let maxX = first.x;
  let minY = first.y;
  let maxY = first.y;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }

  // A stroke covers half its width either side of the path itself.
  const pad = pdfLengthToViewport(mask.strokeWidth, viewport) / 2;
  return {
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };
}

/** Which handles are offered for a box this size. */
export function visibleHandles(bounds: ViewportRect): readonly HandleId[] {
  const roomy =
    bounds.width >= EDGE_HANDLE_MIN_BOX_PX && bounds.height >= EDGE_HANDLE_MIN_BOX_PX;
  return roomy ? HANDLE_IDS : CORNER_HANDLE_IDS;
}

export function handlePositions(bounds: ViewportRect): Record<HandleId, ViewportPoint> {
  const { x, y, width, height } = bounds;
  const midX = x + width / 2;
  const midY = y + height / 2;
  return {
    nw: { x, y },
    n: { x: midX, y },
    ne: { x: x + width, y },
    e: { x: x + width, y: midY },
    se: { x: x + width, y: y + height },
    s: { x: midX, y: y + height },
    sw: { x, y: y + height },
    w: { x, y: midY },
  };
}

/**
 * Which handle, if any, is under `point`. Checked before the mask body.
 *
 * Picks the *nearest* handle rather than the first one in range, and lets corners win
 * over edges. On a small mask the hit zones overlap, and returning the first match in
 * iteration order meant grabbing a corner actually resized a single edge — a one-axis
 * resize when the user asked for two.
 */
export function hitTestHandle(bounds: ViewportRect, point: ViewportPoint): HandleId | null {
  const reach = HANDLE_SIZE_PX / 2 + HANDLE_GRAB_TOLERANCE_PX;
  const positions = handlePositions(bounds);
  const offered = visibleHandles(bounds);

  const nearestWithin = (candidates: readonly HandleId[]): HandleId | null => {
    let best: HandleId | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const id of candidates) {
      if (!offered.includes(id)) continue;
      const position = positions[id];
      if (Math.abs(point.x - position.x) > reach || Math.abs(point.y - position.y) > reach) {
        continue;
      }
      const distance = Math.hypot(point.x - position.x, point.y - position.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = id;
      }
    }
    return best;
  };

  return nearestWithin(CORNER_HANDLE_IDS) ?? nearestWithin(EDGE_HANDLE_IDS);
}

/** Is `point` on the mask itself? Rectangles are solid; strokes use their width. */
export function hitTestMask(mask: Mask, point: ViewportPoint, viewport: PageViewport): boolean {
  if (mask.kind === 'RECTANGLE') {
    const rect = viewportRectFromPdfRect(mask.rect, viewport);
    return (
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height
    );
  }

  const points = mask.path.map((p) => pdfToViewportPoint(p, viewport));
  const reach =
    pdfLengthToViewport(mask.strokeWidth, viewport) / 2 + STROKE_HIT_TOLERANCE_PX;

  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (a && b && distanceToSegment(point, a, b) <= reach) return true;
  }
  // A one-point path still paints a dot.
  const only = points[0];
  return points.length === 1 && !!only && Math.hypot(point.x - only.x, point.y - only.y) <= reach;
}

function distanceToSegment(p: ViewportPoint, a: ViewportPoint, b: ViewportPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Apply a handle drag to a box.
 *
 * Dragging an edge past its opposite is allowed and flips the box, which is what a
 * user expects; the result is re-normalised so width/height stay positive.
 */
export function resizeBounds(
  bounds: ViewportRect,
  handle: HandleId,
  dx: number,
  dy: number,
): ViewportRect {
  let left = bounds.x;
  let top = bounds.y;
  let right = bounds.x + bounds.width;
  let bottom = bounds.y + bounds.height;

  if (handle.includes('w')) left += dx;
  if (handle.includes('e')) right += dx;
  if (handle.includes('n')) top += dy;
  if (handle.includes('s')) bottom += dy;

  return {
    x: Math.min(left, right),
    y: Math.min(top, bottom),
    width: Math.max(Math.abs(right - left), MIN_MASK_SIZE_PX),
    height: Math.max(Math.abs(bottom - top), MIN_MASK_SIZE_PX),
  };
}

export function translateBounds(bounds: ViewportRect, dx: number, dy: number): ViewportRect {
  return { ...bounds, x: bounds.x + dx, y: bounds.y + dy };
}

/**
 * Rebuild a mask so that its on-screen box becomes `to`, given it currently occupies
 * `from`. Covers both move (same size, new origin) and resize (new size).
 *
 * The affine map from `from` to `to` is computed in viewport space and applied to the
 * mask's viewport representation, then converted back to PDF user space — so rotated
 * pages need no special handling here.
 */
export function remapMask(
  mask: Mask,
  from: ViewportRect,
  to: ViewportRect,
  viewport: PageViewport,
): Mask {
  if (mask.kind === 'RECTANGLE') {
    return {
      ...mask,
      rect: pdfRectFromViewportCorners(
        { x: to.x, y: to.y },
        { x: to.x + to.width, y: to.y + to.height },
        viewport,
      ),
    };
  }

  // Guard against dividing by a collapsed source box.
  const scaleX = from.width === 0 ? 1 : to.width / from.width;
  const scaleY = from.height === 0 ? 1 : to.height / from.height;

  const path: PdfPoint[] = mask.path.map((point) => {
    const v = pdfToViewportPoint(point, viewport);
    return viewportToPdfPoint(
      {
        x: to.x + (v.x - from.x) * scaleX,
        y: to.y + (v.y - from.y) * scaleY,
      },
      viewport,
    );
  });

  /*
   * The stroke has one width but the box may have been scaled unevenly, so there is no
   * exactly right answer. The geometric mean keeps the stroke visually proportional to
   * the shape's overall change and is stable under a pure move (both factors are 1).
   */
  const widthScale = Math.sqrt(Math.abs(scaleX * scaleY)) || 1;

  return { ...mask, path, strokeWidth: mask.strokeWidth * widthScale };
}

/** The CSS cursor for a handle, accounting for the page's on-screen rotation. */
export function handleCursor(handle: HandleId): string {
  switch (handle) {
    case 'n':
    case 's':
      return 'ns-resize';
    case 'e':
    case 'w':
      return 'ew-resize';
    case 'nw':
    case 'se':
      return 'nwse-resize';
    default:
      return 'nesw-resize';
  }
}
