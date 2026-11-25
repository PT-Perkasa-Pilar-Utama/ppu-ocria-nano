// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/tex_math/mod.rs (crates-v2.21.2, Apache-2.0).

// Accent glyphs (hats, tildes, bars, wide accents): drop them from a span and wrap the glyphs
// under each in `\hat{..}` etc.

import { f32, totalCmp } from "../../ocria/rust.js";
import { maxSize } from "./helpers.js";
import { gCx } from "./types.js";
import type { G } from "./types.js";

const ACCENT_NAMES: ReadonlyMap<string, string> = new Map([
  ["\u02c6", "hat"],
  ["^", "hat"],
  ["\u02dc", "tilde"],
  ["~", "tilde"],
  ["\u00af", "bar"],
  ["\u02d9", "dot"],
  ["\u00a8", "ddot"],
  ["\u00b4", "acute"],
  ["`", "grave"],
  ["\u02c7", "check"],
  ["\u02d8", "breve"],
  ["\u20d7", "vec"],
]);

/** Accent marks a math-italic font may carry: U+02DC, U+00AF, U+02D9, U+00A8, U+02C6, U+20D7. */
const MI_ACCENT_CHARS = "˜¯˙¨ˆ⃗";

export function accentName(t: string): string | null {
  return ACCENT_NAMES.get(t) ?? null;
}

const ACCENT_PRE = "\0ACC:";

/** The accent command a glyph stands for, or null when it is no accent. */
export function accentOf(g: G): string | null {
  if (g.t.startsWith(ACCENT_PRE)) return g.t.slice(ACCENT_PRE.length);
  if (g.role === null || g.role === "Mi") {
    const a = accentName(g.t);
    if (a !== null && (g.role === null || MI_ACCENT_CHARS.includes(g.t))) return a;
  }
  return null;
}

/**
 * Drop accent glyphs from a span, wrapping the glyphs under each in `\hat{..}` etc. Writes the
 * wrapping into the \`pre\` / \`post\` of the glyphs under each accent.
 */
export function attachAccents(all: G[], sp: readonly number[]): number[] {
  const accs = sp.filter((i) => accentOf(all[i]) !== null);
  if (accs.length === 0) return [...sp];
  const rest = sp.filter((i) => accentOf(all[i]) === null);
  for (const a of accs) {
    const { x0: ax0, x1: ax1, top: atop, size: asz } = all[a];
    const cx = f32(f32(ax0 + ax1) / 2);
    const name = accentOf(all[a]) ?? "";
    const wide = name.startsWith("wide");
    let under: number[];
    if (wide) {
      const restMax = maxSize(all, rest);
      under = rest.filter((g) => {
        const gg = all[g];
        return (
          gg.top > atop &&
          f32(ax0 - f32(f32(0.1) * asz)) <= gCx(gg) &&
          gCx(gg) <= f32(ax1 + f32(f32(0.1) * asz)) &&
          gg.size >= f32(f32(0.9) * restMax)
        );
      });
    } else {
      under = rest.filter((g) => {
        const gg = all[g];
        return (
          gg.top > f32(atop + f32(f32(0.1) * asz)) &&
          f32(gg.x0 - f32(f32(0.15) * asz)) <= cx &&
          cx <= f32(gg.x1 + f32(f32(0.15) * asz))
        );
      });
    }
    if (under.length === 0) continue;
    under.sort((x, y) => totalCmp(all[x].x0, all[y].x0));
    if (!wide) {
      // Keeps the first of equally near glyphs, like the Rust \`reduce\`.
      const pick = under.reduce((best, g) =>
        Math.abs(f32(gCx(all[g]) - cx)) < Math.abs(f32(gCx(all[best]) - cx)) ? g : best
      );
      under = [pick];
    }
    const first = under[0];
    const last = under[under.length - 1];
    all[first].pre += `\\${name}{`;
    all[last].post = `}${all[last].post}`;
  }
  return rest;
}
