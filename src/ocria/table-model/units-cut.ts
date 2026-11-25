// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/table_model/units.rs (crates-v2.21.2, Apache-2.0): cutting a run into units.

import { isAlphanumeric } from "../rust.js";
import { splitWhitespace } from "../rust-extra.js";
import type { Box4, Ch, Unit, UnitWord } from "./units.js";
import { CELL_GAP, charOf, chIsSpace, fromFrame, median, toFrame } from "./units.js";

const LEADER = new Set([".", "·", "…", "•", "\u{fffd}", "_"]);
const LEADER_MIN = 3;
const NUM_GAP = 0.5;
const ADAPT_X = 2.5;
const ADAPT_MIN = 0.6;

/** A character with its box in the run's reading frame. */
export type FrameCh = [Ch, Box4];

/** Code units to text, pairing UTF-16 surrogate halves and dropping lone ones. */
export function decode(units: readonly number[]): string {
  let s = "";
  const pending: number[] = [];
  // `char::decode_utf16(..).flatten()`: a high half followed by a low half makes one character
  const flush = (): void => {
    let i = 0;
    while (i < pending.length) {
      const u = pending[i];
      if (u >= 0xd800 && u <= 0xdbff && i + 1 < pending.length) {
        const lo = pending[i + 1];
        if (lo >= 0xdc00 && lo <= 0xdfff) {
          s += String.fromCodePoint(0x10000 + ((u - 0xd800) << 10) + (lo - 0xdc00));
          i += 2;
          continue;
        }
      }
      i += 1;
    }
    pending.length = 0;
  };
  for (const u of units) {
    if (u >= 0xd800 && u <= 0xdfff) {
      // `u as u16`
      pending.push(u & 0xffff);
    } else {
      flush();
      const c = charOf(u);
      if (c !== null) s += c;
    }
  }
  flush();
  return s;
}

const DASH = new Set(["-", "–", "−"]);

/** Python `\d` for this use: an ASCII decimal digit (`is_dec`). */
function isDec(c: string): boolean {
  return c >= "0" && c <= "9";
}

/** units.py _NUM: `^[-–−]?\$?\d[\d,.]*%?(?:[-–−]\d[\d,.]*%?)?$` */
export function isNum(t: string): boolean {
  const cs = Array.from(t);
  let i = 0;
  if (i < cs.length && DASH.has(cs[i])) i += 1;
  if (i < cs.length && cs[i] === "$") i += 1;
  const number = (): boolean => {
    if (i >= cs.length || !isDec(cs[i])) return false;
    i += 1;
    while (i < cs.length && (isDec(cs[i]) || cs[i] === "," || cs[i] === ".")) i += 1;
    if (i < cs.length && cs[i] === "%") i += 1;
    return true;
  };
  if (!number()) return false;
  if (i === cs.length) return true;
  // optional range part; `[\d,.]*` is greedy but can't swallow the dash, so no backtracking
  if (DASH.has(cs[i])) {
    i += 1;
    if (number() && i === cs.length) return true;
  }
  return false;
}

function isLead(c: Ch): boolean {
  if (c.c.length !== 1) return false;
  const ch = charOf(c.c[0]);
  return ch !== null && LEADER.has(ch);
}

/** True for characters in a dot-leader run (LEADER_MIN+ leader characters, spaces between). */
export function leaderMask(chars: readonly FrameCh[]): boolean[] {
  const mask = chars.map(() => false);
  let i = 0;
  while (i < chars.length) {
    if (isLead(chars[i][0])) {
      let j = i;
      let k = 0;
      while (j < chars.length && (isLead(chars[j][0]) || chIsSpace(chars[j][0]))) {
        k += isLead(chars[j][0]) ? 1 : 0;
        j += 1;
      }
      if (k >= LEADER_MIN) {
        for (let m = i; m < j; m++) mask[m] = true;
      }
      i = j;
    } else {
      i += 1;
    }
  }
  return mask;
}

/** The gap above which a space in this run is a column gutter (null: too few word gaps). */
export function gutterGap(chars: readonly FrameCh[], h: number): number | null {
  const gaps: number[] = [];
  let prev: number | null = null;
  let spaced = false;
  for (const [c, b] of chars) {
    if (chIsSpace(c)) {
      spaced = true;
      continue;
    }
    if (prev !== null && spaced) gaps.push(b[0] - prev);
    prev = b[2];
    spaced = false;
  }
  if (gaps.length < 3) return null;
  return Math.max(ADAPT_X * median(gaps), ADAPT_MIN * h);
}

