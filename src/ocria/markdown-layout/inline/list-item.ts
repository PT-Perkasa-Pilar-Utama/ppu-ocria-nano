// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/inline.rs (crates-v2.21.2, Apache-2.0): list items and continuations.

import { chars, isWhitespace } from "../../rust.js";
import type { ProjectedLine } from "../../types/page.js";
import { collapseWhitespace, dehyphenateJoin } from "../paragraphs/index.js";
import { renderSpan } from "./apply-style.js";
import { escapeInline } from "./escape.js";
import { lineUniformStyle, renderLineInline } from "./render-line.js";

/**
 * Try to strip a leading list marker (optionally wrapped in emphasis markers)
 * off `s`. Recognizes `***MARK*** `, `**MARK** `, `*MARK* `, `` `MARK` ``,
 * and bare `MARK `. Returns the suffix on a match.
 */
export function stripLeadingMarkerFromInline(s: string, marker: string): string | null {
  for (const wrap of ["***", "**", "*", "`"]) {
    const prefix = `${wrap}${marker}${wrap} `;
    if (s.startsWith(prefix)) return s.slice(prefix.length);
  }
  const prefix = `${marker} `;
  return s.startsWith(prefix) ? s.slice(prefix.length) : null;
}

/**
 * Render the text portion of a list item with per-span emphasis. The marker
 * itself isn't included in the output (the renderer handles it separately).
 *
 * When the line is uniformly styled we wrap the marker-stripped `rest` with
 * the line's style — this avoids the awkward emphasis-marker mismatch we'd
 * hit if we naively stripped a leading bullet out of an already-wrapped
 * rendered line (`**• item**` becomes `** item**`).
 *
 * When the line is mixed-style we render the full line via the inline pipeline
 * and then best-effort-strip the marker prefix (with optional emphasis wrap
 * around it). On any failure we fall back to plain escaped `rest`.
 */
export function renderListItemText(line: ProjectedLine, marker: string, rest: string): string {
  const style = lineUniformStyle(line);
  if (style !== null) return renderSpan(collapseWhitespace(rest), style);
  const full = renderLineInline(line);
  const stripped = stripLeadingMarkerFromInline(full, marker);
  if (stripped !== null) return stripped;
  return escapeInline(collapseWhitespace(rest));
}

/**
 * Length of an emphasis marker (`*`, `**`, `***` or `~~`) that closes `prev` and reopens
 * `next` identically, with text on both sides of the seam (not `\*`, not a lone marker).
 */
export function continuedEmphasis(prev: string, next: string): number | null {
  const pairs: Array<[string, number[]]> = [
    ["*", [1, 2, 3]],
    ["~", [2]],
  ];
  for (const [ch, lens] of pairs) {
    let tail = 0;
    while (tail < prev.length && prev[prev.length - 1 - tail] === ch) tail++;
    let head = 0;
    while (head < next.length && next[head] === ch) head++;
    if (tail === 0 || tail !== head || !lens.includes(tail)) continue;
    // the markers are ASCII, so these offsets are the same in bytes and UTF-16 units
    const before = chars(prev.slice(0, prev.length - tail)).pop();
    const after = chars(next.slice(head))[0];
    const ok =
      before !== undefined &&
      !isWhitespace(before) &&
      before !== "\\" &&
      after !== undefined &&
      !isWhitespace(after);
    return ok ? tail : null;
  }
  return null;
}

/**
 * Append an inline-rendered continuation line to an existing list-item body.
 * De-hyphenates against the raw text boundary (mirrors the paragraph rule)
 * and falls back to a space join otherwise. Rust mutates `prev_text`; a JS
 * string cannot be, so this returns the new text.
 */
export function appendInlineContinuation(
  prevText: string,
  nextRaw: string,
  nextInline: string
): string {
  const raw = collapseWhitespace(nextRaw);
  let prev = prevText;
  let next = nextInline;
  // An emphasis run that continues onto the next line ("*… Network on*" then "*Drug Use …*")
  // stays one run: the closing marker and the reopening one are dropped at the seam.
  if (prev.endsWith("</u>") && next.startsWith("<u>") && !next.startsWith("<u></u>")) {
    prev = prev.slice(0, prev.length - "</u>".length);
    next = next.slice("<u>".length);
  }
  const n = continuedEmphasis(prev, next);
  if (n !== null) {
    prev = prev.slice(0, prev.length - n);
    next = next.slice(n);
  }
  return dehyphenateJoin(prev, raw, next);
}
