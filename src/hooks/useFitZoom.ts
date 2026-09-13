// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ladislav Slezák

/**
 * Live zoom for the two fit modes (FR-3).
 *
 * The scale is derived from the space actually available, so it has to be recomputed
 * whenever that space changes — a window resize, the mask panel opening, the toolbar
 * wrapping to another row. A ResizeObserver on the viewer catches all of those; a
 * window resize listener alone would miss the last two.
 */
import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';
import type { PageDisplaySize, ZoomMode } from '../types/models';
import { FIT_MARGIN_PX, MAX_ZOOM, MIN_ZOOM } from '../constants';

/**
 * Scale that fits `page` into `viewer`, or null if it cannot be determined yet.
 *
 * Every allowance is measured from the live DOM rather than hard-coded, so the result
 * stays correct if the page caption or the gutters change. `clientWidth`/`clientHeight`
 * already exclude any scrollbar, which is what makes fit-width land inside the viewport
 * instead of provoking a horizontal scrollbar.
 */
export function computeFitZoom(
  mode: Exclude<ZoomMode, 'FIXED'>,
  viewer: HTMLElement,
  page: PageDisplaySize,
): number | null {
  if (page.width <= 0 || page.height <= 0) return null;

  const pages = viewer.querySelector<HTMLElement>('.tis-viewer__pages');
  const style = pages ? getComputedStyle(pages) : null;
  const padTop = style ? parseFloat(style.paddingTop) || 0 : 0;
  const padBottom = style ? parseFloat(style.paddingBottom) || 0 : 0;
  const padLeft = style ? parseFloat(style.paddingLeft) || 0 : 0;
  const padRight = style ? parseFloat(style.paddingRight) || 0 : 0;

  /*
   * The caption under each sheet takes vertical space that "fit page" must account
   * for, or the page would be sized to the full height and then pushed into a scroll
   * by its own label. Measured, not assumed.
   */
  let caption = 0;
  const firstPage = viewer.querySelector<HTMLElement>('.tis-page');
  const firstSheet = firstPage?.querySelector<HTMLElement>('.tis-page__sheet');
  if (firstPage && firstSheet) {
    caption = Math.max(
      0,
      firstPage.getBoundingClientRect().height - firstSheet.getBoundingClientRect().height,
    );
  }

  const availableWidth = viewer.clientWidth - padLeft - padRight - FIT_MARGIN_PX;
  if (availableWidth <= 0) return null;

  const widthScale = availableWidth / page.width;
  if (mode === 'FIT_WIDTH') return clampZoom(widthScale);

  const availableHeight = viewer.clientHeight - padTop - padBottom - caption - FIT_MARGIN_PX;
  if (availableHeight <= 0) return null;

  return clampZoom(Math.min(widthScale, availableHeight / page.height));
}

function clampZoom(value: number): number {
  return Math.min(Math.max(value, MIN_ZOOM), MAX_ZOOM);
}

export function useFitZoom(
  mode: ZoomMode,
  page: PageDisplaySize | null,
  scrollRef: RefObject<HTMLDivElement>,
  onFit: (zoom: number) => void,
): void {
  const pageWidth = page?.width ?? 0;
  const pageHeight = page?.height ?? 0;

  /*
   * A layout effect, not a passive one, and the first computation is synchronous.
   *
   * Deferring it to requestAnimationFrame meant the pages painted at the previous
   * scale and then visibly jumped once the callback ran — around 150 ms later, because
   * the main thread is busy rendering the ink samples at exactly that moment. Running
   * before paint means the first frame is already correctly sized.
   */
  useLayoutEffect(() => {
    if (mode === 'FIXED' || pageWidth <= 0 || pageHeight <= 0) return undefined;
    const viewer = scrollRef.current;
    if (!viewer) return undefined;

    const apply = (): void => {
      const next = computeFitZoom(mode, viewer, { width: pageWidth, height: pageHeight });
      if (next !== null) onFit(next);
    };

    let frame = 0;
    const recompute = (): void => {
      // Later recomputes stay deferred: writing from inside a ResizeObserver callback
      // is what provokes the browser's "ResizeObserver loop" warning.
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(apply);
    };

    apply();
    const observer = new ResizeObserver(recompute);
    observer.observe(viewer);
    // The viewer does not resize when only the device pixel ratio changes.
    window.addEventListener('resize', recompute);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', recompute);
    };
  }, [mode, pageWidth, pageHeight, scrollRef, onFit]);
}
