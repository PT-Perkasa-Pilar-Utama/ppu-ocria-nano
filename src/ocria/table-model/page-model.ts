// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/table_model/mod.rs `run_page_framed` (crates-v2.21.2, Apache-2.0): logits to a page model.

import { f32, charCount } from "../rust.js";
import { blockGroups, maxByLast, splitAtGaps, splitParagraphs } from "./blocks.js";
import type { DecodeOptions, DUnit } from "./decode.js";
import { decodeTables } from "./decode.js";
import { decodeGrid } from "./decode-grid.js";
import { readingOrder } from "./decode-link.js";
import { isChart, isProse, isToc } from "./grid.js";
import { maskMinor } from "./page-input.js";
import type { Logits } from "./net.js";
import type { ModelBlock, ModelTable, PageModel, UnitClass } from "./types.js";
import type { Box4, Unit } from "./units.js";

/** The union of the units' page boxes as a `Rect` (x, y, width, height as f32). */
function unionRect(units: readonly Unit[], g: readonly number[]): ModelTable["bbox"] {
  const b: Box4 = [Infinity, Infinity, -Infinity, -Infinity];
  for (const i of g) {
    const p = units[i].pbox;
    b[0] = Math.min(b[0], p[0]);
    b[1] = Math.min(b[1], p[1]);
    b[2] = Math.max(b[2], p[2]);
    b[3] = Math.max(b[3], p[3]);
  }
  return { x: f32(b[0]), y: f32(b[1]), width: f32(b[2] - b[0]), height: f32(b[3] - b[1]) };
}

/** The tables the logits decode to (after `mask_minor`). */
function decodedTables(units: readonly Unit[], logits: Logits, opt: DecodeOptions): ModelTable[] {
  const du: DUnit[] = units.map((u) => ({ bx: u.bx, text: u.text, h: u.h }));
  const out: ModelTable[] = [];
  for (const g0 of decodeTables(du, logits, opt)) {
    const g = g0.filter((i) => !units[i].minor);
    if (g.length < 2) continue;
    const grid = decodeGrid(du, g, logits, opt);
    // one column is a list or a stack of lines, not a table (seen on OCR pages: a
    // signature block's lines grouped into a 1-wide grid); tables of contents, charts and
    // multi-column prose read as grids are no tables either
    if (grid.n_cols < 2 || isToc(grid) || isChart(grid) || isProse(grid)) continue;
    out.push({ bbox: unionRect(units, g), grid });
  }
  return out;
}

/** Every non-minor unit's block class probabilities: softmax over the class logits. */
function unitClasses(units: readonly Unit[], cl: Logits): UnitClass[] {
  const classes: UnitClass[] = [];
  if (cl.n_cls === 0) return classes;
  const c = cl.n_cls;
  units.forEach((u, i) => {
    if (u.minor) return;
    const z = cl.cls.subarray(i * c, (i + 1) * c);
    const m = z.reduce((a, b) => Math.max(a, b), -Infinity);
    const e = Array.from(z, (v) => f32(Math.exp(f32(v - m))));
    let sum = 0;
    for (const x of e) sum = f32(sum + x);
    const p = u.pbox;
    classes.push({
      bbox: { x: f32(p[0]), y: f32(p[1]), width: f32(p[2] - p[0]), height: f32(p[3] - p[1]) },
      chars: charCount(u.text),
      probs: e.map((v) => f32(v / sum)),
    });
  });
  return classes;
}

/** The summed class logits of a group of units, as the index of the largest. */
function groupClass(cl: Logits, g: readonly number[], fallback: number): number {
  const c = cl.n_cls;
  const sum: number[] = Array.from({ length: c }, () => 0);
  for (const i of g) {
    for (let k = 0; k < c; k++) sum[k] = f32(sum[k] + cl.cls[i * c + k]);
  }
  return maxByLast(sum) ?? fallback;
}

/** The layout blocks of a joint model: units grouped by the same_block head, labelled by their summed class probabilities. */
function layoutBlocks(units: readonly Unit[], cl: Logits): ModelBlock[] {
  const blocks: ModelBlock[] = [];
  const keep: number[] = [];
  units.forEach((u, i) => {
    if (!u.minor) keep.push(i);
  });
  const c = cl.n_cls;
  for (const g of blockGroups(cl, keep)) {
    const class0 = groupClass(cl, g, 0);
    // Groups split at wide horizontal gaps: running headers and footers are rows of
    // separate items (page number, title, section tabs) that the same_block head joins
    // into one page-wide block, and side-by-side text blocks get joined the same way;
    // also at paragraph breaks and heading / body changes.
    const parts = splitAtGaps(g, units).flatMap((part) => splitParagraphs(part, units, cl.cls, c));
    for (const part of parts) {
      // each part takes its own class
      const cls = groupClass(cl, part, class0);
      const text = readingOrder(part.map((i) => units[i].bx))
        .map((k) => units[part[k]].text)
        .join(" ");
      blocks.push({ bbox: unionRect(units, part), class: cls, text });
    }
  }
  return blocks;
}

/**
 * The page model from the logits: tables, block classes and layout blocks. `logits` are the
 * table model's own (masked here for minor units); `layoutLogits` are a separate layout model's,
 * when one ran. `hasLayoutNet` is whether a layout net was given at all.
 */
export function pageModelFromLogits(
  units: readonly Unit[],
  logits: Logits,
  layoutLogits: Logits | null,
  hasLayoutNet: boolean,
  opt: DecodeOptions
): PageModel {
  maskMinor(
    logits,
    units.map((u) => u.minor)
  );
  const tables = decodedTables(units, logits, opt);
  // block classes: from the layout model when one is given (same units and features), else
  // from the table model's own class head (a joint model)
  const cl = layoutLogits ?? logits;
  const classes = unitClasses(units, cl);
  const blocks = cl.n_pair === 5 && cl.n_cls > 0 && !hasLayoutNet ? layoutBlocks(units, cl) : [];
  return { tables, classes, blocks };
}
