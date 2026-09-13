// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ladislav Slezák

/**
 * Opening a local PDF (spec FR-1, §8.1).
 *
 * The critical detail here is the ArrayBuffer ownership rule from §8.1: pdf.js
 * *transfers* the typed array it is handed to its worker thread, which detaches it
 * on the main thread. If we later gave that same buffer to pdf-lib we would get an
 * empty or throwing document. So we read the file once, keep `originalBytes`
 * pristine, and hand pdf.js a copy.
 */
import { pdfjs } from './pdfjs';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from './pdfjs';
import { MAX_FILE_BYTES, MAX_PAGES, MAX_PASSWORD_ATTEMPTS } from '../constants';
import type { AppError, DocumentInfo, PageDisplaySize } from '../types/models';

export interface LoadedDocument {
  readonly proxy: PDFDocumentProxy;
  /**
   * Kept so the document can be released later: PDFDocumentProxy has no destroy()
   * of its own in pdf.js v6 -- only the loading task can tear down the worker.
   */
  readonly loadingTask: PDFDocumentLoadingTask;
  /** Pristine, never handed to pdf.js. Used by the export step. */
  readonly originalBytes: Uint8Array;
  readonly info: DocumentInfo;
}

export class LoadError extends Error {
  readonly appError: AppError;
  constructor(appError: AppError) {
    super(appError.message);
    this.name = 'LoadError';
    this.appError = appError;
  }
}

/** Resolves with a password, or null if the user cancelled. */
export type PasswordRequester = (wasIncorrect: boolean) => Promise<string | null>;

function looksLikePdf(bytes: Uint8Array): boolean {
  // The header may be preceded by junk in the wild, so scan the first 1 KiB for "%PDF-".
  const limit = Math.min(bytes.length, 1024);
  const signature = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
  outer: for (let i = 0; i + signature.length <= limit; i += 1) {
    for (let j = 0; j < signature.length; j += 1) {
      if (bytes[i + j] !== signature[j]) continue outer;
    }
    return true;
  }
  return false;
}

export async function loadDocument(
  file: File,
  requestPassword: PasswordRequester,
): Promise<LoadedDocument> {
  if (file.size > MAX_FILE_BYTES) {
    throw new LoadError({
      kind: 'TOO_LARGE',
      fatal: false,
      message: `"${file.name}" is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_FILE_BYTES)}.`,
    });
  }

  const originalBytes = new Uint8Array(await file.arrayBuffer());

  if (!looksLikePdf(originalBytes)) {
    throw new LoadError({
      kind: 'NOT_A_PDF',
      fatal: false,
      message: `"${file.name}" does not look like a PDF file.`,
    });
  }

  let promptCount = 0;
  let cancelled = false;
  let wasEncrypted = false;

  // .slice() copies: pdf.js may detach what we pass it, originalBytes must survive.
  const loadingTask = pdfjs.getDocument({
    data: originalBytes.slice(),
    /*
     * NFR-6 note: earlier pdf.js releases needed `isEvalSupported: false` to keep
     * font and pattern compilation away from eval. pdf.js 6 removed both the eval
     * code path and the option, so there is nothing to switch off here -- verified
     * by there being no `new Function(` in pdf.mjs or pdf.worker.mjs.
     */
    // Do not fetch anything from the network for a local file.
    disableAutoFetch: true,
    disableStream: true,
  });

  loadingTask.onPassword = (updatePassword: (password: string) => void, reason: number) => {
    wasEncrypted = true;
    const wasIncorrect = reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD;

    void (async () => {
      if (promptCount >= MAX_PASSWORD_ATTEMPTS) {
        cancelled = true;
        void loadingTask.destroy();
        return;
      }
      promptCount += 1;
      const password = await requestPassword(wasIncorrect);
      if (password === null) {
        cancelled = true;
        void loadingTask.destroy();
        return;
      }
      updatePassword(password);
    })();
  };

  let proxy: PDFDocumentProxy;
  try {
    proxy = await loadingTask.promise;
  } catch (error) {
    if (cancelled) {
      throw new LoadError({
        kind: 'PASSWORD_FAILED',
        fatal: false,
        message:
          promptCount >= MAX_PASSWORD_ATTEMPTS
            ? 'Too many incorrect passwords. The document was not opened.'
            : 'Opening the password-protected document was cancelled.',
      });
    }
    throw new LoadError({
      kind: 'CORRUPT',
      fatal: false,
      message: `"${file.name}" could not be read: ${describe(error)}`,
    });
  }

  if (proxy.numPages > MAX_PAGES) {
    await loadingTask.destroy();
    throw new LoadError({
      kind: 'TOO_MANY_PAGES',
      fatal: false,
      message: `"${file.name}" has ${proxy.numPages} pages. The limit is ${MAX_PAGES}.`,
    });
  }

  // Measure every page up front so the scroll container can lay out the full
  // document immediately; virtualisation (§8.2) then only controls *rendering*.
  const pageSizes: PageDisplaySize[] = [];
  for (let pageNumber = 1; pageNumber <= proxy.numPages; pageNumber += 1) {
    const page = await proxy.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    pageSizes.push({ width: viewport.width, height: viewport.height });
  }

  return {
    proxy,
    loadingTask,
    originalBytes,
    info: {
      fileName: file.name,
      pageCount: proxy.numPages,
      pageSizes,
      wasEncrypted,
    },
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
