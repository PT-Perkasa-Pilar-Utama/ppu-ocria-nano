// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/classify.rs (crates-v2.21.2, Apache-2.0): table-of-contents page detection.

import { charCount, chars, f32, isAlphabetic, trim } from "../../rust.js";
import type { ParsedPage } from "../../types/page.js";
import { isTocTitle, pageIsToc } from "../headings/index.js";
import { isRotatedLine } from "./rotated.js";

/**
 * Fallback TOC detection: when projection truncates the trailing page
 * numbers on TOC entries (common when entries use dot-leaders that the
 * projection eats), `page_is_toc` misses. If a `Contents` / `Table of
 * Contents` title is the first text on the page, treat the rest as TOC
 * entries even without page-number tails. Guard: don't fire if the page
 * has a substantial body paragraph (≥3 lines of ≥80 chars each) — that's
 * a real content page that just happens to mention "contents" near the
 * top.
 */
function titleLeadsTocPage(page: ParsedPage): boolean {
  let sawTitle = false;
  let longLines = 0;
  for (const line of page.projected_lines) {
    if (isRotatedLine(line)) continue;
    const t = trim(line.text);
    if (t === "") continue;
    if (!sawTitle) {
      if (isTocTitle(t)) {
        sawTitle = true;
        continue;
      }
      if (charCount(t) > 40) break;
    } else if (charCount(t) >= 80) {
      // Dot-leader fragments ("`. . . . . . . .`") are part of
      // TOC layout, not body paragraphs — skip them.
      const alpha = chars(t).filter(isAlphabetic).length;
      const alphaRatio = f32(alpha / charCount(t));
      if (alphaRatio < f32(0.3)) continue;
      longLines += 1;
      if (longLines >= 3) {
        sawTitle = false;
        break;
      }
    }
  }
  return sawTitle;
}

/**
 * TOC suppression: when ≥3 lines on this page look like TOC entries
 * (alpha body + trailing page-number), demote heading promotion so each
 * entry stays a paragraph instead of becoming a fake H1/H2. The TOC's
 * own title ("Contents", "Table of Contents") is shorter without a
 * trailing number — it falls through the size/bold heuristics with no
 * special handling needed.
 */
export function isTocPage(page: ParsedPage): boolean {
  return pageIsToc(page) || titleLeadsTocPage(page);
}
