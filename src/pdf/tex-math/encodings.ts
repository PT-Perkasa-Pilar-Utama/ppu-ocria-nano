// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/tex_math/encodings.rs (crates-v2.21.2, Apache-2.0).

// TeX math font encodings (OML = cmmi, OMS = cmsy, OMX = cmex, msam): glyph code -> LaTeX, for
// glyphs PDFium could not map to Unicode.

import { decodeOms } from "./encodings-oms.js";
import { decodeOmx } from "./encodings-omx.js";

/** The fixed encoding a TeX math font follows. */
export type Enc = "Oml" | "Oms" | "Omx" | "Msam";

const OML_GREEK: readonly string[] = [
  "\\Gamma",
  "\\Delta",
  "\\Theta",
  "\\Lambda",
  "\\Xi",
  "\\Pi",
  "\\Sigma",
  "\\Upsilon",
  "\\Phi",
  "\\Psi",
  "\\Omega",
  "\\alpha",
  "\\beta",
  "\\gamma",
  "\\delta",
  "\\epsilon",
  "\\zeta",
  "\\eta",
  "\\theta",
  "\\iota",
  "\\kappa",
  "\\lambda",
  "\\mu",
  "\\nu",
  "\\xi",
  "\\pi",
  "\\rho",
  "\\sigma",
  "\\tau",
  "\\upsilon",
  "\\phi",
  "\\chi",
  "\\psi",
  "\\omega",
  "\\varepsilon",
  "\\vartheta",
  "\\varpi",
  "\\varrho",
  "\\varsigma",
  "\\varphi",
];

const OML_OTHER: ReadonlyMap<number, string> = new Map([
  [58, "."],
  [59, ","],
  [60, "<"],
  [61, "/"],
  [62, ">"],
  [63, "\\star"],
  [64, "\\partial"],
  [91, "\\flat"],
  [92, "\\natural"],
  [93, "\\sharp"],
  [96, "\\ell"],
  [123, "\\imath"],
  [124, "\\jmath"],
  [125, "\\wp"],
  [126, "ACC:vec"],
]);

/** cmmi non-letters. */
export function decodeOml(code: number): string | null {
  if (code < OML_GREEK.length) return OML_GREEK[code];
  return OML_OTHER.get(code) ?? null;
}

const MSAM: ReadonlyMap<number, string> = new Map([
  [3, "\\square"],
  [4, "\\blacksquare"],
  [6, "\\Diamond"],
  [54, "\\leqslant"],
  [44, "\\leqslant"],
  [62, "\\geqslant"],
  [38, "\\gtrsim"],
  [45, "\\eqslantless"],
  [46, "\\lesssim"],
]);

export function decodeMsam(code: number): string | null {
  return MSAM.get(code) ?? null;
}

/**
 * LaTeX for the raw char code of a glyph PDFium gave no Unicode for, in a font following `enc`;
 * null when the encoding has no entry.
 */
export function decode(enc: Enc, code: number): string | null {
  switch (enc) {
    case "Oms":
      return decodeOms(code);
    case "Omx":
      return decodeOmx(code);
    case "Oml":
      return decodeOml(code);
    case "Msam":
      return decodeMsam(code);
  }
}
