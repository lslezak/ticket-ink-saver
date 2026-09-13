// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ladislav Slezák

/**
 * Orchestration: file opening, keyboard shortcuts, export, and the announcements
 * that make the canvas-based editor usable with a screen reader (spec NFR-5).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AlertActionCloseButton,
  AlertGroup,
  Drawer,
  DrawerActions,
  DrawerCloseButton,
  DrawerContent,
  DrawerContentBody,
  DrawerHead,
  DrawerPanelBody,
  DrawerPanelContent,
  Spinner,
} from '@patternfly/react-core';
import { ActionToolbar } from './ActionToolbar';
import { DocumentViewer } from './DocumentViewer';
import { DropZone } from './DropZone';
import { MaskListPanel } from './MaskListPanel';
import { PasswordModal } from './PasswordModal';
import type { PasswordRequest } from './PasswordModal';
import { ConfirmDiscardModal } from './ConfirmDiscardModal';
import type { DiscardRequest } from './ConfirmDiscardModal';
import { useEditorDispatch, useEditorState, useLoadedDocument } from '../state/EditorContext';
import { canRedo, canUndo, hasUnsavedMasks, selectedMask } from '../state/editorReducer';
import { LoadError, loadDocument } from '../pdf/loadDocument';
import { ExportError, buildMaskedPdf } from '../pdf/exportPdf';
import { downloadPdf, printPdf, suggestedFileName } from '../pdf/output';
import type { AppError, Mask, MaskId, ToolId } from '../types/models';
import {
  maskViewportBounds,
  moveBounds,
  pageBoundsOf,
  remapMask,
  resizeBounds,
} from '../geometry/maskGeometry';
import type { PageViewport } from '../pdf/pdfjs';
import { MAX_ZOOM, MIN_ZOOM } from '../constants';
import { WIDE_LAYOUT_QUERY, useMediaQuery } from '../hooks/useMediaQuery';
import { useUnloadWarning } from '../hooks/useUnloadWarning';
import { useInkSavings } from '../hooks/useInkSavings';

export function EditorWorkspace(): JSX.Element {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const { handle, setHandle } = useLoadedDocument();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  /*
   * Live viewport per rendered page, published by PageView. Held in a ref rather than
   * state: it changes on every zoom and only the key handler reads it, so putting it
   * in state would re-render the tree for nobody's benefit.
   */
  const viewportsRef = useRef(new Map<number, PageViewport>());
  const [passwordRequest, setPasswordRequest] = useState<PasswordRequest | null>(null);
  const [discardRequest, setDiscardRequest] = useState<DiscardRequest | null>(null);
  const [isDraggingOver, setDraggingOver] = useState(false);
  const [visiblePageIndex, setVisiblePageIndex] = useState(0);
  const [announcement, setAnnouncement] = useState('');

  /*
   * Below the lg breakpoint an inline drawer would squeeze the document to nothing,
   * so the mask panel becomes an overlay there and starts closed. `null` means
   * "follow the viewport"; toggling pins an explicit choice without it being
   * overridden on the next resize.
   */
  const isWideLayout = useMediaQuery(WIDE_LAYOUT_QUERY);
  const [panelOpenOverride, setPanelOpenOverride] = useState<boolean | null>(null);
  const isPanelOpen = panelOpenOverride ?? isWideLayout;

  const masks = state.masks.present;
  const hasDocument = state.document !== null;
  const isBusy = state.status === 'LOADING' || state.status === 'EXPORTING';

  /*
   * FR-8. Masks are not persisted (N3), so unexported work is lost on reload or when
   * another document replaces this one. Both exits are guarded.
   */
  const unsaved = hasUnsavedMasks(state);
  useUnloadWarning(unsaved);

  // FR-10. Measured per page off a small offscreen raster, independent of what is
  // currently rendered, so the total covers the whole document.
  const ink = useInkSavings(masks, state.document?.pageCount ?? 0);

  /*
   * pdf-lib cannot decrypt, so an encrypted source can be viewed and masked but not
   * re-saved. Where we already know that (we had to ask for a password), disable the
   * output buttons up front rather than failing after the user clicks.
   */
  const exportDisabledReason = state.document?.wasEncrypted
    ? 'This PDF is encrypted and cannot be re-saved. Remove the protection first.'
    : null;

  const announce = useCallback((message: string) => {
    // Re-announce identical messages by forcing a change in the live region text.
    setAnnouncement((previous) => (previous === message ? `${message} ` : message));
  }, []);

  // ---------------------------------------------------------------- file opening

  const requestPassword = useCallback(
    (wasIncorrect: boolean) =>
      new Promise<string | null>((resolve) => {
        setPasswordRequest({
          wasIncorrect,
          resolve: (password) => {
            setPasswordRequest(null);
            resolve(password);
          },
        });
      }),
    [],
  );

  const confirmDiscard = useCallback(
    (incomingFileName: string, maskCount: number) =>
      new Promise<boolean>((resolve) => {
        setDiscardRequest({
          incomingFileName,
          maskCount,
          resolve: (discard) => {
            setDiscardRequest(null);
            resolve(discard);
          },
        });
      }),
    [],
  );

  const openFile = useCallback(
    async (file: File) => {
      // FR-8: never silently drop mask work by opening another document over it.
      if (unsaved) {
        const discard = await confirmDiscard(file.name, masks.length);
        if (!discard) return;
      }

      dispatch({ type: 'DOCUMENT_LOADING' });
      try {
        const loaded = await loadDocument(file, requestPassword);
        setHandle({
          proxy: loaded.proxy,
          loadingTask: loaded.loadingTask,
          originalBytes: loaded.originalBytes,
          fileName: loaded.info.fileName,
        });
        dispatch({
          type: 'DOCUMENT_LOADED',
          document: loaded.info,
          notice: loaded.info.wasEncrypted
            ? 'This document is encrypted. You can view and mask it, but it cannot be printed or downloaded from here.'
            : null,
        });
        announce(`Opened ${loaded.info.fileName}, ${loaded.info.pageCount} pages.`);
      } catch (error) {
        const appError: AppError =
          error instanceof LoadError
            ? error.appError
            : {
                kind: 'CORRUPT',
                fatal: false,
                message: error instanceof Error ? error.message : String(error),
              };
        dispatch({ type: 'DOCUMENT_FAILED', error: appError });
        announce(appError.message);
      }
    },
    [dispatch, requestPassword, setHandle, announce, confirmDiscard, unsaved, masks.length],
  );

  const handleFileInput = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Reset so re-picking the same file fires change again.
      event.target.value = '';
      if (file) void openFile(file);
    },
    [openFile],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDraggingOver(false);
      const file = event.dataTransfer.files?.[0];
      if (file) void openFile(file);
    },
    [openFile],
  );

  // ---------------------------------------------------------------- editing

  const selected = selectedMask(state);

  const registerViewport = useCallback((pageIndex: number, viewport: PageViewport | null) => {
    if (viewport) viewportsRef.current.set(pageIndex, viewport);
    else viewportsRef.current.delete(pageIndex);
  }, []);

  const selectMask = useCallback(
    (maskId: MaskId | null) => dispatch({ type: 'MASK_SELECTED', maskId }),
    [dispatch],
  );

  const commitGeometry = useCallback(
    (mask: Mask) => dispatch({ type: 'MASK_GEOMETRY_CHANGED', mask }),
    [dispatch],
  );

  const commitMask = useCallback(
    (mask: Mask) => {
      dispatch({ type: 'MASK_ADDED', mask });
      announce(
        `${mask.kind === 'RECTANGLE' ? 'Rectangle' : 'Freehand'} mask added on page ${mask.pageIndex + 1}.`,
      );
    },
    [dispatch, announce],
  );

  const handleUndo = useCallback(() => {
    if (!canUndo(state)) return;
    dispatch({ type: 'UNDO' });
    announce('Undone.');
  }, [state, dispatch, announce]);

  const handleRedo = useCallback(() => {
    if (!canRedo(state)) return;
    dispatch({ type: 'REDO' });
    announce('Redone.');
  }, [state, dispatch, announce]);

  // FR-5 keyboard shortcuts. Ignored while focus is in a text field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        handleUndo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo]);

  /*
   * Keyboard editing of the selected mask (FR-9, NFR-5).
   *
   * This is the part that makes mask editing reachable without a pointer at all:
   * a mask is selected from the accessible list (FR-6), then nudged or resized from
   * the keyboard. Steps are in *screen* pixels and converted through the same
   * viewport maths as a drag, so behaviour matches at every zoom and rotation.
   */
  useEffect(() => {
    if (!selected) return undefined;

    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      if (event.key === 'Escape') {
        selectMask(null);
        announce('Selection cleared.');
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        dispatch({ type: 'MASK_DELETED', maskId: selected.id });
        announce('Mask deleted.');
        return;
      }

      const deltas: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const delta = deltas[event.key];
      if (!delta) return;

      const viewport = viewportsRef.current.get(selected.pageIndex);
      if (!viewport) return;

      event.preventDefault();
      // Shift for a coarse step, matching the convention in drawing tools.
      const step = event.shiftKey ? 10 : 1;
      const [dx, dy] = [delta[0] * step, delta[1] * step];
      const from = maskViewportBounds(selected, viewport);
      const page = pageBoundsOf(viewport);
      // Alt turns the arrows into a resize of the bottom-right corner.
      const to = event.altKey
        ? resizeBounds(from, 'se', dx, dy, page)
        : moveBounds(from, dx, dy, page);

      // Clamping can absorb the step entirely at the page edge; don't record a no-op.
      if (to.x === from.x && to.y === from.y && to.width === from.width && to.height === from.height) {
        return;
      }

      commitGeometry(remapMask(selected, from, to, viewport));
      announce(
        event.altKey
          ? `Mask resized to ${Math.round(to.width)} by ${Math.round(to.height)} pixels.`
          : `Mask moved.`,
      );
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selected, selectMask, commitGeometry, dispatch, announce]);

  // ---------------------------------------------------------------- zoom

  const setZoom = useCallback(
    (zoom: number) => dispatch({ type: 'ZOOM_CHANGED', zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM) }),
    [dispatch],
  );

  const fitWidth = useCallback(() => {
    const element = scrollRef.current;
    const page = state.document?.pageSizes[visiblePageIndex];
    if (!element || !page || page.width === 0) return;
    // 48px accounts for the page gutter and the scrollbar.
    const available = element.clientWidth - 48;
    setZoom(clamp(available / page.width, MIN_ZOOM, MAX_ZOOM));
  }, [state.document, visiblePageIndex, setZoom]);

  // ---------------------------------------------------------------- output

  const runExport = useCallback(
    async (mode: 'PRINT' | 'DOWNLOAD') => {
      if (!handle || !state.document) return;

      dispatch({ type: 'EXPORT_STARTED' });
      try {
        const bytes = await buildMaskedPdf(handle.originalBytes, masks);
        const fileName = suggestedFileName(handle.fileName);

        if (mode === 'DOWNLOAD') {
          downloadPdf(bytes, fileName);
          announce('The masked PDF has been downloaded.');
        } else {
          const printed = await printPdf(bytes);
          if (printed) {
            announce('The print dialog has been opened.');
          } else {
            /*
             * AC-7.4: printing is not portable, so fall back rather than dead-end.
             * This must NOT return early -- the user has their file, so the export
             * still counts as finished. Returning here would leave `exportedMasks`
             * unset and FR-8 would keep warning about work the user has already saved.
             */
            downloadPdf(bytes, fileName);
            dispatch({
              type: 'ERROR_RAISED',
              error: {
                kind: 'PRINT_UNSUPPORTED',
                fatal: false,
                message:
                  'This browser would not open a print dialog for the PDF, so it has been ' +
                  'downloaded instead. Open the downloaded file and print it from there.',
              },
            });
            announce('Printing is not supported here; the masked PDF was downloaded instead.');
          }
        }
        dispatch({ type: 'EXPORT_FINISHED' });
      } catch (error) {
        dispatch({
          type: 'ERROR_RAISED',
          error: {
            kind: 'EXPORT_FAILED',
            fatal: false,
            message:
              error instanceof ExportError
                ? error.message
                : `The masked PDF could not be produced: ${error instanceof Error ? error.message : String(error)}`,
          },
        });
      }
    },
    [handle, state.document, masks, dispatch, announce],
  );

  /*
   * Print is the primary action (Q-2), and the browser's own Ctrl+P would print the
   * editor chrome instead of the ticket -- a wasteful misprint in an app whose whole
   * purpose is saving ink. Route the shortcut to the real print path instead.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'p') return;
      if (!hasDocument || isBusy || exportDisabledReason !== null) return;
      event.preventDefault();
      void runExport('PRINT');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasDocument, isBusy, exportDisabledReason, runExport]);

  // ---------------------------------------------------------------- render

  const panel = useMemo(
    () => (
      <DrawerPanelContent widths={{ default: 'width_33' }} className="tis-drawer">
        <DrawerHead>
          <h2 className="tis-drawer__title">Masks ({masks.length})</h2>
          <DrawerActions>
            <DrawerCloseButton onClick={() => setPanelOpenOverride(false)} />
          </DrawerActions>
        </DrawerHead>
        <DrawerPanelBody>
          <MaskListPanel
            masks={masks}
            pageCount={state.document?.pageCount ?? 0}
            selectedMaskId={state.selectedMaskId}
            onSelect={selectMask}
            onDelete={(maskId) => {
              dispatch({ type: 'MASK_DELETED', maskId });
              announce('Mask deleted.');
            }}
            onClearPage={(pageIndex) => {
              dispatch({ type: 'MASKS_CLEARED', pageIndex });
              announce(`Masks cleared on page ${pageIndex + 1}.`);
            }}
          />
        </DrawerPanelBody>
      </DrawerPanelContent>
    ),
    [masks, state.document, state.selectedMaskId, selectMask, dispatch, announce],
  );

  return (
    <div
      className="tis-workspace"
      onDragOver={(event) => {
        event.preventDefault();
        setDraggingOver(true);
      }}
      onDragLeave={() => setDraggingOver(false)}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="tis-visually-hidden"
        onChange={handleFileInput}
      />

      <ActionToolbar
        hasDocument={hasDocument}
        isBusy={isBusy}
        activeTool={state.activeTool}
        zoom={state.zoom}
        strokeWidth={state.strokeWidth}
        canUndo={canUndo(state)}
        canRedo={canRedo(state)}
        maskCount={masks.length}
        inkSaved={ink.total}
        inkMeasuring={ink.totalPages > 0 && ink.measuredPages < ink.totalPages}
        isPanelOpen={isPanelOpen}
        canExport={exportDisabledReason === null}
        exportDisabledReason={exportDisabledReason}
        onOpenFile={() => fileInputRef.current?.click()}
        onToolChange={(tool: ToolId) => dispatch({ type: 'TOOL_SELECTED', tool })}
        onStrokeWidthChange={(strokeWidth) =>
          dispatch({ type: 'STROKE_WIDTH_CHANGED', strokeWidth })
        }
        onZoomChange={setZoom}
        onFitWidth={fitWidth}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onClearPage={() => {
          dispatch({ type: 'MASKS_CLEARED', pageIndex: visiblePageIndex });
          announce(`Masks cleared on page ${visiblePageIndex + 1}.`);
        }}
        onClearAll={() => {
          dispatch({ type: 'MASKS_CLEARED', pageIndex: 'ALL' });
          announce('All masks cleared.');
        }}
        onTogglePanel={() => setPanelOpenOverride(!isPanelOpen)}
        onPrint={() => void runExport('PRINT')}
        onDownload={() => void runExport('DOWNLOAD')}
      />

      <AlertGroup isToast isLiveRegion>
        {state.error ? (
          <Alert
            variant={state.error.kind === 'PRINT_UNSUPPORTED' ? 'warning' : 'danger'}
            title={state.error.message}
            actionClose={
              <AlertActionCloseButton onClose={() => dispatch({ type: 'ERROR_DISMISSED' })} />
            }
          />
        ) : null}
      </AlertGroup>

      {state.notice ? (
        <Alert variant="warning" isInline title={state.notice} className="tis-notice" />
      ) : null}

      {/* NFR-5: canvas edits are invisible to assistive tech without this. */}
      <div className="tis-visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <Drawer
        isExpanded={hasDocument && isPanelOpen}
        isInline={isWideLayout}
        position="end"
      >
        <DrawerContent panelContent={hasDocument ? panel : null}>
          <DrawerContentBody className="tis-drawer__body">
            {state.status === 'LOADING' ? (
              <div className="tis-loading">
                <Spinner aria-label="Opening the PDF" />
                <p>Opening the PDF…</p>
              </div>
            ) : state.document ? (
              <DocumentViewer
                info={state.document}
                masks={masks}
                zoom={state.zoom}
                activeTool={state.activeTool}
                strokeWidth={state.strokeWidth}
                scrollRef={scrollRef}
                selectedMaskId={state.selectedMaskId}
                onCommitMask={commitMask}
                onCommitGeometry={commitGeometry}
                onSelect={selectMask}
                onViewport={registerViewport}
                inkPerPage={ink.perPage}
                onVisiblePageChange={setVisiblePageIndex}
              />
            ) : (
              <DropZone
                isDraggingOver={isDraggingOver}
                onOpenFile={() => fileInputRef.current?.click()}
              />
            )}
          </DrawerContentBody>
        </DrawerContent>
      </Drawer>

      <PasswordModal request={passwordRequest} />
      <ConfirmDiscardModal request={discardRequest} />
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
