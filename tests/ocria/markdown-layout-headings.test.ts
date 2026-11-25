// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// Port of the #[cfg(test)] tests of liteparse markdown_layout/headings.rs (crates-v2.21.2).

import { describe, expect, test } from "bun:test";

import {
  buildHeadingMap,
  computeBodySize,
  headingLevelFor,
  isAttributionLine,
  isCaptionLine,
  isSectionNumberPrefix,
  isTocTitle,
  looksLikeBoldHeading,
  looksLikeNumberedBoldHeading,
  looksLikeTocEntry,
  outlineHeadingLevel,
  pageIsToc,
  parseHeadingRole,
  structHeadingLevel,
  tocEntryArabicNumber,
} from "../../src/ocria/markdown-layout/headings/index.js";
import { line, page } from "../../src/ocria/markdown-layout/test-helpers.js";
import type { ProjectedLine } from "../../src/ocria/types/page.js";
import { textItem } from "../../src/ocria/types/text-item.js";

describe("headings", () => {
  test("toc_entry_arabic_extracts_trailing_page_number", () => {
    expect(tocEntryArabicNumber("Introduction 7")).toBe(7);
    expect(tocEntryArabicNumber("1. A Fountain in the Square 1")).toBe(1);
    expect(tocEntryArabicNumber("6. For the Love of Iran . . . 41")).toBe(41);
  });

  test("toc_entry_arabic_rejects_decimals_and_axis_labels", () => {
    expect(tocEntryArabicNumber("OCR-Recall3 7 94.2")).toBeNull();
    expect(tocEntryArabicNumber("Chapter 7")).toBeNull();
    expect(tocEntryArabicNumber("Section1")).toBeNull();
  });

  test("is_toc_title_matches_common_variants", () => {
    expect(isTocTitle("Contents")).toBe(true);
    expect(isTocTitle("Table of Contents")).toBe(true);
    expect(isTocTitle("table of contents")).toBe(true);
    expect(isTocTitle("Index")).toBe(true);
    expect(isTocTitle("Introduction")).toBe(false);
  });

  test("page_is_toc_requires_monotonic_page_numbers", () => {
    const pagesToc = page([
      line("Table of contents", 50, 30, 18, 18),
      line("Introduction 7", 50, 60, 12, 12),
      line("Part I: New Children 21", 50, 72, 12, 12),
      line("Part II: From Solitary 45", 50, 84, 12, 12),
      line("Part III: Commercial 71", 50, 96, 12, 12),
      line("Conclusion 127", 50, 108, 12, 12),
    ]);
    expect(pageIsToc(pagesToc)).toBe(true);

    const pagesChart = page([
      line("OCR-Recall is 94.2", 50, 60, 9, 9),
      line("Precision rate 89.0", 50, 72, 9, 9),
      line("F1 score 80.4", 50, 84, 9, 9),
    ]);
    expect(pageIsToc(pagesChart)).toBe(false);
  });

  test("body_size_picks_most_common", () => {
    const pages = [
      page([
        line("Title", 50, 50, 18, 18),
        line("body line one", 50, 80, 10, 10),
        line("body line two", 50, 92, 10, 10),
        line("body line three", 50, 104, 10, 10),
      ]),
    ];
    expect(Math.abs(computeBodySize(pages) - 10)).toBeLessThan(0.01);
  });

  test("heading_map_descending_levels", () => {
    const pages = [
      page([
        line("The largest heading on the page", 50, 50, 24, 24),
        line("A smaller heading right below it", 50, 80, 18, 18),
        line("body text line one with plenty of content", 50, 110, 10, 10),
        line("body text line two with plenty of content", 50, 122, 10, 10),
        line("body text line three with even more content", 50, 134, 10, 10),
        line("body text line four with even more content", 50, 146, 10, 10),
      ]),
    ];
    const body = computeBodySize(pages);
    const map = buildHeadingMap(pages, body);
    expect(map.length).toBe(2);
    expect(map[0][1]).toBe(1);
    expect(map[1][1]).toBe(2);
    expect(map[0][0]).toBeGreaterThan(map[1][0]);
  });
});

