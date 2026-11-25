// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/classify.rs (crates-v2.21.2, Apache-2.0): code-run heuristics.

import { splitWhitespace } from "../../rust-extra.js";
import { chars, f32, isWhitespace, trim, trimEnd, trimStart } from "../../rust.js";

const CODE_SYMBOLS = "{}[];=<>|\\$^~`";

/** A monospace run that reads as prose rather than code: lines of several words, almost no code punctuation. */
export function monoRunReadsAsProse(lines: readonly string[]): boolean {
  const nonempty = lines.map(trim).filter((l) => l !== "");
  if (nonempty.length === 0) return false;
  const words = nonempty.reduce((n, l) => n + splitWhitespace(l).length, 0);
  const nChars = nonempty.reduce((n, l) => n + chars(l).filter((c) => !isWhitespace(c)).length, 0);
  const symbols = nonempty.reduce(
    (n, l) => n + chars(l).filter((c) => CODE_SYMBOLS.includes(c)).length,
    0
  );
  const wordyLines = nonempty.filter((l) => splitWhitespace(l).length >= 4).length;
  return (
    f32(words / nonempty.length) >= 4 &&
    symbols < f32(f32(0.02) * nChars) &&
    wordyLines * 2 >= nonempty.length
  );
}

const CPP_SIGNALS = ["#include", "std::", "int main", "nullptr", "->", "::", "template<"];
const PY_SIGNALS = [
  "self.",
  "import ",
  "from ",
  "def ",
  "class ",
  "print(",
  "lambda ",
  "elif ",
  "f'",
  'f"',
  "__",
  " for ",
  "len(",
  "sorted(",
  "range(",
];
const PY_BLOCK_KEYWORDS = [
  "if ",
  "for ",
  "while ",
  "def ",
  "class ",
  "elif ",
  "else",
  "try",
  "except",
  "with ",
];

/** Occurrences of the single character `ch` in `s` (`str::matches(char).count()`). */
function countChar(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

/**
 * Best-effort language hint for a fenced code block, used as the fence
 * info-string. Conservative: returns a name only when the body carries
 * strong, language-specific signals; otherwise `null` (bare fence). This
 * feeds markdown consumers that key off the language tag (e.g. syntax
 * highlighting).
 */
export function detectCodeLanguage(lines: readonly string[]): string | null {
  const body = lines.join("\n");
  const trimmed = trimStart(body);

  // JSON: starts with a brace/bracket and reads as an object/array with
  // quoted keys. Checked first because `{`/`[` are unambiguous openers.
  const first = chars(trimmed).find((c) => !isWhitespace(c));
  if (
    first !== undefined &&
    (first === "{" || first === "[") &&
    body.includes('":') &&
    countChar(body, "{") + countChar(body, "[") >= 1
  ) {
    return "json";
  }

  // C / C++: preprocessor includes, namespace qualifiers, stream ops.
  if (CPP_SIGNALS.filter((s) => body.includes(s)).length >= 2) return "cpp";

  // Python: keyword-led lines, f-strings, comprehensions, dunder/`self.`.
  const pyHits = PY_SIGNALS.filter((s) => body.includes(s)).length;
  // A colon-terminated control line (`if ...:`, `for ...:`, `def ...:`) is a
  // strong Python tell that other curly-brace languages lack.
  const pyColonBlock = lines.some((l) => {
    const t = trimEnd(l);
    return t.endsWith(":") && PY_BLOCK_KEYWORDS.some((kw) => trimStart(t).startsWith(kw));
  });
  if (pyHits >= 2 || (pyHits >= 1 && pyColonBlock)) return "python";

  return null;
}
