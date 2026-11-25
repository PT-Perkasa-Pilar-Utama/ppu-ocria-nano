// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/classify.rs (crates-v2.21.2, Apache-2.0): the layout model's view of a page.

import { roundF32 } from "../../rust-extra.js";
import { asInt, f32, isAlphanumeric, isWhitespace, trim } from "../../rust.js";
import { rectExtend } from "../../types/geometry.js";
import type { Rect } from "../../types/geometry.js";
import type { ParsedPage, ProjectedLine } from "../../types/page.js";
import type { TextItem } from "../../types/text-item.js";

/**
 * Which heuristic table detectors run on a page: all of them (`On`), or (`Smart`, on pages the
 * learned table model ran on) only tables whose cells don't read as prose columns.
 */
export type HeuristicTables = "On" | "Smart";

/** `line` cut down to the spans in `rest` (text and box rebuilt from them); `null` when empty. */
export function residualLine(line: ProjectedLine, rest: TextItem[]): ProjectedLine | null {
  if (rest.every((sp) => trim(sp.text) === "")) return null;
  const f32Max = 3.4028234663852886e38;
  let x0 = f32Max;
  let y0 = f32Max;
  let x1 = -f32Max;
  let y1 = -f32Max;
  for (const sp of rest) {
    x0 = Math.min(x0, sp.x);
    y0 = Math.min(y0, sp.y);
    x1 = Math.max(x1, f32(sp.x + sp.width));
    y1 = Math.max(y1, f32(sp.y + sp.height));
  }
  return {
    ...line,
    text: rest
      .map((sp) => trim(sp.text))
      .filter((t) => t !== "")
      .join(" "),
    bbox: { x: x0, y: y0, width: f32(x1 - x0), height: f32(y1 - y0) },
    indent_x: x0,
    spans: rest,
  };
}

/**
 * Characters that identify text when matching a model table's cells back to its lines:
 * letters, digits and any non-ASCII glyph (combining marks), never ASCII punctuation - units
 * drop leader dots and the like, which would leave a covered line looking uncovered.
 */
export function textChar(ch: string): boolean {
  // SAFETY: `ch` is one code point from a string iteration.
  const cp = ch.codePointAt(0) as number;
  return isAlphanumeric(ch) || (cp >= 0x80 && !isWhitespace(ch));
}

/**
 * Which heuristic table detectors run on `page`. Only pages the learned table model ran on
 * (non-empty `model_classes`) are affected.
 */
export function heuristicTablesMode(page: ParsedPage): HeuristicTables {
  if (page.model_classes.length === 0) return "On";
  // `Smart` keeps the borderless heuristic's real tables that TableNet misses (scores better on
  // table benchmarks than running no heuristic detectors)
  return "Smart";
}

/** Whether `(cx, cy)` lies inside `b` grown by one point on every side. */
function centreInside(b: Rect, cx: number, cy: number): boolean {
  return (
    f32(b.x - 1) <= cx &&
    cx <= f32(f32(b.x + b.width) + 1) &&
    f32(b.y - 1) <= cy &&
    cy <= f32(f32(b.y + b.height) + 1)
  );
}

function centre(b: Rect): [number, number] {
  return [f32(b.x + f32(b.width / 2)), f32(b.y + f32(b.height / 2))];
}

/**
 * Mean P(Table) of the layout model over the units centred in `boxes` (page space), weighted
 * by their characters. null without a layout model or when no unit lies inside.
 */
export function modelTableProb(page: ParsedPage, boxes: readonly Rect[]): number | null {
  if (page.model_classes.length === 0) return null;
  let w = 0;
  let p = 0;
  for (const u of page.model_classes) {
    const [cx, cy] = centre(u.bbox);
    if (boxes.some((b) => centreInside(b, cx, cy))) {
      const k = Math.max(u.chars, 1);
      w = f32(w + k);
      p = f32(p + f32(k * u.probs[6]));
    }
  }
  return w > 0 ? f32(p / w) : null;
}

/**
 * A heuristic table the layout model reads as not a table: its mean P(Table) over the table's
 * own lines (`lines`) is under 0.3. Heuristic tables only see lines no model table claimed, so
 * these are aligned prose, stat panels, timelines and the like read as grids; their lines fall
 * through to paragraphs. A higher threshold (0.5) scored the same; limiting the check to short
 * (<= 3-row) tables kept half the gain, since some false tables are large.
 */
export function modelVetoesTable(page: ParsedPage, lines: readonly ProjectedLine[]): boolean {
  const p = modelTableProb(page, linePageBoxes(page, lines));
  return p !== null && p < f32(0.3);
}

