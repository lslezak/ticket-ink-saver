// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ladislav Slezák

/** Empty state that doubles as the drop target (spec §6). */
import { Button, EmptyState, EmptyStateActions, EmptyStateBody, EmptyStateFooter } from '@patternfly/react-core';
import FileImportIcon from '@patternfly/react-icons/dist/esm/icons/file-import-icon';
import { MAX_FILE_BYTES, MAX_PAGES } from '../constants';
import { formatBytes } from '../pdf/loadDocument';

export function DropZone({
  isDraggingOver,
  onOpenFile,
}: {
  isDraggingOver: boolean;
  onOpenFile: () => void;
}): JSX.Element {
  return (
    <div className={`tis-dropzone${isDraggingOver ? ' tis-dropzone--active' : ''}`}>
      <EmptyState titleText="Open a PDF ticket" headingLevel="h2" icon={FileImportIcon}>
        <EmptyStateBody>
          Drag a PDF here, or choose one below. It is opened in this browser only and is
          never uploaded anywhere.
          <br />
          <small>
            Up to {formatBytes(MAX_FILE_BYTES)} and {MAX_PAGES} pages.
          </small>
        </EmptyStateBody>
        <EmptyStateFooter>
          <EmptyStateActions>
            <Button variant="primary" onClick={onOpenFile}>
              Choose a PDF
            </Button>
          </EmptyStateActions>
        </EmptyStateFooter>
      </EmptyState>
    </div>
  );
}
