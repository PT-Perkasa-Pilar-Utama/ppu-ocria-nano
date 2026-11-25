// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/ocr_merge.rs (crates-v2.21.2, Apache-2.0): OcrMergeState and merge_ocr_results.

import type { Page } from "../types/page.js";
import { LiteParseError } from "./error.js";
import { mergeOcrOutcomes } from "./outcomes.js";
import type { PageOcrOutcome } from "./types.js";

/**
 * Merge OCR results in separate calls, with one final failure check.
 * Stores counters and the first error in merge order. The counters are
 * written by `mergeOcrOutcomes`, the Rust module-private writer.
 */
export class OcrMergeState {
  totalTasks = 0;
  failedTasks = 0;
  failedSparseTextPage = false;
  firstError: string | null = null;

  /**
   * Merge completed results into their pages. Supply each outcome only once.
   * Call `finish` after all outcomes to check the failure policy.
   */
  merge(pages: Page[], outcomes: readonly PageOcrOutcome[], emitWordBoxes: boolean): void {
    mergeOcrOutcomes(pages, outcomes, emitWordBoxes, this);
  }

  /** Apply the failure policy to all outcomes received by this state. */
  finish(ocrFailureFatal: boolean): void {
    // If every OCR task failed *and* at least one of those failures was on a
    // sparse-text page (the same length/coverage predicate that sends pages to
    // OCR as text-poor in `render_pages_for_ocr`), treat it as a systemic
    // failure. Returning an error surfaces the root cause (e.g. missing language
    // data) instead of silently emitting an empty or mostly-empty page. We
    // deliberately do NOT fail when the only failures were on pages that already
    // had substantial native text and were merely rendered for image-based OCR
    // enrichment: a broken OCR setup must not abort an otherwise-good
    // native-text document.
    if (this.totalTasks > 0 && this.failedTasks === this.totalTasks && this.failedSparseTextPage) {
      const detail = this.firstError ?? "unknown error";
      if (ocrFailureFatal) {
        throw new LiteParseError("Ocr", `OCR failed for all ${this.totalTasks} page(s): ${detail}`);
      }
      // Non-fatal mode: the caller prefers partial results over a hard abort,
      // so keep whatever native text was extracted and continue. Surface the
      // root cause as a warning so a broken OCR setup is still visible.
      console.error(
        `[ocr] OCR failed for all ${this.totalTasks} page(s): ${detail} — continuing with partial (native-text) results (ocr_failure_fatal=false)`
      );
    }

    // Surface a concise summary for partial failures without flooding stderr.
    if (this.failedTasks > 0) {
      console.error(
        `[ocr] ${this.failedTasks}/${this.totalTasks} page(s) failed OCR; continuing with partial results`
      );
    }
  }
}

/**
 * Merge recognition outcomes into `pages`, in place. Pure: needs neither the
 * document nor the rasters, only the outcomes the recognizer produced (or an
 * equivalent a caller built from its own OCR engine's output).
 *
 * Per page, unusable native text (garbled fonts, unmappable Type3) is dropped
 * first so OCR can replace it; then each result is filtered against rule
 * artifacts and overlap with surviving native text before being appended as an
 * `OCR`-font text item in viewport points.
 *
 * Outcomes are matched to pages by `page_number`; an outcome for a page not
 * in `pages` throws, so a caller can merge a subset of pages or hand-built
 * outcomes safely.
 *
 * `emitWordBoxes` must match `LiteParseConfig::effective_emit_word_boxes`
 * from extraction. Each surviving result becomes one text item whose word
 * boxes the projection preserves when merging neighbours. When `false`, no
 * word boxes are allocated.
 */
export function mergeOcrResults(
  pages: Page[],
  outcomes: readonly PageOcrOutcome[],
  ocrFailureFatal: boolean,
  emitWordBoxes: boolean
): void {
  const state = new OcrMergeState();
  state.merge(pages, outcomes, emitWordBoxes);
  state.finish(ocrFailureFatal);
}
