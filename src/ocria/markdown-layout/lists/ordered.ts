// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/lists.rs (crates-v2.21.2, Apache-2.0): ordered-list runs.

import { f32, trim } from "../../rust.js";
import type { ProjectedLine } from "../../types/page.js";
import { splitOrderedMarker } from "./markers.js";

// ── Lettered / roman ordered-list detection ───────────────────────────────
//
// `parseListMarker` deliberately ignores alphabetic (`a.`) and roman (`i.`)
// markers because a single one is indistinguishable from an initial
// ("J. Smith") or a section letter ("A. Background"). The disambiguating
// signal is *sequence*: a real lettered/roman list has consecutive siblings
// (`a, b, c` / `i, ii, iii`) starting at value 1, at a consistent indent.
// `detectOrderedListLines` does a region-wide pre-pass to find those runs;
// only their member lines are then treated as list items by the classifier.

/** Marker family. Case is tracked so an `a, b, c` run doesn't absorb an unrelated `A.` and vice-versa. */
export type MarkerKind = "AlphaLower" | "AlphaUpper" | "RomanLower" | "RomanUpper";

/**
 * Max line-index gap between consecutive members of one run. A list item may
 * wrap over a few body lines, but a marker sitting dozens of lines below its
 * predecessor belongs to different content, so don't chain across it.
 */
const ORDERED_RUN_MAX_LINE_GAP = 12;
/** Indent tolerance for members of one run (same as the description-list track tolerance). */
const ORDERED_RUN_INDENT_TOL_PT = f32(8.0);

const ROMAN_VALUES = new Map([
  ["i", 1],
  ["v", 5],
  ["x", 10],
  ["l", 50],
  ["c", 100],
  ["d", 500],
  ["m", 1000],
]);

/** Value of a lowercase roman-numeral string, or null if not a valid roman numeral. */
export function romanValue(s: string): number | null {
  if (s === "") return null;
  let total = 0;
  let prev = 0;
  for (const c of Array.from(s).reverse()) {
    const v = ROMAN_VALUES.get(c);
    if (v === undefined) return null;
    if (v < prev) {
      total -= v;
    } else {
      total += v;
      prev = v;
    }
  }
  return total > 0 ? total : null;
}

/**
 * Possible `[kind, value]` interpretations of a marker body. A single letter
 * like `i` is ambiguous (alpha 9th letter, or roman 1), so both are
 * returned and the sequencer picks whichever continues a run.
 */
export function markerInterpretations(body: string): Array<[MarkerKind, number]> {
  const out: Array<[MarkerKind, number]> = [];
  const cs = Array.from(body);
  if (cs.length === 1 && /^[A-Za-z]$/.test(cs[0])) {
    const c = cs[0];
    // SAFETY: `c` is one ASCII letter, so it has a code point.
    const cp = c.codePointAt(0) as number;
    if (/^[a-z]$/.test(c)) {
      out.push(["AlphaLower", cp - 0x61 + 1]);
      const v = romanValue(c);
      if (v !== null) out.push(["RomanLower", v]);
    } else {
      out.push(["AlphaUpper", cp - 0x41 + 1]);
      const v = romanValue(c.toLowerCase());
      if (v !== null) out.push(["RomanUpper", v]);
    }
    return out;
  }
  // Multi-char: only roman numerals qualify (real lists don't use "ab.").
  if (cs.every((c) => /^[a-z]$/.test(c))) {
    const v = romanValue(body);
    if (v !== null) out.push(["RomanLower", v]);
  } else if (cs.every((c) => /^[A-Z]$/.test(c))) {
    const v = romanValue(body.toLowerCase());
    if (v !== null) out.push(["RomanUpper", v]);
  }
  return out;
}

/** A candidate marker line, in region-local index order. */
type OrderedCandidate = { idx: number; indent: number; interps: Array<[MarkerKind, number]> };

/** An in-progress run of sequential markers sharing kind + indent. */
type OrderedRun = {
  kind: MarkerKind;
  next: number;
  indent: number;
  last_idx: number;
  members: number[];
};

/**
 * Region-wide pre-pass: the set of line indices whose leading alphabetic /
 * roman marker belongs to a confirmed ordered-list run (2 or more sequential
 * siblings starting at value 1, consistent indent, no large document-order
 * gap). Callers treat those lines as ordered list items; unconfirmed one-off
 * markers (initials, lone section letters) are left alone.
 */
export function detectOrderedListLines(
  lines: readonly ProjectedLine[],
  tableCovered: ReadonlySet<number>
): Set<number> {
  const candidates: OrderedCandidate[] = [];
  lines.forEach((l, i) => {
    if (tableCovered.has(i)) return;
    const split = splitOrderedMarker(trim(l.text));
    if (split === null) return;
    const interps = markerInterpretations(split[0]);
    if (interps.length === 0) return;
    candidates.push({ idx: i, indent: l.indent_x, interps });
  });

  const runs: OrderedRun[] = [];
  for (const c of candidates) {
    // Prefer extending the most recently touched matching run (keeps nested
    // levels: an inner `i.` opens its own run while the outer `a,b,c` run
    // stays open at its own indent).
    let extended = false;
    for (let r = runs.length - 1; r >= 0; r--) {
      const run = runs[r];
      if (
        c.idx - run.last_idx <= ORDERED_RUN_MAX_LINE_GAP &&
        Math.abs(f32(run.indent - c.indent)) <= ORDERED_RUN_INDENT_TOL_PT &&
        c.interps.some(([k, v]) => k === run.kind && v === run.next)
      ) {
        run.members.push(c.idx);
        run.next += 1;
        run.last_idx = c.idx;
        extended = true;
        break;
      }
    }
    if (extended) continue;
    // Start a new run only at the first item of a sequence (value 1):
    // `a`, `A`, `i`, `I`. This is what keeps stray `J.` / `A.` out.
    const start = c.interps.find(([, v]) => v === 1);
    if (start !== undefined) {
      runs.push({ kind: start[0], next: 2, indent: c.indent, last_idx: c.idx, members: [c.idx] });
    }
  }

  const confirmed = new Set<number>();
  for (const run of runs) {
    if (run.members.length >= 2) for (const m of run.members) confirmed.add(m);
  }
  return confirmed;
}
