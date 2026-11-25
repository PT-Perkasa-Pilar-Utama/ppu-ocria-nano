// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/text_clip.rs (crates-v2.21.2, Apache-2.0): clip geometry helpers.

import { f32 } from "../../ocria/rust.js";
import type { RawPathSegment } from "../pdfium/page-object.js";
import type { Matrix, RectF } from "../pdfium/types.js";

/** Leader characters in a row that make a leader (`...` and longer). */
const MIN_LEADER_RUN = 3;

const LEADERS = new Set([".", "…", "_", "-", "–", "—", "·", "‥", "⋯"]);

/** Marks the glyphs in runs of `MIN_LEADER_RUN` or more leader characters. */
export function leaderRuns(chars: ReadonlyArray<string | null>): boolean[] {
  const isLeader = (c: string | null): boolean => c !== null && LEADERS.has(c);
  const marks = chars.map(() => false);
  let start = 0;
  while (start < chars.length) {
    let end = start;
    while (end < chars.length && isLeader(chars[end])) end++;
    if (end - start >= MIN_LEADER_RUN) marks.fill(true, start, end);
    start = end + 1;
  }
  return marks;
}

/** The larger side of the loose box, about one em (ascent to descent) at any rotation. */
export function emExtent(loose: RectF): number {
  const em = Math.max(
    Math.abs(f32(loose.right - loose.left)),
    Math.abs(f32(loose.top - loose.bottom))
  );
  return Number.isFinite(em) ? em : 0;
}

/** Whether two loose glyph boxes touch, within a quarter em, at any rotation. */
export function adjacent(a: RectF, b: RectF): boolean {
  const gapX = Math.max(f32(b.left - a.right), f32(a.left - b.right));
  const gapY = Math.max(f32(b.bottom - a.top), f32(a.bottom - b.top));
  return Math.max(gapX, gapY) <= 0.25 * Math.max(emExtent(a), emExtent(b));
}

export function validMatrix(m: Matrix): boolean {
  return (
    [m.a, m.b, m.c, m.d, m.e, m.f].every(Number.isFinite) && Math.abs(m.a * m.d - m.b * m.c) > 1e-12
  );
}

/**
 * Accept exactly one closed rectangle, never the bounding box of a compound path (which can contain
 * holes). Rotated or sheared non-axis-aligned clips fail open (null).
 */
export function rectangle(path: readonly RawPathSegment[], parent: Matrix): RectF | null {
  const last = path.at(-1);
  if (!(path.length === 4 || path.length === 5) || !last?.close || !validMatrix(parent))
    return null;
  let points: Array<[number, number]> = [];
  for (let i = 0; i < path.length; i++) {
    const segment = path[i];
    const expected = i === 0 ? "MoveTo" : "LineTo";
    if (segment.kind !== expected || (i + 1 !== path.length && segment.close)) return null;
    if (segment.point === null) return null;
    const [x, y] = segment.point;
    const p: [number, number] = [
      f32(f32(f32(parent.a * x) + f32(parent.c * y)) + parent.e),
      f32(f32(f32(parent.b * x) + f32(parent.d * y)) + parent.f),
    ];
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
    points.push(p);
  }
  if (points.length === 5) {
    const closing = points.pop();
    if (closing === undefined || closing[0] !== points[0][0] || closing[1] !== points[0][1])
      return null;
  }
  points = points.slice(0, 4);
  const horizontal: boolean[] = [];
  for (let i = 0; i < 4; i++) {
    const a = points[i];
    const b = points[(i + 1) % 4];
    horizontal[i] = a[1] === b[1] && a[0] !== b[0];
    if (!(horizontal[i] || (a[0] === b[0] && a[1] !== b[1]))) return null;
  }
  for (let i = 0; i < 4; i++) if (horizontal[i] === horizontal[(i + 1) % 4]) return null;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    bottom: Math.min(...ys),
    top: Math.max(...ys),
  };
}