// Not in the Rust test module: they reach the recognizers, the bold-heading gates and the
// struct-tree and outline heading sources.
function boldLine(text: string, y: number): ProjectedLine {
  const l = line(text, 50, y, 10, 10);
  l.all_bold = true;
  l.spans = [
    textItem({ text, x: 50, y, width: 100, height: 10, font_size: 10, font_name: "Arial-Bold" }),
  ];
  return l;
}

describe("headings (added)", () => {
  test("is_section_number_prefix accepts dotted numbers and rejects words", () => {
    for (const s of ["1", "1.5", "1.5.2", "A.2", "§4", "§", "Sec. 2", "Ch. 3"]) {
      expect(isSectionNumberPrefix(s)).toBe(true);
    }
    for (const s of ["", "1..5", "Intro", "a.1", "AB.1", "Chapter 3"]) {
      expect(isSectionNumberPrefix(s)).toBe(false);
    }
  });

  test("attribution and caption lines", () => {
    expect(isAttributionLine("  source: the survey")).toBe(true);
    expect(isAttributionLine("Sources")).toBe(false);
    expect(isCaptionLine("Figure 7. Results")).toBe(true);
    expect(isCaptionLine("Fig. (4)")).toBe(true);
    expect(isCaptionLine("TABLE IV")).toBe(true);
    expect(isCaptionLine("Table of results")).toBe(false);
    expect(isCaptionLine("Figure")).toBe(false);
    expect(isCaptionLine("Introduction 1")).toBe(false);
  });

  test("roman numeral TOC entries count as TOC-like", () => {
    expect(looksLikeTocEntry("Author's Note ... ix")).toBe(true);
    expect(looksLikeTocEntry("Shor xi")).toBe(false);
    expect(looksLikeTocEntry("Nothing to see here")).toBe(false);
    expect(looksLikeTocEntry("")).toBe(false);
  });

  test("bold body-size headings", () => {
    expect(looksLikeBoldHeading(boldLine("1 Introduction", 50), null, null)).toBe(true);
    expect(looksLikeBoldHeading(boldLine("Model merging.", 50), null, null)).toBe(false);
    expect(looksLikeBoldHeading(boldLine("Figure 3", 50), null, null)).toBe(false);
    expect(looksLikeBoldHeading(boldLine("Source: the survey", 50), null, null)).toBe(false);
    expect(looksLikeBoldHeading(boldLine("lowercase start", 50), null, null)).toBe(false);
    expect(looksLikeBoldHeading(boldLine("47.5 14", 50), null, null)).toBe(false);
    expect(looksLikeBoldHeading(line("Plain text", 50, 50, 10, 10), null, null)).toBe(false);
    expect(looksLikeBoldHeading(boldLine("A  B  C  D", 50), null, null)).toBe(false);
    // run-in label with a long body, but a numbered prefix is exempt
    const runIn = "Base model. Any n-layer transformer architecture is fine here ok";
    expect(looksLikeBoldHeading(boldLine(runIn, 50), null, null)).toBe(false);
    expect(
      looksLikeBoldHeading(
        boldLine("1.5. Migrant Workers in the Cities of Europe and more", 50),
        null,
        null
      )
    ).toBe(true);
  });

  test("bold heading needs a paragraph break above and below", () => {
    const body = line("Some body text that runs on", 50, 62, 10, 10);
    const head = boldLine("Overview", 50);
    expect(looksLikeBoldHeading(head, body, null)).toBe(true);
    const flowing = boldLine("A sentence that flows straight into", 40);
    expect(looksLikeBoldHeading(boldLine("Overview", 52), flowing, null)).toBe(false);
  });

  test("numbered bold headings", () => {
    const l = boldLine("1. Introduction", 50);
    l.spans = [
      textItem({ text: "1.", x: 50, font_name: "Arial", font_size: 10 }),
      textItem({ text: "Introduction", x: 60, font_name: "Arial-Bold", font_size: 10 }),
    ];
    expect(looksLikeNumberedBoldHeading(l, "Introduction", null)).toBe(true);
    expect(looksLikeNumberedBoldHeading(l, "", null)).toBe(false);
    expect(looksLikeNumberedBoldHeading(l, "One. Two.", null)).toBe(false);
    expect(looksLikeNumberedBoldHeading(l, "12 34", null)).toBe(false);
    const plain = line("1. Introduction", 50, 50, 10, 10);
    expect(looksLikeNumberedBoldHeading(plain, "Introduction", null)).toBe(false);
    const mono = boldLine("1. code", 50);
    mono.spans = [textItem({ text: "code", font_name: "Courier-Bold" })];
    expect(looksLikeNumberedBoldHeading(mono, "code", null)).toBe(false);
    const mixed = boldLine("1. Intro text", 50);
    mixed.spans = [
      textItem({ text: "Intro", font_name: "Arial-Bold" }),
      textItem({ text: "text", font_name: "Arial" }),
    ];
    expect(looksLikeNumberedBoldHeading(mixed, "Intro text", null)).toBe(false);
  });

  test("heading_level_for matches within the tolerance", () => {
    const map: Array<[number, number]> = [
      [24, 1],
      [18, 2],
    ];
    expect(headingLevelFor(18.4, map)).toBe(2);
    expect(headingLevelFor(20, map)).toBeNull();
  });

  test("struct heading levels come from H1..H6 roles", () => {
    const l = line("Title", 50, 50, 10, 10);
    l.mcid = 7;
    const nodes = [
      { role: "P", mcids: [7], bbox: null, alt_text: null },
      { role: "H2", mcids: [7], bbox: null, alt_text: null },
    ];
    expect(structHeadingLevel(l, nodes)).toBe(2);
    expect(structHeadingLevel(line("x", 0, 0, 1, 1), nodes)).toBeNull();
    expect(parseHeadingRole("H7")).toBeNull();
    expect(parseHeadingRole("H")).toBeNull();
    expect(parseHeadingRole(" h3 ")).toBe(3);
    expect(parseHeadingRole("Figure")).toBeNull();
  });

  test("outline entries match by title prefix near the line", () => {
    const l = line("Nutrition basics", 50, 100, 12, 12);
    const outline = [{ level: 9, title: "Nutrition", page_index: 0, y_pdf: 792 - 100 }];
    expect(outlineHeadingLevel(l, 792, outline, l.text)).toBe(6);
    expect(outlineHeadingLevel(l, 792, [], l.text)).toBeNull();
    expect(outlineHeadingLevel(l, 792, outline, "   ")).toBeNull();
    const far = [{ level: 1, title: "Nutrition", page_index: 0, y_pdf: 100 }];
    expect(outlineHeadingLevel(l, 792, far, l.text)).toBeNull();
    const offPage = [{ level: 2, title: "Nutrition", page_index: 0, y_pdf: 5000 }];
    expect(outlineHeadingLevel(l, 792, offPage, l.text)).toBe(2);
    const noY = [{ level: 3, title: "Nutrition", page_index: 0, y_pdf: null }];
    expect(outlineHeadingLevel(l, 792, noY, l.text)).toBe(3);
    const prose = "Nutrition is key. It matters. Always.";
    expect(outlineHeadingLevel(l, 792, noY, prose)).toBeNull();
    const runIn = "Nutrition. A long body sentence follows the label here";
    expect(outlineHeadingLevel(l, 792, noY, runIn)).toBeNull();
    expect(
      outlineHeadingLevel(l, 792, [{ level: 1, title: "  ", page_index: 0, y_pdf: null }], l.text)
    ).toBeNull();
  });

  test("repeated large labels do not make heading levels and rotated or figure lines are skipped", () => {
    const labels = [1, 2, 3].map((i) => line("Input-Input Layer5", 50, 10 * i, 30, 30));
    const fig = line("Figure heading text here", 50, 100, 20, 20);
    fig.in_figure = true;
    const body = line("body text line one with plenty of content", 50, 130, 10, 10);
    const p = page([...labels, fig, body]);
    expect(buildHeadingMap([p], 10)).toEqual([]);
    expect(computeBodySize([page([])])).toBe(0);
  });
});
