// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/paragraphs.rs (crates-v2.21.2, Apache-2.0): paragraph accumulator.

import { rectExtend } from "../../types/geometry.js";
import type { Rect } from "../../types/geometry.js";
import type { ProjectedLine } from "../../types/page.js";
import { appendInlineContinuation, lineUniformStyle, renderLineInline } from "../inline/index.js";
import { collapseWhitespace, dehyphenateJoin } from "./text.js";
import { trim } from "../../rust.js";

/**
 * Paragraph accumulator state. Two parallel representations of the running
 * paragraph text:
 *
 * - `raw`: plain text (no emphasis markers). Used for the paragraph-uniform
 *   shortcut: if every contributing line had the same uniform style, the whole
 *   paragraph is wrapped once to avoid the `**foo** **bar** **baz**` per-line noise.
 * - `inline`: per-line markdown with emphasis baked in via `renderLineInline`.
 *   Used when the paragraph contains mid-line emphasis shifts or lines with
 *   differing uniform styles.
 *
 * `uniform` is `[bold, italic]` while every line so far has been a
 * uniformly-styled line sharing the same flags, and null as soon as that breaks.
 */
export type ParaAccum = {
  raw: string;
  inline: string;
  last: ProjectedLine;
  uniform: [boolean, boolean] | null;
  /** Union of every line folded into this paragraph, so the emitted block reports the whole band. */
  bbox: Rect | null;
  /** Source items of every line folded in, in reading order. */
  item_indices: number[];
};

/**
 * Append `nextLine` to a paragraph accumulator. Maintains both the `raw` and
 * `inline` text representations and updates the running `uniform` flag.
 * De-hyphenation runs on the `raw` boundary; the `inline` boundary mirrors it
 * when the trailing char is still a literal `-` (the hyphen sits outside any
 * emphasis wrap, the common case).
 */
export function appendToParagraph(accum: ParaAccum, nextLine: ProjectedLine): void {
  const nextRaw = collapseWhitespace(trim(nextLine.text));
  if (nextRaw === "") return;
  const nextInline = renderLineInline(nextLine);
  // A struck line has no block-level flag, so it can't use the uniform
  // raw-text fast path: drop it to null to force the `inline` rendering.
  const style = lineUniformStyle(nextLine);
  const nextUniform = style !== null && !style.strike ? style : null;

  accum.bbox = rectExtend(accum.bbox ?? undefined, nextLine.bbox);
  accum.item_indices.push(...nextLine.span_item_indices);

  if (accum.raw === "") {
    accum.raw += nextRaw;
    accum.inline += nextInline;
    accum.uniform = nextUniform === null ? null : [nextUniform.bold, nextUniform.italic];
    accum.last = nextLine;
    return;
  }

  // Raw side de-hyphenates against its own boundary. The inline side keys off
  // the same raw lowercase test but checks *its own* trailing char: a hyphen
  // tucked inside an emphasis wrap ends in `*` / `` ` `` rather than `-`, so it
  // won't strip and falls through to a space join.
  accum.raw = dehyphenateJoin(accum.raw, nextRaw, nextRaw);
  // the inline side first rejoins an emphasis run split at the line break ("*… Man-*" +
  // "*ager …*"), so the hyphen is at its seam again
  accum.inline = appendInlineContinuation(accum.inline, nextRaw, nextInline);

  // Maintain the running uniform-style flag.
  const cur = accum.uniform;
  accum.uniform =
    cur !== null &&
    nextUniform !== null &&
    cur[0] === nextUniform.bold &&
    cur[1] === nextUniform.italic
      ? cur
      : null;
  accum.last = nextLine;
}
