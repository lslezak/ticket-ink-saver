# Ticket Ink-Saver

A browser-based utility that covers unwanted adverts on a PDF ticket before you print
it, so the printer does not waste ink on them.

Everything happens locally in your browser. The PDF is never uploaded anywhere — which
matters, because tickets carry names, booking references and barcodes.

See [SPECIFICATION.md](SPECIFICATION.md) for the full design; this file covers how to
run and work on it.

> **This is masking, not redaction.** A mask is a white shape drawn on top of the page.
> The original content is still in the output file and can be recovered with any PDF
> tool. Do not use this to hide sensitive information!

## Running it

```bash
npm install
npm run dev        # development server with hot reload
npm run build      # typecheck + production bundle into dist/
npm run preview    # serve the production bundle
npm run typecheck  # types only
```

`dist/` is a static bundle — host it anywhere, no backend required.

## Using it

1. Drag a PDF onto the window, or click **Open PDF**.
2. Pick **Rectangle** or **Freehand** and drag over each advert. Masks show a dashed
   blue outline in the editor so you can see them; the outline is editor-only and is
   never written to the PDF.
3. Adjust a mask with the **Select** tool: drag it to move, drag a handle to resize,
   drag empty space to scroll. Move and resize are the only edit operations — masks are
   not rotated or reshaped point-by-point.
4. **Ctrl/Cmd+Z** undoes, **Ctrl/Cmd+Shift+Z** redoes; a whole move or resize is a
   single undo step. The panel on the right lists every mask, selects one when you
   click its row, and deletes them individually — that panel, not the canvas, is the
   keyboard- and screen-reader-accessible way to manage masks. With a mask selected,
   arrows move it, **Alt**+arrows resize it, **Shift** takes a bigger step, **Delete**
   removes it and **Escape** deselects.
5. **Print** (also **Ctrl/Cmd+P**), or **Download** to save the masked copy.

## How it is put together

```
src/
  types/models.ts        Data model. Every stored coordinate is in PDF user space.
  geometry/
    coords.ts            Screen <-> PDF coordinate conversion (the correctness core).
    simplify.ts          Ramer-Douglas-Peucker for freehand strokes.
  pdf/
    pdfjs.ts             Worker bootstrap, version-locked to the installed pdfjs-dist.
    loadDocument.ts      File -> PDFDocumentProxy, with validation and passwords.
    exportPdf.ts         Applies masks to the real PDF with pdf-lib.
    output.ts            Print via hidden iframe, with download as the fallback.
  state/
    editorReducer.ts     Committed state + snapshot undo/redo.
    EditorContext.tsx    Split state/dispatch/document contexts.
  geometry/maskGeometry.ts  Hit testing, handles, move and resize of existing masks.
  components/            UI, including the three stacked canvas layers per page.
  hooks/                 Virtualisation, debounce, media queries, page loading.
```

### Three things worth knowing before you change anything

**1. Masks live in PDF user space, never in screen pixels.**
PDF user space has its origin at the bottom-left with Y pointing up; a canvas has it at
the top-left with Y pointing down. Pages can also carry a `/Rotate` and a CropBox whose
origin is not `(0,0)`. All conversion goes through pdf.js's `viewport.convertToPdfPoint`
/ `convertToViewportPoint`, which already fold in scale, rotation and the view-box
offset. Do not hand-roll that arithmetic. Because masks are stored in page space,
zooming re-renders them rather than moving them.

pdf-lib writes its drawing coordinates straight into the content stream in the same
unrotated user space, so no extra transform is needed on export. This was verified
empirically across `/Rotate` 0/90/180/270, offset CropBoxes and four zoom levels.

**2. pdf.js takes ownership of the buffer you give it.**
`getDocument({ data })` transfers the typed array to the worker thread, detaching it on
the main thread. `loadDocument.ts` therefore keeps `originalBytes` pristine and passes
pdf.js a `.slice()` copy. The export step needs those pristine bytes. If you ever see an
empty or throwing `PDFDocument.load`, this is why.

**3. Only committed state goes through the reducer.**
An in-progress drag lives in a ref inside `DrawingLayer` and paints directly to its own
canvas; it reaches the reducer once, on pointer-up. Each page has three stacked canvases
— the pdf.js render (expensive, redrawn only on zoom/page change), committed masks
(cheap), and the live preview. Collapsing them would trigger a full pdf.js re-render on
every mouse move.

## Known limitations

- **Encrypted PDFs cannot be exported.** pdf.js can display them, so you can view and
  mask one, but pdf-lib has no decryption support at all — `ignoreEncryption` only
  suppresses the error and would produce an unreadable file. The app detects this and
  refuses rather than handing you a corrupt ticket. Remove the protection first.
- **PDF annotations are not covered.** Form widgets and stamps are painted above the
  content stream, so a mask drawn into the content stream will not hide them. Adverts
  are normally page content, so this rarely comes up.
- **Programmatic printing is not portable.** iOS Safari and some Firefox configurations
  will not open a print dialog for a generated PDF. The app detects this and downloads
  the file instead.
- No tests yet — see the strategy in SPECIFICATION.md §11. The geometry round-trip and
  golden-output checks described there are the ones that matter most.

## Licence

Copyright © 2026 Ladislav Slezák

Ticket Ink-Saver is free software: you can redistribute it and/or modify it under the
terms of the **GNU General Public License, version 3 or (at your option) any later
version**. It is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY — without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See [LICENSE](LICENSE) for the full text.

Every source file carries an `SPDX-License-Identifier: GPL-3.0-or-later` header.

### Why "or later" and not GPLv2

GPLv2-**only** is not available to this project. pdf.js is Apache-2.0, and Apache-2.0
is incompatible with GPLv2 — its patent-termination and indemnification clauses count
as "further restrictions", which GPLv2 §6 forbids. Apache-2.0 *is* compatible with
GPLv3, so GPLv3-or-later is the licence that actually works here. Do not relicense to
GPLv2 without first removing pdf.js.

### Third-party components

| Component | Licence |
|---|---|
| pdf.js (`pdfjs-dist`) | Apache-2.0 |
| pdf-lib | MIT |
| React, React DOM | MIT |
| PatternFly (`react-core`, `react-icons`, `react-styles`, `react-tokens`) | MIT |
| Red Hat Display / Text / Mono fonts (bundled by PatternFly) | SIL OFL 1.1 |

`scripts/generate-third-party-licenses.mjs` writes `public/THIRD-PARTY-LICENSES.txt`
and copies `LICENSE` to `public/LICENSE.txt`, so the shipped `dist/` always carries the
notices. It runs automatically before both `npm run dev` and `npm run build`, and can
be run on its own with `npm run licenses`.

Both files are **build artifacts and are not committed** — they are regenerated from
`node_modules`, so committing them would only churn whenever a dependency changes. A
fresh clone has neither until you run one of those scripts.

This matters because minification strips `@license` comments out of the bundle, while Apache-2.0 §4
still requires the licence text and attribution notices to travel with the code. Both files are
reachable from the app's **About** link in the header, which is also what satisfies GPLv3 §5(d) for
an interactive program.
