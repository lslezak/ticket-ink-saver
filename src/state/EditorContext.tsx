// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ladislav Slezák

/**
 * Context wiring (spec §7.3, §7.4).
 *
 * Two separate contexts on purpose:
 *   - EditorStateContext / EditorDispatchContext hold the small, serialisable,
 *     committed state. Splitting state from dispatch means components that only
 *     dispatch (most of the toolbar) don't re-render when state changes.
 *   - DocumentContext holds the large, mutable, non-comparable pdf.js objects and
 *     the pristine file bytes. These must never enter the reducer.
 */
import { createContext, useContext, useMemo, useReducer, useState } from 'react';
import type { Dispatch, ReactNode } from 'react';
import { editorReducer, initialEditorState } from './editorReducer';
import type { EditorAction } from './editorReducer';
import type { EditorState } from '../types/models';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from '../pdf/pdfjs';

export interface LoadedDocumentHandle {
  readonly proxy: PDFDocumentProxy;
  /** Tearing down the worker goes through the loading task, not the proxy. */
  readonly loadingTask: PDFDocumentLoadingTask;
  /** Pristine bytes for the export step; never passed to pdf.js. See §8.1. */
  readonly originalBytes: Uint8Array;
  readonly fileName: string;
}

const EditorStateContext = createContext<EditorState | null>(null);
const EditorDispatchContext = createContext<Dispatch<EditorAction> | null>(null);

interface DocumentContextValue {
  readonly handle: LoadedDocumentHandle | null;
  readonly setHandle: (handle: LoadedDocumentHandle | null) => void;
}

const DocumentContext = createContext<DocumentContextValue | null>(null);

export function EditorProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, dispatch] = useReducer(editorReducer, initialEditorState);
  const [handle, setHandleState] = useState<LoadedDocumentHandle | null>(null);

  const documentValue = useMemo<DocumentContextValue>(
    () => ({
      handle,
      setHandle: (next: LoadedDocumentHandle | null) => {
        // Release the previous document's worker-side resources before replacing it.
        setHandleState((previous) => {
          if (previous && previous !== next) {
            void previous.loadingTask.destroy().catch(() => undefined);
          }
          return next;
        });
      },
    }),
    [handle],
  );

  return (
    <EditorStateContext.Provider value={state}>
      <EditorDispatchContext.Provider value={dispatch}>
        <DocumentContext.Provider value={documentValue}>{children}</DocumentContext.Provider>
      </EditorDispatchContext.Provider>
    </EditorStateContext.Provider>
  );
}

export function useEditorState(): EditorState {
  const value = useContext(EditorStateContext);
  if (!value) throw new Error('useEditorState must be used inside <EditorProvider>');
  return value;
}

export function useEditorDispatch(): Dispatch<EditorAction> {
  const value = useContext(EditorDispatchContext);
  if (!value) throw new Error('useEditorDispatch must be used inside <EditorProvider>');
  return value;
}

export function useLoadedDocument(): DocumentContextValue {
  const value = useContext(DocumentContext);
  if (!value) throw new Error('useLoadedDocument must be used inside <EditorProvider>');
  return value;
}
