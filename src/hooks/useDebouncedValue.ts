// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ladislav Slezák

/** §8.2: a held-down zoom button should queue one render, not one per repeat. */
import { useEffect, useRef, useState } from 'react';

/**
 * Rate-limit a value, applying the *first* change straight away.
 *
 * A plain trailing debounce delayed every change, including the one that matters most:
 * the initial fit. Pages painted at 100 % and then jumped to the fitted scale a debounce
 * later, visibly, on every document open. Leading-edge means the first change lands
 * immediately and only a burst gets coalesced — which is all the zoom buttons need.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [throttled, setThrottled] = useState(value);
  // 0 so the very first change is always "overdue" and applies without delay.
  const lastAppliedAt = useRef(0);

  useEffect(() => {
    const elapsed = performance.now() - lastAppliedAt.current;
    if (elapsed >= delayMs) {
      lastAppliedAt.current = performance.now();
      setThrottled(value);
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      lastAppliedAt.current = performance.now();
      setThrottled(value);
    }, delayMs - elapsed);
    return () => window.clearTimeout(timeoutId);
  }, [value, delayMs]);

  return throttled;
}
