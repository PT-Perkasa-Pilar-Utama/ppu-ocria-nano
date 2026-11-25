// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/table_fix.rs (crates-v2.21.2, Apache-2.0): leader and currency rules.

import { chars, trim, trimEnd, trimStart } from "../../rust.js";
import { isAsciiDigit, splitWhitespace } from "../../rust-extra.js";
import { at, single } from "./dense.js";
import type { Dense } from "./dense.js";

const CURRENCY: readonly string[] = ["$", "€", "£", "¥", "US$", "R$"];

const NUMERIC_LEAD = ["(", "-", "−", "–", "."];

/** `t.trim_start()` starts with a digit, or with a sign or bracket followed by a digit. */
export function startsNumeric(text: string): boolean {
  const cs = chars(trimStart(text));
  if (cs.length === 0) return false;
  if (isAsciiDigit(cs[0])) return true;
  return NUMERIC_LEAD.includes(cs[0]) && cs.length > 1 && isAsciiDigit(cs[1]);
}

export function hasDigit(t: string): boolean {
  return chars(t).some(isAsciiDigit);
}

function isLeader(ch: string): boolean {
  return ch === "." || ch === "_" || ch === "·" || ch === "…";
}

/** A run of 4+ leader characters (dots / underscores / middle dots), spaces allowed between. */
export function stripLeaderRuns(t: string): string {
  const cs = chars(t);
  let out = "";
  let i = 0;
  while (i < cs.length) {
    if (isLeader(cs[i])) {
      let j = i;
      let n = 0;
      while (j < cs.length && (isLeader(cs[j]) || cs[j] === " ")) {
        if (isLeader(cs[j])) n++;
        j++;
      }
      if (n >= 4) {
        out += " ";
        i = j;
        continue;
      }
    }
    out += cs[i];
    i++;
  }
  return splitWhitespace(out).join(" ");
}

export function stripLeaders(d: Dense): void {
  for (const c of d.cells) {
    if (
      c.text.includes("....") ||
      c.text.includes("____") ||
      c.text.includes(". . . .") ||
      c.text.includes("…")
    ) {
      c.text = stripLeaderRuns(c.text);
    }
  }
}

/** `$ | 14,046` -> `| $ 14,046`; `8.8 % $ | 13,917` -> `8.8 % | $ 13,917`. */
export function moveCurrency(d: Dense): number[] {
  const emptied: number[] = [];
  for (let r = 0; r < d.n_rows; r++) {
    for (let c = 0; c < Math.max(d.n_cols - 1, 0); c++) {
      const a = single(d, r, c);
      const b = single(d, r, c + 1);
      if (a == null || b == null) continue;
      if (!startsNumeric(d.cells[b].text)) continue;
      const ta = trim(d.cells[a].text);
      if (CURRENCY.includes(ta)) {
        d.cells[b].text = `${ta} ${trim(d.cells[b].text)}`;
        d.cells[a].text = "";
        if (!emptied.includes(c)) emptied.push(c);
        continue;
      }
      // a value with the next column's symbol glued to its end
      const sp = ta.lastIndexOf(" ");
      if (sp >= 0) {
        const head = ta.slice(0, sp);
        const sym = ta.slice(sp + 1);
        if (CURRENCY.includes(sym) && hasDigit(head)) {
          d.cells[a].text = trimEnd(head);
          d.cells[b].text = `${sym} ${trim(d.cells[b].text)}`;
        }
      }
    }
  }
  return emptied;
}

/**
 * Remove a column that moving currency symbols out of left with only empty 1x1 cells or slots
 * covered by spans that also cover a neighbouring column (spans shrink by one). Columns that
 * were empty to begin with are left alone.
 */
export function dropEmptyColumns(d: Dense, emptiedIn: readonly number[]): void {
  let emptied = [...emptiedIn].sort((a, b) => a - b);
  let c = 0;
  while (c < d.n_cols && d.n_cols > 1) {
    if (!emptied.includes(c)) {
      c++;
      continue;
    }
    let removable = true;
    for (let r = 0; r < d.n_rows; r++) {
      const k = at(d, r, c);
      if (k == null) continue;
      const x = d.cells[k];
      if (x.cs === 1 && !(trim(x.text) === "" && x.rs === 1)) {
        removable = false;
        break;
      }
    }
    // keep a column that only spans cover (a structural slot) unless it has no own cell
    const ownsAny = d.cells.some((x) => x.cs === 1 && x.c0 === c);
    if (!removable || !ownsAny) {
      c++;
      continue;
    }
    d.cells = d.cells.filter((x) => !(x.cs === 1 && x.c0 === c));
    for (const x of d.cells) {
      if (x.c0 > c) x.c0 -= 1;
      else if (x.c0 + x.cs > c) x.cs -= 1;
    }
    d.n_cols -= 1;
    // later emptied columns moved left with the removal
    emptied = emptied.filter((e) => e !== c).map((e) => (e > c ? e - 1 : e));
  }
}
