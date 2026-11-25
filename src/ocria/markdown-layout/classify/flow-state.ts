// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/classify.rs (crates-v2.21.2, Apache-2.0): per-line flow state.

import { chars, isUppercase, trim } from "../../rust.js";
import { rectExtend } from "../../types/geometry.js";
import type { Rect } from "../../types/geometry.js";
import { sourcedBlock, positionedBlock } from "../blocks/positioned.js";
import { paragraphFromAccum } from "../blocks/index.js";
import type { PositionedBlock } from "../block-types.js";
import { escapeInline } from "../inline/index.js";
import type { ParaAccum } from "../paragraphs/index.js";
import { detectCodeLanguage, monoRunReadsAsProse } from "./code.js";
import { positionedInterruption } from "./interruption.js";
import type { InterruptionQueue } from "./interruption.js";

/** An active code run: its lines, the union of their boxes and their source items. */
export type CodeRun = { lines: string[]; bbox: Rect | null; items: number[] };

const ASCII_DIGIT = /^[0-9]$/;
const SENTENCE_PUNCT = [".", "!", "?", ":", ")"];

/**
 * Mutable per-line flow state threaded through `classify_region`: the active
 * paragraph accumulator, the active code run, and the current list run. The
 * flush/reset/emit methods live here so list-state resets collapse to method
 * calls.
 */
export class FlowState {
  paragraph: ParaAccum | null = null;
  code: CodeRun | null = null;
  listBaseIndent: number | null = null;
  lastListItemIdx: number | null = null;
  lastListLine: number | null = null;

  /** Drop the active list run. A heading, table, code block, or paragraph break all terminate the current list. */
  resetList(): void {
    this.listBaseIndent = null;
    this.lastListItemIdx = null;
    this.lastListLine = null;
  }

  /** Emit the active paragraph (if it has non-blank content) and clear it. */
  flushParagraph(blocks: PositionedBlock[]): void {
    const acc = this.paragraph;
    this.paragraph = null;
    if (acc !== null && trim(acc.raw) !== "") {
      const items = acc.item_indices;
      acc.item_indices = [];
      blocks.push(sourcedBlock(paragraphFromAccum(acc), acc.bbox, items));
    }
  }

  /** Emit the active code run (if non-empty) and clear it. */
  flushCode(blocks: PositionedBlock[]): void {
    const run = this.code;
    this.code = null;
    if (run === null || run.lines.length === 0) return;
    const { lines, bbox, items } = run;
    const lang = detectCodeLanguage(lines);
    // Monospace body text (typewriter / Courier documents, forms, catalogues) is not code: emit it as
    // paragraphs, breaking where a line ends a sentence and the next starts a new one. Fencing it kept
    // every hard line break and a guessed language tag.
    if (lang === null && monoRunReadsAsProse(lines)) {
      let para: string[] = [];
      const flush = (): void => {
        if (para.length === 0) return;
        const text = escapeInline(para.join(" "));
        blocks.push(positionedBlock({ Paragraph: { text, bold: false, italic: false } }, bbox));
        para = [];
      };
      for (const l of lines.map(trim)) {
        if (l === "") {
          flush();
          continue;
        }
        const first = chars(l)[0];
        const startsNew =
          first !== undefined &&
          (isUppercase(first) || ASCII_DIGIT.test(first) || "•-*".includes(first));
        const last = para.length > 0 ? para[para.length - 1] : null;
        if (startsNew && last !== null && SENTENCE_PUNCT.some((c) => last.endsWith(c))) flush();
        para.push(l);
      }
      flush();
      return;
    }
    blocks.push(sourcedBlock({ CodeBlock: { lines, lang } }, bbox, items));
  }

  /**
   * Emit any interruptions whose y is at or above `beforeY`, flushing the
   * active paragraph/code/list state first so each lands as its own block.
   */
  emitBefore(blocks: PositionedBlock[], queue: InterruptionQueue, beforeY: number): void {
    for (let y = queue.peekY(); y !== null && !(y > beforeY); y = queue.peekY()) {
      const kind = queue.next();
      this.flushParagraph(blocks);
      this.flushCode(blocks);
      this.resetList();
      blocks.push(positionedInterruption(kind));
    }
  }

  /** `code.get_or_insert_with(Default::default)` followed by the push of one mono line. */
  pushCodeLine(line: string, bbox: Rect, items: readonly number[]): void {
    const run = this.code ?? { lines: [], bbox: null, items: [] };
    this.code = run;
    run.lines.push(line);
    run.bbox = rectExtend(run.bbox ?? undefined, bbox);
    run.items.push(...items);
  }
}
