// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/classify.rs (crates-v2.21.2, Apache-2.0): list items and their continuations.

import { f32, asUsize } from "../../rust.js";
import { roundF32 } from "../../rust-extra.js";
import { rectExtend } from "../../types/geometry.js";
import type { ProjectedLine } from "../../types/page.js";
import { sourcedBlock } from "../blocks/positioned.js";
import { looksLikeNumberedBoldHeading } from "../headings/index.js";
import { appendInlineContinuation, renderLineInline, renderListItemText } from "../inline/index.js";
import { LIST_INDENT_STEP_PT, parseListMarker, splitOrderedMarkerForEmit } from "../lists/index.js";
import { continuesListItem } from "../paragraphs/index.js";
import { deepestHeadingLevel } from "./heading-level.js";
import { pushHeading } from "./heading-emit.js";
import { prevLine } from "./region-ctx.js";
import type { RegionCtx } from "./region-ctx.js";

/** The marker of a list-item line: bullets/decimals from `parse_list_marker`, lettered and roman only when the region pre-pass confirmed them. */
function listMarker(
  ctx: RegionCtx,
  text: string,
  lineIdx: number
): [boolean, string, string] | null {
  const parsed = parseListMarker(text);
  if (parsed !== null) return parsed;
  if (!ctx.orderedListLines.has(lineIdx)) return null;
  const split = splitOrderedMarkerForEmit(text);
  return split === null ? null : [true, split[0], split[1]];
}

/** `(x.round().max(0.0)) as u8`. */
function listLevel(indentX: number, base: number): number {
  const v = Math.max(roundF32(f32(f32(indentX - base) / LIST_INDENT_STEP_PT)), 0);
  return Math.min(asUsize(v), 255);
}

/**
 * List item? Bullets/decimals come from `parse_list_marker`; lettered and roman markers are only
 * accepted when the region pre-pass confirmed them as part of a sequential run. Returns true when
 * the line was consumed.
 */
export function emitListItem(
  ctx: RegionCtx,
  line: ProjectedLine,
  lineIdx: number,
  text: string,
  tocSuppress: boolean
): boolean {
  const m = listMarker(ctx, text, lineIdx);
  if (m === null) return false;
  const [ordered, marker, rest] = m;
  const { state, blocks } = ctx;
  // Numbered bold-section heading: "1. **Foo**" / "5. **The dynamics**". When the post-marker
  // body is uniformly bold + body-sized, standalone (paragraph-break gap above and below), short,
  // and mostly alpha, treat it as a heading rather than the first item of an ordered list.
  // Without this, decimal-numbered section headings in technical/legal/scientific PDFs silently
  // emit as ordered list items and lose all heading structure.
  if (ordered && !tocSuppress && looksLikeNumberedBoldHeading(line, rest, prevLine(ctx))) {
    state.flushParagraph(blocks);
    state.resetList();
    pushHeading(ctx, line, text, deepestHeadingLevel(ctx));
    return true;
  }
  state.flushParagraph(blocks);
  state.listBaseIndent ??= line.indent_x;
  const level = listLevel(line.indent_x, state.listBaseIndent);
  state.lastListItemIdx = blocks.length;
  state.lastListLine = lineIdx;
  // Render the list-item text via the inline pipeline so per-span emphasis surfaces. We strip the
  // marker from `rest` (already done by `parse_list_marker`), but emphasis lives on `line.spans`,
  // which still contain the marker span — render the line and then peel the marker off the front
  // of the rendered string.
  const itemText = renderListItemText(line, marker, rest);
  blocks.push(
    sourcedBlock(
      { ListItem: { ordered, marker, level, text: itemText, bold: false, italic: false } },
      { ...line.bbox },
      [...line.span_item_indices]
    )
  );
  return true;
}

/**
 * Continuation of a list item: same gap/font rules as paragraphs, but hanging-indent tolerant.
 * Wrapped bodies either left-flush below the marker (footnote style) or align under the marker's
 * text (indented right) — `continues_list_item` accepts both. Returns true when the line was consumed.
 */
export function continueListItem(
  ctx: RegionCtx,
  line: ProjectedLine,
  lineIdx: number,
  text: string
): boolean {
  const { state } = ctx;
  if (state.lastListItemIdx === null || state.lastListLine === null) return false;
  if (!continuesListItem(ctx.lines[state.lastListLine], line)) return false;
  const item = ctx.blocks[state.lastListItemIdx];
  if (item === undefined || typeof item.block === "string" || !("ListItem" in item.block)) {
    return false;
  }
  const li = item.block.ListItem;
  // De-hyphenate against the prior rendered text, then append the inline-styled continuation.
  li.text = appendInlineContinuation(li.text, text, renderLineInline(line));
  // The wrapped line belongs to the same item, so it grows its box.
  item.bbox = rectExtend(item.bbox ?? undefined, line.bbox);
  item.text_item_indices.push(...line.span_item_indices);
  state.lastListLine = lineIdx;
  return true;
}
