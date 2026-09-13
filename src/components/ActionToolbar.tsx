// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ladislav Slezák

/**
 * The sticky action toolbar (spec §6).
 *
 * PatternFly 6 note: `Button isDisabled` sets the native `disabled` attribute and no
 * longer sets aria-disabled, so a disabled control drops out of the tab order. Every
 * disabled button here therefore keeps an explanatory tooltip *and* the reason is
 * mirrored into the live region in EditorWorkspace, so a screen-reader user is not
 * left wondering why Undo vanished (spec §6, NFR-5).
 */
import { useState } from 'react';
import {
  Button,
  Dropdown,
  DropdownItem,
  DropdownList,
  MenuToggle,
  Select,
  SelectList,
  SelectOption,
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
} from '@patternfly/react-core';
import type { MenuToggleElement } from '@patternfly/react-core';
import MousePointerIcon from '@patternfly/react-icons/dist/esm/icons/mouse-pointer-icon';
import DownloadIcon from '@patternfly/react-icons/dist/esm/icons/download-icon';
import EllipsisVIcon from '@patternfly/react-icons/dist/esm/icons/ellipsis-v-icon';
import LayerGroupIcon from '@patternfly/react-icons/dist/esm/icons/layer-group-icon';
import PencilAltIcon from '@patternfly/react-icons/dist/esm/icons/pencil-alt-icon';
import PrintIcon from '@patternfly/react-icons/dist/esm/icons/print-icon';
import TintIcon from '@patternfly/react-icons/dist/esm/icons/tint-icon';
import RedoIcon from '@patternfly/react-icons/dist/esm/icons/redo-icon';
import SearchMinusIcon from '@patternfly/react-icons/dist/esm/icons/search-minus-icon';
import SearchPlusIcon from '@patternfly/react-icons/dist/esm/icons/search-plus-icon';
import SquareIcon from '@patternfly/react-icons/dist/esm/icons/square-icon';
import UndoIcon from '@patternfly/react-icons/dist/esm/icons/undo-icon';
import UploadIcon from '@patternfly/react-icons/dist/esm/icons/upload-icon';
import type { ToolId } from '../types/models';
import { formatSaving } from '../hooks/useInkSavings';
import {
  MAX_STROKE_WIDTH,
  MIN_STROKE_WIDTH,
  ZOOM_STEPS,
} from '../constants';

export interface ActionToolbarProps {
  hasDocument: boolean;
  isBusy: boolean;
  activeTool: ToolId;
  zoom: number;
  strokeWidth: number;
  canUndo: boolean;
  canRedo: boolean;
  maskCount: number;
  /** Estimated share of the document's ink removed by the masks, 0-1 (FR-10). */
  inkSaved: number | null;
  inkMeasuring: boolean;
  isPanelOpen: boolean;
  canExport: boolean;
  exportDisabledReason: string | null;
  onOpenFile: () => void;
  onToolChange: (tool: ToolId) => void;
  onStrokeWidthChange: (width: number) => void;
  onZoomChange: (zoom: number) => void;
  onFitWidth: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onClearPage: () => void;
  onClearAll: () => void;
  onTogglePanel: () => void;
  onPrint: () => void;
  onDownload: () => void;
}

const TOOLS: ReadonlyArray<{ id: ToolId; label: string; icon: JSX.Element }> = [
  // SELECT also pans: dragging empty space scrolls the document (FR-9).
  { id: 'SELECT', label: 'Select', icon: <MousePointerIcon /> },
  { id: 'RECTANGLE', label: 'Rectangle', icon: <SquareIcon /> },
  { id: 'FREEHAND', label: 'Freehand', icon: <PencilAltIcon /> },
];

/** Wrap a disabled control so it still has a discoverable explanation (NFR-5). */
function MaybeTooltip({
  content,
  children,
}: {
  content: string | null;
  children: JSX.Element;
}): JSX.Element {
  if (!content) return children;
  return <Tooltip content={content}>{children}</Tooltip>;
}

