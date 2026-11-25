// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/stages.rs (crates-v2.21.2, Apache-2.0): open, apply_orientation, outline, extract.

import type { OutlineTarget } from "../../ocria/types/document.js";
import { LiteParseError } from "../../ocria/ocr-merge/error.js";
import type { ExtractedPages, ExtractRequest } from "../extract/pages.js";
import { extractPagesAndImages } from "../extract/pages.js";
import type { Document } from "../pdfium/document.js";
import type { Library } from "../pdfium/library.js";

/** `PageOrientationCorrection`: the clockwise angle (0, 90, 180 or 270) one page's content is rotated by. */
export type PageOrientationCorrection = {
  /** 1-based page number. */
  page: number;
  angle: number;
};

/** `quarter_turns_to_apply`: quarter turns to add to `/Rotate`, so undoing `angle` turns the page by `360 - angle`. */
function quarterTurnsToApply(c: PageOrientationCorrection): number {
  switch (c.angle) {
    case 0:
      return 0;
    case 90:
      return 3;
    case 180:
      return 2;
    case 270:
      return 1;
    default:
      throw new LiteParseError(
        "Other",
        `page_orientation_corrections: page ${c.page} has angle ${c.angle}; expected 0, 90, 180 or 270`
      );
  }
}

/**
 * `extract::apply_page_orientation_corrections`: rewrite `/Rotate` on every page named in
 * `corrections`. The rewrite lives in the open document only, so every reopen of the same bytes
 * must apply the same corrections. Pages past the end are skipped.
 */
export function applyOrientation(
  document: Document,
  corrections: readonly PageOrientationCorrection[]
): void {
  const pageCount = Math.max(document.pageCount(), 0);
  for (const correction of corrections) {
    const quarterTurns = quarterTurnsToApply(correction);
    if (quarterTurns === 0 || correction.page === 0 || correction.page > pageCount) continue;
    const page = document.page(correction.page - 1);
    try {
      page.setRotation((((page.rotation() + quarterTurns) % 4) + 4) % 4);
    } finally {
      page.close();
    }
  }
}

/** `stages::open`: open `bytes` and apply the orientation corrections. */
export function open(
  lib: Library,
  bytes: Uint8Array,
  password: string | null,
  corrections: readonly PageOrientationCorrection[]
): Document {
  const document = lib.loadDocumentFromBytes(bytes, password);
  try {
    applyOrientation(document, corrections);
  } catch (error) {
    document.close();
    throw error;
  }
  return document;
}

/** `stages::outline` (`extract_outline`): bookmarks in pre-order; entries without a page are dropped. */
export function outline(document: Document): OutlineTarget[] {
  const out: OutlineTarget[] = [];
  for (const e of document.outline()) {
    if (e.page_index === null) continue;
    out.push({ level: e.level, title: e.title, page_index: e.page_index, y_pdf: e.y });
  }
  return out;
}

/** `stages::extract`. */
export function extract(document: Document, request: ExtractRequest): ExtractedPages {
  return extractPagesAndImages(document, request);
}
