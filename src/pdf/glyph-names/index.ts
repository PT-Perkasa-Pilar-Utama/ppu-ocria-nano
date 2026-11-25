// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/glyph_names.rs (crates-v2.21.2, Apache-2.0).

// PostScript glyph-name to Unicode resolution (Adobe Glyph List conventions), used to recover
// text when a font has no usable /ToUnicode CMap.

import { AGL_SUBSET_1 } from "./agl-subset-1.js";
import { AGL_SUBSET_2 } from "./agl-subset-2.js";

const AGL_SUBSET: ReadonlyMap<string, string> = new Map([...AGL_SUBSET_1, ...AGL_SUBSET_2]);

// AGL hex digits are uppercase only.
const AGL_HEX = /^[0-9A-F]+$/;
const ANY_HEX = /^[0-9a-fA-F]+$/;

/** `char::from_u32`: the code point as a string, or null for a surrogate or past U+10FFFF. */
function charFromU32(v: number): string | null {
  if (v > 0x10ffff || (v >= 0xd800 && v <= 0xdfff)) return null;
  return String.fromCodePoint(v);
}

/** `presentation_form_expansion`: ASCII expansion for ligature presentation forms. */
export function presentationFormExpansion(c: string): string | null {
  switch (c) {
    case "ﬀ":
      return "ff";
    case "ﬁ":
      return "fi";
    case "ﬂ":
      return "fl";
    case "ﬃ":
      return "ffi";
    case "ﬄ":
      return "ffl";
    case "ﬅ":
    case "ﬆ":
      return "st";
    default:
      return null;
  }
}

function resolveComponent(comp: string): string | null {
  if (comp === "") return null;

  // uniXXXX: one or more groups of exactly 4 uppercase hex digits
  if (comp.startsWith("uni")) {
    const hex = comp.slice(3);
    if (hex.length > 0 && hex.length % 4 === 0 && AGL_HEX.test(hex)) {
      let s = "";
      for (let i = 0; i < hex.length; i += 4) {
        const c = charFromU32(Number.parseInt(hex.slice(i, i + 4), 16));
        if (c === null) return null;
        s += c;
      }
      return s;
    }
  }

  // uXXXX .. uXXXXXX
  if (comp.startsWith("u")) {
    const hex = comp.slice(1);
    if (hex.length >= 4 && hex.length <= 6 && AGL_HEX.test(hex)) {
      return charFromU32(Number.parseInt(hex, 16));
    }
  }

  return AGL_SUBSET.get(comp) ?? null;
}

/**
 * Resolve a glyph name to its Unicode string. Null when the name is meaningless
 * (subset-generated names like "g42", "cid1234") or unknown.
 */
export function resolveGlyphName(name: string): string | null {
  const base = name.split(".")[0];
  if (base === "") return null;
  let out = "";
  for (const component of base.split("_")) {
    const resolved = resolveComponent(component);
    if (resolved === null) return null;
    for (const c of resolved) out += presentationFormExpansion(c) ?? c;
  }
  return out === "" ? null : out;
}

/** `algorithmic_codepoint`: `uniXXXX` (exactly four hex digits) or `uXXXX`..`uXXXXXX`, either case. */
export function algorithmicCodepoint(base: string): number | null {
  let hex: string;
  if (base.startsWith("uni")) {
    hex = base.slice(3);
    if (hex.length !== 4) return null;
  } else if (base.startsWith("u")) {
    hex = base.slice(1);
    if (hex.length < 4 || hex.length > 6) return null;
  } else {
    return null;
  }
  if (!ANY_HEX.test(hex)) return null;
  const codepoint = Number.parseInt(hex, 16);
  return charFromU32(codepoint) === null ? null : codepoint;
}
