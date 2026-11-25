// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/headings.rs (crates-v2.21.2, Apache-2.0): line-text recognizers.

import { isAlphabetic, trim, trimStart } from "../../rust.js";
import { isAsciiDigit, toAsciiLowercase } from "../../rust-extra.js";

const SECTION_LEADS = ["Sec.", "Sec", "Ch.", "Ch", "Chapter", "Chap.", "Chap", "Part"];

const ATTRIBUTION_PREFIXES = [
  "Source:",
  "Sources:",
  "Note:",
  "Notes:",
  "Adapted from",
  "Reproduced from",
  "Reprinted from",
  "Image:",
  "Image source:",
  "Photo:",
  "Photo credit:",
  "Credit:",
  "Caption:",
];

const CAPTION_PREFIXES = [
  "Figure",
  "Figures",
  "Fig.",
  "Fig ",
  "Table",
  "Tables",
  "Tab.",
  "Tab ",
  "Equation",
  "Eq.",
  "Eq ",
  "Scheme",
  "Chart",
  "Plate",
  "Photo",
  "Algorithm",
  "Listing",
];

const ROMAN_CAPTION_LEADS = ["I", "V", "X", "L", "C"];

function isAsciiUppercase(c: string): boolean {
  return c >= "A" && c <= "Z";
}

/** The text after an optional "Sec", "Ch", "Chapter" or "§" lead-in. */
function stripSectionLead(t: string): string {
  if (t.startsWith("§")) return t.slice(1);
  for (const lead of SECTION_LEADS) {
    if (t.startsWith(lead)) return trimStart(t.slice(lead.length));
  }
  return t;
}

/**
 * Recognize a section-number prefix like "1", "1.5", "A.2", "Sec. 2",
 * "Ch. 3", "§4". Used to exempt numbered subsection headings from the
 * bold-heading run-in guard (which would otherwise reject "1.5. Migrant
 * Workers..." because of the embedded ". " after the section number).
 */
export function isSectionNumberPrefix(s: string): boolean {
  const t = trim(s);
  if (t === "") return false;
  const stripped = stripSectionLead(t);
  // "§" alone counts as a section marker context.
  if (stripped === "") return true;
  let sawDigit = false;
  let prevDot = true;
  for (const c of stripped) {
    if (isAsciiDigit(c)) {
      sawDigit = true;
      prevDot = false;
    } else if (isAsciiUppercase(c) && !prevDot) {
      // Allow a leading letter ("A.2") but not letters mid-segment.
      return false;
    } else if (isAsciiUppercase(c)) {
      prevDot = false;
    } else if (c === ".") {
      if (prevDot) return false;
      prevDot = true;
    } else {
      return false;
    }
  }
  return sawDigit;
}

/**
 * Recognize an attribution / annotation prefix like "Source:",
 * "Note:", "Adapted from", "Reproduced from", "Image:" — these
 * commonly appear as isolated bold-styled lines beneath charts and
 * figures, but they are never section headings.
 */
export function isAttributionLine(text: string): boolean {
  const t = trimStart(text);
  return ATTRIBUTION_PREFIXES.some(
    (p) => t.length >= p.length && toAsciiLowercase(t.slice(0, p.length)) === toAsciiLowercase(p)
  );
}

/**
 * Recognize caption-prefix lines like "Figure 7", "Fig. 12.", "Table 3:",
 * "Tab. 5", "Equation (4)" — these routinely render in a slightly distinct
 * font/size that lands them in the heading_map and gets them promoted to a
 * document-level heading. We want to keep them as plain paragraphs.
 */
export function isCaptionLine(text: string): boolean {
  const t = trimStart(text);
  let firstWord = "";
  for (const c of t) {
    if (!isAlphabetic(c) && c !== ".") break;
    firstWord += c;
  }
  const lowerFirst = toAsciiLowercase(firstWord);
  for (const p of CAPTION_PREFIXES) {
    if (lowerFirst !== toAsciiLowercase(p.trimEnd())) continue;
    // Allow a leading "(" then digit, or directly a digit / roman numeral.
    const rest = Array.from(trimStart(t.slice(firstWord.length)));
    const c0 = rest[0];
    if (c0 === undefined) continue;
    const c1 = rest[1];
    if (
      isAsciiDigit(c0) ||
      (c0 === "(" && c1 !== undefined && isAsciiDigit(c1)) ||
      ROMAN_CAPTION_LEADS.includes(c0)
    ) {
      return true;
    }
  }
  return false;
}
