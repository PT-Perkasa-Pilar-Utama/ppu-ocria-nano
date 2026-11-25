// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/classify.rs (crates-v2.21.2, Apache-2.0): bold headings and paragraph text.

import type { ProjectedLine } from "../../types/page.js";
import { looksLikeBoldHeading } from "../headings/index.js";
import { lineUniformStyle, renderLineInline } from "../inline/index.js";
import {
  appendToParagraph,
  collapseWhitespace,
  continuesHyphenWrap,
  continuesParagraph,
} from "../paragraphs/index.js";
import { pushHeading } from "./heading-emit.js";
import { deepestHeadingLevel } from "./heading-level.js";
import { modelHeading } from "./model-page.js";
import { prevLine } from "./region-ctx.js";
import type { RegionCtx } from "./region-ctx.js";

/**
 * Bold body-size heading. Section headings in academic / technical PDFs are routinely body-sized
 * + bold (e.g. "Abstract", "1 Introduction"); without this rule they look just like a bold first
 * sentence of a paragraph. Runs after list-marker detection so bold bullet items stay as list
 * items. Returns true when the line was consumed.
 */
export function emitBoldHeading(
  ctx: RegionCtx,
  line: ProjectedLine,
  lineIdx: number,
  text: string,
  tocSuppress: boolean
): boolean {
  const next = lineIdx + 1 < ctx.lines.length ? ctx.lines[lineIdx + 1] : null;
  if (tocSuppress || !looksLikeBoldHeading(line, prevLine(ctx), next)) return false;
  const model = modelHeading(ctx.page, line);
  if (model !== null && model[0] <= model[3]) return false;
  ctx.state.flushParagraph(ctx.blocks);
  ctx.state.resetList();
  // Level: one deeper than the deepest size-based level we already have. With an empty
  // heading_map this lands on H1; with a full 6-level map it caps at H6.
  const level = deepestHeadingLevel(ctx);
  pushHeading(ctx, line, text, level);
  // Arm the heading_run so a wrapped continuation on the next line merges into this heading
  // instead of emitting as a second one.
  ctx.headingRun = [level, lineIdx];
  return true;
}

/** Add `line` to the live paragraph when it continues it, else start a new paragraph. */
export function emitParagraphLine(ctx: RegionCtx, line: ProjectedLine, text: string): void {
  const { state } = ctx;
  const acc = state.paragraph;
  if (acc !== null && (continuesParagraph(acc.last, line) || continuesHyphenWrap(acc.last, line))) {
    appendToParagraph(acc, line);
    return;
  }
  state.flushParagraph(ctx.blocks);
  state.resetList();
  const inline = renderLineInline(line);
  const raw = collapseWhitespace(text);
  // Strike has no block-level Paragraph flag, so a struck line must keep the per-line `inline`
  // rendering (which emits `~~…~~`) rather than take the uniform raw-text fast path.
  const style = lineUniformStyle(line);
  const uniform: [boolean, boolean] | null =
    style !== null && !style.strike ? [style.bold, style.italic] : null;
  state.paragraph = {
    raw,
    inline,
    bbox: { ...line.bbox },
    last: line,
    uniform,
    item_indices: [...line.span_item_indices],
  };
}
