// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/table_model/features.rs (crates-v2.21.2, Apache-2.0): unit features.

// Feature layout [N, 68]: 21 geometry / text / style, 32 Fourier terms of the
// centre, 8 LiteParse projection signals, 5 ruling-line flags, then block id
// and leaf id. f32 arithmetic is explicit (`f32()`); the transcendental
// functions go through f64 and round once, which can differ from Rust's libm
// `sinf` / `cosf` / `log1pf` in the last bit.

import { f32, isAlphabetic, isUppercase, isWhitespace, trimEnd } from "../rust.js";
import { isAsciiAlphabetic, splitWhitespace, isAsciiDigit } from "../rust-extra.js";

/** LiteParse's grid-projection signals for one unit (absent when no projected item matched it). */
export type Proj = {
  /** Text the text features read instead of the unit's own (an OCR faint-token read). */
  feat_text: string | null;
  flow: number;
  lc: number;
  rc: number;
  cc: number;
  snap: string;
  block: number;
  leaf: number;
};

export type Box4f = [number, number, number, number];

/**
 * A text unit with what the features need. `bx` is in the text's reading frame, `pbox` on the
 * rendered page (they differ only for sideways text); points, top-left origin, f32.
 */
export type FUnit = {
  bx: Box4f;
  pbox: Box4f;
  text: string;
  h: number;
  bold: boolean | null;
  proj: Proj | null;
};

/** Ruling lines in page points: horizontal `[y, x0, x1]`, vertical `[x, y0, y1]`. */
export type Rules = { h: Array<[number, number, number]>; v: Array<[number, number, number]> };

export const N_FOURIER = 8;
export const FEAT_DIM: number = 21 + 4 * N_FOURIER + 8 + 5 + 2;

const LEAD = new Set(Array.from("([$€£¥+-–−±<>≤≥~"));
const TAIL = new Set(Array.from("%)]*†‡§"));

function median(v: readonly number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  if (n % 2 === 1) return s[(n - 1) / 2];
  return f32(f32(s[n / 2 - 1] + s[n / 2]) / 2);
}

/** tn_core._NUM: `^[\s(\[$€£¥+\-–−±<>≤≥~]*[\d.,]+[%)\]*†‡§a-z]*$` (case-insensitive). */
export function isNumericText(t: string): boolean {
  const cs = Array.from(t);
  const lead = (c: string): boolean => isWhitespace(c) || LEAD.has(c);
  const body = (c: string): boolean => isAsciiDigit(c) || c === "." || c === ",";
  const tail = (c: string): boolean => TAIL.has(c) || isAsciiAlphabetic(c);
  let i = 0;
  while (i < cs.length && lead(cs[i]) && !body(cs[i])) i += 1;
  // the body needs at least one char; regex backtracking can give leading chars back only if
  // they could be body chars, and none of the lead set is a digit, '.' or ','
  const start = i;
  while (i < cs.length && body(cs[i])) i += 1;
  if (i === start) return false;
  return cs.slice(i).every(tail);
}

/** Python str.isdigit (Unicode decimal / digit), close enough for features. */
function isDigit(c: string): boolean {
  // SAFETY: `c` is one code point from `Array.from`.
  const u = c.codePointAt(0) as number;
  return (
    isAsciiDigit(c) ||
    u === 0xb2 ||
    u === 0xb3 ||
    u === 0xb9 ||
    (u >= 0x2070 && u <= 0x2079) ||
    (u >= 0x2080 && u <= 0x2089)
  );
}