export function ActionToolbar(props: ActionToolbarProps): JSX.Element {
  const [isZoomOpen, setZoomOpen] = useState(false);
  const [isOverflowOpen, setOverflowOpen] = useState(false);

  const { hasDocument, isBusy, zoom } = props;
  const disabled = !hasDocument || isBusy;

  const zoomIndex = ZOOM_STEPS.findIndex((step) => step >= zoom - 1e-6);
  const canZoomOut = hasDocument && zoom > (ZOOM_STEPS[0] ?? 0);
  const canZoomIn = hasDocument && zoom < (ZOOM_STEPS[ZOOM_STEPS.length - 1] ?? 0);

  const stepZoom = (delta: number): void => {
    const current = zoomIndex === -1 ? ZOOM_STEPS.length - 1 : zoomIndex;
    const next = ZOOM_STEPS[Math.min(Math.max(current + delta, 0), ZOOM_STEPS.length - 1)];
    if (next !== undefined) props.onZoomChange(next);
  };

  return (
    <Toolbar id="tis-toolbar" className="tis-toolbar" isSticky>
      <ToolbarContent>
        <ToolbarItem>
          <Button variant="secondary" icon={<UploadIcon />} onClick={props.onOpenFile}>
            Open PDF
          </Button>
        </ToolbarItem>

        <ToolbarItem variant="separator" />

        <ToolbarItem>
          <ToggleGroup aria-label="Editing tool">
            {TOOLS.map((tool) => (
              <ToggleGroupItem
                key={tool.id}
                icon={tool.icon}
                text={tool.label}
                aria-label={tool.label}
                buttonId={`tis-tool-${tool.id}`}
                isSelected={props.activeTool === tool.id}
                isDisabled={disabled}
                onChange={() => props.onToolChange(tool.id)}
              />
            ))}
          </ToggleGroup>
        </ToolbarItem>

        {props.activeTool === 'FREEHAND' ? (
          <ToolbarItem>
            <label className="tis-toolbar__stroke">
              <span className="tis-toolbar__stroke-label">Brush</span>
              <input
                type="range"
                min={MIN_STROKE_WIDTH}
                max={MAX_STROKE_WIDTH}
                step={1}
                value={props.strokeWidth}
                disabled={disabled}
                aria-label={`Brush width, ${props.strokeWidth} points`}
                onChange={(event) => props.onStrokeWidthChange(Number(event.target.value))}
              />
              <span className="tis-toolbar__stroke-value">{props.strokeWidth}pt</span>
            </label>
          </ToolbarItem>
        ) : null}

        <ToolbarItem variant="separator" />

        <ToolbarGroup variant="action-group-plain">
          <ToolbarItem>
            <Tooltip content="Zoom out">
              <Button
                variant="plain"
                icon={<SearchMinusIcon />}
                aria-label="Zoom out"
                isDisabled={!canZoomOut || isBusy}
                onClick={() => stepZoom(-1)}
              />
            </Tooltip>
          </ToolbarItem>
          <ToolbarItem>
            <Select
              id="tis-zoom-select"
              isOpen={isZoomOpen}
              selected={zoom}
              onSelect={(_event, value) => {
                if (typeof value === 'number') props.onZoomChange(value);
                setZoomOpen(false);
              }}
              onOpenChange={setZoomOpen}
              toggle={(toggleRef: React.Ref<MenuToggleElement>) => (
                <MenuToggle
                  ref={toggleRef}
                  onClick={() => setZoomOpen((open) => !open)}
                  isExpanded={isZoomOpen}
                  isDisabled={disabled}
                  aria-label="Zoom level"
                  style={{ minWidth: '7rem' }}
                >
                  {`${Math.round(zoom * 100)}%`}
                </MenuToggle>
              )}
            >
              <SelectList>
                {ZOOM_STEPS.map((step) => (
                  <SelectOption key={step} value={step}>
                    {`${Math.round(step * 100)}%`}
                  </SelectOption>
                ))}
              </SelectList>
            </Select>
          </ToolbarItem>
          <ToolbarItem>
            <Tooltip content="Zoom in">
              <Button
                variant="plain"
                icon={<SearchPlusIcon />}
                aria-label="Zoom in"
                isDisabled={!canZoomIn || isBusy}
                onClick={() => stepZoom(1)}
              />
            </Tooltip>
          </ToolbarItem>
          <ToolbarItem>
            <Button variant="link" isInline isDisabled={disabled} onClick={props.onFitWidth}>
              Fit width
            </Button>
          </ToolbarItem>
        </ToolbarGroup>

        <ToolbarItem variant="separator" />

        <ToolbarGroup variant="action-group-plain">
          <ToolbarItem>
            <Tooltip content={props.canUndo ? 'Undo (Ctrl+Z)' : 'Nothing to undo'}>
              <Button
                variant="plain"
                icon={<UndoIcon />}
                aria-label="Undo"
                isDisabled={!props.canUndo || isBusy}
                onClick={props.onUndo}
              />
            </Tooltip>
          </ToolbarItem>
          <ToolbarItem>
            <Tooltip content={props.canRedo ? 'Redo (Ctrl+Shift+Z)' : 'Nothing to redo'}>
              <Button
                variant="plain"
                icon={<RedoIcon />}
                aria-label="Redo"
                isDisabled={!props.canRedo || isBusy}
                onClick={props.onRedo}
              />
            </Tooltip>
          </ToolbarItem>
          <ToolbarItem>
            <Dropdown
              isOpen={isOverflowOpen}
              onOpenChange={setOverflowOpen}
              onSelect={() => setOverflowOpen(false)}
              popperProps={{ position: 'right' }}
              toggle={(toggleRef: React.Ref<MenuToggleElement>) => (
                <MenuToggle
                  ref={toggleRef}
                  variant="plain"
                  aria-label="More mask actions"
                  isDisabled={disabled}
                  isExpanded={isOverflowOpen}
                  onClick={() => setOverflowOpen((open) => !open)}
                  icon={<EllipsisVIcon />}
                />
              )}
            >
              <DropdownList>
                <DropdownItem
                  isDisabled={props.maskCount === 0}
                  onClick={props.onClearPage}
                >
                  Clear masks on the visible page
                </DropdownItem>
                <DropdownItem isDisabled={props.maskCount === 0} onClick={props.onClearAll}>
                  Clear all masks
                </DropdownItem>
              </DropdownList>
            </Dropdown>
          </ToolbarItem>
        </ToolbarGroup>

        <ToolbarGroup align={{ default: 'alignEnd' }}>
          <ToolbarItem>
            {/* FR-10: an estimate, and the tooltip says so rather than implying precision. */}
            <Tooltip
              content={
                props.inkMeasuring
                  ? 'Estimating how much ink the masks save…'
                  : 'Rough estimate of the ink saved across the whole document, based on how ' +
                    'much of the printed area the masks cover.'
              }
            >
              <span className="tis-toolbar__ink" aria-live="polite">
                <TintIcon />
                <span className="tis-toolbar__ink-value">
                  {props.inkMeasuring ? '…' : formatSaving(props.inkSaved)}
                </span>
                <span className="tis-toolbar__ink-label">ink saved</span>
              </span>
            </Tooltip>
          </ToolbarItem>
          <ToolbarItem>
            <Tooltip content={props.isPanelOpen ? 'Hide the mask list' : 'Show the mask list'}>
              <Button
                variant="plain"
                icon={<LayerGroupIcon />}
                aria-label={`${props.isPanelOpen ? 'Hide' : 'Show'} the mask list`}
                aria-expanded={props.isPanelOpen}
                isDisabled={disabled}
                onClick={props.onTogglePanel}
              >
                {props.maskCount > 0 ? String(props.maskCount) : null}
              </Button>
            </Tooltip>
          </ToolbarItem>
          <ToolbarItem>
            <MaybeTooltip content={props.exportDisabledReason}>
              <Button
                variant="secondary"
                icon={<DownloadIcon />}
                isDisabled={disabled || !props.canExport}
                onClick={props.onDownload}
              >
                Download
              </Button>
            </MaybeTooltip>
          </ToolbarItem>
          <ToolbarItem>
            <MaybeTooltip content={props.exportDisabledReason}>
              <Button
                variant="primary"
                icon={<PrintIcon />}
                isDisabled={disabled || !props.canExport}
                isLoading={isBusy}
                onClick={props.onPrint}
              >
                Print
              </Button>
            </MaybeTooltip>
          </ToolbarItem>
        </ToolbarGroup>
      </ToolbarContent>
    </Toolbar>
  );
}
