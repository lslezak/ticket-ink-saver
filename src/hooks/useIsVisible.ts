// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ladislav Slezák

/**
 * Viewport virtualisation primitive (spec §8.2).
 *
 * `overscanPx` is applied as an IntersectionObserver rootMargin, so pages just
 * outside the viewport are already rendered by the time they scroll into view.
 */
import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

export function useIsVisible(ref: RefObject<Element | null>, overscanPx: number): boolean {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) setIsVisible(entry.isIntersecting);
      },
      { rootMargin: `${overscanPx}px 0px` },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, overscanPx]);

  return isVisible;
}
