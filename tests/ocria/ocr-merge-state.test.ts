// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of the merge-state and failure-policy tests in liteparse crates/liteparse/src/ocr_merge.rs (crates-v2.21.2, Apache-2.0).

// The Rust failure-policy tests run a failing engine through the task pool.
// Here the outcome the pool yields for a failing engine (no results, the
// error, dpi 72, as the Rust `make_rendered` sets it) is built by hand.

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { LiteParseError, mergeOcrResults, OcrMergeState } from "../../src/ocria/ocr-merge/index.js";
import { textItem } from "../../src/ocria/types/text-item.js";
import { canon } from "./parse-golden.js";
import {
  failedOutcome,
  makeBlankPage,
  makeLowCoveragePage,
  makeNativeTextPage,
  mergeOutcome,
} from "./ocr-merge-builders.test.js";

const HEALTHY = [
  "This fictional report is a public parser-routing fixture.",
  "The upper section uses a standard font and extracts normally.",
  "All names, identifiers, quantities, and dates are fabricated.",
  "A PDF viewer still renders both sections as readable text.",
];

/** Caesar-shifted table text (issue #413): the vowel ratio of its font group is far below natural. */
const GARBLED_ROWS = [
  "Tepx Nzop Opdnctaetzy Bflyetej Cpgtph Olep",
  "KI-334 Cpawlnpxpye Qtwepc Lddpxmwj 44 5359-30-34",
  "KI-335 Azcelmwp Dpydzc Wzfdtyr 45 5359-30-35",
  "KI-336 Nlwtmcletzy Mclnvpe 46 5359-30-36",
];

let errorSpy: ReturnType<typeof spyOn<Console, "error">>;

