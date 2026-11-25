// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/pdfium/src/document.rs (crates-v2.21.2, Apache-2.0): open, metadata and outline.

import { PdfiumError } from "./error.js";
import type { Library } from "./library.js";
import { Page } from "./page.js";

/** One entry in the document's outline (bookmarks tree). */
export type OutlineEntry = {
  /** Hierarchy depth, 1-based (top-level entries are level 1). */
  level: number;
  title: string;
  /** Zero-based page index of the destination, or null if the destination isn't a page in this document. */
  page_index: number | null;
  /** Y of the destination in PDF user space (origin bottom-left), or null. */
  y: number | null;
};

/** An open PDF document; call `close()` when done with it and its pages. */
export class Document {
  private readonly loadedFormType: number;

  constructor(
    readonly lib: Library,
    readonly handle: number,
    private readonly buffer: number
  ) {
    this.loadedFormType = lib.m._FPDF_GetFormType(handle);
  }

  pageCount(): number {
    return this.lib.m._FPDF_GetPageCount(this.handle);
  }

  formType(): number {
    return this.lib.m._FPDF_GetFormType(this.handle);
  }

  /** `FPDF_GetFormType` as it was when the document was loaded, before any flattening dropped `/AcroForm`. */
  formTypeAtLoad(): number {
    return this.loadedFormType;
  }

  /** `Document::page`. */
  page(index: number): Page {
    const handle = this.lib.m._FPDF_LoadPage(this.handle, index);
    if (handle === 0) throw new PdfiumError("PageNotFound");
    // The export clamps to >= 1.0; guard anyway so a misbehaving binary cannot zero out all geometry.
    const unit = this.lib.m._FPDFPage_GetUserUnit(handle);
    return new Page(this.lib, handle, this.handle, Number.isFinite(unit) && unit >= 1 ? unit : 1);
  }

  /**
   * `Document::meta_text`: the Info dictionary value of `tag`; null when the
   * document has no Info dictionary, "" when it has one without the key.
   */
  metaText(tag: string): string | null {
    const { m, heap } = this.lib;
    return heap.scoped((s) => {
      const tagC = s.cstr(tag);
      const needed = m._FPDF_GetMetaText(this.handle, tagC, 0, 0);
      if (needed < 2) return null;
      const buf = s.alloc(needed);
      const written = m._FPDF_GetMetaText(this.handle, tagC, buf, needed);
      if (written < 2) return null;
      const chars = written / 2;
      const end = heap.m.HEAPU16[(buf >> 1) + chars - 1] === 0 ? chars - 1 : chars;
      return heap.utf16(buf, end);
    });
  }

  /** `Document::page_label`: the `/PageLabels` entry of a zero-based page index, when the document defines one. */
  pageLabel(pageIndex: number): string | null {
    if (pageIndex < 0) return null;
    const { m, heap } = this.lib;
    return heap.scoped((s) => {
      const needed = m._FPDF_GetPageLabel(this.handle, pageIndex, 0, 0);
      // `needed` is the byte length of the UTF-16 label including its NUL: under 4 bytes is empty or absent.
      if (needed < 4) return null;
      const buf = s.alloc(needed);
      const written = m._FPDF_GetPageLabel(this.handle, pageIndex, buf, needed);
      if (written < 4) return null;
      const chars = written / 2;
      const end = heap.m.HEAPU16[(buf >> 1) + chars - 1] === 0 ? chars - 1 : chars;
      const label = heap.utf16(buf, end);
      return label === "" ? null : label;
    });
  }

  /** `Document::outline`: the bookmarks in pre-order; empty when the document has none. */
  outline(): OutlineEntry[] {
    const out: OutlineEntry[] = [];
    const root = this.lib.m._FPDFBookmark_GetFirstChild(this.handle, 0);
    if (root !== 0) this.walkBookmark(root, 1, out);
    return out;
  }

  private walkBookmark(bookmark: number, level: number, out: OutlineEntry[]): void {
    const { m } = this.lib;
    let cur = bookmark;
    while (cur !== 0) {
      const title = this.bookmarkTitle(cur);
      const [pageIndex, y] = this.resolveDest(cur);
      out.push({ level, title, page_index: pageIndex, y });
      const child = m._FPDFBookmark_GetFirstChild(this.handle, cur);
      if (child !== 0) this.walkBookmark(child, Math.min(level + 1, 255), out);
      cur = m._FPDFBookmark_GetNextSibling(this.handle, cur);
    }
  }

  private bookmarkTitle(bookmark: number): string {
    const { m, heap } = this.lib;
    return heap.scoped((s) => {
      const needed = m._FPDFBookmark_GetTitle(bookmark, 0, 0);
      if (needed < 2) return "";
      const buf = s.alloc(needed);
      const written = m._FPDFBookmark_GetTitle(bookmark, buf, needed);
      if (written < 2) return "";
      const chars = written / 2;
      const end = heap.m.HEAPU16[(buf >> 1) + chars - 1] === 0 ? chars - 1 : chars;
      return heap.utf16(buf, end);
    });
  }

  private resolveDest(bookmark: number): [number | null, number | null] {
    const { m, heap } = this.lib;
    let dest = m._FPDFBookmark_GetDest(this.handle, bookmark);
    if (dest === 0) {
      const action = m._FPDFBookmark_GetAction(bookmark);
      if (action !== 0) dest = m._FPDFAction_GetDest(this.handle, action);
    }
    if (dest === 0) return [null, null];
    const index = m._FPDFDest_GetDestPageIndex(this.handle, dest);
    const pageIndex = index >= 0 ? index : null;
    return heap.scoped((s) => {
      const hasX = s.alloc(4);
      const hasY = s.alloc(4);
      const hasZ = s.alloc(4);
      const x = s.alloc(4);
      const y = s.alloc(4);
      const z = s.alloc(4);
      const ok = m._FPDFDest_GetLocationInPage(dest, hasX, hasY, hasZ, x, y, z);
      return [pageIndex, ok !== 0 && heap.i32(hasY) !== 0 ? heap.f32(y) : null];
    });
  }

  /** Close the document and free the bytes it reads from. */
  close(): void {
    this.lib.m._FPDF_CloseDocument(this.handle);
    this.lib.heap.free(this.buffer);
  }
}
