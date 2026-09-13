// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ladislav Slezák

/** App header (spec §6). */
import { useState } from 'react';
import { Button, Masthead, MastheadBrand, MastheadContent, MastheadMain } from '@patternfly/react-core';
import { AboutModal, LICENSE_LABEL } from './AboutModal';

export function AppMasthead({ fileName }: { fileName: string | null }): JSX.Element {
  const [isAboutOpen, setAboutOpen] = useState(false);

  return (
    <Masthead className="tis-masthead">
      <MastheadMain>
        <MastheadBrand className="tis-masthead__brand" data-codemods>
          <span className="tis-masthead__title">Ticket Ink-Saver</span>
          <span className="tis-masthead__subtitle">Mask ads in PDF tickets before printing them, runs entirely in your browser!</span>
        </MastheadBrand>
      </MastheadMain>
      <MastheadContent className="tis-masthead__content">
        {fileName ? (
          <p className="tis-masthead__file" title={fileName}>
            {fileName}
          </p>
        ) : null}
        {/* GPLv3 5(d): the legal notices must be reachable from the running program. */}
        <Button
          variant="link"
          isInline
          className="tis-masthead__about"
          onClick={() => setAboutOpen(true)}
        >
          {LICENSE_LABEL}
        </Button>
      </MastheadContent>
      <AboutModal isOpen={isAboutOpen} onClose={() => setAboutOpen(false)} />
    </Masthead>
  );
}
