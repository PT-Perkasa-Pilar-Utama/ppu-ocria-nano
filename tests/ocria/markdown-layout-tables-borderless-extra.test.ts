// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// Tests that the Rust tables.rs suite does not have, for ported lines it leaves
// uncovered: anchor splitting, the two-row and rule-band passes, and the
// validated ruled-table rects. Expectations follow the Rust code's documented
// behavior, derived by hand; none comes from a Rust run.

import { describe, expect, test } from "bun:test";

import { f32 } from "../../src/ocria/rust.js";
import type { GraphicPrimitive } from "../../src/ocria/types/geometry.js";
import { textItem } from "../../src/ocria/types/text-item.js";
import { extractRuleSegments } from "../../src/ocria/markdown-layout/tables/ruled/index.js";
import {
  detectTables,
  detectTablesBanded,
  splitSpanAtAnchors,
  splitWordsAtXAnchors,
  validatedRuledTableRects,
} from "../../src/ocria/markdown-layout/tables/borderless/index.js";
import { line, stroke } from "../../src/ocria/markdown-layout/test-helpers.js";
import { spec, tableOf, texts } from "./markdown-layout-borderless-helpers.test.js";

const word = (text: string, x: number, width: number) => ({ text, x, y: 0, width, height: 10 });

describe("split at anchors (extra)", () => {
  const words = [word("A", 10, 5), word("B", 50, 5), word("C", 100, 5)];

  test("splitWordsAtXAnchors cuts at the word nearest the anchor", () => {
    expect(splitWordsAtXAnchors(words, [50], 6)).toEqual(["A", "B C"]);
    expect(splitWordsAtXAnchors(words, [50, 100], 6)).toEqual(["A", "B", "C"]);
  });

  test("splitWordsAtXAnchors refuses a miss beyond the tolerance, or too few words", () => {
    expect(splitWordsAtXAnchors(words, [200], 6)).toBeNull();
    expect(splitWordsAtXAnchors(words, [], 6)).toBeNull();
    expect(splitWordsAtXAnchors(words.slice(0, 1), [50], 6)).toBeNull();
    // Two anchors that want the same boundary: the second takes the next one, which is too far.
    expect(splitWordsAtXAnchors(words, [50, 51], 6)).toBeNull();
  });

  test("splitSpanAtAnchors splits the text at whitespace", () => {
    const span = textItem({ text: "aaa bbb", x: 50, width: 100 });
    expect(splitSpanAtAnchors(span, [0, 1], [50, 100])).toEqual(["aaa", "bbb"]);
    expect(splitSpanAtAnchors(span, [0], [50])).toBeNull();
    expect(
      splitSpanAtAnchors(textItem({ text: "aaabbb", x: 50, width: 100 }), [0, 1], [50, 100])
    ).toBeNull();
  });
});

describe("two-row second pass (extra)", () => {
  test("a header and one data row form a table when nothing else claims them", () => {
    const lines = [
      spec("Name@50|Qty@150|Total@350", 100),
      spec("Bolt@50|12@150|3.50@250|9@350", 115),
    ];
    const runs = detectTables(lines);
    expect(runs.length).toBe(1);
    expect([runs[0].start, runs[0].end]).toEqual([0, 2]);
    const { header, rows } = tableOf(runs[0]);
    expect(header && texts(header)).toEqual(["Name", "Qty", "", "Total"]);
    expect(rows.map(texts)).toEqual([["Bolt", "12", "3.50", "9"]]);
  });

  test("a lowercase header is prose and is refused", () => {
    const lines = [
      spec("name@50|qty@150|total@350", 100),
      spec("Bolt@50|12@150|3.50@250|9@350", 115),
    ];
    expect(detectTables(lines)).toEqual([]);
  });
});

function hairline(y: number): GraphicPrimitive {
  return {
    Rect: {
      bbox: { x: 40, y, width: 200, height: f32(0.8) },
      stroke: "#000",
      fill: null,
    },
  };
}

describe("rule bands (extra)", () => {
  const lines = [
    spec("Alpha@50|Beta@83", 100),
    spec("Gamma@50|Delta@83", 115),
    spec("Omega@50|Sigma@83", 130),
  ];

  test("a two-column table between two hairlines is found only with the band", () => {
    expect(detectTables(lines)).toEqual([]);
    const runs = detectTablesBanded(lines, extractRuleSegments([hairline(90), hairline(150)]), 792);
    expect(runs.length).toBe(1);
    expect([runs[0].start, runs[0].end]).toEqual([0, 3]);
    expect(tableOf(runs[0]).rows.map(texts)).toEqual([
      ["Alpha", "Beta"],
      ["Gamma", "Delta"],
      ["Omega", "Sigma"],
    ]);
  });

  test("without rules detectTablesBanded is detectTables", () => {
    expect(detectTablesBanded(lines, extractRuleSegments([]), 792)).toEqual([]);
  });
});

describe("validatedRuledTableRects (extra)", () => {
  test("a ruled 2x2 grid gives the box of the lines it consumed", () => {
    const graphics: GraphicPrimitive[] = [];
    for (const y of [100, 140, 180]) graphics.push(stroke(50, y, 250, y, 0.5));
    for (const x of [50, 150, 250]) graphics.push(stroke(x, 100, x, 180, 0.5));
    const lines = [
      line("a", 90, 115, 10, 10),
      line("b", 190, 115, 10, 10),
      line("c", 90, 155, 10, 10),
      line("d", 190, 155, 10, 10),
    ];
    expect(validatedRuledTableRects(lines, graphics, 612, 792)).toEqual([
      { x: 90, y: 115, width: 105, height: 50 },
    ]);
    expect(validatedRuledTableRects(lines, [], 612, 792)).toEqual([]);
  });
});
