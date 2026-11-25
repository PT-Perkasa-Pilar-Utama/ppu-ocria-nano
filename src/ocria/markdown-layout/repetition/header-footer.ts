// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/repetition.rs (crates-v2.21.2, Apache-2.0): cross-page running header / footer set.

import { f32, trim } from "../../rust.js";
import type { ParsedPage, ProjectedLine } from "../../types/page.js";
import { collapseWhitespace } from "../paragraphs/index.js";
import { matchesChromePattern } from "./chrome-pattern.js";

/**
 * Fraction of page height treated as the "top band" for header detection.
 * Most running headers sit within the top 8–12% of a page; 12% gives some
 * slack for two-line headers without sweeping in body text.
 */
export const HEADER_BAND_FRACTION: number = f32(0.12);

/** Fraction of page height treated as the "bottom band" for footer detection. */
export const FOOTER_BAND_FRACTION: number = f32(0.12);

/**
 * Fraction of pages on which a normalized line must appear (in the same
 * band) to be classified as a running header/footer.
 */
export const HEADER_FOOTER_MIN_FRACTION: number = f32(0.5);

/**
 * Absolute floor on header/footer matches — single-page docs can't have a
 * "running" header by definition, and a single match on a 2-page doc is too
 * weak to act on.
 */
export const HEADER_FOOTER_MIN_PAGES = 2;

/**
 * Maximum number of distinct repeated lines a band may contain before the
 * repetition is treated as a content-bearing letterhead rather than running
 * chrome. Real running headers/footers are 1–3 short lines (running title,
 * classification mark, page number); ERP/accounting letterheads repeat an
 * entire block of labeled fields (`Invoice No`, `Terms`, …) at the top of
 * every page, and stripping those deletes document data from every page.
 * Lines matching a chrome pattern (`Page N of M`, URLs, © marks) are exempt
 * from the cap — they strip regardless of how crowded the band is.
 */
export const MAX_REPEATED_LINES_PER_BAND = 3;

/**
 * Normalize a line for cross-page header/footer matching. Lowercases,
 * collapses whitespace, and replaces every run of ASCII digits with `#` so
 * `Page 1 of 6` and `Page 2 of 6` collapse to the same key.
 */
export function normalizeForRepetition(s: string): string {
  const collapsed = collapseWhitespace(s).toLowerCase();
  let out = "";
  let inDigits = false;
  for (const c of collapsed) {
    if (c >= "0" && c <= "9") {
      if (!inDigits) {
        out += "#";
        inDigits = true;
      }
    } else {
      out += c;
      inDigits = false;
    }
  }
  return out;
}

type Band = "h" | "f";

type KeyStats = { pagesSeen: Set<number>; isChromePattern: boolean };

/** Header band cutoff (a line's top at or above it) and footer band cutoff (a line's bottom at or below it). */
export type BandCutoffs = { header: number; footer: number };

export function bandCutoffs(pageHeight: number): BandCutoffs {
  return {
    header: f32(pageHeight * HEADER_BAND_FRACTION),
    footer: f32(pageHeight * f32(1 - FOOTER_BAND_FRACTION)),
  };
}

/**
 * Cross-page repetition detector. Returns normalized strings prefixed with
 * `h:` or `f:` to retain their margin band. Each key must
 * appear in the top or bottom band of ≥ `HEADER_FOOTER_MIN_FRACTION` of
 * pages (capped below by `HEADER_FOOTER_MIN_PAGES`). The caller uses this to
 * filter `ProjectedLine`s before classification.
 *
 * "Same band" means a line whose top is within `HEADER_BAND_FRACTION` of the
 * page top (header) or whose bottom is within `FOOTER_BAND_FRACTION` of the
 * page bottom (footer). Header and footer bands are tracked separately so a
 * company name that appears as both a header and a body-section title on
 * different pages isn't stripped from the body.
 *
 * Letterhead guard: repetition alone is not a license to delete content. If
 * a band accumulates more than `MAX_REPEATED_LINES_PER_BAND` distinct
 * repeated lines that *don't* match a chrome pattern, the block is a
 * content-bearing letterhead (ERP invoices repeat `Invoice No …` on every
 * page) and those lines are kept everywhere. Pattern-matched lines still
 * strip.
 */
export function computeHeaderFooterSet(pages: readonly ParsedPage[]): Set<string> {
  const set = new Set<string>();
  if (pages.length < HEADER_FOOTER_MIN_PAGES) return set;
  // Keyed by band + ":" + normalized text; the result is a set, so map order does not reach it.
  const counts = new Map<string, KeyStats>();
  for (const page of pages) {
    const { header: headerCutoff, footer: footerCutoff } = bandCutoffs(page.page_height);
    for (const line of page.projected_lines) {
      const text = trim(line.text);
      if (text === "") continue;
      const norm = normalizeForRepetition(text);
      if (norm === "") continue;
      const isPattern = matchesChromePattern(text);
      const lineBottom = f32(line.bbox.y + line.bbox.height);
      const bands: Array<[Band, boolean]> = [
        // Header band: top of line within the top band.
        ["h", line.bbox.y <= headerCutoff],
        // Footer band: bottom of line at or below the footer cutoff.
        ["f", lineBottom >= footerCutoff],
      ];
      for (const [band, inBand] of bands) {
        if (!inBand) continue;
        const key = `${band}:${norm}`;
        const stats = counts.get(key) ?? { pagesSeen: new Set<number>(), isChromePattern: false };
        stats.pagesSeen.add(page.page_number);
        stats.isChromePattern ||= isPattern;
        counts.set(key, stats);
      }
    }
  }
  const threshold = Math.max(
    Math.ceil(f32(f32(pages.length) * HEADER_FOOTER_MIN_FRACTION)),
    HEADER_FOOTER_MIN_PAGES
  );
  // Qualify keys per band, then apply the letterhead guard per band.
  const qualified = new Map<Band, Array<[string, boolean]>>();
  for (const [key, stats] of counts) {
    if (stats.pagesSeen.size < threshold) continue;
    const band: Band = key.startsWith("h:") ? "h" : "f";
    const list = qualified.get(band) ?? [];
    list.push([key, stats.isChromePattern]);
    qualified.set(band, list);
  }
  // Keep the band through lookup: a repeated footer page number normalizes
  // to `#`, which must not remove a numeric plot label in the header band.
  // Figure overlap alone is insufficient to exempt text: logos overlap real
  // running headers too, so those still need repetition-based removal.
  for (const keys of qualified.values()) {
    const nonPattern = keys.filter(([, pat]) => !pat).length;
    const letterhead = nonPattern > MAX_REPEATED_LINES_PER_BAND;
    for (const [key, isPattern] of keys) {
      if (isPattern || !letterhead) set.add(key);
    }
  }
  return set;
}

/**
 * Returns true if `line` (located on `page`) matches the running
 * header/footer set: both the margin band and normalized text must match.
 * This preserves top-band content when only footer text repeats, and vice versa.
 */
export function isHeaderOrFooter(
  line: ProjectedLine,
  page: ParsedPage,
  headerFooter: Set<string>
): boolean {
  if (headerFooter.size === 0) return false;
  const { header: headerCutoff, footer: footerCutoff } = bandCutoffs(page.page_height);
  const norm = normalizeForRepetition(trim(line.text));
  return (
    (line.bbox.y <= headerCutoff && headerFooter.has(`h:${norm}`)) ||
    (f32(line.bbox.y + line.bbox.height) >= footerCutoff && headerFooter.has(`f:${norm}`))
  );
}
