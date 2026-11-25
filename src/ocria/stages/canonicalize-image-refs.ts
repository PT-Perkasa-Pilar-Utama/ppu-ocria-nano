// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/stages.rs (crates-v2.21.2, Apache-2.0): canonicalize_image_refs.

import type { ExtractedImage } from "../output/types.js";
import type { ParsedPage } from "../types/page.js";

/** `str::replace` of a literal: `replaceAll` would read `$` in the replacement as a pattern. */
function replaceLiteral(s: string, from: string, to: string): string {
  return s.split(from).join(to);
}

/**
 * Point duplicate-image figure references at the canonical image's file
 * name, in every page's markdown and in the full text. Only the canonical
 * image is written to disk, so a `![](img_p2_1.jpg)` for a duplicate
 * placement would otherwise reference a file that does not exist.
 *
 * Returns the rewritten full text (Rust edits `full_text` in place).
 */
export function canonicalizeImageRefs(
  pages: ParsedPage[],
  fullText: string,
  images: readonly ExtractedImage[]
): string {
  const byId = new Map<string, ExtractedImage>(images.map((image) => [image.id, image]));
  const renames: Array<[string, string]> = [];
  for (const image of images) {
    if (image.duplicate_of == null) continue;
    const canonical = byId.get(image.duplicate_of);
    if (canonical === undefined) continue;
    renames.push([`![](img_${image.id}.${image.format})`, `![](${canonical.name})`]);
  }
  if (renames.length === 0) return fullText;

  const rewrite = (markdown: string): string => {
    let out = markdown;
    for (const [from, to] of renames) out = replaceLiteral(out, from, to);
    return out;
  };
  for (const page of pages) page.markdown = rewrite(page.markdown);
  return rewrite(fullText);
}
