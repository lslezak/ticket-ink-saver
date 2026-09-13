// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ladislav Slezák

/**
 * Getting the finished PDF to the user (spec FR-7, §8.4).
 *
 * Programmatic printing of a blob PDF is genuinely not portable: iOS Safari has no
 * equivalent, and some Firefox configurations refuse it silently. So printing is
 * attempted via a hidden same-origin iframe with a timeout, and download is a
 * first-class fallback rather than an error path (AC-7.4).
 *
 * Every object URL created here is revoked; leaking one pins the whole PDF in memory.
 */
import { PRINT_TIMEOUT_MS } from '../constants';

function createPdfBlobUrl(bytes: Uint8Array): string {
  // Copy into a fresh ArrayBuffer so the Blob never aliases a view we might reuse.
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return URL.createObjectURL(new Blob([buffer], { type: 'application/pdf' }));
}

export function downloadPdf(bytes: Uint8Array, fileName: string): void {
  const url = createPdfBlobUrl(bytes);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // The download is started synchronously by click(); revoking on the next tick is safe.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function suggestedFileName(originalName: string): string {
  const withoutExtension = originalName.replace(/\.pdf$/i, '');
  return `${withoutExtension || 'document'}-inksaver.pdf`;
}

/**
 * Try to open the browser print dialog for `bytes`.
 * Resolves true if the dialog was invoked, false if this browser would not do it.
 */
export function printPdf(bytes: Uint8Array): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const url = createPdfBlobUrl(bytes);
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.setAttribute('title', 'Print preview');
    // Off-screen rather than display:none -- a hidden iframe is not guaranteed to
    // load its PDF viewer plugin in every browser.
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '1px';
    iframe.style.height = '1px';
    iframe.style.border = '0';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';

    let settled = false;
    let timeoutId = 0;

    const cleanup = (): void => {
      window.clearTimeout(timeoutId);
      // Give the print dialog time to take its own reference before we tear down.
      window.setTimeout(() => {
        iframe.remove();
        URL.revokeObjectURL(url);
      }, 60_000);
    };

    const settle = (didPrint: boolean): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(didPrint);
    };

    iframe.onload = () => {
      try {
        const frameWindow = iframe.contentWindow;
        if (!frameWindow) {
          settle(false);
          return;
        }
        frameWindow.focus();
        frameWindow.print();
        settle(true);
      } catch {
        // Cross-origin or unsupported: fall back to download.
        settle(false);
      }
    };

    iframe.onerror = () => settle(false);

    // If the viewer never fires load (iOS Safari), give up and let the caller
    // offer a download instead of leaving the user with a dead button.
    timeoutId = window.setTimeout(() => settle(false), PRINT_TIMEOUT_MS);

    iframe.src = url;
    document.body.appendChild(iframe);
  });
}
