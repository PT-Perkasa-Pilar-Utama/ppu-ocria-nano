// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// Port of the #[cfg(test)] tests of liteparse markdown_layout/repetition.rs (crates-v2.21.2).

import { describe, expect, test } from "bun:test";

import {
  computeHeaderFooterSet,
  detectSinglePageChrome,
  hasDigitRange,
  isHeaderOrFooter,
  matchesChromePattern,
  modelFurnitureLines,
  normalizeForRepetition,
} from "../../src/ocria/markdown-layout/repetition/index.js";
import { headerFooterPage, line, page } from "../../src/ocria/markdown-layout/test-helpers.js";
import type { ParsedPage, ProjectedLine } from "../../src/ocria/types/page.js";

describe("repetition", () => {
  test("normalize_collapses_digits_and_case", () => {
    expect(normalizeForRepetition("Page 1 of 6")).toBe("page # of #");
    expect(normalizeForRepetition("PAGE 12 OF 6")).toBe("page # of #");
    expect(normalizeForRepetition("Confidential")).toBe("confidential");
  });

  test("detects_repeating_header_and_footer", () => {
    const pages = [
      headerFooterPage(1, "Acme Confidential", "Page 1 of 3", "Body one."),
      headerFooterPage(2, "Acme Confidential", "Page 2 of 3", "Body two."),
      headerFooterPage(3, "Acme Confidential", "Page 3 of 3", "Body three."),
    ];
    const set = computeHeaderFooterSet(pages);
    expect(set.has("h:acme confidential")).toBe(true);
    expect(set.has("f:page # of #")).toBe(true);
  });

  test("footer_repetition_does_not_remove_a_top_band_axis_label", () => {
    const pages = [1, 2, 3].map((n) => headerFooterPage(n, "", String(n), "Body text."));
    const axis = line("20", 350, 10, 5, 36);
    axis.in_figure = true;
    pages[2].projected_lines.push(axis);
    const set = computeHeaderFooterSet(pages);
    expect(set.has("f:#")).toBe(true);
    expect(isHeaderOrFooter(pages[2].projected_lines.at(-1) as ProjectedLine, pages[2], set)).toBe(
      false
    );
    expect(isHeaderOrFooter(pages[2].projected_lines[2], pages[2], set)).toBe(true);
  });

  test("repeating_headers_inside_graphic_bounds_are_still_removed", () => {
    const pages = [1, 2, 3].map((n) => headerFooterPage(n, "Quarterly summary", "", "Body text."));
    for (const p of pages) p.projected_lines[0].in_figure = true;
    const set = computeHeaderFooterSet(pages);
    expect(isHeaderOrFooter(pages[0].projected_lines[0], pages[0], set)).toBe(true);
  });

  test("skips_repetition_check_on_single_page", () => {
    const set = computeHeaderFooterSet([headerFooterPage(1, "Solo", "footer", "body")]);
    expect(set.size).toBe(0);
  });

  test("body_text_not_classified_as_header", () => {
    const pages: ParsedPage[] = [];
    for (let n = 1; n <= 3; n++) {
      const p = headerFooterPage(n, "unique header", "unique footer", "shared body text");
      p.projected_lines[0].text = `unique header ${n}`;
      p.projected_lines[2].text = `unique footer ${n}`;
      pages.push(p);
    }
    expect(computeHeaderFooterSet(pages).has("h:shared body text")).toBe(false);
  });

  /** A page (height 792, header band at most 95 pt) whose header band holds `headerLines`. */
  function letterheadPage(n: number, headerLines: string[]): ParsedPage {
    const lines = headerLines.map((t, i) => line(t, 50, 10 + i * 12, 10, 10));
    lines.push(line(`Body text ${n}`, 50, 300, 10, 10));
    const p = page(lines);
    p.page_number = n;
    return p;
  }

  test("letterhead_block_is_kept_not_stripped", () => {
    const head = [
      "ACME SUPPLY CO",
      "Invoice No ACME-00042",
      "Invoice Date 2026-07-21",
      "Terms Net 30",
      "Please Pay From Invoice And Remit To:",
    ];
    const set = computeHeaderFooterSet([letterheadPage(1, head), letterheadPage(2, head)]);
    expect([...set]).toEqual([]);
  });

  test("page_number_still_stripped_inside_letterhead", () => {
    const head = [
      "ACME SUPPLY CO",
      "Invoice No ACME-00042",
      "Invoice Date 2026-07-21",
      "Terms Net 30",
      "Page 1 of 2",
    ];
    const set = computeHeaderFooterSet([letterheadPage(1, head), letterheadPage(2, head)]);
    expect(set.has("h:page # of #")).toBe(true);
    expect(set.has("h:acme supply co")).toBe(false);
    expect(set.has("h:terms net #")).toBe(false);
  });

  test("small_repeated_header_at_cap_still_strips", () => {
    const head = ["Acme Corp", "Quarterly Report", "Confidential"];
    const set = computeHeaderFooterSet([letterheadPage(1, head), letterheadPage(2, head)]);
    expect(set.has("h:acme corp")).toBe(true);
    expect(set.has("h:quarterly report")).toBe(true);
    expect(set.has("h:confidential")).toBe(true);
  });

  test("chrome_pattern_recognizes_common_signatures", () => {
    expect(matchesChromePattern("http://example.com/foo")).toBe(true);
    expect(matchesChromePattern("www.nature.com/scientificreports/")).toBe(true);
    expect(matchesChromePattern("Please cite this article in press as: ...")).toBe(true);
    expect(matchesChromePattern("Page 12 of 24")).toBe(true);
    expect(matchesChromePattern("9")).toBe(true);
    expect(matchesChromePattern("© 2023 Acme Corp")).toBe(true);
    expect(matchesChromePattern("Cell Chemical Biology 24, 1–9, November 16, 2017")).toBe(true);
    expect(matchesChromePattern("The quick brown fox jumps over the lazy dog.")).toBe(false);
    expect(matchesChromePattern("Introduction")).toBe(false);
    expect(matchesChromePattern("Acme Annual Report 2023")).toBe(false);
    expect(
      matchesChromePattern(
        "SERFF Tracking #: FBLB-134215544 State Tracking #: Company Tracking #: MS-2024-07"
      )
    ).toBe(false);
    expect(hasDigitRange("Filed 2024-07")).toBe(false);
    expect(hasDigitRange("Generated 2025-01-23")).toBe(false);
    expect(hasDigitRange("Vol 24, 1-9, 2017")).toBe(true);
  });

  test("detects_top_url_chrome_on_single_page", () => {
    const p = page([
      line("www.nature.com/scientificreports/", 50, 20, 10, 10),
      line("Main Body Title", 50, 200, 14, 14),
      line("Body prose line one.", 50, 220, 10, 10),
      line("Body prose line two.", 50, 232, 10, 10),
    ]);
    const strip = detectSinglePageChrome(p, 10);
    expect(strip.has(0)).toBe(true);
    expect(strip.has(1)).toBe(false);
    expect(strip.has(2)).toBe(false);
  });

  test("detects_bottom_journal_citation_chrome", () => {
    const p = page([
      line("Body line.", 50, 300, 10, 10),
      line("More body.", 50, 312, 10, 10),
      line("Cell Chemical Biology 24, 1–9, November 16, 2017", 50, 770, 10, 10),
    ]);
    const strip = detectSinglePageChrome(p, 10);
    expect(strip.has(2)).toBe(true);
    expect(strip.has(0)).toBe(false);
  });

  test("preserves_title_at_top_without_chrome_pattern", () => {
    const p = page([
      line("My Important Document", 50, 30, 18, 18),
      line("Author Name", 50, 60, 10, 10),
      line("Body prose here.", 50, 200, 10, 10),
    ]);
    expect([...detectSinglePageChrome(p, 10)]).toEqual([]);
  });

  test("chrome_with_no_isolation_gap_is_not_stripped", () => {
    const p = page([
      line("http://example.com/foo", 50, 20, 10, 10),
      line("Body line right after.", 50, 32, 10, 10),
      line("Continuing body.", 50, 44, 10, 10),
    ]);
    expect([...detectSinglePageChrome(p, 10)]).toEqual([]);
  });
});

