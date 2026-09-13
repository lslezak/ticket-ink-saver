// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ladislav Slezák

/**
 * Editor reducer (spec §7.3, §9).
 *
 * Rule: this state holds *committed* data only. The in-progress drag lives in a ref
 * inside the drawing layer and is dispatched exactly once, on pointer-up. Dispatching
 * on pointermove would re-render the whole tree 60+ times a second.
 */
import { DEFAULT_STROKE_WIDTH, DEFAULT_ZOOM, MAX_HISTORY } from '../constants';
import type {
  AppError,
  DocumentInfo,
  EditorState,
  History,
  Mask,
  MaskId,
  MaskList,
} from '../types/models';

export type EditorAction =
  | { type: 'DOCUMENT_LOADING' }
  | { type: 'DOCUMENT_LOADED'; document: DocumentInfo; notice: string | null }
  | { type: 'DOCUMENT_FAILED'; error: AppError }
  | { type: 'DOCUMENT_CLOSED' }
  | { type: 'MASK_ADDED'; mask: Mask }
  | { type: 'MASK_SELECTED'; maskId: MaskId | null }
  | { type: 'MASK_GEOMETRY_CHANGED'; mask: Mask }
  | { type: 'MASK_DELETED'; maskId: string }
  | { type: 'MASKS_CLEARED'; pageIndex: number | 'ALL' }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'TOOL_SELECTED'; tool: EditorState['activeTool'] }
  | { type: 'STROKE_WIDTH_CHANGED'; strokeWidth: number }
  | { type: 'ZOOM_CHANGED'; zoom: number }
  | { type: 'EXPORT_STARTED' }
  | { type: 'EXPORT_FINISHED' }
  | { type: 'ERROR_RAISED'; error: AppError }
  | { type: 'ERROR_DISMISSED' };

const emptyHistory: History<MaskList> = { past: [], present: [], future: [] };

export const initialEditorState: EditorState = {
  document: null,
  masks: emptyHistory,
  activeTool: 'RECTANGLE',
  selectedMaskId: null,
  strokeWidth: DEFAULT_STROKE_WIDTH,
  zoom: DEFAULT_ZOOM,
  status: 'IDLE',
  error: null,
  notice: null,
  exportedMasks: null,
};

/** Push a new present, dropping the oldest entry past MAX_HISTORY and clearing redo. */
function commit(history: History<MaskList>, next: MaskList): History<MaskList> {
  const past = [...history.past, history.present];
  return {
    past: past.length > MAX_HISTORY ? past.slice(past.length - MAX_HISTORY) : past,
    present: next,
    future: [], // AC-5.2
  };
}

/** Undo/redo can remove the mask that was selected; never point at a ghost. */
function stillPresent(maskId: MaskId | null, masks: MaskList): MaskId | null {
  if (maskId === null) return null;
  return masks.some((mask) => mask.id === maskId) ? maskId : null;
}

function undo(history: History<MaskList>): History<MaskList> {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1];
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

function redo(history: History<MaskList>): History<MaskList> {
  if (history.future.length === 0) return history;
  const [next, ...rest] = history.future;
  if (!next) return history;
  return {
    past: [...history.past, history.present],
    present: next,
    future: rest,
  };
}

export function canUndo(state: EditorState): boolean {
  return state.masks.past.length > 0;
}

export function canRedo(state: EditorState): boolean {
  return state.masks.future.length > 0;
}

/**
 * FR-8: is there mask work that would be lost right now?
 *
 * Masks are deliberately not persisted (non-goal N3), so anything not yet exported
 * disappears on reload or when another document is opened. False once the current
 * mask set has been exported, so a user who just downloaded their ticket is not
 * nagged on the way out.
 */
export function selectedMask(state: EditorState): Mask | null {
  if (state.selectedMaskId === null) return null;
  return state.masks.present.find((mask) => mask.id === state.selectedMaskId) ?? null;
}

