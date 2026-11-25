// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/projection.rs (crates-v2.21.2, Apache-2.0): script marks and style pieces.

import { isRtlPieces } from "../bidi.js";
import { f32, isWhitespace, totalCmp, trim } from "../rust.js";
import type { TextItem } from "../types/text-item.js";
import { cloneTextItem } from "./projected-item.js";
import { isBoldItem, isItalicItem, isMonoItem, isStrikeItem } from "./style.js";
import type { ProjectedTextItem } from "./types.js";

function nonSpaceCount(s: string): number {
  let n = 0;
  for (const c of s) if (!isWhitespace(c)) n++;
  return n;
}

const isNative = (p: ProjectedTextItem): boolean => p.item.confidence == null && !p.item.math;

/** An item's own glyph box `(y, height)`: a run split off at a size step carries its host's band. */
const geom = (it: TextItem): [number, number] => it.script_geom ?? [it.y, it.height];

const isScript = (p: ProjectedTextItem): boolean => p.item.sup || p.item.sub;

/**
 * Flag the line's short items set clearly smaller than its body text and raised above its
 * baseline (superscripts: footnote markers, ordinals) or dropped below it (subscripts). The
 * body is the line's tallest-run text by character count; OCR and math items are left alone
 * (OCR boxes are too loose to tell a raised glyph from jitter).
 */
export function markScriptItems(line: ProjectedTextItem[]): void {
  const hs: Array<[number, number]> = line
    .filter((p) => isNative(p) && geom(p.item)[1] > 0.0)
    .map((p): [number, number] => [geom(p.item)[1], nonSpaceCount(p.item.text)]);
  const total = hs.reduce((a, h) => a + h[1], 0);
  if (total < 4) return;
  hs.sort((a, b) => totalCmp(a[0], b[0]));
  let acc = 0;
  let bodyH = 0.0;
  for (const [h, n] of hs) {
    acc += n;
    if (acc * 2 >= total) {
      bodyH = h;
      break;
    }
  }
  const bottoms: number[] = line
    .filter((p) => isNative(p) && geom(p.item)[1] >= f32(bodyH * f32(0.9)))
    .map((p) => f32(geom(p.item)[0] + geom(p.item)[1]));
  if (bottoms.length === 0 || bodyH <= 0.0) return;
  bottoms.sort(totalCmp);
  const base = bottoms[Math.floor(bottoms.length / 2)];
  for (const p of line.filter(isNative)) {
    const it = p.item;
    const n = Array.from(trim(it.text)).length;
    const [gy, gh] = geom(it);
    if (n === 0 || n > 6 || gh > f32(bodyH * f32(0.78))) continue;
    const bottom = f32(gy + gh);
    if (bottom <= f32(base - f32(bodyH * f32(0.2)))) {
      it.sup = true;
    } else if (
      bottom >= f32(base + f32(bodyH * f32(0.1))) &&
      gy >= f32(base - f32(bodyH * f32(0.6)))
    ) {
      it.sub = true;
    }
  }
  unflagStrayScripts(line, bodyH);
}

/**
 * A script hugs the text it marks ("Taha1", "CO2", "substrate41"): a flagged run of three or
 * more items or over 8 characters is a smaller-type phrase on a mixed line (a byline next
 * to a drop cap), and a flagged item with no unflagged neighbour within half the body height
 * is no script either.
 */
function unflagStrayScripts(line: ProjectedTextItem[], bodyH: number): void {
  const order: number[] = line.map((_, i) => i);
  order.sort((a, b) => totalCmp(line[a].item.x, line[b].item.x));
  let k = 0;
  while (k < order.length) {
    if (!isScript(line[order[k]])) {
      k++;
      continue;
    }
    let e = k;
    while (e + 1 < order.length && isScript(line[order[e + 1]])) e++;
    let chars = 0;
    for (let q = k; q <= e; q++) chars += nonSpaceCount(line[order[q]].item.text);
    const near = (i: number | undefined, left: boolean): boolean => {
      if (i === undefined) return false;
      const a = line[order[k]].item;
      const b = line[order[e]].item;
      const n = line[i].item;
      const gap = left ? f32(a.x - f32(n.x + n.width)) : f32(n.x - f32(b.x + b.width));
      return !isScript(line[i]) && gap <= f32(bodyH * f32(0.5));
    };
    const hugs = near(k > 0 ? order[k - 1] : undefined, true) || near(order[e + 1], false);
    if (e - k + 1 >= 3 || chars > 8 || !hugs) {
      for (let q = k; q <= e; q++) {
        line[order[q]].item.sup = false;
        line[order[q]].item.sub = false;
      }
    }
    k = e + 1;
  }
}

/**
 * Keep every merged character in the pieces Markdown renders. Leading-dot
 * continuations with the same style stay in one piece, preserving URLs and numbers.
 */
export function recordStylePiece(prev: TextItem, next: TextItem, sep: string): void {
  if (prev.style_pieces.length === 0) {
    const first = cloneTextItem(prev);
    first.words = [];
    prev.style_pieces.push(first);
  }
  const pieces: TextItem[] = [];
  if (next.style_pieces.length === 0) {
    const piece = cloneTextItem(next);
    piece.words = [];
    pieces.push(piece);
  } else {
    pieces.push(...next.style_pieces.map(cloneTextItem));
  }
  const last = prev.style_pieces[prev.style_pieces.length - 1];
  const first = pieces[0];
  if (
    last &&
    first &&
    sep === "" &&
    first.text.startsWith(".") &&
    sameEmphasis(last, first) &&
    (last.link ?? null) === (first.link ?? null) &&
    !isRtlPieces([last.text, first.text])
  ) {
    const right = Math.max(f32(last.x + last.width), f32(first.x + first.width));
    const bottom = Math.max(f32(last.y + last.height), f32(first.y + first.height));
    last.x = Math.min(last.x, first.x);
    last.y = Math.min(last.y, first.y);
    last.width = f32(right - last.x);
    last.height = f32(bottom - last.y);
    last.text += first.text;
    pieces.shift();
  }
  prev.style_pieces.push(...pieces);
}

/** Whether two items render with the same inline emphasis. */
export function sameEmphasis(a: TextItem, b: TextItem): boolean {
  return (
    isBoldItem(a) === isBoldItem(b) &&
    isItalicItem(a) === isItalicItem(b) &&
    isStrikeItem(a) === isStrikeItem(b) &&
    isMonoItem(a) === isMonoItem(b) &&
    a.underline === b.underline &&
    a.sup === b.sup &&
    a.sub === b.sub
  );
}