// merge and finish log their warnings to stderr, as Rust's eprintln does.
beforeEach(() => {
  errorSpy = spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

function thrown(fn: () => void): Error {
  try {
    fn();
  } catch (err) {
    if (err instanceof Error) return err;
  }
  throw new Error("expected the call to throw");
}

describe("incremental merge", () => {
  test("matches the batch merge and updates pages at once", () => {
    const incremental = [makeNativeTextPage(1), makeBlankPage(2)];
    const batch = structuredClone(incremental);
    const outcomes = [mergeOutcome(2), mergeOutcome(1)];
    mergeOcrResults(batch, outcomes, true, true);

    const state = new OcrMergeState();
    state.merge(incremental.slice(1), [outcomes[0]], true);
    expect(incremental[0].text_items).toHaveLength(1);
    expect(incremental[1].text_items[0].text).toBe("page 2");
    expect(incremental[1].text_items[0].y).toBe(60);
    expect(incremental[1].text_items[0].words).toHaveLength(1);
    state.merge(incremental.slice(0, 1), [outcomes[1]], true);
    state.finish(true);
    expect(canon(incremental)).toEqual(canon(batch));
  });

  test("the error cause matches the batch merge order", () => {
    for (const order of [
      [1, 2],
      [2, 1],
    ]) {
      for (const incremental of [true, false]) {
        const pages = [makeBlankPage(1), makeBlankPage(2)];
        const outcomes = order.map((page) =>
          mergeOutcome(page, page === 1 ? "first page failure" : "second page failure")
        );
        const run = (): void => {
          if (incremental) {
            const state = new OcrMergeState();
            for (const outcome of outcomes) state.merge(pages, [outcome], false);
            state.finish(true);
          } else {
            mergeOcrResults(pages, outcomes, true, false);
          }
        };
        const err = thrown(run);
        expect(err).toBeInstanceOf(LiteParseError);
        expect(err.message).toBe(
          `OCR failed: OCR failed for all 2 page(s): ${order[0] === 1 ? "first" : "second"} page failure`
        );
      }
    }
  });

  test("keeps the document failure policy", () => {
    for (const errors of [
      [true, true],
      [true, false],
      [false, true],
      [false, false],
    ]) {
      for (const fatal of [true, false]) {
        const pages = [makeBlankPage(1), makeBlankPage(2)];
        const state = new OcrMergeState();
        errors.forEach((failed, index) => {
          state.merge(
            pages.slice(index, index + 1),
            [mergeOutcome(index + 1, failed ? "test OCR failure" : undefined)],
            false
          );
        });
        const shouldFail = fatal && errors.every((failed) => failed);
        if (shouldFail) {
          expect(thrown(() => state.finish(fatal)).message).toContain(
            "OCR failed for all 2 page(s): test OCR failure"
          );
        } else {
          state.finish(fatal);
        }
      }
    }
  });

  test("an empty success is not a failure", () => {
    const pages = [makeBlankPage(1), makeBlankPage(2)];
    const state = new OcrMergeState();
    state.merge(pages.slice(0, 1), [mergeOutcome(1, "failed")], false);
    const empty = mergeOutcome(2);
    empty.results = [];
    state.merge(pages.slice(1), [empty], false);
    state.finish(true);
    new OcrMergeState().finish(true);
  });

  test("an outcome without results key (serde omits empty) is a no-op success", () => {
    const pages = [makeBlankPage(1)];
    const outcome = mergeOutcome(1);
    delete outcome.results;
    mergeOcrResults(pages, [outcome], true, true);
    expect(pages[0].text_items).toHaveLength(0);
  });

  test("preserves native text on failure", () => {
    const pages = [makeNativeTextPage(1)];
    const before = structuredClone(pages);
    const state = new OcrMergeState();
    state.merge(pages, [mergeOutcome(1, "failed")], false);
    state.finish(true);
    expect(canon(pages)).toEqual(canon(before));
  });

  test("rejects an unknown page", () => {
    const state = new OcrMergeState();
    const err = thrown(() => state.merge([makeBlankPage(1)], [mergeOutcome(2)], false));
    expect(err).toBeInstanceOf(LiteParseError);
    expect(err.message).toContain("no matching page");
    expect(err.message).toBe(
      "OCR outcome for page 2 has no matching page among the 1 page(s) being merged"
    );
  });
});

// With the failing engine, every outcome carries the error and no results.
describe("failure policy", () => {
  const traineddata = "Error opening data file tessdata/eng.traineddata";

  // When every OCR task fails (e.g. missing language data), the merge must throw
  // instead of silently reporting success with no OCR text.
  test("all pages fail returns an error", () => {
    const pages = [makeBlankPage(1), makeBlankPage(2)];
    const outcomes = [failedOutcome(1, traineddata), failedOutcome(2, traineddata)];
    const err = thrown(() => mergeOcrResults(pages, outcomes, true, false));
    expect(err.message).toContain("OCR failed for all 2 page(s)");
    expect(err.message).toContain("traineddata");
  });

  // With no rendered pages there is nothing to OCR; this must stay a no-op success.
  test("no rendered pages is ok", () => {
    mergeOcrResults([makeBlankPage(1)], [], true, false);
  });

  // When OCR fails but every failing page already had native text (it was only rendered
  // for image-based enrichment), a broken OCR setup must not abort the parse.
  test("native text pages do not fail on an OCR error", () => {
    const pages = [makeNativeTextPage(1), makeNativeTextPage(2)];
    const outcomes = [failedOutcome(1, traineddata), failedOutcome(2, traineddata)];
    mergeOcrResults(pages, outcomes, true, false);
    expect(pages[0].text_items).toHaveLength(1);
    expect(pages[1].text_items).toHaveLength(1);
  });

  // The sparse-text page lost its likely primary text source, so we still fail loud.
  test("a mixed failure with a sparse-text page returns an error", () => {
    const pages = [makeNativeTextPage(1), makeBlankPage(2)];
    const outcomes = [failedOutcome(1, traineddata), failedOutcome(2, traineddata)];
    const err = thrown(() => mergeOcrResults(pages, outcomes, true, false));
    expect(err.message).toContain("OCR failed for all 2 page(s)");
  });

  // Low-coverage pages are rendered for OCR even when their native text is over 20 bytes.
  test("a low-coverage text page failure returns an error", () => {
    const pages = [makeLowCoveragePage(1)];
    const err = thrown(() => mergeOcrResults(pages, [failedOutcome(1, traineddata)], true, false));
    expect(err.message).toContain("OCR failed for all 1 page(s)");
  });

  // With ocr_failure_fatal = false a systemic failure returns normally and keeps native text.
  test("a non-fatal systemic failure returns partial results", () => {
    const pages = [makeNativeTextPage(1), makeBlankPage(2)];
    const outcomes = [failedOutcome(1, traineddata), failedOutcome(2, traineddata)];
    mergeOcrResults(pages, outcomes, false, false);
    expect(pages[0].text_items).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("continuing with partial (native-text) results")
    );
  });

  test("the first failure and the partial-failure summary go to stderr", () => {
    const pages = [makeNativeTextPage(1)];
    mergeOcrResults(pages, [failedOutcome(1, "boom")], true, false);
    expect(errorSpy).toHaveBeenCalledWith("[ocr] failed for page 1: boom");
    expect(errorSpy).toHaveBeenCalledWith(
      "[ocr] 1/1 page(s) failed OCR; continuing with partial results"
    );
  });
});

// The merge keeps a page's native text when a result overlaps it, and drops garbled native text.
describe("native text", () => {
  test("an OCR line over native text is dropped", () => {
    const page = makeNativeTextPage(1);
    const outcome = mergeOutcome(1);
    outcome.dpi = 72;
    mergeOcrResults([page], [outcome], false, false);
    // result box (10,120)-(60,140) does not touch the native item at (0,0,50,50)
    expect(page.text_items.map((i) => i.text)).toEqual([
      "this page already has real native text content",
      "page 1",
    ]);
    const over = mergeOutcome(1);
    over.dpi = 72;
    over.results = [{ ...(over.results ?? [])[0], bbox: [10, 10, 40, 20] }];
    const page2 = makeNativeTextPage(1);
    mergeOcrResults([page2], [over], false, false);
    expect(page2.text_items).toHaveLength(1);
  });

  test("garbled native text is replaced by OCR", () => {
    const page = makeBlankPage(1);
    page.text_items = GARBLED_ROWS.map((text, i) =>
      textItem({ text, font_name: "Bad", x: 10, y: 10 + i * 20, width: 60, height: 10 })
    );
    const outcome = mergeOutcome(1);
    outcome.dpi = 72;
    outcome.results = [
      { ...(outcome.results ?? [])[0], text: "Real text here", bbox: [10, 10, 70, 20] },
    ];
    mergeOcrResults([page], [outcome], false, false);
    expect(page.text_items.map((i) => i.text)).toEqual(["Real text here"]);
  });

  test("on a partial page, a native glyph inside an OCR line gives way to it", () => {
    // One font is garbled and dropped; a lone kept glyph in another font sits inside the OCR line.
    const page = makeBlankPage(1);
    page.page_width = 600;
    page.page_height = 800;
    page.text_items = [
      ...HEALTHY.map((text, i) =>
        textItem({ text, font_name: "Helvetica", x: 0, y: 200 + i * 20, width: 400, height: 10 })
      ),
      ...GARBLED_ROWS.map((text, i) =>
        textItem({ text, font_name: "Bad", x: 0, y: 300 + i * 20, width: 400, height: 10 })
      ),
      textItem({ text: "\u2022", font_name: "Bullets", x: 10, y: 50, width: 4, height: 10 }),
    ];
    const outcome = mergeOutcome(1);
    outcome.dpi = 72;
    outcome.has_native_text = true;
    outcome.results = [
      { ...(outcome.results ?? [])[0], text: "Recovered line", bbox: [0, 50, 200, 60] },
    ];
    mergeOcrResults([page], [outcome], false, false);
    expect(page.text_items.map((i) => i.text)).toEqual([...HEALTHY, "Recovered line"]);
  });
});
