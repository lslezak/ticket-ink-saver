// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ladislav Slezák

/**
 * Conversions between the three coordinate spaces of spec §8.3.
 *
 *   1. Pointer / CSS space  - origin top-left of the canvas element, Y down, zoom-dependent.
 *   2. Viewport space       - what pdf.js renders into; 1:1 with CSS px here because we set
 *                             the canvas CSS size to exactly viewport.width/height.
 *   3. PDF user space       - origin bottom-left, Y up, points. What we persist.
 *
 * All conversion goes through pdf.js's own `PageViewport`, which already folds in
 * scale, the page's /Rotate and the view-box (CropBox) offset. Hand-rolling this
 * arithmetic is the classic source of masks that land in the wrong place on
 * rotated pages — see spec §8.3 rule 2.
 */
import type { PageViewport } from 'pdfjs-dist';
import type { PdfPoint, PdfRect } from '../types/models';

export interface ViewportPoint {
  readonly x: number;
  readonly y: number;
}

export interface ViewportRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Pointer event -> viewport-space point.
 *
 * Uses clientX/clientY against the element's bounding rect, never offsetX/offsetY
 * (which is relative to whichever child node happened to be under the cursor).
 * The rect.width ratio keeps us correct even if CSS ever scales the canvas.
 */
export function pointerToViewportPoint(
  event: { clientX: number; clientY: number },
  element: HTMLElement,
  viewport: PageViewport,
): ViewportPoint {
  const rect = element.getBoundingClientRect();
  const scaleX = rect.width === 0 ? 1 : viewport.width / rect.width;
  const scaleY = rect.height === 0 ? 1 : viewport.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

/** AC-4.3: a drag released outside the page is clamped to the page, not discarded. */
export function clampToViewport(point: ViewportPoint, viewport: PageViewport): ViewportPoint {
  return {
    x: Math.min(Math.max(point.x, 0), viewport.width),
    y: Math.min(Math.max(point.y, 0), viewport.height),
  };
}

export function viewportToPdfPoint(point: ViewportPoint, viewport: PageViewport): PdfPoint {
  const converted = viewport.convertToPdfPoint(point.x, point.y) as number[];
  return { x: converted[0] ?? 0, y: converted[1] ?? 0 };
}

export function pdfToViewportPoint(point: PdfPoint, viewport: PageViewport): ViewportPoint {
  const converted = viewport.convertToViewportPoint(point.x, point.y) as number[];
  return { x: converted[0] ?? 0, y: converted[1] ?? 0 };
}

/**
 * Two opposite corners in viewport space -> a normalised rect in PDF user space.
 *
 * Normalisation must happen *after* conversion: the Y axis flips, and under a 90 deg
 * page rotation the X and Y axes swap, so "the corner the user pressed at" is not
 * reliably the minimum corner in PDF space.
 */
export function pdfRectFromViewportCorners(
  a: ViewportPoint,
  b: ViewportPoint,
  viewport: PageViewport,
): PdfRect {
  const pa = viewportToPdfPoint(a, viewport);
  const pb = viewportToPdfPoint(b, viewport);
  return {
    x: Math.min(pa.x, pb.x),
    y: Math.min(pa.y, pb.y),
    width: Math.abs(pb.x - pa.x),
    height: Math.abs(pb.y - pa.y),
  };
}

/**
 * A PDF-space rect -> its axis-aligned box in viewport space, for redrawing.
 * Rotation by a multiple of 90 deg maps an axis-aligned rect to an axis-aligned
 * rect, so converting two opposite corners and re-normalising is exact.
 */
export function viewportRectFromPdfRect(rect: PdfRect, viewport: PageViewport): ViewportRect {
  const a = pdfToViewportPoint({ x: rect.x, y: rect.y }, viewport);
  const b = pdfToViewportPoint({ x: rect.x + rect.width, y: rect.y + rect.height }, viewport);
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/**
 * Convert a length (e.g. a stroke width) from PDF points to viewport pixels.
 * Derived from the viewport transform rather than `viewport.scale` so that a
 * page with a /UserUnit other than 1 still gets the right on-screen thickness.
 */
export function pdfLengthToViewport(length: number, viewport: PageViewport): number {
  const [a = 1, b = 0] = viewport.transform;
  return length * Math.hypot(a, b);
}
