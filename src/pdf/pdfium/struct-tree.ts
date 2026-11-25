// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/pdfium/src/struct_tree.rs (crates-v2.21.2, Apache-2.0): `Page::struct_tree`.

import { objectBounds } from "./page-paths.js";
import type { Page, ViewportTransform } from "./page.js";
import { transformBounds } from "./page.js";
import type { RectF } from "./types.js";

/** One node of the tagged-PDF structure tree, flattened in pre-order. */
export type StructNode = {
  /** The role string (`H1`, `P`, `Figure`). */
  role: string;
  /** Marked content ids attached to the element and its non-struct child markers. */
  mcids: number[];
  /** Union bbox in viewport space of the page objects carrying one of `mcids`. */
  bbox: RectF | null;
  alt_text: string | null;
};

function unionRect(a: RectF, b: RectF): RectF {
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  };
}

/** `collect_mcid_bboxes`: `mcid -> union(bbox)` over the page's objects, in viewport space. */
function collectMcidBboxes(page: Page, vp: ViewportTransform): Map<number, RectF> {
  const { m } = page.lib;
  const count = m._FPDFPage_CountObjects(page.handle);
  const map = new Map<number, RectF>();
  for (let i = 0; i < count; i++) {
    const obj = m._FPDFPage_GetObject(page.handle, i);
    if (obj === 0) continue;
    const mcid = m._FPDFPageObj_GetMarkedContentID(obj);
    if (mcid < 0) continue;
    const bounds = objectBounds(page.lib, obj);
    if (bounds === null) continue;
    const [left, bottom, right, top] = bounds;
    const b = transformBounds(vp, { left, top, right, bottom });
    const cur = map.get(mcid);
    map.set(mcid, cur ? unionRect(cur, b) : b);
  }
  return map;
}

/** `read_widestring`: a UTF-16 string through pdfium's query-then-fill protocol. */
function readWidestring(page: Page, getter: (buf: number, len: number) => number): string {
  const { heap } = page.lib;
  return heap.scoped((s) => {
    const needed = getter(0, 0) >>> 0;
    if (needed < 2) return "";
    const buf = s.alloc(needed);
    const written = getter(buf, needed) >>> 0;
    if (written < 2) return "";
    let end = Math.min(written / 2, needed / 2);
    while (end > 0 && heap.m.HEAPU16[(buf >> 1) + end - 1] === 0) end -= 1;
    return heap.utf16(buf, end);
  });
}

function walkElement(
  page: Page,
  elem: number,
  mcidBboxes: Map<number, RectF>,
  out: StructNode[]
): void {
  const { m } = page.lib;
  const role = readWidestring(page, (buf, len) => m._FPDF_StructElement_GetType(elem, buf, len));
  const altRaw = readWidestring(page, (buf, len) =>
    m._FPDF_StructElement_GetAltText(elem, buf, len)
  );
  const altText = altRaw === "" ? null : altRaw;

  const mcids: number[] = [];
  const nMcids = m._FPDF_StructElement_GetMarkedContentIdCount(elem);
  for (let i = 0; i < nMcids; i++) {
    const id = m._FPDF_StructElement_GetMarkedContentIdAtIndex(elem, i);
    if (id >= 0) mcids.push(id);
  }
  // Legacy: the single direct mcid getter (older tag trees expose it here).
  const single = m._FPDF_StructElement_GetMarkedContentID(elem);
  if (single >= 0 && !mcids.includes(single)) mcids.push(single);

  const nChildren = m._FPDF_StructElement_CountChildren(elem);
  for (let i = 0; i < nChildren; i++) {
    // Non-struct children expose their mcid here (-1 when the child is itself a struct element).
    const childMcid = m._FPDF_StructElement_GetChildMarkedContentID(elem, i);
    if (childMcid >= 0 && !mcids.includes(childMcid)) mcids.push(childMcid);
  }

  let bbox: RectF | null = null;
  for (const id of mcids) {
    const b = mcidBboxes.get(id);
    if (b) bbox = bbox ? unionRect(bbox, b) : b;
  }
  out.push({ role, mcids, bbox, alt_text: altText });

  for (let i = 0; i < nChildren; i++) {
    const child = m._FPDF_StructElement_GetChildAtIndex(elem, i);
    if (child !== 0) walkElement(page, child, mcidBboxes, out);
  }
}

/** `Page::struct_tree`: the structure nodes of a tagged page in pre-order; empty for an untagged page. */
export function structTree(page: Page, viewBox: RectF): StructNode[] {
  const { m } = page.lib;
  const tree = m._FPDF_StructTree_GetForPage(page.handle);
  if (tree === 0) return [];
  const mcidBboxes = collectMcidBboxes(page, page.viewportTransform(viewBox));
  const out: StructNode[] = [];
  const count = m._FPDF_StructTree_CountChildren(tree);
  for (let i = 0; i < count; i++) {
    const elem = m._FPDF_StructTree_GetChildAtIndex(tree, i);
    if (elem !== 0) walkElement(page, elem, mcidBboxes, out);
  }
  m._FPDF_StructTree_Close(tree);
  return out;
}
