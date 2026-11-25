// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The #[cfg(test)] tests of liteparse markdown_layout/paragraphs.rs (crates-v2.21.2), ported.

import { describe, expect, test } from "bun:test";

import {
  appendToParagraph,
  collapseWhitespace,
  continuesHeading,
  continuesHyphenWrap,
  continuesListItem,
  continuesParagraph,
  dehyphenateJoin,
  endsHyphenated,
  endsOpenHyphen,
  endsSentenceFinal,
  isSoftHyphenBreak,
} from "../../src/ocria/markdown-layout/paragraphs/index.js";
import type { ParaAccum } from "../../src/ocria/markdown-layout/paragraphs/index.js";
import { line, styledLine } from "../../src/ocria/markdown-layout/test-helpers.js";

describe("paragraphs", () => {
  test("dehyphenate_join_keeps_hard_hyphen_without_space", () => {
    expect(
      dehyphenateJoin("2-Chloro-5-ethyl-6-methylpyridine-3-", "carbonitrile 4a", "carbonitrile 4a")
    ).toBe("2-Chloro-5-ethyl-6-methylpyridine-3-carbonitrile 4a");
    expect(dehyphenateJoin("a well-", "Known case", "Known case")).toBe("a well-Known case");
    expect(dehyphenateJoin("ranges 5 -", "10", "10")).toBe("ranges 5 - 10");
  });

  test("dehyphenate_join_only_strips_before_lowercase", () => {
    expect(dehyphenateJoin("co-", "operate", "operate")).toBe("cooperate");
    // a capitalized continuation is a real compound: the hyphen stays, with no space
    expect(dehyphenateJoin("Vitamin-", "A", "A")).toBe("Vitamin-A");
  });
});

// Behavior the Rust file's own tests do not reach; the expected values follow the Rust source.
describe("paragraphs: continuation rules", () => {
  test("text helpers", () => {
    expect(collapseWhitespace("  for \t instance \u00a0 x  ")).toBe("for instance x");
    expect(endsHyphenated("architec-")).toBe(true);
    expect(endsHyphenated("café- ")).toBe(true);
    expect(endsHyphenated("5-")).toBe(false);
    expect(endsOpenHyphen("5-")).toBe(true);
    expect(endsOpenHyphen("a -")).toBe(false);
    expect(endsSentenceFinal('He said "stop."')).toBe(true);
    expect(endsSentenceFinal("and so on")).toBe(false);
    expect(isSoftHyphenBreak("architec-", "ture")).toBe(true);
    expect(isSoftHyphenBreak("well-", "Known")).toBe(false);
  });

  test("a close line below continues the paragraph and a big gap does not", () => {
    expect(
      continuesParagraph(line("first line", 50, 100, 10, 10), line("second", 50, 112, 10, 10))
    ).toBe(true);
    expect(
      continuesParagraph(line("first line", 50, 100, 10, 10), line("second", 50, 140, 10, 10))
    ).toBe(false);
  });

  test("a right shift is a new paragraph unless the list item allows a hanging indent", () => {
    const prev = line("item text", 50, 100, 10, 10);
    const cur = line("wrapped under the text", 70, 112, 10, 10);
    expect(continuesParagraph(prev, cur)).toBe(false);
    expect(continuesListItem(prev, cur)).toBe(true);
  });

  test("a size jump breaks the paragraph unless the sentence clearly runs on", () => {
    expect(
      continuesParagraph(line("Body text.", 50, 100, 10, 10), line("Title", 50, 112, 10, 14))
    ).toBe(false);
    expect(
      continuesParagraph(
        line("runs on and", 50, 100, 10, 10),
        line("continues here", 50, 112, 10, 12.5)
      )
    ).toBe(true);
  });

  test("a region change continues only mid-sentence into lowercase", () => {
    const a = line("runs on and", 50, 100, 10, 10);
    const b = line("continues", 300, 100, 10, 10);
    b.region_path = [1];
    expect(continuesParagraph(a, b)).toBe(true);
    const c = line("Starts new.", 300, 100, 10, 10);
    c.region_path = [1];
    expect(continuesParagraph(a, c)).toBe(false);
  });

  test("a size jump past the tolerance breaks the heading rule", () => {
    expect(
      continuesHeading(line("Wrapped heading", 50, 100, 10, 10), line("Big", 50, 112, 10, 14))
    ).toBe(false);
    const centered = line("Centered", 50, 112, 10, 10);
    centered.anchor = "Center";
    expect(continuesHeading(line("Left", 50, 100, 10, 10), centered)).toBe(false);
  });

  test("a bold line over a plain line breaks the paragraph and the heading rule", () => {
    const bold = styledLine([["Heading", 50, "Arial-Bold"]], 100, 10);
    const plain = styledLine([["body", 50, "Arial"]], 112, 10);
    expect(continuesParagraph(bold, plain)).toBe(false);
    expect(continuesHeading(bold, plain)).toBe(false);
    expect(
      continuesHeading(
        line("Wrapped heading", 50, 100, 10, 10),
        line("second half", 90, 112, 10, 10)
      )
    ).toBe(true);
  });

  test("a hyphen-wrapped token joins across a gap", () => {
    const prev = line("pyridine-3-", 50, 100, 10, 10);
    expect(continuesHyphenWrap(prev, line("carbonitrile", 50, 125, 10, 10))).toBe(true);
    expect(continuesHyphenWrap(prev, line("Carbonitrile", 50, 125, 10, 10))).toBe(false);
    expect(continuesHyphenWrap(prev, line("carbonitrile", 50, 200, 10, 10))).toBe(false);
  });

  test("appendToParagraph keeps raw and inline text and the uniform flag", () => {
    const first = styledLine([["An architec-", 50, "Arial"]], 100, 10);
    const accum: ParaAccum = {
      raw: "",
      inline: "",
      last: first,
      uniform: null,
      bbox: null,
      item_indices: [],
    };
    appendToParagraph(accum, first);
    appendToParagraph(accum, line("   ", 50, 112, 10, 10));
    appendToParagraph(accum, styledLine([["ture note", 50, "Arial"]], 112, 10));
    expect(accum.raw).toBe("An architecture note");
    expect(accum.inline).toBe("An architecture note");
    expect(accum.bbox).toEqual({ x: 50, y: 100, width: 60, height: 22 });
    expect(accum.item_indices).toEqual([0, 0]);
    expect(accum.uniform).toEqual([false, false]);
    appendToParagraph(accum, styledLine([["Bold", 50, "Arial-Bold"]], 124, 10));
    expect(accum.uniform).toBeNull();
  });
});
