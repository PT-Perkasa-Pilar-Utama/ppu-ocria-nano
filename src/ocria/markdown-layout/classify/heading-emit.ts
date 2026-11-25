// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/classify.rs (crates-v2.21.2, Apache-2.0): heading emission and wrap merging.

import { charCount } from "../../rust.js";
import { rectExtend } from "../../types/geometry.js";
import type { ProjectedLine } from "../../types/page.js";
import type { PositionedBlock } from "../block-types.js";
import { sourcedBlock } from "../blocks/positioned.js";
import { HEADING_MAX_TEXT_CHARS } from "../headings/index.js";
import { appendInlineContinuation } from "../inline/index.js";
import { collapseWhitespace, continuesHeading } from "../paragraphs/index.js";
import type { RegionCtx } from "./region-ctx.js";

/** The heading fields of a block, or null when `pb` is not a heading. */
function headingOf(pb: PositionedBlock | undefined): { level: number; text: string } | null {
  if (pb === undefined || typeof pb.block === "string" || !("Heading" in pb.block)) return null;
  return pb.block.Heading;
}

/** Emit a heading block for `line`. */
export function pushHeading(
  ctx: RegionCtx,
  line: ProjectedLine,
  text: string,
  level: number
): void {
  ctx.blocks.push(
    sourcedBlock({ Heading: { level, text: collapseWhitespace(text) } }, { ...line.bbox }, [
      ...line.span_item_indices,
    ])
  );
}

/**
 * Unconditional wrap-continuation merge: when the previous block is a live `headingRun` and this
 * line continues it (same font, same region, tight gap), merge regardless of whether this line
 * itself qualifies as a heading. Catches body-size wrap continuations of bold headings
 * ("Cellular Cycle\nand Replication") where line 2 has the same sub-body size and would otherwise
 * emit as a stray bold paragraph. Gated so only body-sized continuations that *look* like the
 * rest of a heading fold in: `continues_heading` only enforces structural agreement
 * (font/bold/region/gap), so a body paragraph that happens to share those traits would otherwise
 * be absorbed. Returns true when the line was merged.
 */
export function mergeIntoHeadingRun(
  ctx: RegionCtx,
  line: ProjectedLine,
  lineIdx: number,
  text: string,
  contLooksLikeHeading: boolean
): boolean {
  // The heading is only "directly above" when no paragraph is pending:
  // `blocks.last()` stays the heading while a paragraph accumulates.
  if (!contLooksLikeHeading || ctx.state.paragraph !== null || ctx.headingRun === null)
    return false;
  const [runLevel, runIdx] = ctx.headingRun;
  if (!continuesHeading(ctx.lines[runIdx], line)) return false;
  const last = ctx.blocks[ctx.blocks.length - 1];
  const heading = headingOf(last);
  if (heading === null || heading.level !== runLevel) return false;
  // The continuation line is part of the same heading.
  last.bbox = rectExtend(last.bbox ?? undefined, line.bbox);
  const combinedChars = charCount(heading.text) + 1 + charCount(text);
  if (combinedChars > HEADING_MAX_TEXT_CHARS) return false;
  heading.text = appendInlineContinuation(heading.text, text, collapseWhitespace(text));
  last.text_item_indices.push(...line.span_item_indices);
  ctx.headingRun = [runLevel, lineIdx];
  return true;
}

/**
 * Emit `line` as a heading of `level`. Merges a wrapped continuation into the heading directly
 * above when it flows as one block: same level, the heading is still the last emitted block, and
 * the line continues the paragraph. A real section heading is followed by body text (which breaks
 * the run), so only a genuinely multi-line heading/caption merges here. Without the "directly
 * above" check, demotion below would overwrite the pending paragraph and drop its text.
 *
 * Returns false when the heading above grew past the length limit and was demoted back to a
 * paragraph: the caller then classifies `line` as that paragraph's continuation.
 */
export function emitHeading(
  ctx: RegionCtx,
  line: ProjectedLine,
  lineIdx: number,
  text: string,
  level: number
): boolean {
  const { state } = ctx;
  if (state.paragraph === null && ctx.headingRun !== null) {
    const [runLevel, runIdx] = ctx.headingRun;
    const last = ctx.blocks[ctx.blocks.length - 1];
    const heading = headingOf(last);
    if (
      runLevel === level &&
      continuesHeading(ctx.lines[runIdx], line) &&
      heading !== null &&
      heading.level === level
    ) {
      // Length guard: a wrapped multi-line heading is fine, but a run that grows past
      // `HEADING_MAX_TEXT_CHARS` is almost certainly a footnote/citation block whose font is only
      // slightly above body (e.g. 10.7pt over 9pt body). Demote the existing heading block back to
      // a paragraph and let the current line continue that paragraph below. The first line scored
      // as a solo heading because it was under the limit on its own; only the second-or-later
      // line tips the cumulative content into footnote territory.
      const combinedChars = charCount(heading.text) + 1 + charCount(text);
      if (combinedChars > HEADING_MAX_TEXT_CHARS) {
        const demoted = heading.text;
        const itemIndices = last.text_item_indices;
        ctx.blocks.pop();
        state.paragraph = {
          raw: demoted,
          inline: demoted,
          last: { ...ctx.lines[runIdx] },
          uniform: null,
          bbox: { ...ctx.lines[runIdx].bbox },
          item_indices: itemIndices,
        };
        ctx.headingRun = null;
        return false;
      }
      heading.text = appendInlineContinuation(heading.text, text, collapseWhitespace(text));
      last.text_item_indices.push(...line.span_item_indices);
      ctx.headingRun = [level, lineIdx];
      return true;
    }
  }
  state.flushParagraph(ctx.blocks);
  state.resetList();
  pushHeading(ctx, line, text, level);
  ctx.headingRun = [level, lineIdx];
  return true;
}
