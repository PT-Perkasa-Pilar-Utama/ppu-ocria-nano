// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The `#[cfg(test)]` tests of liteparse markdown_layout/classify.rs (crates-v2.21.2).

import { describe, expect, test } from "bun:test";

import {
  classifyPage,
  isKind,
  isRule,
  mapOf,
  paragraph,
  titlePage,
} from "./markdown-layout-classify-helpers.test.js";

import type {} from "../../src/ocria/markdown-layout/block-types.js";
import {
  classifyPageWithFilters,
  detectCodeLanguage,
} from "../../src/ocria/markdown-layout/classify/index.js";
import {
  buildHeadingMap,
  computeBodySize,
} from "../../src/ocria/markdown-layout/headings/index.js";
import { HEADING_MAX_TEXT_CHARS } from "../../src/ocria/markdown-layout/headings/index.js";
import { computeHeaderFooterSet } from "../../src/ocria/markdown-layout/repetition/index.js";
import { renderBlocks } from "../../src/ocria/markdown-layout/render/index.js";
import {} from "../../src/ocria/markdown-layout/tables/borderless/index.js";
import {
  headerFooterPage,
  line,
  monoLine,
  page,
  pageWithGraphics,
  stroke,
  styledLine,
} from "../../src/ocria/markdown-layout/test-helpers.js";
import { textItem } from "../../src/ocria/types/text-item.js";

