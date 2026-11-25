// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/ocr_merge.rs (crates-v2.21.2, Apache-2.0): per-text garble signals and their thresholds.

import { chars, cp, f32, isAlphabetic, isWhitespace } from "../rust.js";
import { isAsciiGraphic, isControl, toAsciiLowercase } from "../rust-extra.js";

/**
 * Fewest stray ASCII characters inside complex-script words, and their least rate per script
 * character, for a font's text to count as garbled (see `scriptIntrusions`).
 */
const INTRUSION_MIN = 5;
const INTRUSION_MIN_RATE = f32(0.015);

/**
 * Fewest symbol intrusions, and their least rate per letter, for text to count as garbled
 * (see `symbolIntrusions`). On ParseBench v2 the garbled pages sit at 5.2-8.0%, the
 * highest clean one at 2.2%.
 */
const SYMBOL_MIN = 20;
const SYMBOL_MIN_RATE = f32(0.03);

const CONTROL_MIN = 5;
const CONTROL_MIN_RATE = f32(0.02);

/** Fewest malformed tokens, and their least share of the judged ones, for a font to count as garbled. */
const MALFORMED_MIN = 10;
const MALFORMED_MIN_RATE = f32(0.2);

/** Only symbols legacy / cipher fonts produce and real text doesn't put inside words. */
const SYM = "$¥©«»@¢£¤¦§¨ª¬®¯¶¸º¼½¾¿";

const SYMBOL_FONT_NAMES = [
  "wingding",
  "webding",
  "dingbat",
  "symbol",
  "zapf",
  "math",
  "sym",
  "greekwith",
];
// TeX math fonts (Computer Modern / AMS / txfonts / xy-pic): glyph codes for
// operators and delimiters map to control positions by design.
const TEX_FONT_PREFIXES = [
  "cmex",
  "cmsy",
  "cmmi",
  "msam",
  "msbm",
  "rtxm",
  "rtxs",
  "txex",
  "txsy",
  "xyatip",
  "xydash",
  "eufm",
  "esint",
  "stmary",
  "wasy",
];

/**
 * Complex scripts whose shaped forms (Indic conjuncts and matras, Arabic / Hebrew joining
 * forms and ligatures, Thai / Khmer / Myanmar clusters) a subset font draws from glyphs that
 * often lack a ToUnicode entry.
 */
function isComplexScript(c: string): boolean {
  const u = cp(c);
  return (
    (u >= 0x0590 && u <= 0x05ff) ||
    (u >= 0x0600 && u <= 0x06ff) ||
    (u >= 0x0750 && u <= 0x077f) ||
    (u >= 0x08a0 && u <= 0x08ff) ||
    (u >= 0x0900 && u <= 0x0dff) ||
    (u >= 0x0e00 && u <= 0x0eff) ||
    (u >= 0x1000 && u <= 0x109f) ||
    (u >= 0x1780 && u <= 0x17ff) ||
    (u >= 0xfb1d && u <= 0xfdff) ||
    (u >= 0xfe70 && u <= 0xfeff)
  );
}

/**
 * (complex-script characters, ASCII intrusions) in `text`. An intrusion is a printable ASCII
 * character wedged between two complex-script characters with no space: where a conjunct
 * or ligature glyph has no Unicode mapping, PDF text extraction yields a stray `(`, `@`, `/`
 * or Latin letter inside the word. Correctly encoded text in these scripts essentially
 * never mixes ASCII into a word.
 */
export function scriptIntrusions(text: string): [number, number] {
  const cs = chars(text);
  const script = cs.filter(isComplexScript).length;
  let intrusions = 0;
  for (let i = 1; i < cs.length - 1; i++) {
    if (isAsciiGraphic(cs[i]) && isComplexScript(cs[i - 1]) && isComplexScript(cs[i + 1])) {
      intrusions++;
    }
  }
  return [script, intrusions];
}

/**
 * (letters, symbol intrusions) in `text`: a symbol such as `$ ¥ © « @ § ¶ ®` wedged
 * between two letters. Text drawn with a legacy 8-bit Indic font or a cipher-like ToUnicode
 * map is full of them; real text, code and URLs included, rarely puts them inside a word.
 * LaTeX and math symbols are out: the TeX math path writes `x^{2}`, `\alpha` into text
 * items before this check runs, and with them every math page read as garbled.
 */
export function symbolIntrusions(text: string): [number, number] {
  const cs = chars(text);
  const letters = cs.filter(isAlphabetic).length;
  let n = 0;
  for (let i = 1; i < cs.length - 1; i++) {
    if (SYM.includes(cs[i]) && isAlphabetic(cs[i - 1]) && isAlphabetic(cs[i + 1])) n++;
  }
  return [letters, n];
}

/**
 * Dingbat / symbol fonts map their glyphs (bullets, arrows, checkboxes) to control and
 * private codes by design; that is not a broken map, so they never count as garbled.
 */
export function isSymbolFont(name: string | null | undefined): boolean {
  if (name == null) return false;
  const n = toAsciiLowercase(name);
  const plus = n.indexOf("+");
  const base = plus >= 0 ? n.slice(plus + 1) : n;
  return (
    SYMBOL_FONT_NAMES.some((s) => base.includes(s)) ||
    TEX_FONT_PREFIXES.some((p) => base.startsWith(p))
  );
}

/**
 * (control characters other than tab / newline / carriage return, visible characters
 * plus those controls). A correct ToUnicode map never yields controls; a cipher-like or
 * truncated map does, often as the space glyph, digits or punctuation.
 */
export function controlChars(text: string): [number, number] {
  let ctrl = 0;
  let visible = 0;
  for (const c of text) {
    if (isControl(c) && c !== "\t" && c !== "\n" && c !== "\r") ctrl++;
    else if (!isWhitespace(c)) visible++;
  }
  return [ctrl, visible + ctrl];
}

export function controlsAreGarbled(ctrl: number, charCount: number): boolean {
  return ctrl >= CONTROL_MIN && ctrl >= f32(f32(charCount) * CONTROL_MIN_RATE);
}

export function tokensAreGarbled(judged: number, malformed: number): boolean {
  return malformed >= MALFORMED_MIN && malformed >= f32(f32(judged) * MALFORMED_MIN_RATE);
}

export function symbolsAreGarbled(letters: number, intrusions: number): boolean {
  return intrusions >= SYMBOL_MIN && intrusions >= f32(f32(letters) * SYMBOL_MIN_RATE);
}

export function intrusionsAreGarbled(script: number, intrusions: number): boolean {
  return intrusions >= INTRUSION_MIN && intrusions >= f32(f32(script) * INTRUSION_MIN_RATE);
}
