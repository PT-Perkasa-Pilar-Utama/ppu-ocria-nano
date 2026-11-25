// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The #[cfg(test)] fusion tests of liteparse markdown_layout/cross_region.rs.

import { describe, expect, test } from "bun:test";

import { findCrossRegionTableMerge } from "../../src/ocria/markdown-layout/cross-region/index.js";
import { lineWithSpans } from "../../src/ocria/markdown-layout/test-helpers.js";
import type { ProjectedLine } from "../../src/ocria/types/page.js";

function atRegion(l: ProjectedLine, path: number[]): ProjectedLine {
  l.region_path = path;
  return l;
}

const LABELS = ["MANILA", "CEBU", "CAGAYAN DE ORO", "SUBIC"];
const NUMBERS: Array<[string, string]> = [
  ["2454", "6125"],
  ["1138", "79500"],
  ["958", "13196"],
  ["313", "136"],
];

describe("cross_region fusion", () => {
  test("fusion_drops_indices_when_a_member_has_none", () => {
    const lines: ProjectedLine[] = [];
    LABELS.forEach((label, i) => {
      const l = atRegion(lineWithSpans([[label, 50]], 100 + i * 20, 10), [0, 0]);
      // The second label line carries no provenance.
      l.span_item_indices = i === 1 ? [] : [i];
      lines.push(l);
    });
    NUMBERS.forEach(([a, b], i) => {
      const l = atRegion(
        lineWithSpans(
          [
            [a, 200],
            [b, 280],
          ],
          100 + i * 20,
          10
        ),
        [0, 1]
      );
      l.span_item_indices = [10 + 2 * i, 11 + 2 * i];
      lines.push(l);
    });
    const m = findCrossRegionTableMerge(lines);
    expect(m).not.toBeNull();
    if (m == null) return;
    expect(m.merged.length).toBe(4);
    expect(m.merged[0].span_item_indices).toEqual([0, 10, 11]);
    expect(m.merged[1].span_item_indices).toEqual([]);
    expect(m.merged[2].span_item_indices).toEqual([2, 14, 15]);
  });

  test("fused_lines_keep_span_item_indices_aligned", () => {
    // Fusion re-sorts spans by x; each must keep its own item index.
    const lines: ProjectedLine[] = [];
    const texts: string[] = [];
    LABELS.forEach((label, i) => {
      const l = atRegion(lineWithSpans([[label, 50]], 100 + i * 20, 10), [0, 0]);
      l.span_item_indices = [texts.length];
      texts.push(label);
      lines.push(l);
    });
    NUMBERS.forEach(([a, b], i) => {
      const l = atRegion(
        lineWithSpans(
          [
            [a, 200],
            [b, 280],
          ],
          100 + i * 20,
          10
        ),
        [0, 1]
      );
      l.span_item_indices = [texts.length, texts.length + 1];
      texts.push(a, b);
      lines.push(l);
    });
    const m = findCrossRegionTableMerge(lines);
    expect(m).not.toBeNull();
    if (m == null) return;
    expect(m.merged.length).toBe(4);
    for (const fused of m.merged) {
      expect(fused.spans.length).toBe(fused.span_item_indices.length);
      fused.spans.forEach((span, k) => {
        expect(texts[fused.span_item_indices[k]]).toBe(span.text);
      });
    }
  });
});
