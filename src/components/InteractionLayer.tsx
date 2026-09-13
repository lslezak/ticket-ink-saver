// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ladislav Slezák

/**
 * All pointer interaction for a page: drawing new masks, and selecting, moving and
 * resizing existing ones (spec §7.3, §8.3, §8.5, FR-9).
 *
 * The state-ownership rule from §7.3 holds for every gesture here: the whole drag
 * lives in a ref and paints straight to this canvas, and exactly one action is
 * dispatched on pointer-up. So a completed move or resize is a single undo step, and
 * nothing re-renders the tree 60 times a second.
 *
 * Pointer Events plus setPointerCapture throughout, so pen and touch work and a drag
 * that leaves the page still completes (AC-4.3).
 */
import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { PageViewport } from '../pdf/pdfjs';
import type { Mask, MaskId, PdfPoint, ToolId } from '../types/models';
import {
  clampToViewport,
  pdfLengthToViewport,
  pdfRectFromViewportCorners,
  pointerToViewportPoint,
  viewportToPdfPoint,
} from '../geometry/coords';
import type { ViewportPoint, ViewportRect } from '../geometry/coords';
import {
  handleCursor,
  hitTestHandle,
  hitTestMask,
  maskViewportBounds,
  remapMask,
  resizeBounds,
  translateBounds,
} from '../geometry/maskGeometry';
import type { HandleId } from '../geometry/maskGeometry';
import { simplifyPath } from '../geometry/simplify';
import {
  clearCanvas,
  paintFreehandPreview,
  paintMask,
  paintRectanglePreview,
  paintSelection,
  prepareCanvas,
} from './maskPainting';
import {
  FREEHAND_MIN_POINT_DISTANCE_PX,
  FREEHAND_SIMPLIFY_EPSILON_PT,
  MAX_RENDER_SCALE,
  MIN_RECT_SIZE_PX,
} from '../constants';

interface InteractionLayerProps {
  pageIndex: number;
  viewport: PageViewport;
  activeTool: ToolId;
  strokeWidth: number;
  /** Masks on this page, in paint order (last is on top). */
  masks: readonly Mask[];
  selectedMaskId: MaskId | null;
  onCommitNew: (mask: Mask) => void;
  onCommitGeometry: (mask: Mask) => void;
  onSelect: (maskId: MaskId | null) => void;
  /** Reports which mask is mid-drag so the committed layer can hide it. */
  onDragMask: (maskId: MaskId | null) => void;
  /** Drag on empty space scrolls the document instead of drawing. */
  onPan: (dx: number, dy: number) => void;
}

/**
 * MOVE and RESIZE are separate members rather than one with a `'MOVE' | 'RESIZE'`
 * discriminant: TypeScript narrows a union-valued discriminant poorly, and splitting
 * them also captures the real invariant — only a resize has a handle.
 */
interface TransformDrag {
  pointerId: number;
  mask: Mask;
  /** The mask's on-screen box when the gesture started. */
  from: ViewportRect;
  /** Where it is now; committed on pointer-up. */
  to: ViewportRect;
  origin: ViewportPoint;
  /** False for a click that only selected, so it never enters the undo history. */
  moved: boolean;
}

type Drag =
  | { kind: 'DRAW_RECT'; pointerId: number; start: ViewportPoint; current: ViewportPoint }
  | { kind: 'DRAW_FREEHAND'; pointerId: number; points: ViewportPoint[] }
  | ({ kind: 'MOVE'; handle: null } & TransformDrag)
  | ({ kind: 'RESIZE'; handle: HandleId } & TransformDrag)
  | { kind: 'PAN'; pointerId: number; last: ViewportPoint };

