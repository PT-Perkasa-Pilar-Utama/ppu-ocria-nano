// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The JSON printer (serde_json `to_string_pretty` with ryu float formats) and
// `format_text` / `format_json` on every golden's `final.pages`. No golden holds
// the JSON string itself, so the golden check parses the output back and
// compares it with the pages.

import { describe, expect, test } from "bun:test";

import { formatJson } from "../../src/ocria/output/json.js";
import { f32v, formatFloat, toStringPretty } from "../../src/ocria/output/serde-json.js";
import { formatText } from "../../src/ocria/output/text.js";
import {
  canon,
  loadParseGolden,
  parsedPageFromJson,
  parseGoldenNames,
  stage,
} from "./parse-golden.js";

/** The parts of a printed document the golden check reads. */
type ParsedJson = {
  total_pages: number;
  pages: Array<{
    page: number;
    text: string;
    width: number;
    height: number;
    blocks?: unknown;
    text_items: Array<{
      text: string;
      x: number;
      y: number;
      width: number;
      height: number;
      confidence: number;
    }>;
  }>;
};

describe("printer", () => {
  test("f32 floats print as ryu does", () => {
    const f = (v: number) => formatFloat(Math.fround(v), 32);
    expect(f(612)).toBe("612.0");
    expect(f(0.1)).toBe("0.1");
    expect(f(0.42)).toBe("0.42");
    expect(f(-2.9632630348205566)).toBe("-2.963263");
    expect(f(16777216)).toBe("16777216.0");
    expect(f(1e12)).toBe("1000000000000.0");
    expect(f(1e13)).toBe("1e13");
    expect(f(1.5e20)).toBe("1.5e20");
    expect(f(0.000123)).toBe("0.000123");
    expect(f(0.0000001)).toBe("1e-7");
    expect(f(1.234e-9)).toBe("1.234e-9");
    expect(f(3.4028235e38)).toBe("3.4028235e38");
    expect(formatFloat(0, 32)).toBe("0.0");
    expect(formatFloat(-0, 32)).toBe("-0.0");
    expect(formatFloat(Number.NaN, 32)).toBe("null");
    expect(formatFloat(Number.POSITIVE_INFINITY, 32)).toBe("null");
  });

  test("an exact tie rounds to the even digit, as ryu does", () => {
    // Values from a comparison with ryu 1.0.23 over 3.7M f32 bit patterns: `toExponential` rounds
    // these half up.
    const f = (v: number) => formatFloat(Math.fround(v), 32);
    expect(f(305404.125)).toBe("305404.12");
    expect(f(8099.03125)).toBe("8099.0312");
    expect(f(130.015625)).toBe("130.01562");
    expect(f(3065919.25)).toBe("3065919.2");
    expect(f(-44144.3125)).toBe("-44144.312");
    // An odd digit below a tie rounds up to the even one.
    expect(f(130.046875)).toBe("130.04688");
  });

  test("f64 floats print as ryu does", () => {
    expect(formatFloat(42.5, 64)).toBe("42.5");
    expect(formatFloat(1e16, 64)).toBe("1e16");
    expect(formatFloat(1e15, 64)).toBe("1000000000000000.0");
    expect(formatFloat(0.00001, 64)).toBe("0.00001");
    expect(formatFloat(0.000001, 64)).toBe("1e-6");
  });

  test("a printed f32 reads back as the same f32", () => {
    let seed = 12345;
    const next = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let i = 0; i < 2000; i++) {
      const v = Math.fround((next() - 0.5) * 10 ** Math.floor(next() * 12 - 4));
      expect(Math.fround(Number(formatFloat(v, 32)))).toBe(v);
    }
  });

  test("strings escape as serde_json does", () => {
    expect(toStringPretty('a"b\\c\n\u0001\u007f é😀/')).toBe('"a\\"b\\\\c\\n\\u0001\u007f é😀/"');
  });

  test("empty containers, nesting and skipped keys", () => {
    expect(toStringPretty({ a: [], b: {}, c: [1, [2]], d: undefined, e: null, f: f32v(1) })).toBe(
      '{\n  "a": [],\n  "b": {},\n  "c": [\n    1,\n    [\n      2\n    ]\n  ],\n  "e": null,\n  "f": 1.0\n}'
    );
  });

  test("a non-integer number without a Float wrapper is an error", () => {
    expect(() => toStringPretty(1.5)).toThrow(RangeError);
  });
});

describe.each(parseGoldenNames())("%s", (name) => {
  test("final.pages through format_text and format_json", () => {
    const g = loadParseGolden(name);
    // SAFETY: final.pages is the ParsedPage[] after the last stage.
    const pages = (stage(g, "final.pages") as unknown[]).map(parsedPageFromJson);

    const text = formatText(pages);
    expect(text).toBe(pages.map((p) => `\n--- Page ${p.page_number} ---\n${p.text}`).join("\n\n"));

    const printed = formatJson(pages);
    // SAFETY: the printer writes JSON; the fields read below are the ones it always writes.
    const value = JSON.parse(printed) as ParsedJson;
    expect(value.total_pages).toBe(pages.length);
    // Pretty-printing is stable: the same pages print the same string.
    expect(formatJson(pages)).toBe(printed);
    pages.forEach((p, i) => {
      const out = value.pages[i];
      expect(out.page).toBe(p.page_number);
      expect(out.text).toBe(p.text);
      expect(canon([out.width, out.height])).toEqual(canon([p.page_width, p.page_height]));
      expect(out.text_items.length).toBe(p.text_items.length);
      p.text_items.forEach((t, j) => {
        const o = out.text_items[j];
        expect(o.text).toBe(t.text);
        expect(canon([o.x, o.y, o.width, o.height, o.confidence])).toEqual(
          canon([t.x, t.y, t.width, t.height, t.confidence ?? 1])
        );
      });
      expect(canon(out.blocks ?? null)).toEqual(canon(p.blocks ?? null));
    });
  });
});
