// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ladislav Slezák

/**
 * Confirmation shown when opening a document would discard unsaved masks (FR-8).
 *
 * Deliberately asked *after* a file has been chosen or dropped: drag-and-drop gives no
 * earlier hook, and one code path for both entry points beats two that can drift.
 */
import {
  Button,
  Content,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from '@patternfly/react-core';

export interface DiscardRequest {
  /** Name of the document about to be opened. */
  incomingFileName: string;
  maskCount: number;
  resolve: (discard: boolean) => void;
}

export function ConfirmDiscardModal({
  request,
}: {
  request: DiscardRequest | null;
}): JSX.Element {
  const count = request?.maskCount ?? 0;

  return (
    <Modal
      isOpen={request !== null}
      variant="small"
      aria-label="Discard unsaved masks?"
      onClose={() => request?.resolve(false)}
    >
      <ModalHeader title="Discard your masks?" titleIconVariant="warning" />
      <ModalBody>
        <Content component="p">
          The current document has {count} unsaved mask{count === 1 ? '' : 's'}. Opening{' '}
          <strong>{request?.incomingFileName}</strong> will discard {count === 1 ? 'it' : 'them'}.
        </Content>
        <Content component="p">
          Masks are not saved anywhere. To keep this work, cancel and use{' '}
          <strong>Download</strong> or <strong>Print</strong> first.
        </Content>
      </ModalBody>
      <ModalFooter>
        <Button variant="danger" onClick={() => request?.resolve(true)}>
          Discard and open
        </Button>
        <Button variant="link" onClick={() => request?.resolve(false)}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
}
