# System Specification: Ticket Ink-Saver (PDF Ad Masker)

| | |
|---|---|
| **Status** | Draft v0.3 — for review |
| **Last updated** | 2026-09-13 |
| **Audience** | Implementing engineers, reviewers |

---

## 1. Executive Summary

**Ticket Ink-Saver** is a browser-based utility that lets a user cover unwanted
advertisements and decorative artwork on a PDF ticket before printing it, saving
printer ink and toner.

The user opens a local PDF, sees its pages, paints white masks over the areas they
do not want printed (rectangular or freehand), undoes mistakes, and then prints or
downloads the modified document.

All processing happens **locally in the browser**. The PDF is never uploaded to a
server. This is a hard requirement, not an optimisation: tickets routinely contain
names, booking references, seat numbers and barcodes.

### 1.1 What this product is *not*

> **This is masking, not redaction.**
>
> A mask is a white shape drawn *on top of* the existing page content. The original
> text, images and vector artwork remain fully present in the output file and can be
> recovered by anyone with a PDF tool. The product must never claim, in UI copy or
> documentation, that content is "removed", "deleted" or "redacted". The UI wording is
> "hide" / "mask" / "cover".
>
> True redaction (content-stream surgery) is explicitly out of scope — see §13.

---

## 2. Goals and Non-Goals

### 2.1 Goals
* G1 — Reduce ink usage when printing a PDF ticket, with minimal clicks.
* G2 — Preserve the original page as vector/text content, so the printed ticket stays
  crisp and barcodes stay scannable. (Rasterising the page would degrade barcodes and
  is therefore forbidden — see §8.4.)
* G3 — Zero server dependency; the app is a static bundle that works offline after
  first load.

### 2.2 Expected usage profile

This drives every limit and performance budget below, so it is stated explicitly:

* A ticket is **1-2 pages**. `MAX_PAGES` is 200 — a guard against pathological input,
  not a target; the common case is two orders of magnitude below it.
* A typical edit is **one rectangle over one advert**, usually at the foot of the page.
  Two or three masks is a busy document.
* `MAX_HISTORY` of 50 therefore covers far more than a realistic session.

The consequence for design: optimise for the first mask being fast and obvious. Do not
spend complexity on bulk-editing affordances (multi-select, marquee, mask reordering,
templates) that this profile will never exercise.

### 2.3 Non-Goals (v1)
* N1 — Automatic ad detection.
* N2 — Editing text, reordering, rotating or deleting pages.
* N3 — Multi-document sessions, or persisting work across reloads.
* N4 — Redaction / secure content removal.
* N5 — Mobile-first touch design. Pointer/touch input must not *break*, but the
  primary target is a desktop browser with a mouse.

---

## 3. Technology Stack

| Concern | Choice | Notes / Risks |
|---|---|---|
| Framework | React 18 (function components + hooks) | PatternFly 6 supports React 17, 18 and 19, so no version conflict here — see R-1. |
| Language | TypeScript, `strict: true` | Also enable `noUncheckedIndexedAccess`. |
| UI kit | PatternFly 6 | See R-1 for migration items relevant to this app (design tokens, `Button` disabled behaviour). |
| PDF rendering | `pdfjs-dist` (Mozilla pdf.js) | Renders pages to `<canvas>`. Worker setup is non-trivial under Vite — see §8.1. |
| PDF authoring | `pdf-lib` | Draws the masks into the real PDF content stream. |
| State | React Context + `useReducer` | With the constraint in §7.3 about transient state. |
| Build | Vite | Static output, no SSR. |
| Tests | Vitest + React Testing Library; Playwright for E2E | See §11. |

**Licensing — resolved.** The project is licensed **GPL-3.0-or-later**; every source
file carries an SPDX header and `LICENSE` holds the full text.

*GPL-2.0-only was evaluated and rejected as unusable.* pdf.js is Apache-2.0, which is
incompatible with GPLv2 — its patent-termination and indemnification clauses are
"further restrictions" barred by GPLv2 §6. Apache-2.0 is compatible with GPLv3, so v3
is the floor. **Do not relicense to GPLv2 while pdf.js is a dependency.** Bundled
components: pdf.js Apache-2.0; pdf-lib, React and PatternFly MIT; the Red Hat fonts
that PatternFly ships are SIL OFL-1.1 and arrive as bare `.woff2` files with no licence
of their own, so they need an explicit notice entry.

Two obligations follow, both automated by `scripts/generate-third-party-licenses.mjs`
at prebuild:
* Apache-2.0 §4 requires retaining attribution notices and shipping the licence text.
  Minification strips `@license` comments, so `dist/THIRD-PARTY-LICENSES.txt` carries
  them instead.
* GPLv3 §4 requires conveying a copy of the Licence. Serving JavaScript to a browser
  *is* conveying, so `LICENSE` is copied into the bundle.

GPLv3 §5(d) additionally requires an interactive program to display Appropriate Legal
Notices — copyright, no-warranty, redistribution rights, and how to read the Licence.
That is the purpose of the About dialog behind the header's licence link (§6); it is a
licence obligation, not decoration.

