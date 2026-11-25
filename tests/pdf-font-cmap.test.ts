// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// Ports the `#[cfg(test)]` module of liteparse crates/liteparse/src/font_cmap.rs (crates-v2.21.2).

import { describe, expect, test } from "bun:test";

import { reverseCmap } from "../src/pdf/font-cmap/index.js";

/** `x.to_be_bytes()` for a u16. */
function u16(v: number): number[] {
  return [(v >>> 8) & 0xff, v & 0xff];
}

/** `x.to_be_bytes()` for a u32. */
function u32(v: number): number[] {
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}

/** A one-table sfnt whose `cmap` table holds `cmap`. */
function sfntWithCmap(cmap: number[]): Uint8Array {
  return Uint8Array.from([
    ...u32(0x00010000), // sfnt version
    ...u16(1), // numTables
    ...u16(0), // search fields
    ...u32(0),
    ...Buffer.from("cmap"),
    ...u32(0), // checksum
    ...u32(28), // offset (12 + 16)
    ...u32(cmap.length),
    ...cmap,
  ]);
}

/** A cmap table with one subtable record, the subtable at offset 12. */
function cmapWithSubtable(platform: number, encoding: number, sub: number[]): number[] {
  return [...u16(0), ...u16(1), ...u16(platform), ...u16(encoding), ...u32(12), ...sub];
}

/** A minimal sfnt with a single format-4 cmap subtable mapping 'A'..='C' (0x41..0x43) to glyphs 10..12. */
function minimalFormat4Font(): Uint8Array {
  // format 4 subtable: one real segment + terminator segment
  const sub = [
    ...u16(4), // format
    ...u16(0), // length (unchecked)
    ...u16(0), // language
    ...u16(4), // segCountX2 = 4 (2 segments)
    ...u16(0), // searchRange/entrySelector/rangeShift
    ...u32(0),
    ...u16(0x0043), // endCodes
    ...u16(0xffff),
    ...u16(0), // reservedPad
    ...u16(0x0041), // startCodes
    ...u16(0xffff),
    // idDelta: glyph = code + delta mod 65536; 10 - 0x41 = -55 = 0xFFC9
    ...u16(0xffc9), // idDeltas
    ...u16(0x0001),
    ...u32(0), // idRangeOffsets
  ];
  return sfntWithCmap(cmapWithSubtable(3, 1, sub));
}

describe("font_cmap", () => {
  test("parses_format4_and_inverts", () => {
    const map = reverseCmap(minimalFormat4Font());
    expect(map).not.toBeNull();
    expect(map?.get(10)).toBe(0x41); // A
    expect(map?.get(11)).toBe(0x42); // B
    expect(map?.get(12)).toBe(0x43); // C
    expect(map?.has(0)).toBe(false);
  });

  test("prefers_unified_ideograph_over_kangxi_radical", () => {
    // Format 12 cmap where U+2F00 (KANGXI RADICAL ONE) and U+4E00 share glyph 7, as in Noto Serif CJK and Yu Gothic.
    const sub = [
      ...u16(12), // format 12
      ...u16(0), // reserved
      ...u32(40), // length
      ...u32(0), // language
      ...u32(2), // numGroups
    ];
    for (const start of [0x2f00, 0x4e00]) {
      sub.push(...u32(start)); // startCharCode
      sub.push(...u32(start)); // endCharCode
      sub.push(...u32(7)); // startGlyphID
    }
    const map = reverseCmap(sfntWithCmap(cmapWithSubtable(3, 10, sub)));
    expect(map?.get(7)).toBe(0x4e00);
  });

  test("rejects_non_sfnt", () => {
    expect(reverseCmap(Buffer.from("%!PS-AdobeFont"))).toBeNull();
    expect(reverseCmap(Uint8Array.from([1, 0, 0, 0]))).toBeNull(); // bare CFF header
    expect(reverseCmap(new Uint8Array(0))).toBeNull();
  });
});
