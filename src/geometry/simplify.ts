// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ladislav Slezák

/**
 * Ramer-Douglas-Peucker path simplification (spec §8.5).
 *
 * A raw freehand stroke can carry thousands of points, which bloats the output
 * content stream and slows every overlay redraw. Simplifying at ~1pt tolerance is
 * visually lossless for a 12pt-wide brush.
 */
import type { PdfPoint } from '../types/models';

function perpendicularDistance(point: PdfPoint, lineStart: PdfPoint, lineEnd: PdfPoint): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lengthSquared = dx * dx + dy * dy;

  // Degenerate segment: fall back to point-to-point distance.
  if (lengthSquared === 0) {
    return Math.hypot(point.x - lineStart.x, point.y - lineStart.y);
  }

  // Project onto the segment, clamped to it.
  const t = Math.min(
    1,
    Math.max(0, ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lengthSquared),
  );
  const projX = lineStart.x + t * dx;
  const projY = lineStart.y + t * dy;
  return Math.hypot(point.x - projX, point.y - projY);
}

/** Iterative RDP; iterative rather than recursive so a long stroke cannot blow the stack. */
export function simplifyPath(points: readonly PdfPoint[], epsilon: number): PdfPoint[] {
  if (points.length <= 2 || epsilon <= 0) {
    return [...points];
  }

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: Array<[number, number]> = [[0, points.length - 1]];

  while (stack.length > 0) {
    const range = stack.pop();
    if (!range) break;
    const [startIndex, endIndex] = range;
    if (endIndex <= startIndex + 1) continue;

    const start = points[startIndex];
    const end = points[endIndex];
    if (!start || !end) continue;

    let maxDistance = 0;
    let maxIndex = -1;
    for (let i = startIndex + 1; i < endIndex; i += 1) {
      const candidate = points[i];
      if (!candidate) continue;
      const distance = perpendicularDistance(candidate, start, end);
      if (distance > maxDistance) {
        maxDistance = distance;
        maxIndex = i;
      }
    }

    if (maxIndex !== -1 && maxDistance > epsilon) {
      keep[maxIndex] = 1;
      stack.push([startIndex, maxIndex], [maxIndex, endIndex]);
    }
  }

  const result: PdfPoint[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    if (keep[i] === 1 && point) result.push(point);
  }
  return result;
}
