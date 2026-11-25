// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/classify.rs (crates-v2.21.2, Apache-2.0): cross-region paragraph stitching.

import { isLowercase, isWhitespace, trimEnd, trimStart } from "../../rust.js";
import { rectUnion } from "../../types/geometry.js";
import type { Rect } from "../../types/geometry.js";
import type { PositionedBlock } from "../block-types.js";
import { endsOpenHyphen, isSoftHyphenBreak } from "../paragraphs/index.js";

const CLOSERS = new Set([".", "!", "?", ":", ";", "”", '"', ")", "]", "。", "』", "」"]);

/** The box of two merged blocks: `Option` union (a missing side yields the other). */
function mergedBox(a: Rect | null, b: Rect | null): Rect | null {
  if (a !== null && b !== null) return rectUnion(a, b);
  return a ?? b;
}

/** `s` without trailing characters while `pred` holds, on code points. */
function popWhile(s: string, pred: (c: string) => boolean): string {
  const cs = Array.from(s);
  while (cs.length > 0 && pred(cs[cs.length - 1])) cs.pop();
  return cs.join("");
}

/**
 * Cross-region merging. Walks the concatenated block stream and, at each
 * region boundary, tries to fuse the last block of region A with the first
 * block of region B when they represent one logical unit split across leaves.
 * This is the *only* place per-region scoping is relaxed — every other
 * detector now treats a region as a hard wall — so the merge rules here are
 * deliberately narrow and inspectable.
 *
 * Currently supports:
 * - **Paragraph → Paragraph**: same cross-region rule as
 *   `continues_paragraph`'s `region_path != region_path` arm: the previous
 *   paragraph ends mid-sentence (no terminal punctuation) and the next
 *   starts lowercase. Heals a column wrap losing its tail to a separate
 *   block.
 * - **Hyphen splice**: previous paragraph ends `<letter>-` and next starts
 *   ASCII-lowercase. Already handled in `render_blocks` for the adjacent
 *   case, but doing it here too lets the merged block flow through the
 *   uniform paragraph-rendering path and avoids a `\n\n` slipping in when
 *   the renderer sees an intervening non-paragraph block.
 *
 * Lists, code blocks, headings, and tables are *not* fused across regions.
 * A bullet point split across columns is rare and a false merge is worse
 * than a true split; a table split across leaves indicates a projection-side
 * issue better fixed there than papered over here.
 */
export function stitchRegions(
  blocks: PositionedBlock[],
  regionStarts: readonly number[]
): PositionedBlock[] {
  if (regionStarts.length <= 1) return blocks;
  const boundarySet = new Set(regionStarts.slice(1));
  const out: PositionedBlock[] = [];
  blocks.forEach((block, i) => {
    const prev = out.length > 0 ? out[out.length - 1] : null;
    if (
      prev !== null &&
      boundarySet.has(i) &&
      typeof prev.block !== "string" &&
      "Paragraph" in prev.block &&
      typeof block.block !== "string" &&
      "Paragraph" in block.block &&
      !block.block.Paragraph.bold &&
      !block.block.Paragraph.italic
    ) {
      const para = prev.block.Paragraph;
      const curText = block.block.Paragraph.text;
      // Either merge below fuses the two blocks, so the survivor covers both leaves.
      const mergedBbox = mergedBox(prev.bbox, block.bbox);
      const prevTrim = trimEnd(para.text);
      const first = Array.from(trimStart(curText))[0];
      const startsLower = first !== undefined && isLowercase(first);
      // Hyphen-splice path: a mid-word soft hyphen break across the
      // leaf boundary. Drop the hyphen, join with no separator.
      if (isSoftHyphenBreak(para.text, curText)) {
        // Pop the trailing `-` (it may have whitespace after it from
        // a previous trim, so re-trim).
        const popped = Array.from(popWhile(para.text, isWhitespace));
        popped.pop(); // the '-'
        para.text = popped.join("") + trimStart(curText);
        prev.bbox = mergedBbox;
        prev.text_item_indices.push(...block.text_item_indices);
        return;
      }
      // A hard hyphen (`pyridine-3-` + `carbonitrile`): one token, hyphen kept.
      if (endsOpenHyphen(para.text) && startsLower) {
        para.text = popWhile(para.text, isWhitespace) + trimStart(curText);
        prev.bbox = mergedBbox;
        prev.text_item_indices.push(...block.text_item_indices);
        return;
      }
      const lastCh = Array.from(prevTrim).pop();
      const endsOpen = !(lastCh !== undefined && CLOSERS.has(lastCh));
      if (endsOpen && startsLower) {
        para.text = `${para.text} ${trimStart(curText)}`;
        prev.bbox = mergedBbox;
        prev.text_item_indices.push(...block.text_item_indices);
        return;
      }
    }
    out.push(block);
  });
  return out;
}
