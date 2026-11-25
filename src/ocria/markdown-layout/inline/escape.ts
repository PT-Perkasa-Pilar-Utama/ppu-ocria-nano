// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/inline.rs (crates-v2.21.2, Apache-2.0): escaping.

import { chars, isAlphanumeric } from "../../rust.js";

/** Rust `u8::is_ascii_whitespace` on a UTF-16 code unit (non-ASCII units are never ASCII whitespace). */
function isAsciiWhitespaceUnit(u: number): boolean {
  return u === 0x20 || u === 0x09 || u === 0x0a || u === 0x0c || u === 0x0d;
}

/**
 * Escape characters that would otherwise be interpreted as markdown emphasis.
 * Deliberately narrow: only `*`, `_`, and backslash. Aggressive escaping
 * (`#`, `[`, backticks, etc.) breaks more output than it saves in practice.
 * An `_` between two letters or digits stays bare: CommonMark never reads an
 * intraword underscore as emphasis, and `snake_case`, `first_last@host.com`
 * or a URL path should survive verbatim. Inline math (`$…$`, see
 * `mathRuns`) passes through untouched.
 */
export function escapeInline(s: string): string {
  let out = "";
  for (const [isMath, run] of mathRuns(s)) {
    if (isMath) {
      out += run;
      continue;
    }
    const cs = chars(run);
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      const intraword =
        c === "_" &&
        i > 0 &&
        isAlphanumeric(cs[i - 1]) &&
        i + 1 < cs.length &&
        isAlphanumeric(cs[i + 1]);
      if ((c === "\\" || c === "*" || c === "_") && !intraword) out += `\\${c}`;
      else out += c;
    }
  }
  return out;
}

/**
 * Split `s` into runs, flagging the `$…$` spans a renderer reads as inline
 * math under pandoc's `tex_math_dollars` rule: the opening `$` is followed
 * by a non-space, the closing `$` follows a non-space and isn't followed by
 * a digit (so "$5 to $10" stays text) unless the span is plainly LaTeX
 * (`\`, `^`, `_` or `{`). The math pass (`tex_math`) emits its LaTeX this
 * way, and it must reach the output unescaped.
 *
 * Rust scans bytes; every byte tested is ASCII, and a non-ASCII byte matches
 * none of them, so scanning UTF-16 units gives the same runs.
 */
export function mathRuns(s: string): Array<[boolean, string]> {
  const runs: Array<[boolean, string]> = [];
  let lit = 0;
  let i = 0;
  while (i < s.length) {
    const next = i + 1 < s.length ? s.charCodeAt(i + 1) : null;
    const opens =
      s[i] === "$" &&
      (i === 0 || s[i - 1] !== "\\") &&
      next !== null &&
      !isAsciiWhitespaceUnit(next) &&
      next !== 0x24;
    let close: number | null = null;
    if (opens) {
      const rel = s.indexOf("$", i + 1);
      if (rel !== -1) {
        const j = rel;
        const body = s.slice(i + 1, j);
        const latex = /[\\^_{]/.test(body);
        const after = j + 1 < s.length ? s.charCodeAt(j + 1) : null;
        const ok =
          !isAsciiWhitespaceUnit(s.charCodeAt(j - 1)) &&
          s[j - 1] !== "\\" &&
          (latex || !(after !== null && after >= 0x30 && after <= 0x39));
        if (ok) close = j;
      }
    }
    if (close !== null) {
      if (lit < i) runs.push([false, s.slice(lit, i)]);
      runs.push([true, s.slice(i, close + 1)]);
      i = close + 1;
      lit = i;
    } else {
      i += 1;
    }
  }
  if (lit < s.length) runs.push([false, s.slice(lit)]);
  return runs;
}
