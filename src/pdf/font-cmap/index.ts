// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/font_cmap.rs (crates-v2.21.2, Apache-2.0).

// Reverse-cmap recovery: parse an embedded sfnt (TrueType/OpenType) font program's `cmap` table
// and invert it to a glyph-index to unicode map. Only formats 4, 12, 6 and 0 are parsed.

/** A read past the end of the font data: the Rust returns `None` through `?`. */
class Short extends Error {}

function readU16(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > data.length) throw new Short();
  return (data[offset] << 8) | data[offset + 1];
}

function readU32(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > data.length) throw new Short();
  return (
    ((data[offset] << 24) |
      (data[offset + 1] << 16) |
      (data[offset + 2] << 8) |
      data[offset + 3]) >>>
    0
  );
}

function tagIs(data: Uint8Array, at: number, bytes: number[]): boolean {
  return data.length >= at + bytes.length && bytes.every((b, i) => data[at + i] === b);
}

const TTCF = [0x74, 0x74, 0x63, 0x66];
const SFNT_1_0 = [0, 1, 0, 0];
const OTTO = [0x4f, 0x54, 0x54, 0x4f];
const TRUE = [0x74, 0x72, 0x75, 0x65];
const CMAP = [0x63, 0x6d, 0x61, 0x70];

function isSfntMagic(data: Uint8Array): boolean {
  return tagIs(data, 0, SFNT_1_0) || tagIs(data, 0, OTTO) || tagIs(data, 0, TRUE);
}

/** `sfnt_slice`: resolve TTC wrappers and validate the sfnt magic. */
function sfntSlice(data: Uint8Array): Uint8Array {
  if (data.length < 4) throw new Short();
  if (tagIs(data, 0, TTCF)) {
    const first = readU32(data, 12);
    if (first > data.length) throw new Short();
    const sub = data.subarray(first);
    if (sub.length < 4 || !isSfntMagic(sub)) throw new Short();
    return sub;
  }
  if (!isSfntMagic(data)) throw new Short();
  return data;
}

function findTable(font: Uint8Array, tag: number[]): Uint8Array {
  const numTables = readU16(font, 4);
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (rec + 4 > font.length) throw new Short();
    if (tagIs(font, rec, tag)) {
      const offset = readU32(font, rec + 8);
      const length = readU32(font, rec + 12);
      if (offset + length > font.length) throw new Short();
      return font.subarray(offset, offset + length);
    }
  }
  throw new Short();
}

/** Collision rank: prefer non-PUA, then non-radical, then the smaller codepoint. */
function rank(u: number): number {
  if (u >= 0xe000 && u <= 0xf8ff) return 2;
  if (u >= 0x2e80 && u <= 0x2fdf) return 1;
  return 0;
}

function addMapping(map: Map<number, number>, glyph: number, unicode: number): void {
  if (glyph === 0 || unicode === 0) return;
  const cur = map.get(glyph);
  if (cur === undefined) {
    map.set(glyph, unicode);
    return;
  }
  const [ru, rc] = [rank(unicode), rank(cur)];
  if (ru < rc || (ru === rc && unicode < cur)) map.set(glyph, unicode);
}

function scoreOf(platform: number, encoding: number): number {
  // Only true unicode subtables: Mac Roman (1,0) and symbol (3,0) encode charcodes, not unicode.
  if ((platform === 3 && encoding === 10) || (platform === 0 && (encoding === 4 || encoding === 6)))
    return 4;
  if ((platform === 3 && encoding === 1) || (platform === 0 && encoding <= 3)) return 3;
  return 0;
}

function parseFormat4(sub: Uint8Array, map: Map<number, number>): void {
  const segCount = readU16(sub, 6) >> 1;
  const endCodes = 14;
  const startCodes = endCodes + segCount * 2 + 2;
  const idDeltas = startCodes + segCount * 2;
  const idRangeOffsets = idDeltas + segCount * 2;
  for (let seg = 0; seg < segCount; seg++) {
    const end = readU16(sub, endCodes + seg * 2);
    const start = readU16(sub, startCodes + seg * 2);
    const delta = readU16(sub, idDeltas + seg * 2);
    const rangeOffset = readU16(sub, idRangeOffsets + seg * 2);
    if (start === 0xffff && end === 0xffff) continue;
    for (let code = start; code <= Math.min(end, 0xfffe); code++) {
      let glyph: number;
      if (rangeOffset === 0) {
        glyph = (code + delta) & 0xffff;
      } else {
        // glyphIdArray indexing relative to this rangeOffset slot
        const slot = idRangeOffsets + seg * 2 + rangeOffset + (code - start) * 2;
        const g = readU16(sub, slot);
        glyph = g === 0 ? 0 : (g + delta) & 0xffff;
      }
      addMapping(map, glyph, code);
    }
  }
}

function parseFormat12(sub: Uint8Array, map: Map<number, number>): void {
  const nGroups = readU32(sub, 12);
  for (let i = 0; i < Math.min(nGroups, 100_000); i++) {
    const rec = 16 + i * 12;
    const start = readU32(sub, rec);
    const end = readU32(sub, rec + 4);
    const startGlyph = readU32(sub, rec + 8);
    if (end < start || end - start > 0x10000) continue;
    for (let off = 0; off <= end - start; off++) addMapping(map, startGlyph + off, start + off);
  }
}

function parseSubtable(sub: Uint8Array, map: Map<number, number>): boolean {
  switch (readU16(sub, 0)) {
    case 0:
      // Byte encoding table: 256 glyph ids at offset 6
      for (let code = 0; code < 256; code++) {
        if (6 + code >= sub.length) throw new Short();
        addMapping(map, sub[6 + code], code);
      }
      return true;
    case 4:
      parseFormat4(sub, map);
      return true;
    case 6: {
      const first = readU16(sub, 6);
      const count = readU16(sub, 8);
      for (let i = 0; i < count; i++) addMapping(map, readU16(sub, 10 + i * 2), first + i);
      return true;
    }
    case 12:
      parseFormat12(sub, map);
      return true;
    default:
      return false;
  }
}

/**
 * Build glyph_index to unicode from an sfnt font program. Null when the data
 * is not sfnt (for example bare CFF) or has no usable cmap subtable.
 */
export function reverseCmap(data: Uint8Array): Map<number, number> | null {
  try {
    const font = sfntSlice(data);
    const cmap = findTable(font, CMAP);
    const numSubtables = readU16(cmap, 2);
    // Pick the best unicode subtable: full-repertoire (fmt 12) beats BMP (fmt 4).
    let best: [number, number] | null = null;
    for (let i = 0; i < numSubtables; i++) {
      const rec = 4 + i * 8;
      const score = scoreOf(readU16(cmap, rec), readU16(cmap, rec + 2));
      const offset = readU32(cmap, rec + 4);
      if (score > 0 && (best === null || score > best[0])) best = [score, offset];
    }
    if (best === null) return null;
    if (best[1] > cmap.length) return null;
    const map = new Map<number, number>();
    if (!parseSubtable(cmap.subarray(best[1]), map)) return null;
    return map.size === 0 ? null : map;
  } catch (error) {
    if (error instanceof Short) return null;
    throw error;
  }
}
