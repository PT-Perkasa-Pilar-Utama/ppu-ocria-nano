// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/blocks.rs (crates-v2.21.2, Apache-2.0).

import { chars, isWhitespace } from "../../rust.js";
import type { PositionedBlock } from "../block-types.js";
import { isSoftHyphenBreak } from "../paragraphs/index.js";
import { absorbBlock } from "./positioned.js";

/** A paragraph with no block-level emphasis, or null. */
function plainParagraph(pb: PositionedBlock | undefined): string | null {
  if (pb == null || typeof pb.block === "string" || !("Paragraph" in pb.block)) return null;
  const p = pb.block.Paragraph;
  return p.bold || p.italic ? null : p.text;
}

/**
 * Heal words hyphenated across a soft line wrap that the classifier split into
 * two *separate* paragraph blocks: `…they dis-` ‖ `lodged…`. When a plain
 * paragraph ends with `<letter>-` and the next is a plain paragraph starting
 * lowercase, fuse them, dropping the hyphen and joining with no separator, and
 * union their boxes, since the result spans both source regions.
 *
 * This runs as a pass over the block list rather than inside the renderer so
 * that the blocks callers receive are the same ones that produced the
 * markdown. The lowercase and plain-text gates keep real compounds (`well-`
 * then a capitalized `Known`) and emphasised/heading/table starts intact.
 */
export function spliceSoftHyphens(blocks: PositionedBlock[]): PositionedBlock[] {
  const out: PositionedBlock[] = [];
  for (const pb of blocks) {
    // Both sides must be unemphasised: an emphasised predecessor renders with a trailing
    // `**`/`*`, so its final character was never the hyphen this splice keys off.
    const prevText = plainParagraph(out[out.length - 1]);
    const tail = plainParagraph(pb);
    const prev = out[out.length - 1];
    if (
      prevText != null &&
      tail != null &&
      isSoftHyphenBreak(prevText, tail) &&
      typeof prev.block !== "string" &&
      "Paragraph" in prev.block
    ) {
      const cs = chars(prevText);
      while (cs.length > 0 && isWhitespace(cs[cs.length - 1])) cs.pop();
      cs.pop(); // the soft hyphen
      prev.block.Paragraph.text = cs.join("") + tail;
      absorbBlock(prev, pb);
      continue;
    }
    out.push(pb);
  }
  return out;
}
