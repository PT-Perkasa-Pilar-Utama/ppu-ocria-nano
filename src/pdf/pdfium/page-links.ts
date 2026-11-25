// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/pdfium/src/page.rs (crates-v2.21.2, Apache-2.0): `Page::links`.

import type { Page } from "./page.js";
import type { RectF } from "./types.js";

/** A URI hyperlink annotation; `rect` is in viewport space, matching text items. */
export type PdfLink = { rect: RectF; uri: string };

const NUL = /^\0+|\0+$/g;

/** `read_uri_path`: the URI action's path, null for non-URI actions or an empty URI. */
function readUriPath(page: Page, action: number): string | null {
  const { m, heap } = page.lib;
  return heap.scoped((s) => {
    // pdfium reports `len + 1` for a URI action (the NUL), 0 for anything else.
    const needed = m._FPDFAction_GetURIPath(page.docHandle, action, 0, 0) >>> 0;
    if (needed < 1) return null;
    const buf = s.alloc(needed);
    const written = m._FPDFAction_GetURIPath(page.docHandle, action, buf, needed) >>> 0;
    if (written < 1) return null;
    const len = Math.min(Math.max(written - 1, 0), needed);
    const uri = new TextDecoder().decode(heap.m.HEAPU8.subarray(buf, buf + len)).replace(NUL, "");
    return uri === "" ? null : uri;
  });
}

/**
 * `Page::links`: URI hyperlink annotations with their clickable rectangles in
 * viewport space. A link that wraps lines has one quad per line; the single
 * annotation rect is used only when no quads are present.
 */
export function pageLinks(page: Page, viewBox: RectF): PdfLink[] {
  const { m, heap } = page.lib;
  const out: PdfLink[] = [];
  heap.scoped((s) => {
    const startPos = s.alloc(4);
    const linkOut = s.alloc(4);
    const quad = s.alloc(32);
    const rectP = s.alloc(16);
    for (;;) {
      if (m._FPDFLink_Enumerate(page.handle, startPos, linkOut) === 0) break;
      const link = heap.u32(linkOut);
      if (link === 0) continue;
      const action = m._FPDFLink_GetAction(link);
      if (action === 0) continue;
      const uri = readUriPath(page, action);
      if (uri === null) continue;

      const quadCount = m._FPDFLink_CountQuadPoints(link);
      let emitted = false;
      for (let q = 0; q < quadCount; q++) {
        if (m._FPDFLink_GetQuadPoints(link, q, quad) === 0) continue;
        const xs = [heap.f32(quad), heap.f32(quad + 8), heap.f32(quad + 16), heap.f32(quad + 24)];
        const ys = [
          heap.f32(quad + 4),
          heap.f32(quad + 12),
          heap.f32(quad + 20),
          heap.f32(quad + 28),
        ];
        out.push({
          rect: page.boundsToViewport(viewBox, {
            left: Math.min(...xs),
            bottom: Math.min(...ys),
            right: Math.max(...xs),
            top: Math.max(...ys),
          }),
          uri,
        });
        emitted = true;
      }
      if (emitted) continue;

      if (m._FPDFLink_GetAnnotRect(link, rectP) === 0) continue;
      out.push({
        rect: page.boundsToViewport(viewBox, {
          left: heap.f32(rectP),
          top: heap.f32(rectP + 4),
          right: heap.f32(rectP + 8),
          bottom: heap.f32(rectP + 12),
        }),
        uri,
      });
    }
  });
  return out;
}
