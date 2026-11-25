// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/tex_math/mod.rs (crates-v2.21.2, Apache-2.0).

// Font recognition: which fonts are TeX math fonts, their role, and their glyph-code encoding.

import type { Enc } from "./encodings.js";
import type { FontInfo, G } from "./types.js";

const TXPX: readonly string[] = ["TX", "RTX", "PX", "RPX"];
const TXPX_NEW: readonly string[] = ["TX", "RTX", "PX", "RPX", "NEWTX"];
const TXPX_MI: readonly string[] = ["TX", "RTX", "PX", "RPX", "NEWTX", "ZX", "NTX"];

export const TEXT_FAMS: readonly string[] = ["CMR", "CMBX", "CMSL", "CMTI"];

/** `prefix` + `rest` where the prefix is one of the tx / px font families: every `rest`, one per matching prefix. */
export function txPx(f: string, prefixes: readonly string[]): string[] {
  return prefixes.filter((p) => f.startsWith(p)).map((p) => f.slice(p.length));
}

/**
 * Math font families (subset prefix and size stripped, upper case), checked in order: (role,
 * encoding). The encoding is set when the font follows cmmi / cmsy / cmex (OML / OMS / OMX): a
 * glyph without Unicode is then read through that table, and a capital in an OMS font is
 * `\mathcal`.
 */
export function fontInfo(f: string): FontInfo {
  const miOml =
    ["CMMI", "CMMIB", "LMMATHITALIC", "MLMMATHITALIC", "CMBRMI"].includes(f) ||
    txPx(f, TXPX_MI).some((r) => r.startsWith("MI") || r.startsWith("BMI"));
  if (miOml) return ["Mi", "Oml"];
  if (
    ["EURM", "EURB", "PAZOMATH-ITALIC", "STIXMATH-ITALIC"].includes(f) ||
    f.includes("MATHITALIC")
  ) {
    return ["Mi", null];
  }
  if (
    ["CMSY", "CMBSY", "LMMATHSYMBOLS", "TXBSY", "TXBSYS"].includes(f) ||
    txPx(f, TXPX_NEW).some((r) => r === "SY" || r === "SYS")
  ) {
    return ["Sy", "Oms"];
  }
  if (
    txPx(f, TXPX).some((r) => r === "SYB") ||
    f === "MSBM" ||
    f === "BBOLD" ||
    ["DSROM", "BBM", "PAZOMATHBLACKBOARDBOLD"].some((p) => f.startsWith(p))
  ) {
    return ["Bb", null];
  }
  if (
    ["CMEX", "LMMATHEXTENSION", "EUEX", "YHCMEX"].includes(f) ||
    f.includes("EXTENSION") ||
    txPx(f, TXPX_NEW).some((r) => ["EX", "EXA", "EXS", "EXAS"].includes(r))
  ) {
    return ["Ex", "Omx"];
  }
  if (f === "MSAM") return ["Sy", "Msam"];
  if (f === "EUFM" || f === "EUFB") return ["Frak", null];
  if (f.startsWith("RSFS") || f.startsWith("STIXMATHSCRIPT")) return ["Scr", null];
  if (f === "EUSM" || f === "EUSB") return ["Cal", null];
  const sy =
    txPx(f, TXPX).some((r) => r === "SYA" || r === "SYC") ||
    [
      "TEX-MATH",
      "TEX-MATHA",
      "TEX-MATHB",
      "TEX-MATHC",
      "TEX-MATHX",
      "LASY",
      "WASY",
      "OAMATHSYMBOLS",
      "STIXMATH-REGULAR",
    ].includes(f) ||
    ["MNSYMBOL", "STANDARDSYML", "ESINT", "STMARY"].some((p) => f.startsWith(p)) ||
    f.endsWith("SYMBOL") ||
    f.endsWith("SYMBOL-") ||
    (f.startsWith("MATHDESIGN") && f.slice("MATHDESIGN".length).includes("SYMBOL"));
  if (sy) return ["Sy", null];
  return [null, null];
}

const TRAILING_DIGITS = /[0-9]+$/;

/** Font family: subset prefix, a `-Regular` suffix and size digits stripped, upper case ("ABCDEF+CMMI10" -> "CMMI"). */
export function family(fontName: string): string {
  const plus = fontName.lastIndexOf("+");
  const name = plus < 0 ? fontName : fontName.slice(plus + 1);
  let up = name.toUpperCase();
  if (up.endsWith("-REGULAR")) up = up.slice(0, up.length - "-REGULAR".length);
  return up.replace(TRAILING_DIGITS, "");
}

/** `G::enc`: the encoding of the glyph's font family. */
export function gEnc(g: G): Enc | null {
  return fontInfo(g.fam)[1];
}

/**
 * Whether a font can make its page a TeX page (see `pageMath`): a math font in a TeX encoding,
 * or an AMS / Euler / rsfs alphabet. A cheap gate that lets callers skip collecting glyphs on
 * every other page.
 */
export function isTexMathFont(fontName: string): boolean {
  const [role, enc] = fontInfo(family(fontName));
  return enc !== null || role === "Bb" || role === "Frak" || role === "Cal" || role === "Scr";
}
