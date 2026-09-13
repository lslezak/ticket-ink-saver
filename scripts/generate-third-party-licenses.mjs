// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ladislav Slezák

/**
 * Collect the licence texts of every bundled runtime dependency into
 * public/THIRD-PARTY-LICENSES.txt, which Vite then copies into dist/.
 *
 * This is a compliance requirement, not a nicety: pdf.js is Apache-2.0, and
 * Apache-2.0 section 4 obliges us to ship the licence text and retain attribution
 * notices. Minification strips those notices from the bundle, so they have to
 * travel alongside it.
 *
 * Run automatically by `npm run build` (see the prebuild script).
 */
import { createRequire } from 'node:module';
import { copyFileSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

/** Packages that end up in the shipped bundle. Dev-only tooling is excluded. */
const RUNTIME_PACKAGES = [
  'react',
  'react-dom',
  'pdfjs-dist',
  'pdf-lib',
  '@patternfly/react-core',
  '@patternfly/react-icons',
  '@patternfly/react-styles',
  '@patternfly/react-tokens',
];

/**
 * Assets that ship without a licence file of their own and therefore need an
 * explicit entry. PatternFly bundles the Red Hat fonts as bare .woff2 binaries.
 */
const EXTRA_NOTICES = [
  {
    name: 'Red Hat Display / Red Hat Text / Red Hat Mono (fonts)',
    version: 'bundled with @patternfly/react-core',
    license: 'SIL Open Font License 1.1',
    note:
      'Shipped as .woff2 assets by @patternfly/react-core. Copyright (c) Red Hat, Inc.\n' +
      'These fonts carry Reserved Font Names; see the OFL text for the conditions on\n' +
      'renaming and redistribution. Full text: https://openfontlicense.org/',
  },
  {
    name: 'PatternFly icon font (pf-v6-pficon)',
    version: 'bundled with @patternfly/react-core',
    license: 'MIT',
    note: 'Shipped as a .woff2 asset by @patternfly/react-core.',
  },
];

const LICENSE_FILE_PATTERN = /^(LICENSE|LICENCE|COPYING|NOTICE)([-.].*)?$/i;

function packageRoot(name) {
  // Resolve via package.json so this works for packages without a root "main".
  return dirname(require.resolve(`${name}/package.json`));
}

function readLicenseTexts(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((file) => LICENSE_FILE_PATTERN.test(file))
    .sort()
    .map((file) => ({ file, text: readFileSync(join(root, file), 'utf8').trim() }));
}

const divider = '='.repeat(78);
const sections = [];

sections.push(
  [
    divider,
    'THIRD-PARTY LICENCES',
    divider,
    '',
    'Ticket Ink-Saver is licensed under the GNU General Public License, version 3',
    'or (at your option) any later version. See the LICENSE file.',
    '',
    'It bundles the third-party components listed below. Their licence terms are',
    'reproduced in full and continue to apply to those components.',
    '',
  ].join('\n'),
);

let missing = 0;

for (const name of RUNTIME_PACKAGES) {
  let pkg;
  let root;
  try {
    root = packageRoot(name);
    pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  } catch {
    console.warn(`  ! ${name}: not installed, skipping`);
    continue;
  }

  const texts = readLicenseTexts(root);
  const header = [
    divider,
    `${name} ${pkg.version}`,
    `Licence: ${pkg.license ?? 'see text below'}`,
    pkg.homepage ? `Homepage: ${pkg.homepage}` : null,
    divider,
    '',
  ]
    .filter(Boolean)
    .join('\n');

  if (texts.length === 0) {
    missing += 1;
    console.warn(`  ! ${name}: no LICENSE file found in the package`);
    sections.push(`${header}(No licence file shipped in this package; declared as ${pkg.license}.)\n`);
  } else {
    sections.push(header + texts.map((t) => t.text).join('\n\n') + '\n');
    console.log(`  ${name} ${pkg.version} (${pkg.license}) - ${texts.map((t) => t.file).join(', ')}`);
  }
}

for (const extra of EXTRA_NOTICES) {
  sections.push(
    [divider, extra.name, `Licence: ${extra.license}`, divider, '', extra.note, ''].join('\n'),
  );
  console.log(`  ${extra.name} (${extra.license})`);
}

/*
 * GPLv3 section 4 requires conveying a copy of the Licence with the work. A hosted
 * web app conveys its JavaScript to every visitor, so the licence text has to ship
 * in the bundle too, not just sit in the repository.
 */
copyFileSync('LICENSE', 'public/LICENSE.txt');
console.log('  Copied LICENSE -> public/LICENSE.txt');

const output = `${sections.join('\n')}\n`;
writeFileSync('public/THIRD-PARTY-LICENSES.txt', output);
console.log(`\nWrote public/THIRD-PARTY-LICENSES.txt (${output.length} bytes)`);
if (missing > 0) {
  console.warn(`${missing} package(s) shipped no licence text - check them manually.`);
}
