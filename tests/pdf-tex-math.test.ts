// Ports of the `#[cfg(test)]` tests of liteparse crates/liteparse/src/tex_math/mod.rs (crates-v2.21.2).
// structures.rs and encodings.rs have no Rust unit tests; the extra tests at the end pin their
// public entry points.

import { expect, test } from "bun:test";
import {
  build,
  decode,
  emitted,
  family,
  fontInfo,
  hasStructure,
  isTexMathFont,
  pageMath,
  ruleFromBox,
  spansInLine,
  trimUnmatchedBrackets,
} from "../src/pdf/tex-math/index.js";
import type { G, MathSpan, RawChar, Role } from "../src/pdf/tex-math/index.js";

function glyph(
  t: string,
  role: Role | null,
  fam: string,
  size: number,
  base: number,
  x0: number,
  x1: number
): G {
  const f = Math.fround;
  const top = f(800 - f(base + f(size * 0.75)));
  const bottom = f(800 - f(base - f(size * 0.25)));
  return {
    t,
    role,
    fam,
    size,
    base,
    x0,
    x1,
    top,
    bottom,
    loose: [top, bottom],
    pre: "",
    post: "",
    src: [],
  };
}

test("family strips prefix, size and regular", () => {
  expect(family("ABCDEF+CMMI10")).toBe("CMMI");
  expect(family("LMMathItalic10-Regular")).toBe("LMMATHITALIC");
  expect(family("MSBM10")).toBe("MSBM");
});

test("font rules match prototype roles", () => {
  expect(fontInfo("CMMI")).toEqual(["Mi", "Oml"]);
  expect(fontInfo("CMSY")).toEqual(["Sy", "Oms"]);
  expect(fontInfo("CMEX")).toEqual(["Ex", "Omx"]);
  expect(fontInfo("MSBM")).toEqual(["Bb", null]);
  expect(fontInfo("MSAM")).toEqual(["Sy", "Msam"]);
  expect(fontInfo("CMR")).toEqual([null, null]);
  expect(fontInfo("TIMES-ROMAN")).toEqual([null, null]);
});

test("build writes sub and superscripts", () => {
  const all = [
    glyph("x", "Mi", "CMMI", 10, 100, 0, 5),
    glyph("i", "Mi", "CMMI", 7, 98, 5, 8),
    glyph("2", null, "CMR", 7, 104, 8, 11),
  ];
  // The 2 is a fresh first-level glyph above the baseline.
  expect(build(all, [0, 1, 2], 100, 10)).toBe("x_{i}^{2}");
});

test("primes stay outside superscript braces", () => {
  const all = [glyph("f", "Mi", "CMMI", 10, 100, 0, 5), glyph("\0'", "Sy", "CMSY", 7, 104, 5, 7)];
  expect(build(all, [0, 1], 100, 10)).toBe("f'");
});

test("footnote markers after words stay text", () => {
  // "Kim∗": a raised CMSY star tight after a roman word.
  let all = [
    glyph("K", null, "CMR", 10, 100, 0, 7),
    glyph("i", null, "CMR", 10, 100, 7, 10),
    glyph("m", null, "CMR", 10, 100, 10, 18),
    glyph("∗", "Sy", "CMSY", 7, 104, 18, 22),
  ];
  expect(spansInLine(all, [0, 1, 2, 3])).toEqual([]);
  // "Aut⁰(X)": the same shape tight against a bracket is a function.
  all = [
    glyph("A", null, "CMR", 10, 100, 0, 7),
    glyph("u", null, "CMR", 10, 100, 7, 12),
    glyph("t", null, "CMR", 10, 100, 12, 16),
    glyph("0", null, "CMR", 7, 104, 16, 20),
    glyph("(", null, "CMR", 10, 100, 20, 23),
    glyph("X", "Mi", "CMMI", 10, 100, 23, 31),
    glyph(")", null, "CMR", 10, 100, 31, 34),
  ];
  expect(spansInLine(all, [0, 1, 2, 3, 4, 5, 6])).toEqual([[0, 1, 2, 3, 4, 5, 6]]);
});

