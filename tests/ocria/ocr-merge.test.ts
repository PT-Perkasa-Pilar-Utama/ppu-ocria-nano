// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The OCR merge against LiteParse's own values: each golden's recorded
// `merge.input` is fed to `mergeOcrResults` and the pages must equal the
// recorded `merge.pages`.

import { describe, expect, test } from "bun:test";

import { mergeOcrResults, pageOcrOutcomeFromJson } from "../../src/ocria/ocr-merge/index.js";
import type { PageOcrOutcome } from "../../src/ocria/ocr-merge/index.js";
import type { Page } from "../../src/ocria/types/page.js";
import { canon, loadParseGolden, pageFromJson, parseGoldenNames, stage } from "./parse-golden.js";

type MergeInput = {
  pages: unknown[];
  outcomes: unknown[];
  ocr_failure_fatal: boolean;
  emit_word_boxes: boolean;
};

describe.each(parseGoldenNames())("%s", (name) => {
  test("merge.input to merge.pages", () => {
    const g = loadParseGolden(name);
    // SAFETY: the recorder writes merge.input as {pages, outcomes, ocr_failure_fatal, emit_word_boxes}.
    const input = stage(g, "merge.input") as unknown as MergeInput;
    const pages: Page[] = input.pages.map(pageFromJson);
    const outcomes: PageOcrOutcome[] = input.outcomes.map(pageOcrOutcomeFromJson);
    mergeOcrResults(pages, outcomes, input.ocr_failure_fatal, input.emit_word_boxes);
    expect(canon(pages)).toEqual(canon(stage(g, "merge.pages")));
  });
});