/** One group's unit: the box over its ink, median heights and sizes, majority bold, words. */
function groupUnit(chars: readonly FrameCh[], g: readonly number[]): Unit | null {
  const ink = g.filter((k) => !chIsSpace(chars[k][0]));
  if (ink.length === 0) return null;
  const raw = g.flatMap((k) => chars[k][0].c);
  const text = splitWhitespace(decode(raw)).join(" ");
  if (text === "") return null;
  const bx: Box4 = [Infinity, Infinity, -Infinity, -Infinity];
  for (const k of ink) {
    const b = chars[k][1];
    bx[0] = Math.min(bx[0], b[0]);
    bx[1] = Math.min(bx[1], b[1]);
    bx[2] = Math.max(bx[2], b[2]);
    bx[3] = Math.max(bx[3], b[3]);
  }
  const hs = ink.map((k) => chars[k][1][3] - chars[k][1][1]);
  const sizes = ink.map((k) => chars[k][0].size);
  const bolds: boolean[] = [];
  for (const k of ink) {
    const b = chars[k][0].bold;
    if (b !== null) bolds.push(b);
  }
  const bold = bolds.length === 0 ? null : bolds.filter((b) => b).length > bolds.length / 2;
  const words: UnitWord[] = [];
  let w: number[] = [];
  const endWord = (): void => {
    if (w.length === 0) return;
    let x0 = Infinity;
    let x1 = -Infinity;
    for (const k of w) {
      x0 = Math.min(x0, chars[k][1][0]);
      x1 = Math.max(x1, chars[k][1][2]);
    }
    words.push([x0, x1, decode(w.flatMap((k) => chars[k][0].c))]);
    w = [];
  };
  for (const k of g) {
    if (!chIsSpace(chars[k][0])) w.push(k);
    else endWord();
  }
  endWord();
  return {
    bx,
    pbox: [...bx],
    text,
    h: median(hs),
    size: median(sizes),
    bold,
    q: 0,
    minor: false,
    words,
  };
}

/** Split one run (chars with reading-frame boxes) into units. */
export function cut(chars: readonly FrameCh[], h: number): Unit[] {
  const lead = leaderMask(chars);
  const gut = gutterGap(chars, h);
  const groups: number[][] = [];
  let cur: number[] = [];
  let prev: number | null = null;
  let word = "";
  let lastWord = "";
  let spaced = false;
  for (let k = 0; k < chars.length; k++) {
    const [c, b] = chars[k];
    if (lead[k]) {
      if (cur.length > 0) {
        groups.push(cur);
        cur = [];
        prev = null;
        word = "";
        lastWord = "";
        spaced = false;
      }
      continue;
    }
    if (chIsSpace(c)) {
      if (cur.length > 0) {
        cur.push(k);
        if (word !== "") {
          lastWord = word;
          word = "";
        }
        spaced = true;
      }
      continue;
    }
    let isCut = prev !== null && b[0] - prev > CELL_GAP * h;
    if (!isCut && spaced && gut !== null && prev !== null && b[0] - prev > gut) isCut = true;
    if (!isCut && spaced && prev !== null && b[0] - prev > NUM_GAP * h && isNum(lastWord)) {
      let nxt = decode(c.c);
      for (let x = k + 1; x < Math.min(chars.length, k + 1 + 23); x++) {
        if (chIsSpace(chars[x][0])) break;
        nxt += decode(chars[x][0].c);
      }
      isCut = isNum(nxt);
    }
    if (isCut) {
      groups.push(cur);
      cur = [];
      lastWord = "";
    }
    cur.push(k);
    word += decode(c.c);
    spaced = false;
    prev = b[2];
  }
  if (cur.length > 0) groups.push(cur);
  const out: Unit[] = [];
  for (const g of groups) {
    const u = groupUnit(chars, g);
    if (u !== null) out.push(u);
  }
  return out;
}

/** Units of one raw run, built in the reading frame of direction q. */
export function runUnits(
  chars: readonly Ch[],
  q: number,
  w: number,
  h: number,
  minor: boolean
): Unit[] {
  const runs: FrameCh[][] = [];
  let cur: FrameCh[] = [];
  for (const c of chars) {
    const bx = toFrame(c.pb, q, w, h);
    if (cur.length > 0 && !chIsSpace(c)) {
      const last = cur.findLast(([x]) => !chIsSpace(x));
      if (last !== undefined) {
        const bb = last[1];
        const hh = Math.max(bb[3] - bb[1], bx[3] - bx[1], 1);
        if (Math.abs((bx[1] + bx[3]) / 2 - (bb[1] + bb[3]) / 2) > 0.6 * hh || bx[0] < bb[0] - hh) {
          runs.push(cur);
          cur = [];
        }
      }
    }
    cur.push([c, bx]);
  }
  if (cur.length > 0) runs.push(cur);
  const units: Unit[] = [];
  for (const run of runs) {
    // the gap scale is a glyph height, from letters and digits only (flat "–" / "." markers
    // would pull the median to ~0 and cut every character apart)
    const alnum = run
      .filter(([c]) => {
        if (c.c.length !== 1) return false;
        const x = charOf(c.c[0]);
        return x !== null && isAlphanumeric(x);
      })
      .map(([, b]) => b[3] - b[1]);
    const hs =
      alnum.length === 0 ? run.filter(([c]) => !chIsSpace(c)).map(([, b]) => b[3] - b[1]) : alnum;
    if (hs.length === 0) continue;
    units.push(...cut(run, median(hs)));
  }
  for (const u of units) {
    u.pbox = fromFrame(u.bx, q, w, h);
    u.q = q;
    u.minor = minor;
  }
  return units;
}
