// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ladislav Slezák

/**
 * Warn before the tab is closed or reloaded while mask work would be lost (FR-8).
 *
 * Masks are not persisted (non-goal N3), so a reload discards them. Browsers show
 * their own fixed wording here — a custom message has been ignored for years — so the
 * only thing under our control is *whether* to prompt. Prompting when there is nothing
 * to lose trains people to click through the dialog, hence the `enabled` guard.
 */
import { useEffect } from 'react';

export function useUnloadWarning(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return undefined;

    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      // Both forms are needed for cross-browser coverage.
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [enabled]);
}
