// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// Ports the `#[cfg(test)]` module of liteparse crates/liteparse/src/glyph_names.rs (crates-v2.21.2).

import { describe, expect, test } from "bun:test";

import { AGL_SUBSET_1 } from "../src/pdf/glyph-names/agl-subset-1.js";
import { AGL_SUBSET_2 } from "../src/pdf/glyph-names/agl-subset-2.js";
import { resolveGlyphName } from "../src/pdf/glyph-names/index.js";

describe("glyph_names", () => {
  test("agl_subset_is_sorted_and_unique", () => {
    // The Rust table is one sorted slice; the port splits it into two files, so check the join.
    const names = [...AGL_SUBSET_1, ...AGL_SUBSET_2].map(([name]) => name);
    for (let i = 1; i < names.length; i++) {
      expect(names[i - 1] < names[i], `${names[i - 1]} >= ${names[i]}`).toBe(true);
    }
  });

  test("resolves_plain_names", () => {
    expect(resolveGlyphName("germandbls")).toBe("ß");
    expect(resolveGlyphName("adieresis")).toBe("ä");
    expect(resolveGlyphName("fl")).toBe("fl");
    expect(resolveGlyphName("ffi")).toBe("ffi");
    expect(resolveGlyphName("A")).toBe("A");
    expect(resolveGlyphName("space")).toBe(" ");
  });

  test("resolves_uni_and_u_forms", () => {
    expect(resolveGlyphName("uni0041")).toBe("A");
    expect(resolveGlyphName("uniFB01")).toBe("fi");
    expect(resolveGlyphName("uni00410042")).toBe("AB");
    expect(resolveGlyphName("u1F600")).toBe("😀");
    expect(resolveGlyphName("u0041")).toBe("A");
    // lowercase hex is not AGL-valid
    expect(resolveGlyphName("uni00e9")).toBeNull();
    // surrogate halves are invalid
    expect(resolveGlyphName("uniD800")).toBeNull();
  });

  test("resolves_compounds_and_suffixes", () => {
    expect(resolveGlyphName("f_i")).toBe("fi");
    expect(resolveGlyphName("f_f_l")).toBe("ffl");
    expect(resolveGlyphName("fi.alt")).toBe("fi");
    expect(resolveGlyphName("uni0041.sc")).toBe("A");
  });

  test("rejects_meaningless_names", () => {
    expect(resolveGlyphName("g42")).toBeNull();
    expect(resolveGlyphName("cid1234")).toBeNull();
    expect(resolveGlyphName("glyph7")).toBeNull();
    expect(resolveGlyphName("")).toBeNull();
    expect(resolveGlyphName(".notdef")).toBeNull();
  });
});
