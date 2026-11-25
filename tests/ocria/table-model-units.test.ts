// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The pure parts of liteparse crates/liteparse/src/table_model/units.rs (crates-v2.21.2): units
// from characters. `pdf_units` reads the characters from PDFium; no golden records them, and
// units.rs has no tests of its own, so these build characters by hand.

import { describe, expect, test } from "bun:test";

import type { Box4, Ch, Unit } from "../../src/ocria/table-model/units.js";
import { fromFrame, toFrame } from "../../src/ocria/table-model/units.js";
import { decode, isNum } from "../../src/ocria/table-model/units-cut.js";
import { flagLetterStacks } from "../../src/ocria/table-model/units-join.js";
import { unitsFromChars } from "../../src/ocria/table-model/units-chars.js";

const H = 10;
const W = 5;

/** The characters of `text` laid left to right from `x`, `y` (top), each `W` wide and `H` high. */
function line(text: string, x: number, y = 0, bold: boolean | null = null): Ch[] {
  return Array.from(text).map((c, i) => ({
    // SAFETY: one code point per entry of Array.from.
    c: [c.codePointAt(0) as number],
    pb: [x + i * W, y, x + (i + 1) * W, y + H],
    size: H,
    bold,
  }));
}

const texts = (us: readonly Unit[]): string[] => us.map((u) => u.text);

describe("cutting a run", () => {
  test("a gap wider than 1.8 glyph heights separates two cells", () => {
    // "Name" then 5 glyph widths of space (25 > 18) then "Value"
    const us = unitsFromChars([...line("Name", 0), ...line("Value", 45)], 200, 100);
    expect(texts(us)).toEqual(["Name", "Value"]);
    expect(us[1].words).toEqual([[45, 70, "Value"]]);
  });

  test("a narrow gap keeps one unit, with its words, majority bold and median size", () => {
    const us = unitsFromChars(
      [
        ...line("Hello", 0, 0, true),
        ...line(" ", 25),
        ...line("World", 30, 0, false),
        ...line("!", 55, 0, true),
      ],
      200,
      100
    );
    expect(texts(us)).toEqual(["Hello World!"]);
    expect(us[0].words.map((w) => w[2])).toEqual(["Hello", "World!"]);
    expect(us[0].bold).toBe(true);
    expect(us[0].size).toBe(H);
    expect(us[0].bx).toEqual([0, 0, 60, 10]);
  });

  test("a dot leader is dropped and cuts the run", () => {
    const us = unitsFromChars(
      [...line("Intro", 0), ...line(".....", 25), ...line("12", 50)],
      200,
      100
    );
    expect(texts(us)).toEqual(["Intro", "12"]);
  });

  test("two plain numbers a space apart are two cells", () => {
    // space gap 8 > 0.5 * 10 and both sides numbers
    const us = unitsFromChars(
      [...line("1,200", 0), ...line(" ", 25), ...line("-3.5%", 33)],
      200,
      100
    );
    expect(texts(us)).toEqual(["1,200", "-3.5%"]);
    // words, not numbers, stay together at the same gap
    expect(
      texts(unitsFromChars([...line("alpha", 0), ...line(" ", 25), ...line("beta", 33)], 200, 100))
    ).toEqual(["alpha beta"]);
  });

  test("a space far wider than the run's word spacing is a column gutter", () => {
    // word gaps of 3 (median) make the gutter 7.5 glyph units: a gap of 12 cuts
    const run = [
      ...line("aa", 0),
      ...line(" ", 10),
      ...line("bb", 13),
      ...line(" ", 23),
      ...line("cc", 26),
      ...line(" ", 36),
      ...line("dd", 39),
      ...line(" ", 49),
      ...line("ee", 61),
    ];
    expect(texts(unitsFromChars(run, 200, 100))).toEqual(["aa bb cc dd", "ee"]);
  });

  test("characters on another baseline start another run", () => {
    const us = unitsFromChars([...line("Top", 0, 0), ...line("Low", 0, 30)], 200, 100);
    expect(texts(us)).toEqual(["Top", "Low"]);
  });

  test("a break between runs and an empty page", () => {
    const us = unitsFromChars([...line("One", 0), null, ...line("Two", 0, 30)], 200, 100);
    expect(texts(us)).toEqual(["One", "Two"]);
    expect(unitsFromChars([], 200, 100)).toEqual([]);
  });
});

