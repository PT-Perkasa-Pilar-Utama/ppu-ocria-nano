// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/hr.rs (crates-v2.21.2, Apache-2.0).

import { f32, totalCmp } from "../../rust.js";
import type { Rect } from "../../types/geometry.js";
import type { ParsedPage } from "../../types/page.js";

/**
 * Maximum stroke thickness (or |y1-y2|) for a stroke to count as a candidate HR.
 * Thicker shapes are filled rects, not rules.
 */
const HR_MAX_THICKNESS_PT = f32(2.0);

/**
 * Minimum fraction of page width a horizontal stroke must span to count as an HR.
 * Shorter strokes are typically table borders, list bullets, or inline marks.
 */
const HR_MIN_WIDTH_FRACTION = f32(0.3);

/**
 * Vertical tolerance (points) for treating a stroke as "underlining" the
 * nearest text line. Strokes within this band of a text line's baseline are
 * dropped: they're underlines, not rules.
 */
const HR_UNDERLINE_PROXIMITY_PT = f32(3.0);

/**
 * Detect horizontal rules from a page's vector graphics.
 *
 * Returns the accepted HRs (viewport space) as rects, sorted by y ascending.
 * The rect spans the stroke's drawn x-extent and carries its thickness, so a
 * rule reports the region it actually occupies rather than just its baseline.
 * An HR is a roughly horizontal stroke that spans at least
 * `HR_MIN_WIDTH_FRACTION` of the page width, is thinner than
 * `HR_MAX_THICKNESS_PT`, and does not sit on the baseline of any text line
 * (which would make it an underline).
 */
export function detectHorizontalRules(page: ParsedPage): Rect[] {
  if (page.graphics.length === 0 || page.page_width <= 0) return [];
  const minWidth = f32(page.page_width * HR_MIN_WIDTH_FRACTION);
  const rules: Rect[] = [];

  for (const g of page.graphics) {
    if (!("Stroke" in g)) continue;
    const { x1, y1, x2, y2, width } = g.Stroke;
    const dy = Math.abs(f32(y1 - y2));
    const dx = Math.abs(f32(x1 - x2));
    if (dy > HR_MAX_THICKNESS_PT || width > HR_MAX_THICKNESS_PT) continue;
    if (dx < minWidth) continue;
    const y = f32(f32(y1 + y2) * f32(0.5));
    const xmin = Math.min(x1, x2);
    const xmax = Math.max(x1, x2);

    // Drop if this stroke sits on a text-line baseline: it's an underline, not a divider.
    const isUnderline = page.projected_lines.some((line) => {
      const bottom = f32(line.bbox.y + line.bbox.height);
      return (
        Math.abs(f32(y - bottom)) < HR_UNDERLINE_PROXIMITY_PT &&
        xmin >= f32(line.bbox.x - 2) &&
        xmax <= f32(f32(line.bbox.x + line.bbox.width) + 2)
      );
    });
    if (isUnderline) continue;
    rules.push({
      x: xmin,
      y,
      width: Math.max(f32(xmax - xmin), 0),
      // A hairline can report zero thickness; keep the drawn width so the
      // rect is never degenerate.
      height: Math.max(dy, width),
    });
  }

  // Sort + dedup near-duplicates (some PDFs draw the same rule twice).
  rules.sort((a, b) => totalCmp(a.y, b.y));
  const out: Rect[] = [];
  for (const r of rules) {
    const kept = out[out.length - 1];
    // `Vec::dedup_by` compares each element with the last one kept.
    if (kept !== undefined && Math.abs(f32(r.y - kept.y)) < 1) continue;
    out.push(r);
  }
  return out;
}