/** `(P(heading or title), P(title), promote threshold, demote threshold)`. */
export type ModelHeading = [number, number, number, number];

/**
 * The joint layout model's view of a line: (P(heading or title), P(title), promote threshold,
 * demote threshold) - probabilities averaged over the units centred in the line, weighted by
 * their characters. null without a layout model.
 */
export function modelHeading(page: ParsedPage, line: ProjectedLine): ModelHeading | null {
  if (page.model_classes.length === 0) return null;
  const promote = f32(0.6);
  const demote = f32(0.15);
  const b = line.bbox;
  let w = 0;
  let ph = 0;
  let pt = 0;
  for (const u of page.model_classes) {
    const [cx, cy] = centre(u.bbox);
    if (centreInside(b, cx, cy)) {
      const k = Math.max(u.chars, 1);
      w = f32(w + k);
      ph = f32(ph + f32(k * f32(u.probs[1] + u.probs[2])));
      pt = f32(pt + f32(k * u.probs[2]));
    }
  }
  return w > 0 ? [f32(ph / w), f32(pt / w), promote, demote] : null;
}

/**
 * A projected (upright-frame) box mapped back to page space through the page's
 * `projected_item_frames`: the union of the original boxes of the items whose projected
 * centres fall inside it. null when no item does.
 */
export function framePageBox(b: Rect, frames: ReadonlyArray<[Rect, Rect]>): Rect | null {
  let out: Rect | null = null;
  for (const [proj, orig] of frames) {
    const [cx, cy] = centre(proj);
    if (centreInside(b, cx, cy)) out = rectExtend(out ?? undefined, orig);
  }
  return out;
}

/**
 * Each projected line's box in the page space the layout model ran in: `pageBoxes`, or on a page
 * whose text projection turned upright (rotated content) the original boxes of its items, since no
 * vertical shift maps the upright frame back to the page.
 */
export function linePageBoxes(page: ParsedPage, lines: readonly ProjectedLine[]): Rect[] {
  const b = pageBoxes(page, lines);
  if (page.projected_item_frames.length > 0) {
    lines.forEach((line, i) => {
      const r = framePageBox(line.bbox, page.projected_item_frames);
      if (r !== null) b[i] = r;
    });
  }
  return b;
}

/** `f32::round(v * scale) as i64` of the key parts `page_boxes` matches items on. */
function quarter(v: number): number {
  return asInt(roundF32(f32(v * 4)));
}

function itemKey(text: string, x: number, w: number): string {
  return JSON.stringify([text, quarter(x), quarter(w)]);
}

/**
 * Each projected line's box in page coordinates. The projection can move text in y (a rotated
 * margin stamp - Federal Register pages - pushes every later group ~a page down), while the
 * model's tables are in page space; x, width and text are kept, so each span is matched to its
 * original text item and the line is shifted back by its most common offset (a span that
 * matches several items, e.g. the same "2022 ...." row in three tables, takes the offset most
 * common on the page).
 */
export function pageBoxes(page: ParsedPage, lines: readonly ProjectedLine[]): Rect[] {
  const orig = new Map<string, number[]>();
  for (const it of page.text_items) {
    const k = itemKey(it.text, it.x, it.width);
    const ys = orig.get(k);
    if (ys === undefined) orig.set(k, [it.y]);
    else ys.push(it.y);
  }
  const cands: number[][] = lines.map((l) =>
    l.spans.flatMap((sp) =>
      (orig.get(itemKey(sp.text, sp.x, sp.width)) ?? []).map((y) =>
        asInt(roundF32(f32(f32(sp.y - y) * 2)))
      )
    )
  );
  const hist = new Map<number, number>();
  for (const c of cands) {
    for (const d of new Set(c)) hist.set(d, (hist.get(d) ?? 0) + 1);
  }
  return lines.map((l, i) => {
    // `max_by_key` keeps the last of equal keys, so `>=` replaces on a tie.
    let best: number | null = null;
    let bestKey: [number, number] = [0, 0];
    for (const d of cands[i]) {
      const key: [number, number] = [hist.get(d) ?? 0, -Math.abs(d)];
      if (best === null || key[0] > bestKey[0] || (key[0] === bestKey[0] && key[1] >= bestKey[1])) {
        best = d;
        bestKey = key;
      }
    }
    const dy = best === null ? 0 : f32(best / 2);
    return { x: l.bbox.x, y: f32(l.bbox.y - dy), width: l.bbox.width, height: l.bbox.height };
  });
}
