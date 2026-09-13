// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ladislav Slezák

/**
 * Ink-saving estimate for the whole document and per page (FR-10).
 *
 * Pages are measured once, progressively, when a document opens — not tied to what is
 * currently rendered on screen, so the total covers virtualised pages too and does not
 * change as the user scrolls or zooms.
 *
 * Measuring yields between pages so a long document cannot lock the UI, and is
 * abandoned immediately if the document changes underneath it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MaskList } from '../types/models';
import { measurePageInk, savedFraction } from '../ink/inkEstimate';
import type { PageInkSample } from '../ink/inkEstimate';
import { useLoadedDocument } from '../state/EditorContext';

export interface InkSavings {
  /** Fraction saved per page, 0-1; null where the page is not measured yet. */
  readonly perPage: ReadonlyArray<number | null>;
  /** Fraction saved across the document, or null before anything is measured. */
  readonly total: number | null;
  readonly measuredPages: number;
  readonly totalPages: number;
}

const EMPTY: InkSavings = { perPage: [], total: null, measuredPages: 0, totalPages: 0 };

export function useInkSavings(masks: MaskList, pageCount: number): InkSavings {
  const { handle } = useLoadedDocument();
  const samplesRef = useRef<Array<PageInkSample | null>>([]);
  // Bumped as each page is measured, to re-run the (cheap) aggregation below.
  const [measuredPages, setMeasuredPages] = useState(0);

  useEffect(() => {
    samplesRef.current = [];
    setMeasuredPages(0);
    if (!handle || pageCount === 0) return undefined;

    let cancelled = false;
    const samples: Array<PageInkSample | null> = new Array<PageInkSample | null>(pageCount).fill(
      null,
    );
    samplesRef.current = samples;

    void (async () => {
      for (let index = 0; index < pageCount; index += 1) {
        if (cancelled) return;
        try {
          const page = await handle.proxy.getPage(index + 1);
          if (cancelled) return;
          samples[index] = await measurePageInk(page);
        } catch {
          samples[index] = null; // A page we cannot measure simply does not count.
        }
        if (cancelled) return;
        setMeasuredPages(index + 1);
        // Let the browser paint and handle input between pages.
        await new Promise((resolve) => {
          window.setTimeout(resolve, 0);
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [handle, pageCount]);

  return useMemo<InkSavings>(() => {
    const samples = samplesRef.current;
    if (!handle || pageCount === 0 || samples.length === 0) return EMPTY;

    const byPage = new Map<number, typeof masks[number][]>();
    for (const mask of masks) {
      const list = byPage.get(mask.pageIndex);
      if (list) list.push(mask);
      else byPage.set(mask.pageIndex, [mask]);
    }

    const perPage: Array<number | null> = [];
    let inkTotal = 0;
    let inkSaved = 0;
    let measured = 0;

    for (let index = 0; index < pageCount; index += 1) {
      const sample = samples[index];
      if (!sample) {
        perPage.push(null);
        continue;
      }
      measured += 1;
      const pageMasks = byPage.get(index) ?? [];
      const fraction = savedFraction(sample, pageMasks);
      perPage.push(fraction);
      inkTotal += sample.total;
      inkSaved += sample.total * fraction;
    }

    return {
      perPage,
      // A document of entirely blank pages has nothing to save, which is 0 %, not "unknown".
      total: measured === 0 ? null : inkTotal === 0 ? 0 : inkSaved / inkTotal,
      measuredPages,
      totalPages: pageCount,
    };
    // `measuredPages` is the signal that samplesRef has new content in it.
  }, [handle, masks, pageCount, measuredPages]);
}

/** Consistent formatting so the toolbar and the page labels never disagree. */
export function formatSaving(fraction: number | null): string {
  if (fraction === null) return '—';
  const percent = fraction * 100;
  if (percent > 0 && percent < 1) return '<1%';
  return `${Math.round(percent)}%`;
}