/** [N, 4]: a horizontal rule just above / below the unit, a vertical rule just left / right. */
export function unitRuleFeatures(
  boxes: readonly Box4f[],
  rules: Rules,
  h: readonly number[]
): Array<[number, number, number, number]> {
  const out = boxes.map((): [number, number, number, number] => [0, 0, 0, 0]);
  boxes.forEach((b, i) => {
    const hh = Math.max(h[i], f32(0.5));
    for (const r of rules.h) {
      const ov = f32(Math.min(b[2], r[2]) - Math.max(b[0], r[1])) > 0;
      if (!ov) continue;
      const above = f32(b[1] - r[0]);
      const below = f32(r[0] - b[3]);
      if (above >= f32(f32(-0.3) * hh) && above < f32(f32(1.5) * hh)) out[i][0] = 1;
      if (below >= f32(f32(-0.3) * hh) && below < f32(f32(1.5) * hh)) out[i][1] = 1;
    }
    for (const r of rules.v) {
      const ov = f32(Math.min(b[3], r[2]) - Math.max(b[1], r[1])) > 0;
      if (!ov) continue;
      const left = f32(b[0] - r[0]);
      const right = f32(r[0] - b[2]);
      if (left >= f32(f32(-0.3) * hh) && left < f32(2 * hh)) out[i][2] = 1;
      if (right >= f32(f32(-0.3) * hh) && right < f32(2 * hh)) out[i][3] = 1;
    }
  });
  return out;
}

/** [N, N, 2]: rules strictly between two units (spanning both), counts capped at 3, scaled. */
export function pairRuleFeatures(boxes: readonly Box4f[], rules: Rules): Float32Array {
  const n = boxes.length;
  const out = new Float32Array(n * n * 2);
  const cap = 3;
  const cy = boxes.map((b) => f32(f32(b[1] + b[3]) / 2));
  const cx = boxes.map((b) => f32(f32(b[0] + b[2]) / 2));
  // covers[i][r]: rule r runs under unit i's x-range (h) / beside its y-range (v)
  const hcov = boxes.map((b) => rules.h.map((r) => r[1] <= b[2] && r[2] >= b[0]));
  const vcov = boxes.map((b) => rules.v.map((r) => r[1] <= b[3] && r[2] >= b[1]));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (rules.h.length > 0) {
        const lo = Math.min(cy[i], cy[j]);
        const hi = Math.max(cy[i], cy[j]);
        let c = 0;
        rules.h.forEach((rr, r) => {
          if (rr[0] > lo && rr[0] < hi && hcov[i][r] && hcov[j][r]) c += 1;
        });
        out[(i * n + j) * 2] = f32(Math.min(c, cap) / cap);
      }
      if (rules.v.length > 0) {
        const lo = Math.min(cx[i], cx[j]);
        const hi = Math.max(cx[i], cx[j]);
        let c = 0;
        rules.v.forEach((rr, r) => {
          if (rr[0] > lo && rr[0] < hi && vcov[i][r] && vcov[j][r]) c += 1;
        });
        out[(i * n + j) * 2 + 1] = f32(Math.min(c, cap) / cap);
      }
    }
  }
  return out;
}

/** `f32::ln_1p` (through f64, rounded once). */
function ln1p(v: number): number {
  return f32(Math.log1p(v));
}

const PI32 = f32(Math.PI);

