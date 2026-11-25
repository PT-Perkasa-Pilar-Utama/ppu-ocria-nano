// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The `#[cfg(test)]` tests of liteparse markdown_layout/classify.rs (crates-v2.21.2).

import { describe, expect, test } from "bun:test";

import {
  classifyPage,
  isKind,
  mapOf,
  paragraph,
  tag,
} from "./markdown-layout-classify-helpers.test.js";

import { NUMERIC_FOOTER_PATH } from "../../src/ocria/projection/xy-cut.js";
import { withoutStraySideways } from "../../src/ocria/markdown-layout/classify/index.js";
import {} from "../../src/ocria/markdown-layout/headings/index.js";
import { HEADING_MAX_TEXT_CHARS } from "../../src/ocria/markdown-layout/headings/index.js";
import {} from "../../src/ocria/markdown-layout/render/index.js";
import {} from "../../src/ocria/markdown-layout/tables/borderless/index.js";
import { line, lineWithSpans, page } from "../../src/ocria/markdown-layout/test-helpers.js";
import type { ProjectedLine } from "../../src/ocria/types/page.js";

describe("classify", () => {
  test("a_stray_sideways_glyph_leaves_with_its_item", () => {
    const l = lineWithSpans(
      [
        ["L", 50],
        ["Current", 80],
        ["A-001", 150],
        ["Smith", 230],
      ],
      155,
      10
    );
    l.spans[0].rotation = 90;
    l.span_item_indices = [4, 5, 6, 7];
    const upright = withoutStraySideways(l);
    if (upright === null) throw new Error("expected an upright line");
    expect(upright.text).toBe("Current A-001 Smith");
    expect(upright.span_item_indices).toEqual([5, 6, 7]);
  });

  test("a_detached_numeric_footer_keeps_its_items", () => {
    const body = line("Body text of the page.", 50, 100, 10, 10);
    body.span_item_indices = [0];
    const footer = line("12", 300, 760, 10, 10);
    footer.region_path = [...NUMERIC_FOOTER_PATH];
    footer.span_item_indices = [1];
    const blocks = classifyPage(page([body, footer]), []);
    const last = blocks[blocks.length - 1];
    expect(paragraph(last).text).toBe("12");
    expect(last.text_item_indices).toEqual([1]);
  });

  test("blocks_carry_the_items_they_were_read_from", () => {
    const p = page([
      tag(line("Title of the document goes here", 50, 50, 18, 18), 0),
      tag(line("First sentence of the para-", 50, 80, 10, 10), 1),
      tag(line("graph continues here.", 50, 92, 10, 10), 2),
      tag(line("Another paragraph.", 50, 130, 10, 10), 3),
    ]);
    const blocks = classifyPage(p, mapOf(p));
    expect(blocks.length).toBe(3);
    expect(isKind(blocks[0], "Heading")).toBe(true);
    expect(blocks[0].text_item_indices).toEqual([0]);
    expect(blocks[1].text_item_indices).toEqual([1, 2]);
    expect(blocks[2].text_item_indices).toEqual([3]);
  });

  test("demoted_heading_keeps_its_items", () => {
    // A heading-sized first line under the length cap, then a continuation that tips the run
    // over `HEADING_MAX_TEXT_CHARS`: the heading demotes to a paragraph that must carry both
    // lines' items.
    const longA =
      "A rather long citation-style opening line that scores as a heading on its own because it stays just under the cap";
    const longB = "But the continuation line pushes the combined run far over the limit";
    expect([...longA].length).toBeLessThanOrEqual(HEADING_MAX_TEXT_CHARS);
    expect([...longA].length + 1 + [...longB].length).toBeGreaterThan(HEADING_MAX_TEXT_CHARS);
    const build = (): ProjectedLine[] => {
      const v = [tag(line(longA, 50, 50, 14, 14), 0), tag(line(longB, 50, 66, 14, 14), 1)];
      for (let i = 0; i < 10; i++) {
        v.push(
          tag(
            line(
              "plain body text keeps the size map honest and body-dominant here.",
              50,
              Math.fround(300 + i * 12),
              10,
              10
            ),
            2 + i
          )
        );
      }
      return v;
    };
    const p = page(build());
    const map = mapOf(p);
    const solo = build();
    solo.splice(1, 1);
    expect(isKind(classifyPage(page(solo), map)[0], "Heading")).toBe(true);
    const blocks = classifyPage(p, map);
    expect(isKind(blocks[0], "Paragraph")).toBe(true);
    expect(blocks[0].text_item_indices).toEqual([0, 1]);
  });

  test("list_continuation_extends_item_indices", () => {
    const p = page([
      tag(line("Intro line.", 50, 50, 10, 10), 0),
      tag(line("• bullet starts here and", 60, 80, 10, 10), 1),
      tag(line("wraps onto a second line", 60, 92, 10, 10), 2),
    ]);
    const item = classifyPage(p, []).find((b) => isKind(b, "ListItem"));
    if (item === undefined) throw new Error("expected a list item");
    expect(item.text_item_indices).toEqual([1, 2]);
  });

  test("stitch_regions_hard_hyphen_join_unions_items", () => {
    const a = tag(line("treated with pyridine-3-", 50, 700, 10, 10), 0);
    a.region_path = [0];
    const b = tag(line("carbonitrile in water.", 320, 50, 10, 10), 1);
    b.region_path = [1];
    const blocks = classifyPage(page([a, b]), []);
    expect(blocks.length).toBe(1);
    expect(paragraph(blocks[0]).text).toContain("pyridine-3-carbonitrile");
    expect(blocks[0].text_item_indices).toEqual([0, 1]);
  });

  test("stitch_regions_unions_items_across_leaves", () => {
    const a = tag(line("The sentence continues without", 50, 700, 10, 10), 0);
    a.region_path = [0];
    const b = tag(line("ending punctuation here.", 320, 50, 10, 10), 1);
    b.region_path = [1];
    const blocks = classifyPage(page([a, b]), []);
    expect(blocks.length).toBe(1);
    expect(blocks[0].text_item_indices).toEqual([0, 1]);
  });
});