// Not in the Rust test module: they reach the volume marker, the empty and rotated early outs of the
// single-page detector, the bottom-band gap and the layout-model furniture lines.
describe("repetition (added)", () => {
  test("volume markers and short page numbers are chrome", () => {
    expect(matchesChromePattern("Journal of Things, Vol. 24")).toBe(true);
    expect(matchesChromePattern("Vol 24")).toBe(true);
    expect(matchesChromePattern("Volume 24")).toBe(false);
    expect(matchesChromePattern("12345")).toBe(false);
    expect(matchesChromePattern("")).toBe(false);
    expect(matchesChromePattern("Copyright 2020 by the authors")).toBe(true);
  });

  test("single page without lines or height has no chrome", () => {
    expect(detectSinglePageChrome(page([]), 10).size).toBe(0);
    const p = page([line("http://example.com/foo", 50, 20, 10, 10)]);
    p.page_height = 0;
    expect(detectSinglePageChrome(p, 10).size).toBe(0);
  });

  test("a footer URL below a gap is stripped and a body-size of zero falls back to the line height", () => {
    const p = page([
      line("Body line.", 50, 300, 10, 10),
      line("https://example.com/footer", 50, 770, 10, 10),
    ]);
    expect([...detectSinglePageChrome(p, 0)]).toEqual([1]);
  });

  test("model_furniture_lines marks lines under page header and footer blocks", () => {
    const p = page([
      line("Running head", 50, 10, 10, 10),
      line("Body text of the page", 50, 300, 10, 10),
      line("12", 300, 760, 10, 10),
    ]);
    const bx = (y: number, h: number, cls: number) => ({
      bbox: { x: 40, y, width: 400, height: h },
      class: cls,
      text: "",
    });
    // class 3 = PageHeader, 4 = PageFooter, 0 = Text
    p.model_blocks = [bx(5, 20, 3), bx(280, 60, 0), bx(750, 30, 4)];
    expect([...modelFurnitureLines(p)].sort()).toEqual([0, 2]);
    expect(modelFurnitureLines(page([line("x", 0, 0, 1, 1)])).size).toBe(0);
  });

  test("model_furniture_lines strips a line beyond every body block", () => {
    const p = page([
      line("Logo strip", 50, 12, 10, 10),
      line("Body text of the page", 50, 300, 10, 10),
      line("Address strip", 50, 770, 10, 10),
    ]);
    p.model_blocks = [{ bbox: { x: 40, y: 280, width: 400, height: 60 }, class: 0, text: "" }];
    expect([...modelFurnitureLines(p)].sort()).toEqual([0, 2]);
  });

  test("model_furniture_lines keeps a line inside the content area", () => {
    const p = page([line("Caption", 50, 200, 10, 10), line("Body", 50, 300, 10, 10)]);
    p.model_blocks = [{ bbox: { x: 40, y: 280, width: 400, height: 60 }, class: 0, text: "" }];
    expect(modelFurnitureLines(p).size).toBe(0);
  });
});
