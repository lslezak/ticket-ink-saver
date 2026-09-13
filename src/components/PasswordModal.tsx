// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ladislav Slezák

/**
 * Password prompt for encrypted documents (spec AC-1.2).
 *
 * pdf.js drives this: it calls back with NEED_PASSWORD, and again with
 * INCORRECT_PASSWORD if the answer was wrong, until we give up or the user cancels.
 */
import { useEffect, useState } from 'react';
import {
  Button,
  Form,
  FormGroup,
  HelperText,
  HelperTextItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  TextInput,
} from '@patternfly/react-core';

export interface PasswordRequest {
  wasIncorrect: boolean;
  resolve: (password: string | null) => void;
}

export function PasswordModal({ request }: { request: PasswordRequest | null }): JSX.Element {
  const [password, setPassword] = useState('');

  // Clear the field between prompts so a wrong password is not silently resubmitted.
  useEffect(() => setPassword(''), [request]);

  const submit = (): void => {
    request?.resolve(password);
  };

  return (
    <Modal
      isOpen={request !== null}
      variant="small"
      aria-label="Password required"
      onClose={() => request?.resolve(null)}
    >
      <ModalHeader title="This PDF is password-protected" />
      <ModalBody>
        <Form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <FormGroup label="Password" fieldId="tis-password" isRequired>
            <TextInput
              id="tis-password"
              type="password"
              value={password}
              autoFocus
              onChange={(_event, value) => setPassword(value)}
              validated={request?.wasIncorrect ? 'error' : 'default'}
              aria-describedby="tis-password-help"
            />
            <HelperText id="tis-password-help">
              <HelperTextItem variant={request?.wasIncorrect ? 'error' : 'default'}>
                {request?.wasIncorrect
                  ? 'That password was not accepted. Try again.'
                  : 'The password is used locally and is never sent anywhere.'}
              </HelperTextItem>
            </HelperText>
          </FormGroup>
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" onClick={submit} isDisabled={password.length === 0}>
          Open
        </Button>
        <Button variant="link" onClick={() => request?.resolve(null)}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
}
