// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The #[cfg(test)] tests of liteparse markdown_layout/tables.rs that run a borderless
// table through the page classifier and the markdown renderer.

import { describe, expect, test } from "bun:test";

import { classifyPageWithFilters } from "../../src/ocria/markdown-layout/classify/classify-page.js";
import { renderBlocks } from "../../src/ocria/markdown-layout/render/index.js";
import { tryDetectTable } from "../../src/ocria/markdown-layout/tables/borderless/index.js";
import { lineWithSpans, page } from "../../src/ocria/markdown-layout/test-helpers.js";
import { row3 } from "./markdown-layout-borderless-helpers.test.js";

describe("borderless tables through the classifier", () => {
  test("cells_trimmed_from_a_rejected_row_are_not_handed_back", () => {
    // The third line's extra cell is trimmed as bleed, then the row fails
    // track alignment and ends the run. The line stays outside the run, so the
    // classifier emits it once; the trimmed cell must not come back too.
    const lines = [
      lineWithSpans(
        [
          ["Medication description", 50],
          ["Route", 200],
          ["Dose", 350],
        ],
        100,
        10
      ),
      row3("Aspirin", "Oral", "81mg", 112),
      lineWithSpans(
        [
          ["take", 50],
          ["daily", 120],
          ["oral", 200],
          ["Fax 555-0199", 450],
        ],
        124,
        10
      ),
    ];
    const run = tryDetectTable(lines, 0, 0);
    if (run === null) throw new Error("table");
    expect(run.end).toBe(2);
    expect(run.interstitials).toEqual([]);
    const md = renderBlocks(
      classifyPageWithFilters(page(lines), [], new Set(), [], "placeholder", new Set())
    );
    expect(md.split("Fax 555-0199").length - 1).toBe(1);
  });

  test("interstitials_are_escaped_like_paragraphs", () => {
    // A stepped-over line comes back as a paragraph; its literal asterisks
    // must not turn into emphasis.
    const lines = [
      row3("Name", "Phone", "Notes", 100),
      row3("Ann", "555-0100", "none", 112),
      lineWithSpans([["Dose *as written*", 450]], 118, 10),
      row3("Bob", "555-0101", "none", 124),
    ];
    const md = renderBlocks(
      classifyPageWithFilters(page(lines), [], new Set(), [], "placeholder", new Set())
    );
    expect(md).toContain("Dose \\*as written\\*");
  });
});