**Version pinning:** `pdfjs-dist` and its worker must come from the *same exact*
version — a mismatch throws at runtime. Pin exact versions in `package.json`
(no `^`) for `pdfjs-dist`.

---

## 4. Functional Requirements

Each requirement carries acceptance criteria (AC) that the E2E suite must assert.

### FR-1 File input
Users can open a local PDF by drag-and-drop onto the workspace or via a file picker.

* AC-1.1 A non-PDF file produces an inline error and leaves any current document intact.
* AC-1.2 A password-protected PDF prompts for the password (pdf.js `onPassword`); three
  failed attempts abort with a clear message. See §10 for the pdf-lib limitation.
* AC-1.3 Files above `MAX_FILE_BYTES` (default 50 MB) or `MAX_PAGES` (default 200) are
  rejected with a message naming the limit.
* AC-1.4 A corrupt/unparseable PDF produces a readable error, never a blank screen.

### FR-2 Viewing
All pages of the document are displayed in a single vertically scrolling column, in
order, each labelled with its page number.

* AC-2.1 Page order and count match the source document.
* AC-2.2 Scrolling a 200-page document stays responsive (see NFR-2 and §8.2).

### FR-3 Zoom

Zoom in / out over a range of 25 %–400 % in defined steps
(`[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]`), plus two **fit modes**, all offered from
a single zoom menu — the fit modes are zoom choices, so they belong in the same list
rather than as separate buttons where the active one is invisible.

Zoom is therefore a *mode*, not just a number:

* `FIT_PAGE` — the whole page, caption included, fits the visible area. **The
  default**, and listed first: opening a ticket should show all of it at once, which is
  what the user needs before deciding what to mask.
* `FIT_WIDTH` — the page spans the available width.
* `FIXED` — a scale the user picked, which stays where it was put.

The fit modes are **live**: the scale is derived from the space available, so it is
recomputed whenever that space changes.

* AC-3.1 Changing zoom re-renders pages at the new scale and masks stay visually
  anchored to the same content. **This is the single most important regression test.**
* AC-3.2 Scroll position stays anchored to the same content after a zoom change —
  except at the very top, which stays at the top. Anchoring the viewport *centre*
  would otherwise push a top-aligned document downwards on zoom-in, and on the
  automatic fit when a document opens that left the first page starting behind the
  toolbar.
* AC-3.3 A fit mode re-fits when the window is resized, and equally when anything else
  changes the available space — the mask panel opening, the toolbar wrapping to another
  row. Observing the viewer element catches all of these; a window resize listener
  alone would catch only the first.
* AC-3.4 Choosing a percentage, or using the +/- buttons, ends the fit mode. It is an
  explicit instruction and must not be silently overridden by the next resize.
* AC-3.5 The menu toggle shows the resulting percentage alongside the mode name
  (`Fit page · 122 %`), since the mode name alone hides how big the page actually is.
* AC-3.6 Fitting leaves a small margin and measures the caption below each sheet, so a
  fitted page does not provoke the scrollbar that would then change the fit.
* AC-3.8 The fitted scale is applied **before the first paint**, so pages never appear
  at one size and then jump to another. Two things were needed: computing the fit in a
  layout effect rather than a `requestAnimationFrame` (which the ink measurement's work
  delays), and not letting the zoom throttle swallow the first change — on mount it was
  "applying" the unchanged initial value, consuming its leading edge and delaying the
  real one.
* AC-3.7 Re-fitting settles in a single step. Applying a new scale resizes the pages,
  which can add or remove a scrollbar, which resizes the viewer, which recomputes the
  fit; changes below half a percent are ignored to break that loop.

### FR-4 Masking tools
* **Rectangle** — press, drag, release draws an axis-aligned filled rectangle.
* **Freehand** — press and drag paints a stroke of a configurable width
  (default 12 PDF points), with round caps and joins.
* **Select** — no drawing. Clicking a mask selects it, dragging it moves it, dragging
  a handle resizes it, and dragging empty space scrolls the document (FR-9).

Requirements common to both tools:
* AC-4.1 Mask fill colour is opaque white (`#FFFFFF`, alpha 1). v1 exposes no colour
  choice.
* AC-4.2 A drag that produces a degenerate shape (rectangle smaller than 3×3 CSS px,
  or a freehand stroke with a single point) is discarded, not committed.
* AC-4.3 A drag started inside a page and released outside it is clamped to the page
  bounds and still committed.
* AC-4.4 A mask never spans two pages; masks belong to exactly one page.
* AC-4.5 Masks are rendered live in the overlay while drawing (preview) and become
  committed state on pointer release.

### FR-5 History
* Undo reverts the last committed change; redo reapplies it.
* Depth: at least 50 steps (`MAX_HISTORY`).
* Keyboard: `Ctrl/Cmd+Z` undo, `Ctrl/Cmd+Shift+Z` and `Ctrl+Y` redo.