test("unmatched end brackets are trimmed", () => {
  const g = (t: string, x: number): G => glyph(t, null, "CMR", 10, 100, x, x + 3);
  const all = [g("q", 0), g(")", 3), g("[", 6), g("0", 9), g(")", 12)];
  let sp = [0, 1];
  trimUnmatchedBrackets(all, sp);
  expect(sp).toEqual([0]);
  // A half-open interval [0) is matched.
  sp = [2, 3, 4];
  trimUnmatchedBrackets(all, sp);
  expect(sp).toEqual([2, 3, 4]);
});

test("structure rule keeps plain symbols as text", () => {
  const span = (tex: string): MathSpan => ({
    tex,
    x0: 0,
    x1: 0,
    top: 0,
    bottom: 0,
    size: 0,
    chars: [],
  });
  expect(hasStructure(span("\\pm "))).toBe(false);
  expect(hasStructure(span("\\alpha "))).toBe(false);
  expect(hasStructure(span("x_{i}"))).toBe(true);
  expect(hasStructure(span("\\mathcal{O}(2^{M}\\cdot K)"))).toBe(true);
});

// Entry points that have no Rust unit test.

function rawChar(
  index: number,
  text: RawChar["text"],
  font: string,
  x0: number,
  x1: number
): RawChar {
  return {
    index,
    text,
    font_name: font,
    size: 10,
    descent: -2.5,
    origin_y: 700,
    x0,
    x1,
    ink: null,
    loose: [690, 702.5],
  };
}

test("isTexMathFont gates on TeX encodings and AMS, Euler and rsfs alphabets", () => {
  expect(isTexMathFont("ABCDEF+CMMI10")).toBe(true);
  expect(isTexMathFont("ABCDEF+MSBM10")).toBe(true);
  expect(isTexMathFont("CMR10")).toBe(false);
  expect(isTexMathFont("Symbol")).toBe(false);
});

test("decode reads the TeX encodings", () => {
  expect(decode("Oms", 0)).toBe("-");
  expect(decode("Oms", 65)).toBeNull();
  expect(decode("Omx", 0)).toBe("(");
  expect(decode("Omx", 52)).toBe("");
  expect(decode("Omx", 112)).toBe("SQRT");
  expect(decode("Oml", 11)).toBe("\\alpha");
  expect(decode("Oml", 126)).toBe("ACC:vec");
  expect(decode("Msam", 54)).toBe("\\leqslant");
});

test("ruleFromBox keeps thin wide boxes only", () => {
  expect(ruleFromBox(10, 40, 100, 100.5, 800)).toEqual({ x0: 10, x1: 40, y: 699.75, w: 30 });
  expect(ruleFromBox(10, 40, 100, 102, 800)).toBeNull();
  expect(ruleFromBox(10, 11, 100, 100.5, 800)).toBeNull();
});

test("pageMath returns null for a page with no TeX math font", () => {
  const chars = [rawChar(0, { Unicode: "x" }, "ABCDEF+CMR10", 0, 5)];
  expect(pageMath(chars, [], 800)).toBeNull();
});

test("pageMath builds a span from cmmi glyphs and emitted keeps structured spans", () => {
  const chars = [
    rawChar(0, { Unicode: "x" }, "ABCDEF+CMMI10", 0, 5),
    { ...rawChar(1, { Code: 0x2b }, "ABCDEF+CMMI10", 5, 8), size: 7, origin_y: 697 },
    { ...rawChar(2, { Unicode: " " }, "ABCDEF+CMR10", 8, 10), size: 10 },
  ];
  const spans = pageMath(chars, [], 800);
  expect(spans).not.toBeNull();
  const [keep, consumed] = emitted(spans ?? []);
  expect(keep.length).toBeGreaterThan(0);
  expect(keep.every(hasStructure)).toBe(true);
  expect([...consumed].sort()).toEqual(keep.flatMap((s) => s.chars).sort());
});
