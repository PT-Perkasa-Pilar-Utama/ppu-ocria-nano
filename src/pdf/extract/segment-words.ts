// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/extract.rs (crates-v2.21.2, Apache-2.0): SegmentBuilder::add_word_char and break_word.

import { f32, trim } from "../../ocria/rust.js";
import type { WordBox } from "../../ocria/types/text-item.js";
import type { RectF } from "../pdfium/types.js";

const F32_MAX = 3.4028234663852886e38;

/** The per-word sub-box state of a `SegmentBuilder`. */
export class WordTracker {
  // Per-word sub-boxes, finalized at each inter-word space break; the open word accumulates in `word*`.
  words: WordBox[] = [];
  curWord: string = "";
  wordLeft: number = F32_MAX;
  wordRight: number = -F32_MAX;
  wordTop: number = F32_MAX;
  wordBottom: number = -F32_MAX;
  wordHas: boolean = false;

  constructor(readonly emitWords: boolean) {}

  /** Extend the open word with a character's loose box, opening a fresh word if none is active. */
  addWordChar(c: string, vpLoose: RectF): void {
    if (!this.emitWords) return;
    if (this.wordHas) {
      this.wordLeft = Math.min(this.wordLeft, vpLoose.left);
      this.wordRight = Math.max(this.wordRight, vpLoose.right);
      this.wordTop = Math.min(this.wordTop, vpLoose.top);
      this.wordBottom = Math.max(this.wordBottom, vpLoose.bottom);
    } else {
      this.curWord = "";
      this.wordLeft = vpLoose.left;
      this.wordRight = vpLoose.right;
      this.wordTop = vpLoose.top;
      this.wordBottom = vpLoose.bottom;
      this.wordHas = true;
    }
    this.curWord += c;
  }

  /** Finalize the open word into `words`; called at each inter-word space and at flush. */
  breakWord(): void {
    if (!this.wordHas) return;
    const trimmed = trim(this.curWord);
    if (trimmed !== "") {
      this.words.push({
        text: trimmed,
        x: this.wordLeft,
        y: this.wordTop,
        width: f32(this.wordRight - this.wordLeft),
        height: f32(this.wordBottom - this.wordTop),
      });
    }
    this.curWord = "";
    this.wordHas = false;
  }
}
