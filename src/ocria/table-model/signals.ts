// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/table_model/mod.rs (crates-v2.21.2, Apache-2.0): projection signals for units.

import { roundF32 } from "../rust-extra.js";
import type { ProjSignalItem, ProjSignals } from "../projection/signals.js";
import { asInt, charCount, f32, trim } from "../rust.js";
import type { Proj } from "./features.js";
import type { PageInput } from "./page-input.js";
import type { Unit } from "./units.js";

/**
 * The text the table model's features read for an OCR faint-token read. LayoutNet reads a lone
 * value-like token ("1", "€1", "1.0") recovered between two cells as a reason to fuse the table's
 * rows (issue #615): the same token as an opaque word leaves the table intact. Tuned to the
 * LayoutNet of OCRia-nano-1 v1.0.0; a retrained model that has seen such tokens may not need it.
 */
export function faintMask(t: string): string {
  return "x".repeat(charCount(t));
}

/** Element-wise equality of two leaf paths (`Vec<u16> ==`). */
export function samePath(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** The id of `path` among `ids`, adding it when new (`position` or push). */
function leafId(ids: number[][], path: number[]): number {
  const i = ids.findIndex((q) => samePath(q, path));
  if (i >= 0) return i;
  ids.push(path);
  return ids.length - 1;
}

/**
 * An OCR page's units and their projection signals, straight from LiteParse's projected OCR
 * items (units.py `_lit_ocr_units`): one unit per item, box in page points, height un-padded
 * (/1.4), leaf ids numbered in item order.
 */
export function ocrUnits(input: PageInput, sig: ProjSignals): [Unit[], Array<Proj | null>] {
  const sx = input.wh[0] / f32(Math.max(sig.width, 1));
  const sy = input.wh[1] / f32(Math.max(sig.height, 1));
  const r1 = (v: number): number => asInt(roundF32(f32(v * 10)));
  const ids: number[][] = [];
  const us: Unit[] = [];
  const proj: Array<Proj | null> = [];
  for (const it of sig.items) {
    const t = trim(it.text);
    const [x, y, w, h] = it.bx;
    if (t === "" || w <= 0 || h <= 0) continue;
    const bx: [number, number, number, number] = [x * sx, y * sy, f32(x + w) * sx, f32(y + h) * sy];
    const path = sig.leaves.find(([b]) => r1(b[0]) === r1(x) && r1(b[1]) === r1(y));
    const leaf = path === undefined ? -1 : leafId(ids, path[1]);
    us.push({
      bx,
      pbox: [...bx],
      text: t,
      h: (bx[3] - bx[1]) / 1.4,
      size: 0,
      bold: null,
      q: 0,
      minor: false,
      words: [],
    });
    proj.push({
      feat_text: it.faint ? faintMask(t) : null,
      flow: it.flow ? 1 : 0,
      lc: it.lc,
      rc: it.rc,
      cc: it.cc,
      snap: it.snap,
      block: it.block,
      leaf,
    });
  }
  return [us, proj];
}

/** The most frequent value, the first seen winning a tie (`vote`). */
function vote<T>(v: readonly T[]): T | null {
  const c: Array<[T, number]> = [];
  for (const x of v) {
    const e = c.find(([k]) => k === x);
    if (e) e[1] += 1;
    else c.push([x, 1]);
  }
  let best: [T, number] | null = null;
  for (const e of c) {
    if (best === null || e[1] > best[1]) best = e;
  }
  return best === null ? null : best[0];
}

/**
 * Each unit's projection signals: the projected items whose centres fall in its page box
 * (padded by a fifth of its height) - flow averaged, anchor counts maxed, snap / block / leaf by
 * vote (first seen wins a tie) - as units.projection_signals does with the dump.
 */
export function joinSignals(input: PageInput, sig: ProjSignals): Array<Proj | null> {
  const [w, h] = input.wh;
  const sx = w / f32(Math.max(sig.width, 1));
  const sy = h / f32(Math.max(sig.height, 1));
  const centre = (b: readonly number[]): [number, number] => [
    f32(b[0] + f32(b[2] / 2)) * sx,
    f32(b[1] + f32(b[3] / 2)) * sy,
  ];
  const items = sig.items.map((it) => centre(it.bx));
  const leafIds: number[][] = [];
  const leaves = sig.leaves.map(([b, path]): [number, number, number] => {
    const id = leafId(leafIds, path);
    const [cx, cy] = centre(b);
    return [cx, cy, id];
  });
  return input.units.map((u): Proj | null => {
    const b = u.pbox;
    const pad = 0.2 * (b[3] - b[1]);
    const inside = (x: number, y: number): boolean =>
      b[0] - pad <= x && x <= b[2] + pad && b[1] - pad <= y && y <= b[3] + pad;
    const hit: ProjSignalItem[] = sig.items.filter((_, i) => inside(items[i][0], items[i][1]));
    if (hit.length === 0) return null;
    const lv = leaves.filter(([x, y]) => inside(x, y)).map((l) => l[2]);
    let flow = 0;
    for (const it of hit) flow = f32(flow + (it.flow ? 1 : 0));
    return {
      feat_text: null,
      flow: f32(flow / hit.length),
      lc: Math.max(...hit.map((it) => it.lc)),
      rc: Math.max(...hit.map((it) => it.rc)),
      cc: Math.max(...hit.map((it) => it.cc)),
      snap: vote(hit.map((it) => it.snap)) ?? " ",
      block: vote(hit.map((it) => it.block)) ?? 0,
      leaf: vote(lv) ?? -1,
    };
  });
}
