// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// projection.rs script marks and style pieces. The Rust file tests these only
// through the whole projection (the goldens cover that in projection.test.ts),
// so each case here calls the function directly.

import { describe, expect, test } from "bun:test";

import {
  markScriptItems,
  recordStylePiece,
  sameEmphasis,
} from "../../src/ocria/projection/script-style.js";
import type { ProjectedTextItem } from "../../src/ocria/projection/types.js";
import { f32 } from "../../src/ocria/rust.js";
import { textItem } from "../../src/ocria/types/text-item.js";
import type { TextItem } from "../../src/ocria/types/text-item.js";

function itemAt(text: string, x: number, y: number, w: number, h: number): ProjectedTextItem {
  return {
    item: textItem({ text, x, y, width: w, height: h }),
    snap: "Left",
    anchor: "Left",
    is_dup: false,
    rendered: false,
    num_spaces: 0,
    force_unsnapped: false,
    is_margin_line_number: false,
    rotated: false,
    d: 0,
    orig_x: x,
    orig_y: y,
    orig_width: w,
    orig_height: h,
    orig_rotation: 0,
  };
}

function flagOf(p: ProjectedTextItem): string {
  if (p.item.sup) return "sup";
  return p.item.sub ? "sub" : "-";
}

const flags = (line: ProjectedTextItem[]): string[] => line.map(flagOf);

describe("markScriptItems", () => {
  test("flags a raised short item as superscript and a dropped one as subscript", () => {
    const line = [
      itemAt("Taha", 0, 100, 20, 10),
      itemAt("1", 20, 98, 4, 6),
      itemAt("CO", 30, 100, 12, 10),
      itemAt("2", 42, 106, 4, 6),
    ];
    markScriptItems(line);
    expect(flags(line)).toEqual(["-", "sup", "-", "sub"]);
  });

  test("leaves a line with fewer than four characters alone", () => {
    const line = [itemAt("ab", 0, 100, 10, 10), itemAt("1", 10, 98, 4, 6)];
    markScriptItems(line);
    expect(flags(line)).toEqual(["-", "-"]);
  });

  test("leaves a line with no glyph height alone", () => {
    const line = [itemAt("abcdef", 0, 100, 10, 0)];
    markScriptItems(line);
    expect(flags(line)).toEqual(["-"]);
  });

  test("ignores OCR and math items", () => {
    const line = [itemAt("Taha", 0, 100, 20, 10), itemAt("1", 20, 98, 4, 6)];
    line[1].item.confidence = 0.9;
    markScriptItems(line);
    expect(flags(line)).toEqual(["-", "-"]);
    line[1].item.confidence = null;
    line[1].item.math = true;
    markScriptItems(line);
    expect(flags(line)).toEqual(["-", "-"]);
  });

  test("uses an item's script_geom instead of its own box", () => {
    const line = [itemAt("Taha", 0, 100, 20, 10), itemAt("1", 20, 100, 4, 10)];
    line[1].item.script_geom = [98, 6];
    markScriptItems(line);
    expect(flags(line)).toEqual(["-", "sup"]);
  });

  test("clears a flagged item that has no unflagged neighbour within half the body height", () => {
    const line = [itemAt("Taha", 0, 100, 20, 10), itemAt("1", 60, 98, 4, 6)];
    markScriptItems(line);
    expect(flags(line)).toEqual(["-", "-"]);
  });

  test("clears a run of three flagged items and a run over eight characters", () => {
    const three = [
      itemAt("Taha", 0, 100, 20, 10),
      itemAt("1", 20, 98, 4, 6),
      itemAt("2", 24, 98, 4, 6),
      itemAt("3", 28, 98, 4, 6),
    ];
    markScriptItems(three);
    expect(flags(three)).toEqual(["-", "-", "-", "-"]);
    const long = [itemAt("Taha", 0, 100, 20, 10), itemAt("12345", 20, 98, 4, 6)];
    long[1].item.text = "123456";
    const wide = [...long, itemAt("789", 24, 98, 4, 6)];
    markScriptItems(wide);
    expect(flags(wide)).toEqual(["-", "-", "-"]);
  });

  test("a script run that hugs the text on its right stays flagged", () => {
    const line = [itemAt("1", 0, 98, 4, 6), itemAt("Taha", 5, 100, 20, 10)];
    markScriptItems(line);
    expect(flags(line)).toEqual(["sup", "-"]);
  });

  test("does not flag a tall item or an item longer than six characters", () => {
    const line = [itemAt("Taha", 0, 100, 20, 10), itemAt("abcdefg", 20, 98, 4, 6)];
    markScriptItems(line);
    expect(flags(line)).toEqual(["-", "-"]);
    const tall = [itemAt("Taha", 0, 100, 20, 10), itemAt("1", 20, 96, 4, 9)];
    markScriptItems(tall);
    expect(flags(tall)).toEqual(["-", "-"]);
  });
});

