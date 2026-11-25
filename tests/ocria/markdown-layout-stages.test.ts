// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// Port of the `#[cfg(test)]` tests of liteparse crates/liteparse/src/stages.rs
// (crates-v2.21.2) that exercise `document_signals`, `extract_blocks` and
// `dedupe_rules`.

import { describe, expect, test } from "bun:test";

import type { PositionedBlock } from "../../src/ocria/markdown-layout/block-types.js";
import { spanCell } from "../../src/ocria/markdown-layout/block-types.js";
import { line, page } from "../../src/ocria/markdown-layout/test-helpers.js";
import { unlocatedBlock } from "../../src/ocria/markdown-layout/blocks/positioned.js";
import { documentSignals } from "../../src/ocria/stages/document-signals.js";
import { dedupeRules, extractBlocks } from "../../src/ocria/stages/extract-blocks.js";
import type { BlockOptions } from "../../src/ocria/stages/extract-blocks.js";

const OPTIONS: BlockOptions = {
  outline: [],
  image_mode: "placeholder",
  keep_headers_footers: false,
};

function paragraph(text: string): PositionedBlock {
  return unlocatedBlock({ Paragraph: { text, bold: false, italic: false } });
}

describe("stages", () => {
  test("document_signals of no pages is the default", () => {
    const s = documentSignals([], false);
    expect(s.body_size).toBe(0);
    expect(s.heading_map).toEqual([]);
    expect(s.header_footer.size).toBe(0);
  });

  test("dedupe_rules_drops_edges_and_collapses_runs", () => {
    const rule = (): PositionedBlock => unlocatedBlock("HorizontalRule");
    const blocks = [rule(), paragraph("a"), rule(), rule(), paragraph("b"), rule()];
    blocks[3].text_item_indices = [4, 7];
    dedupeRules(blocks);
    const kinds = blocks.map((b) => b.block === "HorizontalRule");
    // Leading + trailing rules gone; the doubled interior run collapsed to one.
    expect(kinds).toEqual([false, true, false]);
    // The survivor keeps the dropped rule's items.
    expect(blocks[1].text_item_indices).toEqual([4, 7]);
  });

  test("a page without projected lines has no blocks", () => {
    const p = page([]);
    expect(extractBlocks(p, documentSignals([p], false), OPTIONS)).toBeNull();
  });

  test("heading_and_paragraph", () => {
    const p = page([
      line("My Title For This Test Document", 50, 50, 18, 18),
      // Enough body text to dominate the char-weighted body-size mode so the
      // title at 18pt registers as larger-than-body.
      line("First sentence of body prose here.", 50, 80, 10, 10),
      line("Second sentence of body prose here.", 50, 92, 10, 10),
      line("Third sentence of body prose here.", 50, 104, 10, 10),
    ]);
    const blocks = extractBlocks(p, documentSignals([p], false), OPTIONS);
    expect(blocks?.[0].block).toEqual({
      Heading: { level: 1, text: "My Title For This Test Document" },
    });
    expect(JSON.stringify(blocks?.[1].block)).toContain("First sentence of body prose here.");
  });

  test("zero_span_is_coerced_to_one", () => {
    // `rowspan="0"` means "to the end of the section" in HTML, never what a
    // producer means here, so it must not survive into the output.
    const c = spanCell("x", 0, 0);
    expect([c.colspan, c.rowspan]).toEqual([1, 1]);
  });
});
