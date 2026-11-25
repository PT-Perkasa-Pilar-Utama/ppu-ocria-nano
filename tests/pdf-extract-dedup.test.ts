// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// Ports the dedup tests of the `#[cfg(test)]` module of liteparse crates/liteparse/src/extract.rs
// (crates-v2.21.2) against src/pdf/extract/dedup.ts.
//
// Not ported: `skip_diagonal_keeps_only_upright_text`, `crop_box_keeps_only_items_fully_inside_region`
// and `content_filters_noop_without_options`. Their subject, `apply_content_filters`, has no port,
// because the PDF entry never sets `skip_diagonal` or `crop_box`.

import { describe, expect, test } from "bun:test";

import { f32, trim } from "../src/ocria/rust.js";
import type { TextItem } from "../src/ocria/types/text-item.js";
import { textItem } from "../src/ocria/types/text-item.js";
import {
  dedupOverlappingItems,
  dedupSameLine,
  isDiagonalRotation,
  stripLeaderRuns,
} from "../src/pdf/extract/dedup.js";

function ti(text: string, x: number, y: number, w: number, h: number): TextItem {
  return textItem({ text, x: f32(x), y: f32(y), width: f32(w), height: f32(h) });
}

describe("extract dedup", () => {
  test("dedup_keeps_adjacent_lines_despite_tall_loose_box", () => {
    // #486: a 9pt hyphen in Cambria Math (Ascent 3116 / Descent -2463) stretches its line to 50.2pt
    // tall, covering 78% of the line above with a 3.9x area ratio, just under the old cutoffs.
    // Adjacent lines must survive; overpaint dedupe requires a shared baseline.
    const items = [
      ti(
        "Based upon payment history, the otherwise applicable premium shall be modified.",
        72,
        83.9,
        325.6,
        10
      ),
      ti(
        "if there are no late fees in the previous 24 months. History is re-",
        72,
        74.4,
        254.7,
        50.2
      ),
      ti("evaluated at each renewal.", 72, 104.7, 107.6, 10),
    ];
    // tall loose box must not drop the line above
    expect(dedupOverlappingItems(items)).toHaveLength(3);
  });

  test("dedup_same_line_allows_true_overpaint", () => {
    // Identical boxes on the same baseline still dedupe.
    expect(dedupSameLine(ti("old", 0, 0, 10, 5), ti("new", 0, 0, 10, 5))).toBe(true);
    // 10.4pt-apart baselines with 10pt-tall boxes do not share a line.
    expect(dedupSameLine(ti("a", 72, 83.9, 325.6, 10), ti("b", 72, 74.4, 254.7, 50.2))).toBe(false);
  });

  test("dedup_drops_earlier_exact_duplicate", () => {
    const out = dedupOverlappingItems([ti("hello", 0, 0, 10, 5), ti("hello", 1, 0, 10, 5)]);
    expect(out).toHaveLength(1);
    expect(out[0].x).toBe(1);
  });

  test("dedup_keeps_non_overlapping", () => {
    const out = dedupOverlappingItems([ti("a", 0, 0, 5, 5), ti("b", 100, 100, 5, 5)]);
    expect(out).toHaveLength(2);
  });

  test("dedup_drops_earlier_when_different_text_overlaps_heavily", () => {
    const out = dedupOverlappingItems([ti("old", 0, 0, 10, 5), ti("new", 0, 0, 10, 5)]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("new");
  });

  test("dedup_keeps_both_when_different_text_overlaps_lightly", () => {
    const out = dedupOverlappingItems([ti("aaa", 0, 0, 10, 5), ti("bbb", 9, 0, 10, 5)]);
    expect(out).toHaveLength(2);
  });

  test("dedup_keeps_overlapping_diagonal_lines", () => {
    // Two stacked lines of one rotated block: their loose axis-aligned bounding boxes overlap
    // heavily, but both must survive (the "Paris has the" / "eiffel tower" @51 degrees regression).
    const out = dedupOverlappingItems([
      { ...ti("Paris has the", 0, 0, 100, 40), rotation: 51 },
      { ...ti("eiffel tower", 5, 5, 100, 40), rotation: 51 },
    ]);
    expect(out).toHaveLength(2);
  });

  test("dedup_keeps_value_merged_with_leader_under_label", () => {
    // #622: the dots under a label and the value after them are one item; the label painted later
    // must not take it for an overpainted layer.
    const out = dedupOverlappingItems([
      ti("....................4711000001", 48, 172, 189.6, 12.3),
      ti("Invoice number", 48, 172, 75.4, 12.3),
    ]);
    expect(out).toHaveLength(2);
  });

  test("dedup_drops_leader_under_value_not_value", () => {
    // #622: a dot run painted under (after) a value is decoration.
    const out = dedupOverlappingItems([
      ti("0A1B2C-3D4E5F-6A7B8C", 176.4, 214, 81.6, 12.3),
      ti("....................", 176.4, 214, 61.2, 12.3),
      ti("..........................................", 48, 214, 128.4, 12.3),
      ti("Account", 48, 214, 41.6, 12.3),
    ]);
    expect(out.map((t) => t.text)).toEqual(["0A1B2C-3D4E5F-6A7B8C", "Account"]);
  });

  test("dedup_still_drops_restamp_differing_only_in_leader_length", () => {
    const out = dedupOverlappingItems([
      ti("Intro ....... 3", 0, 0, 100, 10),
      ti("Intro ......... 3", 0, 0, 100, 10),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("Intro ......... 3");
  });

  test("strip_leader_runs_keeps_short_dot_runs", () => {
    expect(stripLeaderRuns("U.S. Inc...")).toBe("U.S. Inc...");
    expect(stripLeaderRuns("Total . . . . 330")).toBe("Total 330");
    expect(stripLeaderRuns("________")).toBe("");
  });

  test("dedup_noop_for_empty_or_single", () => {
    expect(dedupOverlappingItems([])).toHaveLength(0);
    expect(dedupOverlappingItems([ti("x", 0, 0, 1, 1)])).toHaveLength(1);
  });

  test("is_diagonal_rotation_matches", () => {
    // Within 2 degrees of a right angle: not diagonal.
    expect(isDiagonalRotation(0)).toBe(false);
    expect(isDiagonalRotation(f32(1.9))).toBe(false);
    expect(isDiagonalRotation(90)).toBe(false);
    expect(isDiagonalRotation(f32(271.5))).toBe(false);
    expect(isDiagonalRotation(f32(358.5))).toBe(false);
    // More than 2 degrees off: diagonal (2.57 degree San-francisco case, 51, 324).
    expect(isDiagonalRotation(f32(2.57))).toBe(true);
    expect(isDiagonalRotation(51)).toBe(true);
    expect(isDiagonalRotation(324)).toBe(true);
  });
});

/**
 * The Rust `dedup_pair_drops_earlier` without its debug output, `is_pure_leader` and
 * `leader_covered`, written again from the Rust source. They are private in the TS port, and the
 * oracle must not share the logic under test.
 */
function pairDropsEarlier(a: TextItem, b: TextItem): boolean {
  const ixLeft = Math.max(a.x, b.x);
  const ixRight = Math.min(f32(a.x + a.width), f32(b.x + b.width));
  const iyTop = Math.max(a.y, b.y);
  const iyBottom = Math.min(f32(a.y + a.height), f32(b.y + b.height));
  if (ixLeft >= ixRight || iyTop >= iyBottom) return false;
  const intersection = f32(f32(ixRight - ixLeft) * f32(iyBottom - iyTop));
  const areaA = f32(a.width * a.height);
  const areaB = f32(b.width * b.height);
  const smallerArea = Math.min(areaA, areaB);
  if (!(smallerArea > 0 && f32(intersection / smallerArea) > 0.5)) return false;
  const ha = Math.max(Math.abs(a.height), f32(1e-6));
  const hb = Math.max(Math.abs(b.height), f32(1e-6));
  if (Math.max(ha, hb) > f32(2.5 * Math.min(ha, hb)) && !dedupSameLine(a, b)) return false;
  if (a.text === b.text) return true;
  const sa = stripLeaderRuns(a.text);
  const sb = stripLeaderRuns(b.text);
  if ((sa !== a.text || sb !== b.text) && sa !== sb) return false;
  return !(f32(Math.max(areaA, areaB) / smallerArea) > 5);
}

function isPureLeader(it: TextItem): boolean {
  return trim(it.text) !== "" && stripLeaderRuns(it.text) === "";
}

function leaderCovered(l: TextItem, c: TextItem): boolean {
  if (isPureLeader(c) || trim(c.text) === "" || !dedupSameLine(l, c)) return false;
  const w = f32(Math.min(f32(l.x + l.width), f32(c.x + c.width)) - Math.max(l.x, c.x));
  const h = f32(Math.min(f32(l.y + l.height), f32(c.y + c.height)) - Math.max(l.y, c.y));
  const smaller = Math.min(f32(l.width * l.height), f32(c.width * c.height));
  return w > 0 && h > 0 && smaller > 0 && f32(f32(w * h) / smaller) > 0.5;
}

/**
 * Exhaustive-search oracle: applies the dedup rule ("drop an item iff some later upright item
 * passes the pair predicate") by checking every pair. The grid-backed search must match this on
 * any layout.
 */
function dedupOverlappingItemsExhaustive(items: readonly TextItem[]): TextItem[] {
  if (items.length < 2) return [...items];
  const keep = items.map(() => true);
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (isDiagonalRotation(items[i].rotation) || isDiagonalRotation(items[j].rotation)) continue;
      if (pairDropsEarlier(items[i], items[j])) {
        keep[i] = false;
        break;
      }
    }
  }
  for (let l = 0; l < items.length; l++) {
    if (
      keep[l] &&
      !isDiagonalRotation(items[l].rotation) &&
      isPureLeader(items[l]) &&
      items.some(
        (c, ci) => ci !== l && !isDiagonalRotation(c.rotation) && leaderCovered(items[l], c)
      )
    ) {
      keep[l] = false;
    }
  }
  return items.filter((_, i) => keep[i]);
}

const U64_MASK = (1n << 64n) - 1n;

describe("extract dedup, grid against exhaustive search", () => {
  test("dedup_grid_matches_exhaustive_on_random_layouts", () => {
    // Deterministic LCG so failures reproduce (u64 wrapping arithmetic).
    let state = 0x2545f4914f6cdd1dn;
    const next = (): number => {
      state = (state * 6364136223846793005n + 1442695040888963407n) & U64_MASK;
      return f32(Number(state >> 33n)) / f32(2 ** 31);
    };
    for (let round = 0; round < 50; round++) {
      const n = 20 + ((round * 17) % 300);
      const items: TextItem[] = [];
      for (let k = 0; k < n; k++) {
        // Cluster positions so overlaps are common, vary size so both the area-ratio skip and the
        // oversized side-list trigger, and reuse a small text alphabet so exact-match dedup fires.
        // The draw order is the Rust's: `big`, rotation, x, y, width, height.
        const big = next() < f32(0.05);
        const rotation = next() < f32(0.1) ? 51 : 0;
        const x = f32(next() * 200);
        const y = f32(next() * 3000);
        const width = big ? 500 : f32(4 + f32(next() * 30));
        const height = big ? 2000 : f32(4 + f32(next() * 12));
        items.push({ ...ti(["a", "b", "cc", "ddd"][k % 4], x, y, width, height), rotation });
      }
      const expected = dedupOverlappingItemsExhaustive(items);
      const got = dedupOverlappingItems(items);
      const key = (list: readonly TextItem[]): Array<[string, number, number]> =>
        list.map((it) => [it.text, it.x, it.y]);
      // grid dedup diverged from oracle on this round
      expect(key(got), `round ${round}`).toEqual(key(expected));
    }
  });

  test("dedup_scales_to_ribbon_pages", () => {
    // Single-page CAD exports / receipt ribbons put 10^5 to 10^6 items on one page; dedup must
    // stay effectively linear there. A timeout here means quadratic behavior regressed.
    const n = 200_000;
    const items: TextItem[] = [];
    for (let k = 0; k < n; k++) {
      // Every 10th item is a near-exact restamp of its predecessor (slightly nudged, same text) so
      // the exact-match dedup path fires; everything else is a disjoint grid cell.
      const dup = k % 10 === 0 && k > 0;
      const base = dup ? k - 1 : k;
      const col = base % 40;
      const row = Math.floor(base / 40);
      items.push(ti("cell", f32(f32(col * 5) + (dup ? f32(0.3) : 0)), f32(row * 8), 4, 6));
    }
    const out = dedupOverlappingItems(items);
    const dups = Math.floor((n - 1) / 10);
    // ~dups restamped predecessors dropped
    expect(out.length).toBeLessThanOrEqual(n - dups);
    expect(out.length).toBeGreaterThanOrEqual(n - 2 * dups);
  }, 60_000);
});
