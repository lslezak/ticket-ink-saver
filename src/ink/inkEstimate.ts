// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ladislav Slezák

/**
 * Rough estimate of how much ink the masks save (FR-10).
 *
 * Method: render each page once to a small offscreen raster and score every pixel for
 * "ink". Masks are then rasterised at the same scale, and the ink under them is the
 * saving. Percentage saved = ink under masks / ink on the unmasked page.
 *
 * Two deliberate choices:
 *
 * 1. **Measured off its own low-resolution raster, not the on-screen canvas.** The
 *    displayed pages are virtualised (§8.2) and re-rendered on zoom, so a total taken
 *    from them would count only the pages that happen to be visible and would drift as
 *    the user scrolled. A fixed, zoom-independent sample gives a stable answer for the
 *    whole document.
 *
 * 2. **Coverage, not true ink volume.** `1 - mean(r,g,b)` treats a black pixel as full
 *    coverage and white as none, and counts a saturated colour as needing more ink than
 *    a pale one. Real consumption depends on the printer's colour model, driver,
 *    dithering and paper. This is an honest approximation and the UI must present it as
 *    an estimate, never as a guarantee.
 */
import type { Mask } from '../types/models';
import type { PDFPageProxy, PageViewport } from '../pdf/pdfjs';
import { isRenderCancelled } from '../pdf/pdfjs';
import { INK_SAMPLE_MAX_DIMENSION_PX } from '../constants';
import { paintMask } from '../components/maskPainting';

export interface PageInkSample {
  readonly viewport: PageViewport;
  readonly width: number;
  readonly height: number;
  /** Per-pixel coverage, 0 (white) to 255 (black), row-major. */
  readonly ink: Uint8Array;
  /** Sum of `ink`; 0 for a blank page. */
  readonly total: number;
}

/** Scale that fits the page into a small square, so cost is bounded per page. */
function sampleScale(page: PDFPageProxy): number {
  const base = page.getViewport({ scale: 1 });
  const longest = Math.max(base.width, base.height);
  if (longest <= 0) return 1;
  return Math.min(1, INK_SAMPLE_MAX_DIMENSION_PX / longest);
}

/** Render one page small and score its ink. Returns null if rendering failed. */
export async function measurePageInk(page: PDFPageProxy): Promise<PageInkSample | null> {
  const viewport = page.getViewport({ scale: sampleScale(page) });
  const width = Math.max(1, Math.floor(viewport.width));
  const height = Math.max(1, Math.floor(viewport.height));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;

  try {
    // Paper is white; anything the page does not paint must score as no ink.
    await page.render({ canvas, viewport, background: '#ffffff' }).promise;
  } catch (error) {
    if (!isRenderCancelled(error)) return null;
    return null;
  }

  const pixels = context.getImageData(0, 0, width, height).data;
  const ink = new Uint8Array(width * height);
  let total = 0;

  for (let i = 0, p = 0; p < ink.length; i += 4, p += 1) {
    const r = pixels[i] ?? 255;
    const g = pixels[i + 1] ?? 255;
    const bl = pixels[i + 2] ?? 255;
    const coverage = 255 - ((r + g + bl) / 3);
    const value = coverage < 0 ? 0 : coverage > 255 ? 255 : coverage;
    ink[p] = value;
    total += value;
  }

  // Free the backing store now rather than waiting for GC.
  canvas.width = 0;
  canvas.height = 0;

  return { viewport, width, height, ink, total };
}

/**
 * Ink lying under `masks` on a measured page.
 *
 * The masks are painted with no selection or outline chrome, so only the area that
 * will actually be covered in the output counts.
 */
export function maskedInk(sample: PageInkSample, masks: readonly Mask[]): number {
  if (masks.length === 0 || sample.total === 0) return 0;

  const canvas = document.createElement('canvas');
  canvas.width = sample.width;
  canvas.height = sample.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return 0;

  for (const mask of masks) {
    paintMask(context, mask, sample.viewport, false);
  }

  const alpha = context.getImageData(0, 0, sample.width, sample.height).data;
  let covered = 0;
  for (let i = 3, p = 0; p < sample.ink.length; i += 4, p += 1) {
    // Any coverage at all counts; masks are opaque, so this is edge antialiasing only.
    if ((alpha[i] ?? 0) > 8) covered += sample.ink[p] ?? 0;
  }

  canvas.width = 0;
  canvas.height = 0;
  return covered;
}

/** Fraction of a page's ink removed by its masks, 0-1. */
export function savedFraction(sample: PageInkSample, masks: readonly Mask[]): number {
  if (sample.total === 0) return 0;
  return Math.min(1, maskedInk(sample, masks) / sample.total);
}