* AC-5.1 Undo is disabled iff `past.length === 0`; redo is disabled iff `future.length === 0`.
* AC-5.2 Committing a new mask clears the redo stack.
* AC-5.3 Opening a new document clears all history.

### FR-6 Mask management
A side panel lists all masks grouped by page; each entry can be deleted individually.
"Clear page" and "Clear all" actions exist. All of these are history-tracked.

*Rationale: the canvas is unusable with a keyboard or screen reader. This list is the
accessible equivalent — see NFR-5.*

### FR-7 Output

**Print is the primary action** (Q-2, resolved). It is what the product is *for* —
the user's goal is a printed ticket, not a saved file — so it takes the primary button
and Download sits beside it as secondary. Print's weaker browser support is handled by
falling back, not by demoting it.

* **Print** — builds the modified PDF in memory and opens the browser print dialog.
* **Download** — saves the modified PDF as `<original-name>-inksaver.pdf`.

* AC-7.1 Output page count, page sizes and page rotation match the input exactly.
* AC-7.2 Text in the output remains selectable text (proof that the page was not
  rasterised).
* AC-7.3 Every mask appears in the output at the same position as on screen, on
  rotated pages and on pages whose CropBox origin is not `(0,0)`.
* AC-7.4 If programmatic printing fails or is unsupported, the PDF is downloaded
  instead and the user is told why (see §8.4). The fallback is silent-failure
  insurance, not an error: it still counts as a completed export for FR-8, because the
  user has their file.
* AC-7.5 `Ctrl/Cmd+P` triggers the app's print action, not the browser's. The browser's
  own print would render the editor chrome rather than the ticket — a wasteful misprint
  in an application whose purpose is saving ink.
* AC-7.6 If the page is nonetheless printed through the browser's menu, the print
  stylesheet emits a single instruction line rather than the UI.

### FR-8 Unsaved work

Masks are **not** persisted — that is non-goal N3, confirmed rather than assumed (see
the resolution of Q-1 in §12). A reload, a closed tab, or opening another document
discards them. Because that is by design, both exits must be guarded rather than
silent:

* **Leaving the page** — a `beforeunload` prompt while unsaved masks exist.
* **Opening another document** — a confirmation dialog naming the incoming file and the
  number of masks about to be lost, offering "Discard and open" or "Cancel". It covers
  both the file picker and drag-and-drop.

"Unsaved" means *there are masks, and this exact mask set has not been exported*.

* AC-8.1 With no masks, neither prompt ever appears — a warning with nothing to lose
  teaches users to dismiss warnings unread.
* AC-8.2 After a successful download or print, the prompts stop until the masks change
  again. The user has the file; there is nothing left to warn about.
* AC-8.3 Undoing back to an already-exported mask set also clears the warning state.
  (This falls out of comparing the mask list by reference — the reducer replaces the
  array on change and undo restores the previous array object — rather than needing a
  separate dirty flag.)
* AC-8.4 Cancelling the open-document confirmation leaves the current document, its
  masks, and its history completely untouched.
* AC-8.5 The `beforeunload` prompt uses the browser's own wording; custom text has been
  ignored by browsers for years, so only *whether* to prompt is under our control.

### FR-9 Editing an existing mask

Masks can be adjusted after they are drawn (Q-3, resolved). The supported operations
are **move** and **resize** only — no rotation, and no point-by-point reshaping of a
freehand stroke.

* **Select** — click a mask with the Select tool, or its row in the mask list. A newly
  drawn mask is selected automatically, so it can be adjusted straight away. Pressing
  anywhere that is not a mask clears the selection: blank paper, and the area around
  the pages.
* **Move** — drag the mask body. Applies to both rectangles and freehand strokes.
* **Resize** — drag one of the handles on the selection box. A rectangle changes size
  directly; a freehand stroke has its path scaled within the box, and its stroke width
  scaled by the geometric mean of the two axis factors (the only stable choice when the
  box is scaled unevenly, and a no-op for a pure move).
* **Keyboard** — with a mask selected: arrows move it, `Alt`+arrows resize it, `Shift`
  takes a coarse 10 px step, `Delete` removes it, `Escape` deselects.

* AC-9.1 A completed move or resize is **one** undo step, not one per pointer movement.
  The live gesture stays in a ref and reaches the reducer only on pointer-up (§7.3).
* AC-9.2 A click that only selects a mask, without moving it, adds nothing to the undo
  history.
* AC-9.3 Move and resize land correctly on rotated pages and offset CropBoxes. The
  gesture is computed in viewport space and converted back through the same
  `pdfRectFromViewportCorners` path the drawing tools use — never through a second
  implementation of the rotation maths (§8.3).
