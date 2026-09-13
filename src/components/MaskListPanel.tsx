// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ladislav Slezák

/**
 * The accessible view of the mask set (spec FR-6, NFR-5).
 *
 * The canvas cannot be operated with a keyboard or read by a screen reader, so this
 * list is the real interface to the masks: it enumerates them per page and gives each
 * one a focusable delete control. Everything here is history-tracked like any other
 * edit.
 */
import {
  Button,
  DataList,
  DataListAction,
  DataListCell,
  DataListItem,
  DataListItemCells,
  DataListItemRow,
  EmptyState,
  EmptyStateBody,
} from '@patternfly/react-core';
import TrashIcon from '@patternfly/react-icons/dist/esm/icons/trash-icon';
import LayerGroupIcon from '@patternfly/react-icons/dist/esm/icons/layer-group-icon';
import type { Mask, MaskId, MaskList } from '../types/models';

interface MaskListPanelProps {
  masks: MaskList;
  pageCount: number;
  selectedMaskId: MaskId | null;
  onSelect: (maskId: MaskId | null) => void;
  onDelete: (maskId: string) => void;
  onClearPage: (pageIndex: number) => void;
}

/**
 * Whole points for display.
 *
 * Stored sizes are exact and can be long floats — resizing a freehand stroke scales
 * its width by the geometric mean of the two axis factors, which rarely lands on a
 * round number. A sub-point stroke is reported as "<1" rather than "0", matching how
 * the ink estimate formats a small non-zero value: a zero would read as "no width".
 */
function formatPoints(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0 && value > 0) return '<1';
  return String(rounded);
}

function describeMask(mask: Mask): string {
  if (mask.kind === 'RECTANGLE') {
    return `Rectangle, ${formatPoints(mask.rect.width)} × ${formatPoints(mask.rect.height)} pt`;
  }
  return `Freehand stroke, ${mask.path.length} points, ${formatPoints(mask.strokeWidth)} pt wide`;
}

export function MaskListPanel({
  masks,
  pageCount,
  selectedMaskId,
  onSelect,
  onDelete,
  onClearPage,
}: MaskListPanelProps): JSX.Element {
  if (masks.length === 0) {
    return (
      <EmptyState
        variant="sm"
        titleText="No masks yet"
        headingLevel="h3"
        icon={LayerGroupIcon}
      >
        <EmptyStateBody>
          Choose the rectangle or freehand tool, then drag over an advert to cover it.
        </EmptyStateBody>
      </EmptyState>
    );
  }

  const byPage = new Map<number, Mask[]>();
  for (const mask of masks) {
    const list = byPage.get(mask.pageIndex);
    if (list) list.push(mask);
    else byPage.set(mask.pageIndex, [mask]);
  }

  const pages = [...byPage.keys()].sort((a, b) => a - b);

  return (
    <div className="tis-masklist">
      {pages.map((pageIndex) => {
        const pageMasks = byPage.get(pageIndex) ?? [];
        return (
          <section key={pageIndex} className="tis-masklist__page">
            <div className="tis-masklist__header">
              <h3 className="tis-masklist__title">
                Page {pageIndex + 1} of {pageCount}
              </h3>
              <Button variant="link" isInline onClick={() => onClearPage(pageIndex)}>
                Clear page
              </Button>
            </div>
            <DataList aria-label={`Masks on page ${pageIndex + 1}`} isCompact>
              {pageMasks.map((mask, position) => (
                <DataListItem
                  key={mask.id}
                  aria-labelledby={`mask-${mask.id}`}
                  className={mask.id === selectedMaskId ? 'tis-masklist__item--selected' : ''}
                >
                  <DataListItemRow>
                    <DataListItemCells
                      dataListCells={[
                        <DataListCell key="description">
                          {/*
                            Selecting from this list is the keyboard route into mask
                            editing (FR-9/NFR-5): select here, then move or resize with
                            the arrow keys.
                          */}
                          <button
                            type="button"
                            id={`mask-${mask.id}`}
                            className="tis-masklist__select"
                            aria-pressed={mask.id === selectedMaskId}
                            onClick={() =>
                              onSelect(mask.id === selectedMaskId ? null : mask.id)
                            }
                          >
                            <span className="tis-masklist__index">{position + 1}.</span>{' '}
                            {describeMask(mask)}
                          </button>
                        </DataListCell>,
                      ]}
                    />
                    <DataListAction
                      id={`delete-${mask.id}`}
                      aria-labelledby={`delete-${mask.id}`}
                      aria-label={`Delete mask ${position + 1} on page ${pageIndex + 1}`}
                    >
                      <Button
                        variant="plain"
                        icon={<TrashIcon />}
                        aria-label={`Delete mask ${position + 1} on page ${pageIndex + 1}`}
                        onClick={() => onDelete(mask.id)}
                      />
                    </DataListAction>
                  </DataListItemRow>
                </DataListItem>
              ))}
            </DataList>
          </section>
        );
      })}
    </div>
  );
}
