// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The #[cfg(test)] tests of liteparse markdown_layout/lists.rs (crates-v2.21.2), ported.

import { describe, expect, test } from "bun:test";

import {
  detectOrderedListLines,
  parseListMarker,
  romanValue,
  splitOrderedMarker,
  splitOrderedMarkerForEmit,
  markerInterpretations,
} from "../../src/ocria/markdown-layout/lists/index.js";
import { line } from "../../src/ocria/markdown-layout/test-helpers.js";

function ll(text: string, x: number, y: number): ReturnType<typeof line> {
  return line(text, x, y, 11, 10);
}

describe("lists", () => {
  test("parse_list_marker_bullets", () => {
    expect(parseListMarker("• item one")).toEqual([false, "•", "item one"]);
  });

  test("parse_list_marker_dash_bullets", () => {
    for (const dash of ["- We pioneer", "– We pioneer", "— We pioneer"]) {
      const m = parseListMarker(dash);
      expect(m).not.toBeNull();
      expect(m?.[0]).toBe(false);
      expect(m?.[2]).toBe("We pioneer");
      expect(m?.[1]).not.toBe("");
    }
    expect(parseListMarker("-5")).toBeNull();
    expect(parseListMarker("-foo")).toBeNull();
  });

  test("parse_list_marker_decimal", () => {
    expect(parseListMarker("1. first")).toEqual([true, "1.", "first"]);
    expect(parseListMarker("12) twelfth")).toEqual([true, "12)", "twelfth"]);
  });

  test("parse_list_marker_rejects_prose", () => {
    expect(parseListMarker("This sentence.")).toBeNull();
    expect(parseListMarker("2023 was a year")).toBeNull();
    expect(parseListMarker("1.5x growth")).toBeNull();
  });

  test("roman_value_parses", () => {
    expect(romanValue("i")).toBe(1);
    expect(romanValue("iv")).toBe(4);
    expect(romanValue("ix")).toBe(9);
    expect(romanValue("xiv")).toBe(14);
    expect(romanValue("q")).toBeNull();
  });

  test("split_ordered_marker_forms", () => {
    expect(splitOrderedMarker("a. hello")).toEqual(["a", "a.", "hello"]);
    expect(splitOrderedMarker("iv) hello")).toEqual(["iv", "iv)", "hello"]);
    expect(splitOrderedMarker("(a) hello")).toEqual(["a", "(a)", "hello"]);
    expect(splitOrderedMarker("i.e. therefore")).toBeNull();
    expect(splitOrderedMarker("a.")).toBeNull();
  });

  test("detects_lettered_and_roman_sequences", () => {
    const lines = [
      ll("a. first item", 20, 100),
      ll("b. second item", 20, 120),
      ll("c. third item", 20, 140),
      ll("i. sub one", 40, 160),
      ll("ii. sub two", 40, 180),
      ll("iii. sub three", 40, 200),
    ];
    const got = detectOrderedListLines(lines, new Set());
    expect(got.size).toBe(6);
    for (let i = 0; i < 6; i++) expect(got.has(i)).toBe(true);
  });

  test("lone_marker_is_not_a_list", () => {
    const lines = [
      ll("A. Background", 20, 100),
      ll("Some prose about the background of the matter at hand.", 20, 120),
    ];
    expect(detectOrderedListLines(lines, new Set()).size).toBe(0);
  });

  test("initials_are_not_a_list", () => {
    const lines = [
      ll("J. Smith reported the findings to the committee.", 20, 100),
      ll("M. Jones seconded the motion without objection.", 20, 120),
    ];
    expect(detectOrderedListLines(lines, new Set()).size).toBe(0);
  });

  test("does_not_chain_across_large_gaps", () => {
    const lines = [ll("a. opening clause", 20, 100)];
    for (let k = 0; k < 14; k++) lines.push(ll("ordinary body prose line here", 20, 120 + k * 20));
    lines.push(ll("b. much later clause", 20, 420));
    expect(detectOrderedListLines(lines, new Set()).size).toBe(0);
  });

  test("table_covered_markers_are_excluded", () => {
    const lines = [
      ll("(a) first footnote of the table below the divider rule", 20, 100),
      ll("(b) second footnote of the table below the divider rule", 20, 120),
    ];
    expect(detectOrderedListLines(lines, new Set()).size).toBe(2);
    expect(detectOrderedListLines(lines, new Set([0, 1])).size).toBe(0);
  });
});

// Branches the Rust tests do not reach; expected values follow the Rust source.
describe("lists: untested branches", () => {
  test("split_ordered_marker_for_emit returns the marker and the rest", () => {
    expect(splitOrderedMarkerForEmit("  (iv) text")).toEqual(["(iv)", "text"]);
    expect(splitOrderedMarkerForEmit("no marker")).toBeNull();
  });

  test("marker_interpretations of single letters, romans and rejects", () => {
    expect(markerInterpretations("i")).toEqual([
      ["AlphaLower", 9],
      ["RomanLower", 1],
    ]);
    expect(markerInterpretations("I")).toEqual([
      ["AlphaUpper", 9],
      ["RomanUpper", 1],
    ]);
    expect(markerInterpretations("b")).toEqual([["AlphaLower", 2]]);
    expect(markerInterpretations("XIV")).toEqual([["RomanUpper", 14]]);
    expect(markerInterpretations("ab")).toEqual([]);
    expect(markerInterpretations("1")).toEqual([]);
  });

  test("an uppercase roman run nests under its own indent", () => {
    const lines = [ll("I. one", 20, 100), ll("II. two", 20, 120)];
    expect(detectOrderedListLines(lines, new Set()).size).toBe(2);
  });
});