function createMaskId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `mask-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function InteractionLayer(props: InteractionLayerProps): JSX.Element {
  const {
    pageIndex,
    viewport,
    activeTool,
    strokeWidth,
    masks,
    selectedMaskId,
    onCommitNew,
    onCommitGeometry,
    onSelect,
    onDragMask,
    onPan,
  } = props;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const dragRef = useRef<Drag | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.max(
      1,
      Math.min(window.devicePixelRatio || 1, MAX_RENDER_SCALE / Math.max(viewport.scale, 0.01)),
    );
    contextRef.current = prepareCanvas(canvas, viewport, dpr);
    // A zoom change mid-drag would invalidate the captured geometry; abandon it.
    dragRef.current = null;
    onDragMask(null);
    if (contextRef.current) clearCanvas(contextRef.current, viewport);
  }, [viewport, onDragMask]);

  const redraw = useCallback(() => {
    const context = contextRef.current;
    if (!context) return;
    clearCanvas(context, viewport);

    const drag = dragRef.current;
    if (!drag) return;

    if (drag.kind === 'DRAW_RECT') {
      paintRectanglePreview(context, drag.start, drag.current);
    } else if (drag.kind === 'DRAW_FREEHAND') {
      paintFreehandPreview(context, drag.points, pdfLengthToViewport(strokeWidth, viewport));
    } else if (drag.kind === 'MOVE' || drag.kind === 'RESIZE') {
      // Paint the mask exactly as it will be committed, so there is no surprise.
      paintMask(context, remapMask(drag.mask, drag.from, drag.to, viewport), viewport);
      paintSelection(context, drag.to, drag.kind === 'RESIZE');
    }
  }, [viewport, strokeWidth]);

  /** Topmost mask under the pointer, or null. */
  const maskAt = useCallback(
    (point: ViewportPoint): Mask | null => {
      for (let i = masks.length - 1; i >= 0; i -= 1) {
        const mask = masks[i];
        if (mask && hitTestMask(mask, point, viewport)) return mask;
      }
      return null;
    },
    [masks, viewport],
  );

  const selected = selectedMaskId
    ? (masks.find((mask) => mask.id === selectedMaskId) ?? null)
    : null;

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (event.button !== 0) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      const point = clampToViewport(pointerToViewportPoint(event, canvas, viewport), viewport);
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();

      if (activeTool === 'SELECT') {
        // Handles win over the mask body, and the body over panning.
        if (selected) {
          const bounds = maskViewportBounds(selected, viewport);
          const handle = hitTestHandle(bounds, point);
          if (handle) {
            dragRef.current = {
              kind: 'RESIZE',
              pointerId: event.pointerId,
              mask: selected,
              from: bounds,
              to: bounds,
              origin: point,
              handle,
              moved: false,
            };
            onDragMask(selected.id);
            redraw();
            return;
          }
        }

        const hit = maskAt(point);
        if (hit) {
          if (hit.id !== selectedMaskId) onSelect(hit.id);
          const bounds = maskViewportBounds(hit, viewport);
          dragRef.current = {
            kind: 'MOVE',
            pointerId: event.pointerId,
            mask: hit,
            from: bounds,
            to: bounds,
            origin: point,
            handle: null,
            moved: false,
          };
          onDragMask(hit.id);
          redraw();
          return;
        }

        if (selectedMaskId !== null) onSelect(null);
        dragRef.current = { kind: 'PAN', pointerId: event.pointerId, last: point };
        return;
      }

      if (activeTool === 'RECTANGLE') {
        dragRef.current = {
          kind: 'DRAW_RECT',
          pointerId: event.pointerId,
          start: point,
          current: point,
        };
      } else {
        dragRef.current = {
          kind: 'DRAW_FREEHAND',
          pointerId: event.pointerId,
          points: [point],
        };
      }
      redraw();
    },
    [activeTool, viewport, selected, selectedMaskId, maskAt, onSelect, onDragMask, redraw],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const drag = dragRef.current;

      // Not dragging: keep the cursor honest about what a press would do.
      if (!drag) {
        if (activeTool !== 'SELECT') return;
        const point = pointerToViewportPoint(event, canvas, viewport);
        let cursor = 'default';
        if (selected) {
          const handle = hitTestHandle(maskViewportBounds(selected, viewport), point);
          if (handle) cursor = handleCursor(handle);
        }
        if (cursor === 'default' && maskAt(point)) cursor = 'move';
        canvas.style.cursor = cursor;
        return;
      }

      if (drag.pointerId !== event.pointerId) return;
      const point = pointerToViewportPoint(event, canvas, viewport);
      event.preventDefault();

      if (drag.kind === 'PAN') {
        onPan(drag.last.x - point.x, drag.last.y - point.y);
        // The page moved under the pointer, so re-read rather than accumulating drift.
        drag.last = pointerToViewportPoint(event, canvas, viewport);
        return;
      }

      if (drag.kind === 'MOVE' || drag.kind === 'RESIZE') {
        const dx = point.x - drag.origin.x;
        const dy = point.y - drag.origin.y;
        if (dx !== 0 || dy !== 0) drag.moved = true;
        drag.to =
          drag.kind === 'MOVE'
            ? translateBounds(drag.from, dx, dy)
            : resizeBounds(drag.from, drag.handle, dx, dy);
        redraw();
        return;
      }

      const clamped = clampToViewport(point, viewport);
      if (drag.kind === 'DRAW_RECT') {
        drag.current = clamped;
      } else {
        const last = drag.points[drag.points.length - 1];
        if (
          !last ||
          Math.hypot(clamped.x - last.x, clamped.y - last.y) >= FREEHAND_MIN_POINT_DISTANCE_PX
        ) {
          drag.points.push(clamped);
        }
      }
      redraw();
    },
    [activeTool, viewport, selected, maskAt, onPan, redraw],
  );

  const finish = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>, commit: boolean) => {
      const drag = dragRef.current;
      const canvas = canvasRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      dragRef.current = null;
      if (canvas?.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      const context = contextRef.current;
      if (context) clearCanvas(context, viewport);
      onDragMask(null);

      if (!commit) return;

      if (drag.kind === 'MOVE' || drag.kind === 'RESIZE') {
        // A click that selected a mask without moving it must not enter the undo history.
        if (drag.moved) {
          onCommitGeometry(remapMask(drag.mask, drag.from, drag.to, viewport));
        }
        return;
      }

      if (drag.kind === 'PAN') return;

      const mask = buildNewMask(drag, pageIndex, viewport, strokeWidth);
      if (mask) onCommitNew(mask);
    },
    [pageIndex, viewport, strokeWidth, onCommitNew, onCommitGeometry, onDragMask],
  );

  return (
    <canvas
      ref={canvasRef}
      className="tis-page__layer tis-page__interaction"
      data-tool={activeTool}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) => finish(event, true)}
      onPointerCancel={(event) => finish(event, false)}
      onPointerLeave={(event) => {
        if (!dragRef.current) event.currentTarget.style.cursor = 'default';
      }}
      // Not the accessible interface for masks; the mask list is (FR-6).
      aria-hidden="true"
    />
  );
}

/** Turn a finished draw gesture into a mask, or null if it was degenerate (AC-4.2). */
function buildNewMask(
  drag: Drag,
  pageIndex: number,
  viewport: PageViewport,
  strokeWidth: number,
): Mask | null {
  if (drag.kind === 'DRAW_RECT') {
    const widthPx = Math.abs(drag.current.x - drag.start.x);
    const heightPx = Math.abs(drag.current.y - drag.start.y);
    if (widthPx < MIN_RECT_SIZE_PX || heightPx < MIN_RECT_SIZE_PX) return null;
    return {
      id: createMaskId(),
      kind: 'RECTANGLE',
      pageIndex,
      rect: pdfRectFromViewportCorners(drag.start, drag.current, viewport),
    };
  }

  if (drag.kind !== 'DRAW_FREEHAND') return null;
  if (drag.points.length < 2) return null;

  const pdfPoints: PdfPoint[] = drag.points.map((point) => viewportToPdfPoint(point, viewport));
  const simplified = simplifyPath(pdfPoints, FREEHAND_SIMPLIFY_EPSILON_PT);
  if (simplified.length < 2) return null;

  return {
    id: createMaskId(),
    kind: 'FREEHAND',
    pageIndex,
    path: simplified,
    strokeWidth,
  };
}