/** [N, FEAT_DIM] row-major (tn_core.unit_features with rules; `rules` null = unknown). */
export function unitFeatures(
  units: readonly FUnit[],
  wh: readonly [number, number],
  rules: Rules | null
): Float32Array {
  const [wPg, hPg] = wh;
  const n = units.length;
  const f = new Float32Array(n * FEAT_DIM);
  if (n === 0) return f;
  const b = units.map((u) => u.bx);
  const h = units.map((u) => Math.max(u.h, f32(0.5)));
  const hm = median(h);
  const mid = b.map((x) => f32(f32(x[1] + x[3]) / 2));
  const ruleF = rules
    ? unitRuleFeatures(
        units.map((u) => u.pbox),
        rules,
        units.map((u) => u.h)
      )
    : null;
  for (let i = 0; i < n; i++) {
    let nRow = 0;
    let gapL = 20;
    let gapR = 20;
    let lmax = -Infinity;
    let rmin = Infinity;
    let hasL = false;
    let hasR = false;
    for (let j = 0; j < n; j++) {
      const same = Math.abs(f32(mid[j] - mid[i])) < f32(f32(0.5) * Math.max(h[j], h[i]));
      if (!same) continue;
      nRow = f32(nRow + 1);
      if (j === i) continue;
      if (b[j][2] <= f32(b[i][0] + f32(f32(0.5) * h[i]))) {
        hasL = true;
        lmax = Math.max(lmax, b[j][2]);
      }
      if (b[j][0] >= f32(b[i][2] - f32(f32(0.5) * h[i]))) {
        hasR = true;
        rmin = Math.min(rmin, b[j][0]);
      }
    }
    if (hasL) gapL = Math.min(20, f32(f32(b[i][0] - lmax) / hm));
    if (hasR) gapR = Math.min(20, f32(f32(rmin - b[i][2]) / hm));
    const cx = f32(f32(f32(b[i][0] + b[i][2]) / 2) / wPg);
    const cy = f32(f32(f32(b[i][1] + b[i][3]) / 2) / hPg);
    const t = units[i].proj?.feat_text ?? units[i].text;
    const cs = Array.from(t);
    const len = cs.length;
    const nAlpha = cs.filter((c) => isAlphabetic(c)).length;
    const dig = f32(cs.filter((c) => isDigit(c)).length / Math.max(len, 1));
    const alpha = f32(nAlpha / Math.max(len, 1));
    const upper = f32(cs.filter((c) => isUppercase(c)).length / Math.max(nAlpha, 1));
    const words = splitWhitespace(t).length;
    const numeric = isNumericText(t) ? 1 : 0;
    const tr = trimEnd(t);
    const endp =
      tr.endsWith(".") || tr.endsWith(":") || tr.endsWith(";") || tr.endsWith(",") ? 1 : 0;
    const base = [
      cx,
      cy,
      f32(f32(b[i][2] - b[i][0]) / wPg),
      f32(f32(b[i][3] - b[i][1]) / hPg),
      f32(b[i][0] / wPg),
      f32(b[i][2] / wPg),
      f32(b[i][1] / hPg),
      f32(b[i][3] / hPg),
      f32(h[i] / hm),
      f32(ln1p(len) / 5),
      f32(ln1p(words) / 3),
      dig,
      alpha,
      upper,
      numeric,
      endp,
      f32(ln1p(nRow) / 3),
      f32(gapL / 20),
      f32(gapR / 20),
      units[i].bold === true ? 1 : 0,
      units[i].bold === null ? 0 : 1,
    ];
    const o = i * FEAT_DIM;
    f.set(base, o);
    let k = o + 21;
    for (let q = 0; q < N_FOURIER; q++) {
      const fr = f32(2 ** q * PI32);
      f[k] = Math.sin(f32(fr * cx));
      f[k + 1] = Math.cos(f32(fr * cx));
      f[k + 2] = Math.sin(f32(fr * cy));
      f[k + 3] = Math.cos(f32(fr * cy));
      k += 4;
    }
    const p = units[i].proj;
    if (p) {
      f[k] = 1;
      f[k + 1] = p.flow;
      f[k + 2] = f32(ln1p(p.lc) / 3);
      f[k + 3] = f32(ln1p(p.rc) / 3);
      f[k + 4] = f32(ln1p(p.cc) / 3);
      f[k + 5] = p.snap === "L" ? 1 : 0;
      f[k + 6] = p.snap === "R" ? 1 : 0;
      f[k + 7] = p.snap === "C" ? 1 : 0;
    }
    k += 8;
    if (ruleF) {
      f.set(ruleF[i], k);
      f[k + 4] = 1;
    }
    k += 5;
    f[k] = p ? p.block : -1;
    f[k + 1] = p ? p.leaf : -1;
  }
  return f;
}
