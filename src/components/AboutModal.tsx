// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ladislav Slezák

/**
 * GPLv3 section 5(d) requires an interactive program to display "Appropriate Legal
 * Notices": the copyright notice, the absence of warranty, the right to redistribute
 * under the GPL, and how to view a copy of the Licence. That is what this dialog is
 * for -- it is a licence obligation, not decoration, so keep all four elements if you
 * edit it.
 *
 * The licence texts it links to are emitted into the bundle at build time by
 * scripts/generate-third-party-licenses.mjs.
 */
import {
  Button,
  Content,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from '@patternfly/react-core';
import ExternalLinkAltIcon from '@patternfly/react-icons/dist/esm/icons/external-link-alt-icon';

export const COPYRIGHT_HOLDER = 'Ladislav Slezák';
export const COPYRIGHT_YEAR = '2026';
export const LICENSE_LABEL = 'About';

export function AboutModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}): JSX.Element {
  return (
    <Modal isOpen={isOpen} variant="small" aria-label="About Ticket Ink-Saver" onClose={onClose}>
      <ModalHeader title="About Ticket Ink-Saver" />
      <ModalBody>
        <Content component="p">
          Copyright © {COPYRIGHT_YEAR} {COPYRIGHT_HOLDER}
        </Content>
        <Content component="p">
          This program is free software: you may redistribute it and/or modify it under
          the terms of the GNU General Public License as published by the Free Software
          Foundation, either version 3 of the License, or (at your option) any later
          version.
        </Content>
        <Content component="p">
          It is distributed in the hope that it will be useful, but{' '}
          <strong>with no warranty</strong> — without even the implied warranty of
          merchantability or fitness for a particular purpose. See the GNU General Public
          License for more details.
        </Content>
        <Content component="ul">
          <Content component="li">
            <a href="./LICENSE.txt" target="_blank" rel="noreferrer">
              Read the GNU General Public License <ExternalLinkAltIcon />
            </a>
          </Content>
          <Content component="li">
            <a href="./THIRD-PARTY-LICENSES.txt" target="_blank" rel="noreferrer">
              Third-party licences <ExternalLinkAltIcon />
            </a>
          </Content>
        </Content>
        <Content component="p">
          <strong>
            Your PDF is processed entirely in this browser and is never uploaded.
          </strong>
        </Content>
        <Content component="p">
          <strong>
            The added masks
            cover content; they do not remove it, so the original remains inside the
            output file. Do NOT use this tool for hiding sensitive data, it is still present in the
            document!
          </strong>
        </Content>
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" onClick={onClose}>
          Close
        </Button>
      </ModalFooter>
    </Modal>
  );
}