describe("classify", () => {
  test("blocks_report_the_region_they_were_read_from", () => {
    const p = titlePage();
    const blocks = classifyPage(p, mapOf(p));
    const bbox = (i: number) => {
      const b = blocks[i].bbox;
      if (b === null) throw new Error("block should be located");
      return b;
    };
    expect([bbox(0).y, bbox(0).height]).toEqual([50, 18]);
    expect([bbox(1).y, bbox(1).height]).toEqual([80, 22]);
    expect([bbox(2).y, bbox(2).height]).toEqual([130, 10]);
  });

  test("horizontal_rule_reports_the_stroke_it_came_from", () => {
    const lines = [
      line("before the rule", 50, 100, 10, 10),
      line("after the rule", 50, 300, 10, 10),
    ];
    const p = pageWithGraphics(lines, [stroke(50, 200, 450, 200, 0.5)]);
    const blocks = classifyPage(p, []);
    const hr = blocks.find(isRule);
    if (hr === undefined || hr.bbox === null) throw new Error("expected a located HR block");
    expect(hr.bbox.y).toBe(200);
    expect(hr.bbox.x).toBe(50);
    expect(hr.bbox.width).toBe(400);
  });

  test("classify_emits_heading_and_paragraph", () => {
    const p = titlePage();
    const blocks = classifyPage(p, mapOf(p));
    expect(blocks.length).toBe(3);
    const b0 = blocks[0].block;
    if (typeof b0 === "string" || !("Heading" in b0)) throw new Error("expected heading");
    expect(b0.Heading.level).toBe(1);
    expect(b0.Heading.text).toBe("Title of the document goes here");
    const t1 = paragraph(blocks[1]).text;
    expect(t1).toContain("paragraph continues");
    expect(t1).not.toContain("para-");
    expect(paragraph(blocks[2]).text).toBe("Another paragraph.");
  });

  test("paragraph_break_on_big_gap", () => {
    const p = page([line("Line A.", 50, 80, 10, 10), line("Line B.", 50, 200, 10, 10)]);
    expect(classifyPage(p, mapOf(p)).length).toBe(2);
  });

  test("classify_emits_list_items", () => {
    const p = page([
      line("Intro line.", 50, 50, 10, 10),
      line("• first bullet", 60, 80, 10, 10),
      line("• second bullet", 60, 92, 10, 10),
      line("◦ nested item", 72, 104, 10, 10),
      line("• back to top", 60, 116, 10, 10),
    ]);
    const items = classifyPage(p, mapOf(p)).filter((b) => isKind(b, "ListItem"));
    expect(items.length).toBe(4);
    const li = (i: number) => {
      const b = items[i].block;
      if (typeof b === "string" || !("ListItem" in b)) throw new Error("expected list item");
      return b.ListItem;
    };
    expect(li(0).level).toBe(0);
    expect(li(0).text).toBe("first bullet");
    // The "- nested item" line is indented +12pt from the base bullet.
    expect(li(2).level).toBe(1);
  });

  test("classify_emits_code_block", () => {
    const p = page([
      line("Intro line.", 50, 50, 10, 10),
      monoLine("    let x = 1;", 80),
      monoLine("    let y = x + 2;", 92),
      line("After the code.", 50, 120, 10, 10),
    ]);
    const blocks = classifyPage(p, mapOf(p));
    expect(blocks.length).toBe(3);
    const b = blocks[1].block;
    if (typeof b === "string" || !("CodeBlock" in b)) throw new Error("expected code block");
    expect(b.CodeBlock.lines.length).toBe(2);
    expect(b.CodeBlock.lines[0]).toContain("let x = 1;");
    expect(b.CodeBlock.lines[1]).toContain("let y = x + 2;");
    const s = renderBlocks(blocks);
    expect(s).toContain("```\n    let x = 1;");
    expect(s.endsWith("After the code.")).toBe(true);
  });

  test("detect_code_language_classifies_common_langs", () => {
    expect(
      detectCodeLanguage([
        "self.mm_list = sorted([x for x in self.files_list])",
        "self.mm_total = len(self.mm_list)",
      ])
    ).toBe("python");
    expect(detectCodeLanguage(["if item.total > 0:", "    print('many')"])).toBe("python");
    expect(detectCodeLanguage(["{", '    "formatVersion": "1.0",', "}"])).toBe("json");
    expect(detectCodeLanguage(["#include <vector>", "std::vector<int> v;"])).toBe("cpp");
    // Ambiguous / unknown content stays untagged (bare fence).
    expect(detectCodeLanguage(["let x = 1;", "let y = x + 2;"])).toBeNull();
  });

  test("classify_marks_paragraph_bold_when_all_lines_bold", () => {
    const a = line("Bold line one.", 50, 50, 10, 10);
    const b = line("bold continuation.", 50, 62, 10, 10);
    // Mark the underlying spans as bold so per-span style detection sees it — the inline
    // pipeline reads from `spans`, not the per-line `all_bold` shortcut flag.
    const boldSpan = textItem({ text: "x", font_name: "Arial-Bold" });
    a.spans = [{ ...boldSpan }];
    b.spans = [{ ...boldSpan }];
    a.all_bold = true;
    b.all_bold = true;
    const p = page([a, b]);
    const blocks = classifyPage(p, mapOf(p));
    expect(blocks.length).toBe(1);
    const para = paragraph(blocks[0]);
    expect(para.bold).toBe(true);
    expect(para.italic).toBe(false);
    const s = renderBlocks(blocks);
    expect(s.startsWith("**") && s.endsWith("**")).toBe(true);
  });

  test("classify_paragraph_with_mid_line_bold", () => {
    // First line has a bold word mid-line → not uniformly styled; paragraph should emit baked-in
    // `**bold**` inside the text and `bold=false` at the block level.
    const a = styledLine(
      [
        ["a sentence with a", 50, "Arial"],
        ["bold", 180, "Arial-Bold"],
        ["word in it.", 230, "Arial"],
      ],
      50,
      10
    );
    const p = page([a]);
    const blocks = classifyPage(p, mapOf(p));
    expect(blocks.length).toBe(1);
    const para = paragraph(blocks[0]);
    expect(para.bold).toBe(false);
    expect(para.italic).toBe(false);
    expect(para.text).toContain("**bold**");
  });

  test("classify_list_item_strips_marker_under_emphasis", () => {
    // Whole bullet line is bold (marker + text). Rendered text should be wrapped, with the
    // marker dropped (the renderer prints it).
    const l = styledLine(
      [
        ["•", 60, "Arial-Bold"],
        ["important item", 80, "Arial-Bold"],
      ],
      50,
      10
    );
    const p = page([l]);
    const blocks = classifyPage(p, mapOf(p));
    expect(blocks.length).toBe(1);
    const b = blocks[0].block;
    if (typeof b === "string" || !("ListItem" in b)) throw new Error("expected list item");
    expect(b.ListItem.text).toBe("**important item**");
  });

  test("hr_emitted_between_lines_by_y_order", () => {
    const lines = [
      line("before the rule", 50, 100, 10, 10),
      line("after the rule", 50, 300, 10, 10),
    ];
    // Stroke between the two lines, far from either's baseline.
    const p = pageWithGraphics(lines, [stroke(50, 200, 450, 200, 0.5)]);
    const blocks = classifyPage(p, []);
    const pos = blocks.findIndex(isRule);
    expect(pos).toBeGreaterThanOrEqual(0);
    // HR must land between the two paragraphs, not before/after both.
    expect(pos > 0 && pos < blocks.length - 1).toBe(true);
  });

  test("heading_demotion_keeps_the_paragraph_below_it", () => {
    // A 14pt heading, a body line, then a 14pt line that continues the heading's geometry and
    // would push it past HEADING_MAX_TEXT_CHARS. The body line is a pending paragraph, not yet a
    // block, so the heading is not the block directly above: demoting it must not overwrite the
    // paragraph, and the 14pt line must not merge above it.
    const heading =
      "Referral from the clinic with the history and a list of current medications for review";
    const second = "Follow-up visit is requested within two weeks of the date";
    expect(heading.length).toBeLessThanOrEqual(HEADING_MAX_TEXT_CHARS);
    expect(heading.length + 1 + second.length).toBeGreaterThan(HEADING_MAX_TEXT_CHARS);
    const p = page([
      line(heading, 50, 100, 14, 14),
      line("Patient reports mild symptoms.", 50, 118, 10, 10),
      line(second, 50, 130, 14, 14),
    ]);
    const md = renderBlocks(classifyPage(p, [[14, 2]]));
    const body = md.indexOf("Patient reports mild symptoms.");
    const follow = md.indexOf("Follow-up visit");
    expect(body).toBeGreaterThanOrEqual(0);
    expect(follow).toBeGreaterThanOrEqual(0);
    expect(body).toBeLessThan(follow);
  });

  test("full_format_strips_header_footer", () => {
    const pages = [
      headerFooterPage(1, "Acme Confidential", "Page 1 of 2", "First page body."),
      headerFooterPage(2, "Acme Confidential", "Page 2 of 2", "Second page body."),
    ];
    const map = buildHeadingMap(pages, computeBodySize(pages));
    const set = computeHeaderFooterSet(pages);
    const blocks = classifyPageWithFilters(pages[0], map, set, [], "placeholder", new Set());
    const s = renderBlocks(blocks);
    expect(s).not.toContain("Acme Confidential");
    expect(s).not.toContain("Page 1 of 2");
    expect(s).toContain("First page body.");
  });
});