* AC-9.4 Keyboard steps are in *screen* pixels, so a nudge feels identical at every
  zoom level, and follow screen directions on a rotated page (on a `/Rotate 90` page,
  `Alt`+`ArrowRight` grows the mask's height in PDF terms — which is correct).
* AC-9.5 Handles resolve to the **nearest** handle, with corners beating edges. On a
  small mask the hit zones overlap, and picking the first match in iteration order
  turns a corner drag into a single-axis edge resize.
* AC-9.6 Below 32 px in either axis only the four corner handles are offered, since
  eight would overlap. The chrome never draws a handle that cannot be grabbed.
* AC-9.7 Undo or redo that removes the selected mask clears the selection rather than
  leaving it pointing at a mask that no longer exists.
* AC-9.8 While a mask is being dragged the committed layer stops painting it, so the
  original never shows through beneath the live preview.
* AC-9.9 A mask stays within the page when moved or resized, matching AC-4.3 for
  drawing. A move preserves the mask's size and stops at the edge; a resize clamps only
  the edges the handle actually drags, and no mask may exceed the page's own size.
* AC-9.10 Clamping never *corrects* a pre-existing overhang — a thick freehand stroke
  drawn along the margin has half its width outside the page by construction, and
  nudging it must not jerk it inwards. The rule is "a gesture may not make the overhang
  worse", so the permitted range is widened to include wherever the mask already sits.
* AC-9.11 A gesture entirely absorbed by clamping (dragging against an edge that will
  not move) commits nothing to the undo history, exactly like a click that only
  selects (AC-9.2).
* AC-9.12 Pressing outside the page — the surround around the sheets, not just blank
  paper within it — clears the selection. The interaction canvas covers only the page
  sheet, so the scroll container handles this case; it fires on pointer-down, matching
  the in-page behaviour rather than lagging behind it.
* AC-9.13 Pressing the scroll container's own scrollbar does **not** clear the
  selection. A scrollbar press reports the container as its target, so without a guard
  it would read as "outside the page"; grabbing a scrollbar is navigation, not
  deselection.
* AC-9.14 Clearing the selection never deletes or alters a mask, and adds nothing to
  the undo history — selection is view state, not document state.

### FR-10 Ink-saving estimate

The app reports roughly how much ink the masks save — the whole point of the product,
so it should be visible without exporting anything.

* **Toolbar** — one figure for the whole document.
* **Page label** — the same figure per page, shown once that page has masks.

**Definition.** Each pixel scores `1 - mean(r, g, b)`: white is no ink, black is full
coverage, and a saturated colour counts as needing more ink than a pale one. A page's
saving is the ink lying under its masks divided by the ink on the unmasked page; the
document figure is the same ratio over the summed totals.

**Method.** Each page is rendered once to a small offscreen raster (longest edge
`INK_SAMPLE_MAX_DIMENSION_PX`, default 200) and scored. Masks are rasterised at the
same scale and the ink beneath them summed.

* AC-10.1 Measured from a page's **own fixed-scale raster**, not the on-screen canvas.
  Displayed pages are virtualised (§8.2) and re-rendered on zoom, so a figure taken
  from them would count only visible pages and drift as the user scrolled.
* AC-10.2 The document figure covers **every** page, including those never scrolled
  into view.
* AC-10.3 The estimate is independent of zoom level.
* AC-10.4 It updates on every committed change — draw, move, resize, delete, undo,
  redo — but not during a drag, since nothing is committed then.
* AC-10.5 No masks reads as 0 %; masks covering all the ink read as 100 %. A document
  of blank pages reads 0 %, not "unknown": there is genuinely nothing to save.
* AC-10.6 Masks are scored without their editor chrome (selection outline, dashed
  border), which is screen-only and prints nothing.
* AC-10.7 Measuring yields between pages so a long document cannot lock the UI, and is
  abandoned if the document changes underneath it. The toolbar shows progress until
  every page is measured.
* AC-10.8 It is an **estimate** and the UI says so. Real consumption depends on the
  printer's colour model, driver, dithering and paper. It must never be presented as a
  guarantee.

*Accuracy, measured:* on a synthetic page of four identical black squares, masking one,
two and four of them reports 25 %, 50 % and 100 % exactly. On a realistic ticket the
figure sits within ~3 points of an independent implementation; the residual is the two
rasterisers antialiasing thin text and barcode bars differently, and sampling at 200,
400 or 800 px yields the same rounded answer, so there is nothing to buy by sampling
harder.

---

## 5. Non-Functional Requirements

* **NFR-1 Privacy** — No network request carries document bytes. Enforced by a CSP with
  `connect-src 'self'` and verified by an E2E test asserting zero outbound requests
  after a file is opened. No telemetry in v1.
* **NFR-2 Performance** — First page visible within 1.5 s of file selection for a
  typical 1-2 page, <2 MB ticket on a mid-range laptop. Scrolling holds ~60 fps.
  Peak heap stays under 512 MB for a 200-page document (achieved via §8.2).
  *Budget:* an A4 page renders to `(595·zoom·dpr) × (842·zoom·dpr) × 4` bytes. The
  §8.2 render-scale cap holds the worst case at ~32 MB per page, so 200 resident pages
  would be ~6.4 GB and even 20 would be ~640 MB — both over budget. Virtualisation
  keeps ~5 pages resident (~160 MB). Note it earns its place through *zoom* as much as
  page count: a 2-page ticket at 400 % still needs the cap and the overscan window.
* **NFR-3 Robustness** — No unhandled promise rejections. Every failure path in §10
  surfaces a user-visible message.
* **NFR-4 Browser support** — Current Chrome, Edge, Firefox and Safari (last two
  major versions). iOS Safari is best-effort: printing falls back to download.
* **NFR-5 Accessibility** — WCAG 2.1 AA for all non-canvas UI: every toolbar control
  has an accessible name, the app is fully operable by keyboard except for the drawing
  gesture itself, focus order is logical, and state changes (mask added, undo) are
  announced via an ARIA live region.
* **NFR-6 Security** — No PDF-supplied code executes. Embedded PDF JavaScript is never
  run (it is a viewer-layer feature this app does not enable). Filenames are treated as
  untrusted strings and are never injected as HTML.
  *Implementation note:* earlier drafts required `isEvalSupported: false`. pdf.js 6
  removed both the eval-based code path and the option itself — verified by there being
  no `new Function(` in `pdf.mjs` or `pdf.worker.mjs` — so there is no flag to set. If
  the project ever pins an older pdf.js, the flag becomes mandatory again.
* **NFR-7 Offline** — After first load the static bundle works with no network.

---

## 6. UI/UX Design (PatternFly 6)

* **Page layout** — PatternFly `Page` with a `Masthead` and a single `PageSection`.
* **Masthead** — app name and a short subtitle stating "runs entirely in your browser".
* **Toolbar** — sticky PatternFly `Toolbar` above the workspace:
  * Open file (`FileUpload` / `Button`)
  * Tool `ToggleGroup`: Pan · Rectangle · Freehand
  * Freehand width control (visible only when Freehand is active)
  * Zoom out · zoom menu (fit modes, then percentages) · zoom in
  * Undo · Redo (icon buttons with tooltips showing the shortcut)
  * Overflow menu: Clear page, Clear all
  * Download (secondary) · **Print** (primary)
* **Workspace** — scrollable column of pages, neutral grey backdrop, each page a white
  sheet with a subtle drop shadow.
* **Mask panel** — collapsible `Drawer` on the right listing masks per page (FR-6).
* **Empty state** — PatternFly `EmptyState` doubling as the drop zone.
* **Feedback** — non-blocking `Alert`s in an `AlertGroup` for recoverable errors;
  a progress indicator while the output PDF is being built.

**PatternFly 6 specifics that affect this app:**

* Global breakpoint design tokens moved from px to rem in PF6. Any custom CSS in
  `DocumentViewer`/`PageView` that hard-codes a breakpoint in px (for the N5 responsive
  behaviour) must use the PF6 token or an equivalent rem value instead.
* PF6 changed `Button`'s `isDisabled` to set the native `disabled` attribute only, no
  longer also setting `aria-disabled`. A natively disabled button is removed from the
  tab order, which changes how a screen-reader user discovers *why* Undo/Redo are
  unavailable (NFR-5). Verify the Undo/Redo and history-dependent buttons still meet
  NFR-5 under PF6 (e.g. via a tooltip/live-region hint rather than relying on a focusable
  disabled control), and re-check after running PatternFly's PF5→PF6 codemod.

Toolbar controls that need a document are disabled until one is open.

---

## 7. Architecture

### 7.1 Component hierarchy

```
App
└── EditorProvider                    (Context + useReducer; committed state only)
    ├── AppMasthead
    ├── ActionToolbar                 (tools, zoom, history, output)
    └── EditorWorkspace
        ├── DocumentViewer            (scroll container, virtualisation, zoom anchoring)
        │   └── PageView[]            (one per page)
        │       ├── PdfCanvas         (pdf.js render target — expensive)
        │       ├── MaskCanvas        (committed masks — cheap redraw)
        │       └── DrawingLayer      (in-progress preview; owns pointer handlers)
        └── MaskListDrawer            (accessible mask list, FR-6)
```

### 7.2 Layer separation (why three canvases)

`PdfCanvas` re-renders only when the page or the zoom level changes; a pdf.js render
is expensive and asynchronous. `MaskCanvas` redraws on every committed-mask change,
which is cheap. `InteractionLayer` redraws on every pointer move and therefore must never
touch global state. Collapsing these into one canvas forces a full pdf.js re-render on
every mouse move and is the most likely cause of a sluggish prototype.

### 7.3 State ownership rule

> Global reducer state holds **committed** data only. The current gesture — a drag's
> points, or a mask's in-flight position and size — lives in a `useRef` inside
> `InteractionLayer` and is flushed to the reducer exactly once, on pointer-up.

Dispatching on `pointermove` would re-render the whole tree 60+ times a second.

### 7.4 Non-serialisable objects

The `PDFDocumentProxy`, the per-page `PDFPageProxy` objects and the original file bytes
are **not** part of reducer state. They live in a separate `DocumentContext` backed by
`useRef`, because they are large, mutable and not comparable. Reducer state holds only
the derived, serialisable facts (page count, page dimensions, file name).

---

## 8. Critical Implementation Details

These are the areas where a naive implementation is known to produce incorrect results.

### 8.1 pdf.js worker and the detached-buffer trap

Two hazards:

1. **Worker wiring under Vite.** Set `GlobalWorkerOptions.workerSrc` from a Vite URL
   import of the worker shipped with the *installed* `pdfjs-dist` version, e.g.
   `import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'`. Do not load the
   worker from a CDN (breaks NFR-7 and weakens NFR-1).

2. **pdf.js transfers the ArrayBuffer it is given.** Passing an `ArrayBuffer`/
   `Uint8Array` to `getDocument({ data })` transfers it to the worker thread and
   **detaches it on the main thread**. Handing that same buffer to `pdf-lib` later
   throws or yields an empty document.
   **Rule:** read the `File` once into `originalBytes`, then pass a *copy*
   (`originalBytes.slice(0)`) to pdf.js and keep `originalBytes` untouched for the
   export step. Alternatively re-read the `File` at export time.

### 8.2 Rendering and virtualisation

* Render only pages intersecting the viewport plus a small overscan (±2 pages), driven
  by an `IntersectionObserver`. Non-visible pages keep their layout box (computed from
  `page.getViewport({ scale })`) but release their canvas backing store by setting
  `canvas.width = 0`.
* Every render returns a pdf.js `RenderTask`. On zoom change or unmount, call
  `renderTask.cancel()` and ignore the resulting `RenderingCancelledException`.
  Not cancelling causes out-of-order renders that paint a stale scale.
* Honour `devicePixelRatio`: backing store is `cssSize * dpr`, CSS size is set
  separately in the style, and the 2D context is scaled by `dpr`. Cap the effective
  render scale so that `zoom * dpr` never exceeds ~4 (memory guard).
* Debounce zoom changes (~150 ms) so a held-down zoom button does not queue N renders.

### 8.3 Coordinate systems — the core correctness concern

Three spaces are in play, and the original draft of this spec did not distinguish them:

| Space | Origin | Y axis | Unit |
|---|---|---|---|
| Pointer / CSS | top-left of the canvas element | down | CSS px (zoom-dependent) |
| Canvas backing store | top-left | down | device px (`css * dpr`) |
| **PDF user space** | bottom-left of the page box | **up** | points (1/72 in) |

Additionally a page may carry a `/Rotate` of 90/180/270, and its CropBox origin need
not be `(0,0)`.

**Rules:**

1. **Masks are stored exclusively in PDF user space**, never in screen pixels. This is
   what makes AC-3.1 hold: zoom changes the rendering, not the data.
2. Convert with pdf.js's own viewport helpers rather than hand-rolled arithmetic:
   `viewport.convertToPdfPoint(x, y)` when committing a mask, and
   `viewport.convertToViewportPoint(x, y)` when drawing it back. These already account
   for scale, rotation and the view-box offset. The viewport must be the same one used
   to render the page.
3. Pointer coordinates are derived from `event.clientX/Y` minus
   `canvas.getBoundingClientRect()` — never from `offsetX/offsetY` (unreliable across
   child elements) and never from layout assumptions.
4. Because the Y axis flips, a rectangle's stored corners must be re-normalised after
   conversion (`x = min(x0,x1)`, `y = min(y0,y1)`, `w = |x1-x0|`, `h = |y1-y0|`).
5. **Verify against pdf-lib.** pdf-lib's drawing operators work in unrotated user space
   and do not necessarily compensate for `/Rotate` or a non-zero CropBox origin. Before
   building on this, write a spike that draws a marker rectangle at a known location on
   (a) a normal page, (b) a `/Rotate 90` page, (c) a page whose CropBox origin is
   non-zero, and inspect the output. If pdf-lib does not compensate, apply the
   inverse-rotation and offset transform at export time. Treat this as a required
   pre-implementation task, not an assumption.

### 8.4 Export pipeline

```
originalBytes (pristine copy)
  └─ PDFDocument.load(bytes, { ignoreEncryption: true })
       └─ for each mask, on doc.getPage(mask.pageIndex):
            RECTANGLE → page.drawRectangle({ x, y, width, height, color: rgb(1,1,1),
                                             borderWidth: 0 })
            FREEHAND  → one page.drawLine({ start, end, thickness, color: rgb(1,1,1),
                                            lineCap: LineCapStyle.Round }) per segment
       └─ doc.save() → Uint8Array → Blob('application/pdf') → object URL
```

Notes:
* Draw order is document order; masks are drawn last and therefore on top of page
  content. **Caveat:** PDF *annotations* (form widgets, stamps) are painted above the
  content stream and will not be covered. Ads are normally page content, so this is
  acceptable for v1, but it must be recorded as a known limitation.
* Do **not** rasterise the page (no `canvas.toDataURL` into the PDF). That would
  violate G2/AC-7.2 and degrade barcodes.
* Prefer `drawLine` segments over `drawSvgPath` for freehand: `drawSvgPath` uses SVG
  conventions (Y down, anchored at a supplied origin) and is an easy source of flipped
  output.
* **Printing:** write the blob URL into a hidden, same-origin `<iframe>`, wait for its
  `load` event, then call `iframe.contentWindow.print()`. This is not universally
  supported (notably iOS Safari, and some Firefox configurations). Wrap it in a
  try/catch plus a timeout; on failure, fall back to the download path and tell the
  user (AC-7.4).
* Revoke every object URL (`URL.revokeObjectURL`) once consumed; leaking them pins the
  whole PDF in memory.
* Export runs on the main thread and will block it for a large document — show a
  progress/disabled state, and consider moving it to a Web Worker if measurement shows
  >500 ms.

### 8.5 Freehand point handling

Capture points only when the pointer has moved at least ~2 CSS px, and simplify the
committed path with Ramer–Douglas–Peucker (epsilon ≈ 1 PDF point). An unfiltered
stroke can carry thousands of points, which bloats the content stream and slows every
overlay redraw.

Use Pointer Events (`pointerdown`/`move`/`up`) with `setPointerCapture`, not mouse
events, so pen and touch input work and a drag that leaves the element still completes.

---

## 9. Data Model

```typescript
/** A point in PDF user space: origin bottom-left, Y up, unit = 1/72 inch. */
export interface PdfPoint {
  x: number;
  y: number;
}

/** Axis-aligned rectangle in PDF user space, normalised (width/height > 0). */
export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type MaskId = string;

/**
 * A mask is a discriminated union, so the compiler enforces that a rectangle
 * has a rect and a freehand stroke has a path. The previous `rect?` / `path?`
 * shape allowed illegal states such as "both" or "neither".
 */
export type Mask =
  | {
      id: MaskId;
      kind: 'RECTANGLE';
      pageIndex: number;      // 0-based
      rect: PdfRect;
    }
  | {
      id: MaskId;
      kind: 'FREEHAND';
      pageIndex: number;      // 0-based
      path: PdfPoint[];       // >= 2 points, PDF user space
      strokeWidth: number;    // PDF points
    };

export type ToolId = 'SELECT' | 'RECTANGLE' | 'FREEHAND';

export type ZoomMode = 'FIXED' | 'FIT_WIDTH' | 'FIT_PAGE';

/** Static, derived facts about the loaded document. */
export interface DocumentInfo {
  fileName: string;
  pageCount: number;
  /** Unrotated page size in PDF points, per page. */
  pageSizes: ReadonlyArray<{ width: number; height: number }>;
}

/**
 * Snapshot-based history. The mask set is small, so storing whole snapshots is
 * simpler and far less bug-prone than a command stack with inverse operations,
 * and it makes undo/redo of "clear all" free.
 */
export interface History<T> {
  past: T[];        // oldest first; length capped at MAX_HISTORY
  present: T;
  future: T[];      // cleared on every new commit
}

export interface EditorState {
  document: DocumentInfo | null;
  masks: History<ReadonlyArray<Mask>>;
  activeTool: ToolId;
  strokeWidth: number;   // PDF points, for new freehand masks
  zoom: number;          // 1 = 100 %
  status: 'IDLE' | 'LOADING' | 'READY' | 'EXPORTING' | 'ERROR';
  error: AppError | null;
}
```

Actions (reducer): `DOCUMENT_LOADING`, `DOCUMENT_LOADED`, `DOCUMENT_FAILED`,
`MASK_ADDED`, `MASK_DELETED`, `MASKS_CLEARED` (page | all), `UNDO`, `REDO`,
`TOOL_SELECTED`, `STROKE_WIDTH_CHANGED`, `ZOOM_CHANGED`, `EXPORT_STARTED`,
`EXPORT_FINISHED`, `ERROR_DISMISSED`.

Only `MASK_ADDED`, `MASK_DELETED` and `MASKS_CLEARED` push onto `past`.

### Changes from v0.1 of this model

* `masks` + a parallel `historyStack` array are replaced by a single
  past/present/future structure. The two arrays in v0.1 were redundant and could not
  express undo and redo consistently; "enable Undo when `historyStack.length > 0`"
  was ambiguous about which of the two arrays held what.
* `rect?` / `path?` optionals replaced by a discriminated union.
* `pdfFile: File` removed from reducer state (see §7.4).
* Coordinate space of every stored point is now pinned to PDF user space (§8.3).
* `strokeWidth` added — freehand was previously unrenderable as specified.

---

## 10. Error Handling

| Condition | Behaviour |
|---|---|
| Not a PDF / wrong MIME | Inline alert; current document preserved. |
| Corrupt PDF (`InvalidPDFException`) | Alert naming the file; return to empty state. |
| Password-protected | Password prompt (pdf.js `onPassword`), max 3 attempts. The document can then be viewed and masked. **Export is refused** — see the row below. |
| Encrypted document, on export | **pdf-lib cannot decrypt at all.** `ignoreEncryption: true` only suppresses the "this document is encrypted" error: the content streams stay encrypted and the saved file would be unreadable. (Verified: pdf-lib exposes no `decrypt`/`setPassword`/`removeEncryption` API.) The export step therefore checks `PDFDocument.isEncrypted` and fails with an explanation telling the user to remove the protection first. Failing loudly beats handing someone a corrupt ticket. Note this also catches owner-password-only files, which pdf.js opens without ever prompting. |
| Over size/page limit | Alert naming the limit; do not load. |
| pdf.js render failure on one page | That page shows an error placeholder; the rest of the document stays usable. |
| Export failure | Alert; masks and document are preserved so the user can retry. |
| Programmatic print unsupported/blocked | Fall back to download, explain why (AC-7.4). |
| Out of memory on very large documents | Guarded up front by the page/size limits and the render-scale cap (§8.2). |

---

## 11. Testing Strategy

* **Unit** — coordinate conversion (round-trip screen → PDF → screen at several zoom
  levels and all four rotations), rectangle normalisation, RDP simplification, the
  reducer (especially undo/redo invariants AC-5.1–5.3, and the history cap).
* **Component** — toolbar enablement rules, mask list, keyboard shortcuts.
* **E2E (Playwright)** — against a small fixture corpus that must include: a normal
  1-page ticket, a multi-page document, a `/Rotate 90` page, a page with a non-zero
  CropBox origin, an encrypted PDF and a deliberately corrupt file.
* **Golden-output test** — apply a known mask, export, re-open the output with pdf.js,
  render to a canvas and compare pixels against a reference image. This is the only
  test that actually proves AC-7.3; without it, coordinate bugs ship.
* **Privacy test** — assert zero outbound requests after a file is opened (NFR-1).

---

## 12. Risks and Open Questions

| # | Risk / question | Mitigation / owner |
|---|---|---|
| R-1 | PatternFly 6 migration items. PF6 officially supports React 17/18/19, so the React 18 ↔ PatternFly pairing itself is not at risk. The open items are (a) PF6's px→rem breakpoint token change, relevant to the N5 responsive layout, and (b) PF6's `Button` `isDisabled` no longer setting `aria-disabled`, which affects how Undo/Redo communicate their disabled state to assistive tech (NFR-5). | Run the official PF5→PF6 codemod if any PF5 code/tokens exist already; otherwise build directly against PF6. Re-verify NFR-5 for Undo/Redo/history-dependent controls once built (§6). |
| ~~R-2~~ **RESOLVED** | pdf-lib's handling of `/Rotate` and CropBox offset. | **No compensation is needed, and none must be added.** pdf-lib writes drawing coordinates straight into the content stream in unrotated user space (confirmed in its source: `drawRectangle` applies only a `translate`), and pdf.js's `convertToPdfPoint` already returns absolute unrotated user-space points. Verified end-to-end — mask a known block, export, re-render, check pixels — across `/Rotate` 0/90/180/270, a non-zero CropBox origin, and 4 zoom levels: 24/24 correct. |
| R-3 | Programmatic printing of a blob PDF is browser-dependent. | Download fallback is a first-class path, not an error case. |
| R-4 | pdf-lib re-serialises the document; exotic features (XFA forms, unusual encryption, some annotations) may be altered or dropped. | Include such a file in the fixture corpus; document limitations. |
| ~~Q-1~~ **RESOLVED** | Should masks persist across a reload (IndexedDB, keyed by a file hash)? | **No.** Masks stay in memory only; N3 stands. Instead the two ways of losing them are guarded by warnings — see FR-8. Rationale: the expected edit is a single rectangle (§2.2), so recreating it costs seconds, whereas persistence would mean holding fragments of someone's ticket in browser storage indefinitely, which cuts against NFR-1. |
| ~~Q-2~~ **RESOLVED** | Is "print" or "download" the primary action? | **Print**, with the download fallback accepted as good enough. It matches the user's actual goal — a printed ticket — and reliability is handled by AC-7.4 rather than by making everyone take an extra step for a problem most browsers do not have. See FR-7. |
| ~~Q-3~~ **RESOLVED** | Should masks be movable/resizable after they are drawn? | **Yes.** Delete-and-redraw was judged acceptable but markedly less friendly, so move and resize are implemented — see FR-9. Scope is deliberately limited to those two operations: no rotation, no point-level reshaping. |

---

## 13. Future Work

* Ink-saving modes that do not require manual work: "drop all images", "force
  greyscale", "text only".
* Automatic ad-region detection (heuristics on image placement / page margins).
* True redaction: remove the covered operators from the content stream rather than
  painting over them.
* Mask move/resize, snapping, and a colour picker for non-white backgrounds.
* Persisting masks per document — considered and rejected for v1 (Q-1); revisit only
  if multi-page, many-mask editing ever becomes a real use case.