describe("sameEmphasis and recordStylePiece", () => {
  test("sameEmphasis compares each emphasis flag", () => {
    const a = textItem({ text: "a" });
    expect(sameEmphasis(a, textItem({ text: "b" }))).toBe(true);
    expect(sameEmphasis(a, textItem({ font_name: "Arial-Bold" }))).toBe(false);
    expect(sameEmphasis(a, textItem({ font_name: "Arial-Italic" }))).toBe(false);
    expect(sameEmphasis(a, textItem({ strike: true }))).toBe(false);
    expect(sameEmphasis(a, textItem({ font_name: "Courier" }))).toBe(false);
    expect(sameEmphasis(a, textItem({ underline: true }))).toBe(false);
    expect(sameEmphasis(a, textItem({ sup: true }))).toBe(false);
    expect(sameEmphasis(a, textItem({ sub: true }))).toBe(false);
  });

  const piece = (text: string, x: number, w: number, fields: Partial<TextItem> = {}): TextItem =>
    textItem({ text, x, y: 100, width: w, height: 9, ...fields });

  test("starts the pieces from the previous item and appends the next", () => {
    const prev = piece("doi", 10, 20, {
      words: [{ text: "doi", x: 10, y: 100, width: 20, height: 9 }],
    });
    const next = piece("more", 31, 20);
    recordStylePiece(prev, next, " ");
    expect(prev.style_pieces.map((p) => p.text)).toEqual(["doi", "more"]);
    expect(prev.style_pieces[0].words).toEqual([]);
    expect(prev.words.length).toBe(1);
  });

  test("a leading-dot continuation with the same style joins the last piece", () => {
    const prev = piece("doi.org/10", 10, 30, { underline: true });
    const next = piece(".1234", f32(40.5), 20, { underline: true });
    recordStylePiece(prev, next, "");
    expect(prev.style_pieces.length).toBe(1);
    const [only] = prev.style_pieces;
    expect(only.text).toBe("doi.org/10.1234");
    expect(only.x).toBe(10);
    expect(only.width).toBe(f32(f32(40.5 + 20) - 10));
  });

  test("a leading-dot continuation stays apart when the style, link or separator differs", () => {
    const base = (): TextItem => piece("doi.org/10", 10, 30, { underline: true });
    const dot = (fields: Partial<TextItem>): TextItem => piece(".1234", 41, 20, fields);

    const differentStyle = base();
    recordStylePiece(differentStyle, dot({}), "");
    expect(differentStyle.style_pieces.length).toBe(2);

    const differentLink = base();
    recordStylePiece(differentLink, dot({ underline: true, link: "https://x" }), "");
    expect(differentLink.style_pieces.length).toBe(2);

    const withSep = base();
    recordStylePiece(withSep, dot({ underline: true }), " ");
    expect(withSep.style_pieces.length).toBe(2);

    const notDot = base();
    recordStylePiece(notDot, piece("1234", 41, 20, { underline: true }), "");
    expect(notDot.style_pieces.length).toBe(2);

    const rtl = piece("אב", 10, 30);
    recordStylePiece(rtl, piece(".ג", 41, 20), "");
    expect(rtl.style_pieces.length).toBe(2);
  });

  test("copies the next item's own pieces", () => {
    const prev = piece("a", 10, 5);
    const next = piece("bc", 16, 10);
    next.style_pieces = [piece("b", 16, 5), piece("c", 21, 5)];
    recordStylePiece(prev, next, " ");
    expect(prev.style_pieces.map((p) => p.text)).toEqual(["a", "b", "c"]);
    expect(prev.style_pieces[1]).not.toBe(next.style_pieces[0]);
  });
});
