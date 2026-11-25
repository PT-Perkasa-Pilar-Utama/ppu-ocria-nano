// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/blocks.rs (crates-v2.21.2, Apache-2.0).

import { rectExtend } from "../../types/geometry.js";
import { chars, isLowercase, trimEnd, trimStart } from "../../rust.js";
import { trimEndChars, trimStartChars } from "../../rust-extra.js";
import type { PositionedBlock } from "../block-types.js";
import { appendInlineContinuation } from "../inline/index.js";
import { collapseWhitespace } from "../paragraphs/index.js";
import { sourcedBlock } from "./positioned.js";

export function endsSentence(text: string): boolean {
  const t = trimEndChars(trimEnd(text), "*_~`)\"'”’]");
  return t === "" || ".!?:;".includes(t.slice(-1));
}

export function startsContinuation(text: string): boolean {
  const first = chars(trimStartChars(trimStart(text), "*_~"))[0];
  return first != null && isLowercase(first);
}

function isFigure(b: PositionedBlock | undefined): boolean {
  return b != null && typeof b.block !== "string" && "Figure" in b.block;
}

/**
 * Rejoin a paragraph that a figure cut in two. Figures are placed by their top edge, so one set
 * beside a paragraph lands between two of its lines ("... including ![](img) glasses, ...").
 * When a paragraph is followed by figures and then a paragraph that continues it (the first
 * does not end a sentence, the second starts lowercase, both share the paragraph style), the
 * halves join (de-hyphenated) and the figures follow the joined paragraph.
 */
export function rejoinParagraphsAroundFigures(blocks: PositionedBlock[]): PositionedBlock[] {
  const out: PositionedBlock[] = [];
  let pos = 0;
  while (pos < blocks.length) {
    const pb = blocks[pos++];
    if (typeof pb.block === "string" || !("Paragraph" in pb.block)) {
      out.push(pb);
      continue;
    }
    let { text } = pb.block.Paragraph;
    const { bold, italic } = pb.block.Paragraph;
    let bbox = pb.bbox;
    const items = pb.text_item_indices;
    const held: PositionedBlock[] = [];
    for (;;) {
      // figures directly after this paragraph
      const figs: PositionedBlock[] = [];
      while (isFigure(blocks[pos])) figs.push(blocks[pos++]);
      const peek = blocks[pos]?.block;
      const continues =
        figs.length > 0 &&
        !endsSentence(text) &&
        peek != null &&
        typeof peek !== "string" &&
        "Paragraph" in peek &&
        peek.Paragraph.bold === bold &&
        peek.Paragraph.italic === italic &&
        startsContinuation(peek.Paragraph.text);
      if (!continues) {
        held.push(...figs);
        break;
      }
      const next = blocks[pos++];
      if (typeof next.block !== "string" && "Paragraph" in next.block) {
        const t = next.block.Paragraph.text;
        text = appendInlineContinuation(text, collapseWhitespace(t), t);
      }
      if (next.bbox != null) bbox = rectExtend(bbox ?? undefined, next.bbox);
      items.push(...next.text_item_indices);
      held.push(...figs);
    }
    out.push(sourcedBlock({ Paragraph: { text, bold, italic } }, bbox, items));
    out.push(...held);
  }
  return out;
}
