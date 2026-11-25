// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/tex_math/mod.rs (crates-v2.21.2, Apache-2.0).

// Turn collected chars into math-pass glyphs.

import { f32, isWhitespace } from "../../ocria/rust.js";
import { charFromU32 } from "../extract/chars.js";
import { decode } from "./encodings.js";
import type { Enc } from "./encodings.js";
import { TEXT_FAMS, family, fontInfo } from "./fonts.js";
import { PRE, greek } from "./tables.js";
import type { G, RawChar, Role } from "./types.js";

type FamInfo = [fam: string, role: Role | null, enc: Enc | null];

const ASCII_ALPHABETIC = /^[A-Za-z]$/;

/** `char::is_ascii_graphic` on one code point. */
function isAsciiGraphic(ch: string): boolean {
  return ch >= "!" && ch <= "~";
}

/** The glyph's text, or null when the glyph is dropped. */
function glyphText(c: RawChar, enc: Enc | null): string | null {
  // Note: PDFium flags glyphs it could not map; only those are read through the TeX encoding (a
  // ToUnicode'd "{" must stay "{").
  if ("Unicode" in c.text) {
    return isWhitespace(c.text.Unicode) ? null : c.text.Unicode;
  }
  const code = c.text.Code;
  const ch = charFromU32(code);
  // Note: letters and the ASCII a cmmi font draws as itself stay plain text.
  if (enc === "Oml" && ch !== null && (ASCII_ALPHABETIC.test(ch) || ".,</>".includes(ch))) {
    return ch;
  }
  const dec = enc === null ? null : decode(enc, code);
  if (dec !== null) return `${PRE}${dec}`;
  return ch !== null && isAsciiGraphic(ch) ? ch : null;
}

/** Turn collected chars into math-pass glyphs. */
export function glyphs(chars: readonly RawChar[], pageH: number): G[] {
  const out: G[] = [];
  const famCache = new Map<string, FamInfo>();
  for (const c of chars) {
    let info = famCache.get(c.font_name);
    if (info === undefined) {
      const fam = family(c.font_name);
      const [r, e] = fontInfo(fam);
      info = [fam, r, e];
      famCache.set(c.font_name, info);
    }
    const [fam, fontRole, enc] = info;
    const t = glyphText(c, enc);
    if (t === null || t === "") continue;
    let role = fontRole;
    if (role === null && TEXT_FAMS.includes(fam) && greek(t) !== null) {
      role = "Mi"; // upright capital Greek is set in the roman font
    }
    const base = f32(pageH - c.origin_y);
    // Note: the ink box, not an em box. TeX sets \hat{x}'s accent on x's own baseline, so only ink
    // tells the accent sits above; a radical's ink top is where its rule starts. (+4 points over
    // the prototype's font-descriptor boxes on the arXiv math tests.)
    let box = c.ink;
    if (box === null) {
      const bottomUp = f32(base + c.descent);
      box = [f32(pageH - f32(bottomUp + c.size)), f32(pageH - bottomUp)];
    }
    out.push({
      t,
      role,
      fam,
      size: c.size,
      base,
      x0: c.x0,
      x1: c.x1,
      top: box[0],
      bottom: box[1],
      loose: c.loose,
      pre: "",
      post: "",
      src: [c.index],
    });
  }
  return out;
}
