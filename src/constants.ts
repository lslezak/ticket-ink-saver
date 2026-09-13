// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ladislav Slezák

/** Tunable limits and defaults. Spec §4 (AC-1.3, FR-3, FR-4) and §5 (NFR-2). */

/** AC-1.3: reject oversized input rather than melting the tab. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_PAGES = 200;

/**
 * FR-3: breathing room left around a fitted page, so that landing exactly on the
 * viewport edge cannot provoke a scrollbar that then changes the fit.
 */
export const FIT_MARGIN_PX = 8;

/** FR-3: discrete zoom steps, 25 %-400 %. */
export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;
export const DEFAULT_ZOOM = 1;
export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1] as number;

/**
 * §8.2 memory guard: the canvas backing store is (cssPx * dpr), so on a 2x display
 * a 400 % zoom would allocate 8x linear / 64x area. Cap the product.
 */
export const MAX_RENDER_SCALE = 4;

/** §8.2: re-render is debounced so a held-down zoom button queues one render, not N. */
export const ZOOM_DEBOUNCE_MS = 150;

/** §8.2: how far outside the viewport a page is still kept rendered. */
export const RENDER_OVERSCAN_PX = 1200;

/** FR-5: undo depth. */
export const MAX_HISTORY = 50;

/** FR-4: freehand stroke width, in PDF points. */
export const DEFAULT_STROKE_WIDTH = 12;
export const MIN_STROKE_WIDTH = 2;
export const MAX_STROKE_WIDTH = 72;

/** AC-4.2: drags smaller than this (CSS px) are treated as accidental clicks. */
export const MIN_RECT_SIZE_PX = 3;

/** §8.5: don't record a freehand point until the pointer has moved this far (CSS px). */
export const FREEHAND_MIN_POINT_DISTANCE_PX = 2;

/** §8.5: Ramer-Douglas-Peucker tolerance, in PDF points. */
export const FREEHAND_SIMPLIFY_EPSILON_PT = 1;

/** §8.4: how long to wait for the print iframe before falling back to download. */
export const PRINT_TIMEOUT_MS = 5000;

/** AC-1.2 */
export const MAX_PASSWORD_ATTEMPTS = 3;

/**
 * FR-10: longest edge of the offscreen raster used to estimate ink coverage.
 *
 * Small on purpose. It bounds both the render cost and the memory retained per page,
 * and measurement converges well before this point: 200, 400 and 800 all report the
 * same rounded percentage on a realistic ticket, while 24 shifts it by a point. There
 * is nothing to buy by going higher.
 */
export const INK_SAMPLE_MAX_DIMENSION_PX = 200;