describe("reading direction", () => {
  test("text running up the page is read in its own frame", () => {
    // one glyph advance up: dy < 0 votes direction 1
    const up: Ch[] = Array.from("Sideways").map((c, i) => ({
      // SAFETY: one code point per entry of Array.from.
      c: [c.codePointAt(0) as number],
      pb: [10, 100 - (i + 1) * W, 20, 100 - i * W],
      size: H,
      bold: null,
    }));
    const us = unitsFromChars(up, 200, 120);
    expect(texts(us)).toEqual(["Sideways"]);
    expect(us[0].q).toBe(1);
    expect(us[0].minor).toBe(false);
  });

  test("a run against the page's direction is minor", () => {
    const side: Ch[] = Array.from("Label").map((c, i) => ({
      // SAFETY: one code point per entry of Array.from.
      c: [c.codePointAt(0) as number],
      pb: [150, 100 - (i + 1) * W, 160, 100 - i * W],
      size: H,
      bold: null,
    }));
    const us = unitsFromChars([...line("Body text here", 0), null, ...side], 200, 120);
    expect(us.find((u) => u.text === "Label")?.minor).toBe(true);
    expect(us.find((u) => u.text === "Body text here")?.minor).toBe(false);
  });

  test("toFrame and fromFrame are inverse", () => {
    const b: Box4 = [10, 20, 40, 35];
    for (const q of [0, 1, 2, 3]) {
      const [w, h] = [300, 200];
      // both maps take the page's own width and height
      expect(fromFrame(toFrame(b, q, w, h), q, w, h)).toEqual(b);
    }
  });
});

describe("joining and flagging", () => {
  test("pieces that touch are joined (a superscript)", () => {
    // "x" and a raised "2" in another run: the second starts where the first ends
    const x = line("x", 0, 0);
    const two: Ch[] = [{ c: [50], pb: [5, 0, 8, 6], size: 6, bold: null }];
    const us = unitsFromChars([...x, null, ...two], 200, 100);
    expect(texts(us)).toEqual(["x2"]);
    expect(us[0].words).toEqual([[0, 8, "x2"]]);
  });

  test("single glyphs stacked in a column are minor unless they have row-mates", () => {
    const unit = (text: string, x: number, y: number): Unit => ({
      bx: [x, y, x + 5, y + 10],
      pbox: [x, y, x + 5, y + 10],
      text,
      h: 10,
      size: 10,
      bold: null,
      q: 0,
      minor: false,
      words: [],
    });
    const stack = [unit("a", 10, 0), unit("b", 10, 11), unit("c", 10, 22), unit("d", 10, 33)];
    flagLetterStacks(stack);
    expect(stack.map((u) => u.minor)).toEqual([true, true, true, true]);
    // the same column with a unit on each line: a table column of one-glyph cells
    const table = [
      ...stack.map((u) => ({ ...u, minor: false })),
      ...[0, 11, 22, 33].map((y) => unit("word", 40, y)),
    ];
    flagLetterStacks(table);
    expect(table.some((u) => u.minor)).toBe(false);
  });
});

describe("aligned header split", () => {
  test("a header run splits where its words line up with the body", () => {
    // header "Alpha Beta Gamma" over a body of two rows with cells under each word
    const header = [
      ...line("Alpha", 0),
      ...line(" ", 25),
      ...line("Beta", 40),
      ...line(" ", 60),
      ...line("Gamma", 80),
    ];
    const body1 = [...line("10", 0, 20), ...line("20", 40, 20), ...line("30", 80, 20)];
    const body2 = [...line("11", 0, 35), ...line("21", 40, 35), ...line("31", 80, 35)];
    // the header words are 30 and 40 apart (gutters of 15 and 20 glyph units)
    const us = unitsFromChars([...header, null, ...body1, null, ...body2], 300, 100);
    expect(texts(us).filter((t) => /^[A-Za-z]/.test(t))).toEqual(["Alpha", "Beta", "Gamma"]);
  });
});

describe("code units", () => {
  test("surrogate halves pair and lone ones drop", () => {
    expect(decode([0x41, 0xd83d, 0xde00, 0x42])).toBe("A😀B");
    expect(decode([0x41, 0xd83d, 0x42, 0xde00, 0x43])).toBe("ABC");
    expect(decode([0xd83d, 0xd83d, 0xde00])).toBe("😀");
    expect(decode([0x41, 0x110000])).toBe("A");
  });

  test("numbers as units.py reads them", () => {
    for (const t of ["12", "-3.5", "$1,200.00", "45%", "10-20", "−7", "–$5", "12.5%-14%"])
      expect(isNum(t), t).toBe(true);
    for (const t of ["", "abc", "$", "12a", "1-", "10-20-30", "-", "%5", "٣"])
      expect(isNum(t), t).toBe(false);
  });
});