export function hasUnsavedMasks(state: EditorState): boolean {
  return state.masks.present.length > 0 && state.masks.present !== state.exportedMasks;
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'DOCUMENT_LOADING':
      return { ...state, status: 'LOADING', error: null, notice: null };

    case 'DOCUMENT_LOADED':
      // AC-5.3: a new document starts with empty history.
      return {
        ...state,
        status: 'READY',
        document: action.document,
        masks: emptyHistory,
        zoom: DEFAULT_ZOOM,
        error: null,
        notice: action.notice,
        exportedMasks: null,
        selectedMaskId: null,
      };

    case 'DOCUMENT_FAILED':
      // A failed load must not destroy the document the user already has open.
      return {
        ...state,
        status: state.document ? 'READY' : 'IDLE',
        error: action.error,
      };

    case 'DOCUMENT_CLOSED':
      return { ...initialEditorState, activeTool: state.activeTool, strokeWidth: state.strokeWidth };

    case 'MASK_ADDED':
      // A freshly drawn mask becomes the selected one, so it can be nudged or resized
      // straight away without hunting for it.
      return {
        ...state,
        masks: commit(state.masks, [...state.masks.present, action.mask]),
        selectedMaskId: action.mask.id,
      };

    case 'MASK_SELECTED':
      // Re-selecting the same mask (or clearing an empty selection) is a no-op;
      // returning a fresh object would re-render the tree for nothing.
      if (state.selectedMaskId === action.maskId) return state;
      return { ...state, selectedMaskId: action.maskId };

    case 'MASK_GEOMETRY_CHANGED': {
      /*
       * FR-9: one completed move or resize is one undo step. The live drag is held in
       * a ref by the interaction layer and only reaches the reducer on pointer-up, so
       * this never fires per pointermove.
       */
      const next = state.masks.present.map((mask) =>
        mask.id === action.mask.id ? action.mask : mask,
      );
      return { ...state, masks: commit(state.masks, next), selectedMaskId: action.mask.id };
    }

    case 'MASK_DELETED': {
      const next = state.masks.present.filter((mask) => mask.id !== action.maskId);
      if (next.length === state.masks.present.length) return state;
      return {
        ...state,
        masks: commit(state.masks, next),
        selectedMaskId: state.selectedMaskId === action.maskId ? null : state.selectedMaskId,
      };
    }

    case 'MASKS_CLEARED': {
      const next =
        action.pageIndex === 'ALL'
          ? []
          : state.masks.present.filter((mask) => mask.pageIndex !== action.pageIndex);
      if (next.length === state.masks.present.length) return state;
      return { ...state, masks: commit(state.masks, next), selectedMaskId: null };
    }

    case 'UNDO': {
      const masks = undo(state.masks);
      return { ...state, masks, selectedMaskId: stillPresent(state.selectedMaskId, masks.present) };
    }

    case 'REDO': {
      const masks = redo(state.masks);
      return { ...state, masks, selectedMaskId: stillPresent(state.selectedMaskId, masks.present) };
    }

    case 'TOOL_SELECTED':
      return { ...state, activeTool: action.tool };

    case 'STROKE_WIDTH_CHANGED':
      return { ...state, strokeWidth: action.strokeWidth };

    case 'ZOOM_CHANGED':
      return { ...state, zoom: action.zoom };

    case 'EXPORT_STARTED':
      return { ...state, status: 'EXPORTING', error: null };

    case 'EXPORT_FINISHED':
      // FR-8: what is now on disk matches these masks, so they are no longer unsaved.
      return {
        ...state,
        status: state.document ? 'READY' : 'IDLE',
        exportedMasks: state.masks.present,
      };

    case 'ERROR_RAISED':
      return {
        ...state,
        status: state.document ? 'READY' : 'IDLE',
        error: action.error,
      };

    case 'ERROR_DISMISSED':
      return { ...state, error: null };

    default: {
      // Exhaustiveness guard: adding an action without handling it fails the build.
      const unhandled: never = action;
      return unhandled;
    }
  }
}
