// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ladislav Slezák

/**
 * Building the masked output PDF (spec §8.4).
 *
 * Masks are stored in absolute, unrotated PDF user space (§8.3), and pdf-lib's
 * drawing operators write their coordinates straight into the page content stream
 * in exactly that space -- it applies no compensation for /Rotate or a non-zero
 * CropBox origin, and none is wanted: a viewer rotates our mask along with the
 * original content, and CropBox offsets are already baked into the stored numbers
 * by pdf.js's `convertToPdfPoint`. This closes spec risk R-2.
 *
 * The page is never rasterised. Masks are appended as vector operators, so text
 * stays text and barcodes stay sharp (goal G2, AC-7.2).
 */
import {
  LineCapStyle,
  LineJoinStyle,
  PDFDocument,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingColor,
  stroke,
} from 'pdf-lib';
import type { Mask, MaskList } from '../types/models';

export class ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportError';
  }
}

const WHITE = rgb(1, 1, 1);

/**
 * Apply `masks` to `originalBytes` and return the new PDF bytes.
 *
 * `originalBytes` is copied before use: pdf-lib takes ownership of what it parses,
 * and the caller needs its pristine copy to stay valid for the next export.
 */
export async function buildMaskedPdf(
  originalBytes: Uint8Array,
  masks: MaskList,
): Promise<Uint8Array> {
  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(originalBytes.slice(), {
      ignoreEncryption: true,
      updateMetadata: false,
    });
  } catch (error) {
    throw new ExportError(
      `The PDF could not be rewritten: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  /*
   * pdf-lib cannot decrypt. `ignoreEncryption` only suppresses the error -- the
   * content streams stay encrypted and the saved file would be unreadable. Failing
   * loudly here is far better than handing the user a corrupt ticket.
   */
  if (pdfDoc.isEncrypted) {
    throw new ExportError(
      'This PDF is encrypted, and the PDF writer used here cannot re-save encrypted ' +
        'documents. Remove the protection first (for example by printing it to a new ' +
        'PDF), then open that copy here.',
    );
  }

  const pages = pdfDoc.getPages();

  for (const mask of masks) {
    const page = pages[mask.pageIndex];
    if (!page) continue; // Defensive: stale mask for a page that no longer exists.
    drawMask(page, mask);
  }

  try {
    return await pdfDoc.save({ useObjectStreams: false });
  } catch (error) {
    throw new ExportError(
      `The PDF could not be saved: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

type PdfLibPage = ReturnType<PDFDocument['getPages']>[number];

function drawMask(page: PdfLibPage, mask: Mask): void {
  if (mask.kind === 'RECTANGLE') {
    // Zero-area rectangles would emit a degenerate path; skip them.
    if (mask.rect.width <= 0 || mask.rect.height <= 0) return;
    page.drawRectangle({
      x: mask.rect.x,
      y: mask.rect.y,
      width: mask.rect.width,
      height: mask.rect.height,
      color: WHITE,
      borderWidth: 0,
    });
    return;
  }

  const path = mask.path;
  if (path.length < 2) return;

  /*
   * Emit the whole stroke as one polyline rather than N separate drawLine() calls:
   * one graphics-state block instead of N, a much smaller content stream, and real
   * round joins (setLineJoin) instead of joins faked by overlapping round caps.
   */
  const operators = [
    pushGraphicsState(),
    setStrokingColor(WHITE),
    setLineWidth(mask.strokeWidth),
    setLineCap(LineCapStyle.Round),
    setLineJoin(LineJoinStyle.Round),
  ];

  const first = path[0];
  if (!first) return;
  operators.push(moveTo(first.x, first.y));
  for (let i = 1; i < path.length; i += 1) {
    const point = path[i];
    if (point) operators.push(lineTo(point.x, point.y));
  }
  operators.push(stroke(), popGraphicsState());

  page.pushOperators(...operators);
}
