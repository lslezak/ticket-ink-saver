// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ladislav Slezák

/**
 * Core data model. Mirrors spec §9.
 *
 * The single most important invariant in this file: every coordinate stored here
 * is in PDF user space (origin bottom-left, Y up, unit = 1/72"), never in screen
 * pixels. See spec §8.3. This is what makes masks survive a zoom change.
 */

/** A point in PDF user space: origin bottom-left, Y up, unit = 1/72 inch. */
export interface PdfPoint {
  readonly x: number;
  readonly y: number;
}

/** Axis-aligned rectangle in PDF user space, normalised so width/height > 0. */
export interface PdfRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type MaskId = string;

/**
 * Discriminated union so the compiler enforces that a rectangle has a rect and a
 * freehand stroke has a path — an earlier draft used optional `rect?`/`path?`,
 * which permitted "both" and "neither".
 */
export type Mask =
  | {
      readonly id: MaskId;
      readonly kind: 'RECTANGLE';
      readonly pageIndex: number;
      readonly rect: PdfRect;
    }
  | {
      readonly id: MaskId;
      readonly kind: 'FREEHAND';
      readonly pageIndex: number;
      /** At least 2 points, in PDF user space. */
      readonly path: readonly PdfPoint[];
      /** Stroke width in PDF points. */
      readonly strokeWidth: number;
    };

/**
 * SELECT doubles as the pan tool: dragging a mask moves it, dragging one of its
 * handles resizes it, and dragging empty space scrolls the document (FR-9).
 */
export type ToolId = 'SELECT' | 'RECTANGLE' | 'FREEHAND';

/** Page size as displayed, i.e. at scale 1 with the page's /Rotate applied. */
export interface PageDisplaySize {
  readonly width: number;
  readonly height: number;
}

/** Static, derived, serialisable facts about the loaded document. */
export interface DocumentInfo {
  readonly fileName: string;
  readonly pageCount: number;
  readonly pageSizes: readonly PageDisplaySize[];
  /** True when the source file was encrypted; see §10 — output will be decrypted. */
  readonly wasEncrypted: boolean;
}

export type AppErrorKind =
  | 'NOT_A_PDF'
  | 'TOO_LARGE'
  | 'TOO_MANY_PAGES'
  | 'CORRUPT'
  | 'PASSWORD_FAILED'
  | 'RENDER_FAILED'
  | 'EXPORT_FAILED'
  | 'PRINT_UNSUPPORTED';

export interface AppError {
  readonly kind: AppErrorKind;
  readonly message: string;
  /** Non-fatal errors leave the current document usable. */
  readonly fatal: boolean;
}

/**
 * Snapshot-based history (§9). The mask set is small, so whole snapshots are
 * simpler and far less bug-prone than a command stack with inverse operations,
 * and they make undo of "clear all" free.
 */
export interface History<T> {
  readonly past: readonly T[];
  readonly present: T;
  readonly future: readonly T[];
}

export type MaskList = readonly Mask[];

export type EditorStatus = 'IDLE' | 'LOADING' | 'READY' | 'EXPORTING' | 'ERROR';

export interface EditorState {
  readonly document: DocumentInfo | null;
  readonly masks: History<MaskList>;
  readonly activeTool: ToolId;
  /** The mask being edited, if any. Cleared when it is deleted or the document changes. */
  readonly selectedMaskId: MaskId | null;
  /** PDF points, applied to newly drawn freehand masks. */
  readonly strokeWidth: number;
  readonly zoom: number;
  readonly status: EditorStatus;
  readonly error: AppError | null;
  /**
   * The mask list as it stood at the last successful export, or null if nothing has
   * been exported for this document. Compared by reference, which is exactly right:
   * the reducer replaces the array on every change, and undo restores the *previous*
   * array object — so undoing back to an already-exported state correctly reads as
   * "no unsaved work" again. See FR-8.
   */
  readonly exportedMasks: MaskList | null;
  /** Human-readable note shown alongside the document, e.g. the decryption warning. */
  readonly notice: string | null;
}
