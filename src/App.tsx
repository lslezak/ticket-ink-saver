// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ladislav Slezák

import { Page, PageSection } from '@patternfly/react-core';
import { AppMasthead } from './components/AppMasthead';
import { EditorWorkspace } from './components/EditorWorkspace';
import { EditorProvider, useEditorState } from './state/EditorContext';

function Shell(): JSX.Element {
  const state = useEditorState();
  return (
    <Page
      className="tis-app-page"
      masthead={<AppMasthead fileName={state.document?.fileName ?? null} />}
    >
      <PageSection
        hasBodyWrapper={false}
        padding={{ default: 'noPadding' }}
        isFilled
        className="tis-section"
      >
        <EditorWorkspace />
      </PageSection>
    </Page>
  );
}

export function App(): JSX.Element {
  return (
    <EditorProvider>
      <Shell />
    </EditorProvider>
  );
}
