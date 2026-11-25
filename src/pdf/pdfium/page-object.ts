// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/pdfium/src/page_object.rs (crates-v2.21.2, Apache-2.0): the accessors the clip, complexity and table paths use.

import type { Library } from "./library.js";
import type { SegmentKind } from "./page-paths.js";
import { objectMatrix, readColor } from "./page-paths.js";
import type { Page } from "./page.js";
import type { Color, Matrix, RectF } from "./types.js";

export type PageObjectKind = "Text" | "Path" | "Image" | "Shading" | "Form" | "Unknown";

/** `FPDFPath_GetDrawMode`: a path neither filled nor stroked is a clipping path. */
export type PathDrawMode = { filled: boolean; stroked: boolean };

/** A path segment as pdfium reports it: the point is in the object's own space. */
export type RawPathSegment = {
  kind: SegmentKind | null;
  point: [number, number] | null;
  close: boolean;
};

const KINDS: ReadonlyMap<number, PageObjectKind> = new Map([
  [1, "Text"],
  [2, "Path"],
  [3, "Image"],
  [4, "Shading"],
  [5, "Form"],
]);
const SEGMENT_KINDS: ReadonlyMap<number, SegmentKind> = new Map([
  [0, "LineTo"],
  [1, "BezierTo"],
  [2, "MoveTo"],
]);

/** One content object of a page, borrowed while the page is loaded. */
export class PageObject {
  constructor(
    private readonly lib: Library,
    readonly handle: number,
    private readonly page: number
  ) {}

  /** `Page::object_count`: top-level content objects, 0 on error. */
  static count(page: Page): number {
    return Math.max(0, page.lib.m._FPDFPage_CountObjects(page.handle));
  }

  /** `Page::object`: the top-level object at `index`, in content-stream order. */
  static at(page: Page, index: number): PageObject | null {
    const handle = page.lib.m._FPDFPage_GetObject(page.handle, index);
    return handle === 0 ? null : new PageObject(page.lib, handle, page.handle);
  }

  /** An identity stable while the page is loaded. */
  id(): number {
    return this.handle;
  }

  kind(): PageObjectKind {
    return KINDS.get(this.lib.m._FPDFPageObj_GetType(this.handle)) ?? "Unknown";
  }

  /**
   * `PageObject::clip_paths`: clip paths in the containing form's coordinates.
   * No clip is an empty list; null when a read fails or the paths exceed 1024 segments.
   */
  clipPaths(): RawPathSegment[][] | null {
    const { m, heap } = this.lib;
    const clip = m._FPDFPageObj_GetClipPath(this.handle);
    if (clip === 0) return null;
    const count = m._FPDFClipPath_CountPaths(clip);
    // PDFium returns -1 for an object with no clip-path reference.
    if (count === -1) return [];
    if (count < 0 || count > 1024) return null;
    const paths: RawPathSegment[][] = [];
    let budget = 1024;
    for (let path = 0; path < count; path++) {
      const n = m._FPDFClipPath_CountPathSegments(clip, path);
      if (n < 0 || n > budget) return null;
      budget -= n;
      const segments: RawPathSegment[] | null = heap.scoped((s) => {
        const xy = s.alloc(8);
        const out: RawPathSegment[] = [];
        for (let index = 0; index < n; index++) {
          const segment = m._FPDFClipPath_GetPathSegment(clip, path, index);
          if (segment === 0) return null;
          const kind = SEGMENT_KINDS.get(m._FPDFPathSegment_GetType(segment)) ?? null;
          if (m._FPDFPathSegment_GetPoint(segment, xy, xy + 4) === 0) return null;
          out.push({
            kind,
            point: [heap.f32(xy), heap.f32(xy + 4)],
            close: m._FPDFPathSegment_GetClose(segment) !== 0,
          });
        }
        return out;
      });
      if (segments === null) return null;
      paths.push(segments);
    }
    return paths;
  }

  /** `PageObject::matrix`: null when pdfium reports none. */
  matrix(): Matrix | null {
    const { ok, matrix } = objectMatrix(this.lib, this.handle);
    return ok ? matrix : null;
  }

  /** `PageObject::bounds`: a y-up rect in the space pdfium reports it in. */
  bounds(): RectF | null {
    const { m, heap } = this.lib;
    return heap.scoped((s) => {
      const p = s.alloc(16);
      if (m._FPDFPageObj_GetBounds(this.handle, p, p + 4, p + 8, p + 12) === 0) return null;
      return {
        left: heap.f32(p),
        bottom: heap.f32(p + 4),
        right: heap.f32(p + 8),
        top: heap.f32(p + 12),
      };
    });
  }

  /** `PageObject::form_object_count`: objects inside a Form XObject. */
  formObjectCount(): number | null {
    const count = this.lib.m._FPDFFormObj_CountObjects(this.handle);
    return count >= 0 ? count : null;
  }

  /** `PageObject::form_object`. */
  formObject(index: number): PageObject | null {
    const handle = this.lib.m._FPDFFormObj_GetObject(this.handle, index);
    return handle === 0 ? null : new PageObject(this.lib, handle, this.page);
  }

  /** `PageObject::path_draw_mode`. */
  pathDrawMode(): PathDrawMode | null {
    const { m, heap } = this.lib;
    return heap.scoped((s) => {
      const fill = s.alloc(4);
      const stroke = s.alloc(4);
      if (m._FPDFPath_GetDrawMode(this.handle, fill, stroke) === 0) return null;
      return { filled: heap.i32(fill) !== 0, stroked: heap.i32(stroke) !== 0 };
    });
  }

  strokeWidth(): number | null {
    const { m, heap } = this.lib;
    return heap.scoped((s) => {
      const p = s.alloc(4);
      return m._FPDFPageObj_GetStrokeWidth(this.handle, p) !== 0 ? heap.f32(p) : null;
    });
  }

  strokeColor(): Color | null {
    return readColor(this.lib, (r, g, b, a) =>
      this.lib.m._FPDFPageObj_GetStrokeColor(this.handle, r, g, b, a)
    );
  }

  fillColor(): Color | null {
    return readColor(this.lib, (r, g, b, a) =>
      this.lib.m._FPDFPageObj_GetFillColor(this.handle, r, g, b, a)
    );
  }
}
