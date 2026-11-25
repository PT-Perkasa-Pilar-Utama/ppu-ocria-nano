// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Replaces the system font provider of liteparse crates/pdfium (crates-v2.21.2, Apache-2.0): pdfium's `FPDF_SYSFONTINFO` hook, written in JavaScript.

// A native pdfium finds Arial, Times New Roman and Courier New on the host and substitutes them
// for the standard-14 fonts a PDF names without embedding (Helvetica, Times-Roman, Courier).
// Ascent, descent and glyph advances of the substitute set every text box LiteParse reads, so a
// build with no system fonts (this wasm build, in a browser) lays out the same page differently
// by a fraction of a point. The caller can supply the fonts instead.

import type { PdfiumModule } from "./module.js";

/** A font the caller makes available to pdfium: its face name as pdfium asks for it, and the TrueType file. */
export type SystemFont = { name: string; data: Uint8Array };

/**
 * The face a standard-14 name is read from, as the native build's font provider maps it
 * (confirmed against the ten goldens). Other names match a supplied font by their own name only:
 * PostScript names such as `ArialMT` do not map to `Arial`.
 */
const STANDARD_14 = new Map<string, string>([
  ["Courier", "Courier New"],
  ["Courier-Bold", "Courier New Bold"],
  ["Courier-BoldOblique", "Courier New Bold Italic"],
  ["Courier-Oblique", "Courier New Italic"],
  ["Helvetica", "Arial"],
  ["Helvetica-Bold", "Arial Bold"],
  ["Helvetica-BoldOblique", "Arial Bold Italic"],
  ["Helvetica-Oblique", "Arial Italic"],
  ["Times-Roman", "Times New Roman"],
  ["Times-Bold", "Times New Roman Bold"],
  ["Times-BoldItalic", "Times New Roman Bold Italic"],
  ["Times-Italic", "Times New Roman Italic"],
]);

/** The offsets of FPDF_SYSFONTINFO's members, in 4-byte words (wasm32): version, then the eight callbacks. */
const WORD = {
  version: 0,
  release: 1,
  enumFonts: 2,
  mapFont: 3,
  getFont: 4,
  getFontData: 5,
  getFaceName: 6,
  getFontCharset: 7,
  deleteFont: 8,
} as const;
const INFO_BYTES = 9 * 4;
/** `FX_Charset::kANSI`. */
const CHARSET_ANSI = 0;

/** Face names compare without case, spaces, hyphens and underscores (`ArialBold`, `Arial-Bold`, `Arial Bold`). */
function key(name: string): string {
  return name.toLowerCase().replace(/[\s_-]+/g, "");
}

/** The wire value of a four-character table tag, in both byte orders pdfium may pass it in. */
function tagMatches(tag: number, wanted: number): boolean {
  const swapped =
    ((wanted & 0xff) << 24) |
    (((wanted >> 8) & 0xff) << 16) |
    (((wanted >> 16) & 0xff) << 8) |
    (wanted >>> 24);
  return tag === wanted >>> 0 || tag === swapped >>> 0;
}

/** Bytes of one sfnt table of `font`, or null when the font has none by that tag. */
function sfntTable(font: Uint8Array, wanted: number): Uint8Array | null {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const count = view.getUint16(4);
  for (let i = 0; i < count; i++) {
    const entry = 12 + i * 16;
    if (!tagMatches(view.getUint32(entry), wanted)) continue;
    const offset = view.getUint32(entry + 8);
    return font.subarray(offset, offset + view.getUint32(entry + 12));
  }
  return null;
}

function cString(m: PdfiumModule, ptr: number): string {
  let end = ptr;
  while (m.HEAPU8[end] !== 0) end += 1;
  return new TextDecoder().decode(m.HEAPU8.subarray(ptr, end));
}

/**
 * Give pdfium `fonts` as its installed fonts (`FPDF_SetSystemFontInfo`). pdfium keeps the provider
 * for the life of the module, so the callbacks and their table stay allocated.
 */
export function installSystemFonts(m: PdfiumModule, fonts: readonly SystemFont[]): void {
  if (fonts.length === 0) return;
  // A handle is the 1-based index of a font; 0 means none.
  const byKey = new Map(fonts.map((f, i) => [key(f.name), i + 1]));
  const find = (face: string): number => byKey.get(key(STANDARD_14.get(face) ?? face)) ?? 0;
  const info = m._malloc(INFO_BYTES);
  const set = (
    word: number,
    signature: string,
    callback: (...args: number[]) => number | void
  ): void => {
    m.HEAP32[(info >> 2) + word] = m.addFunction(callback, signature);
  };
  m.HEAP32[(info >> 2) + WORD.version] = 1;
  set(WORD.release, "vi", () => {});
  set(WORD.enumFonts, "vii", (_self, mapper) => {
    for (const { name } of fonts) {
      const bytes = new TextEncoder().encode(name);
      const ptr = m._malloc(bytes.length + 1);
      m.HEAPU8.set(bytes, ptr);
      m.HEAPU8[ptr + bytes.length] = 0;
      m._FPDF_AddInstalledFont(mapper, ptr, CHARSET_ANSI);
      m._free(ptr);
    }
  });
  // (self, weight, italic, charset, pitch_family, face, exact): only a face the caller named matches.
  set(WORD.mapFont, "iiiiiiii", (_self, _weight, _italic, _charset, _pitch, face) =>
    find(cString(m, face))
  );
  set(WORD.getFont, "iii", (_self, face) => find(cString(m, face)));
  // (self, font, table, buffer, size): table 0 is the whole file. Called with a null buffer for the size.
  set(WORD.getFontData, "iiiiii", (_self, handle, table, buffer, size) => {
    const file = fonts[handle - 1]?.data;
    if (file === undefined) return 0;
    const data = table === 0 ? file : sfntTable(file, table);
    if (data === null) return 0;
    if (buffer !== 0 && size >= data.length) m.HEAPU8.set(data, buffer);
    return data.length;
  });
  set(WORD.getFaceName, "iiiii", (_self, handle, buffer, size) => {
    const name = fonts[handle - 1]?.name;
    if (name === undefined) return 0;
    const bytes = new TextEncoder().encode(name);
    if (buffer !== 0 && size > bytes.length) {
      m.HEAPU8.set(bytes, buffer);
      m.HEAPU8[buffer + bytes.length] = 0;
    }
    return bytes.length + 1;
  });
  set(WORD.getFontCharset, "iii", () => CHARSET_ANSI);
  set(WORD.deleteFont, "vii", () => {});
  m._FPDF_SetSystemFontInfo(info);
}
