// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The #[cfg(test)] tests of liteparse markdown_layout/inline.rs (crates-v2.21.2), ported.

import { describe, expect, test } from "bun:test";

import {
  appendInlineContinuation,
  escapeInline,
  mathRuns,
  renderLineInline,
} from "../../src/ocria/markdown-layout/inline/index.js";
import { styledLine } from "../../src/ocria/markdown-layout/test-helpers.js";

describe("inline", () => {
  test("render_line_inline_mid_line_bold", () => {
    const l = styledLine(
      [
        ["regular text with", 50, "Arial"],
        ["bold word", 200, "Arial-Bold"],
      ],
      100,
      10
    );
    const out = renderLineInline(l);
    expect(out).toContain("regular text with");
    expect(out).toContain("**bold word**");
    expect(out.startsWith("**")).toBe(false);
  });

  test("render_line_inline_uniform_bold_uses_shortcut", () => {
    const l = styledLine(
      [
        ["first", 50, "Arial-Bold"],
        ["second", 100, "Arial-Bold"],
      ],
      100,
      10
    );
    const out = renderLineInline(l);
    expect(out.startsWith("**") && out.endsWith("**")).toBe(true);
    expect(out.split("**").length - 1).toBe(2);
  });

  test("escape_inline_leaves_dollar_math_alone", () => {
    expect(escapeInline(String.raw`where $x_{i}\in \mathbb{R}$ and a*b`)).toBe(
      String.raw`where $x_{i}\in \mathbb{R}$ and a\*b`
    );
    expect(escapeInline("costs $5 to $10 a*b")).toBe(String.raw`costs $5 to $10 a\*b`);
    expect(escapeInline("$ x*1$")).toBe(String.raw`$ x\*1$`);
    // a plain string: bun mangles non-ASCII text inside String.raw templates
    expect(escapeInline("M×$\\mathbb{R}$3")).toBe("M×$\\mathbb{R}$3");
  });

  test("escape_inline_keeps_intraword_underscores", () => {
    expect(escapeInline("mcc_compliance@masterchemical.com")).toBe(
      "mcc_compliance@masterchemical.com"
    );
    expect(escapeInline("snake_case and x_1")).toBe("snake_case and x_1");
    expect(escapeInline("_lead and trail_ and __init__")).toBe(
      String.raw`\_lead and trail\_ and \_\_init\_\_`
    );
  });

  test("math_runs splits around a math span and keeps non-ASCII text", () => {
    expect(mathRuns("é $a^2$ ü")).toEqual([
      [false, "é "],
      [true, "$a^2$"],
      [false, " ü"],
    ]);
    expect(mathRuns("\\$a$ b")).toEqual([[false, "\\$a$ b"]]);
  });

  test("render_line_inline_escapes_emphasis_chars", () => {
    const l = styledLine([["5*4=20", 50, "Arial"]], 100, 10);
    expect(renderLineInline(l)).toBe("5\\*4=20");
  });

  test("render_line_inline_italic_then_bold", () => {
    const l = styledLine(
      [
        ["italic", 50, "Arial-Italic"],
        ["plain", 100, "Arial"],
        ["bold", 150, "Arial-Bold"],
      ],
      100,
      10
    );
    const out = renderLineInline(l);
    expect(out).toContain("*italic*");
    expect(out).toContain("plain");
    expect(out).toContain("**bold**");
  });

  test("render_line_inline_wraps_link_span", () => {
    const l = styledLine(
      [
        ["see", 50, "Arial"],
        ["the docs", 150, "Arial"],
      ],
      100,
      10
    );
    l.spans[1].link = "https://example.com/docs";
    const out = renderLineInline(l);
    expect(out).toContain("see");
    expect(out).toContain("[the docs](https://example.com/docs)");
  });

  test("render_line_inline_link_wraps_outside_emphasis", () => {
    const l = styledLine([["cite", 50, "Arial-Italic"]], 100, 10);
    l.spans[0].link = "https://example.com/p.pdf";
    expect(renderLineInline(l)).toBe("[*cite*](https://example.com/p.pdf)");
  });

  test("render_line_inline_link_url_with_space_uses_angle_brackets", () => {
    const l = styledLine([["link", 50, "Arial"]], 100, 10);
    l.spans[0].link = "https://example.com/a b";
    expect(renderLineInline(l)).toBe("[link](<https://example.com/a b>)");
  });

  test("emphasis_continues_across_line_join", () => {
    const prev = appendInlineContinuation(
      "hallucinogen. *South African Network on*",
      "Drug Use (2014)",
      "*Drug Use (2014)*"
    );
    expect(prev).toBe("hallucinogen. *South African Network on Drug Use (2014)*");
    expect(appendInlineContinuation("**Bold start**", "ends here", "**ends here** plain")).toBe(
      "**Bold start ends here** plain"
    );
    expect(appendInlineContinuation("**bold**", "italic", "*italic*")).toBe("**bold** *italic*");
    expect(appendInlineContinuation("price 5\\*", "x", "*x*")).toBe("price 5\\* *x*");
  });

  test("underline runs and strike runs continue across a line join", () => {
    expect(appendInlineContinuation("<u>one</u>", "two", "<u>two</u>")).toBe("<u>one two</u>");
    expect(appendInlineContinuation("~~one~~", "two", "~~two~~")).toBe("~~one two~~");
  });

  test("render_line_inline_strike_span", () => {
    const l = styledLine(
      [
        ["keep this", 50, "Arial"],
        ["removed", 150, "Arial"],
      ],
      100,
      10
    );
    l.spans[1].strike = true;
    const out = renderLineInline(l);
    expect(out).toContain("keep this");
    expect(out).toContain("~~removed~~");
  });

  test("render_line_inline_strike_composes_with_bold", () => {
    const l = styledLine([["gone", 50, "Arial-Bold"]], 100, 10);
    l.spans[0].strike = true;
    expect(renderLineInline(l)).toBe("~~**gone**~~");
  });

  test("render_line_inline_mono_span", () => {
    const l = styledLine(
      [
        ["call", 50, "Arial"],
        ["foo()", 100, "Courier"],
        ["on it", 150, "Arial"],
      ],
      100,
      10
    );
    const out = renderLineInline(l);
    expect(out).toContain("`foo()`");
    expect(out).toContain("call");
    expect(out).toContain("on it");
  });

  test("render_line_inline_mono_span_is_not_escaped", () => {
    const l = styledLine(
      [
        ["call", 50, "Arial"],
        ["get_user_id", 100, "Courier"],
        ["now", 200, "Arial"],
      ],
      100,
      10
    );
    const out = renderLineInline(l);
    expect(out).toContain("`get_user_id`");
    expect(out).not.toContain("\\");
  });

  test("render_line_inline_mono_span_keeps_backslashes", () => {
    const l = styledLine(
      [
        ["open", 50, "Arial"],
        [String.raw`C:\Program\bin`, 100, "Courier"],
        ["next", 200, "Arial"],
      ],
      100,
      10
    );
    expect(renderLineInline(l)).toContain("`C:\\Program\\bin`");
  });

  test("render_line_inline_uniform_mono_line_is_not_escaped", () => {
    const l = styledLine([["a_b*c", 50, "Courier"]], 100, 10);
    expect(renderLineInline(l)).toBe("`a_b*c`");
  });

  test("mono_span_with_single_backtick_uses_double_fence", () => {
    const l = styledLine([["a`b", 50, "Courier"]], 100, 10);
    expect(renderLineInline(l)).toBe("`` a`b ``");
  });

  test("mono_span_with_double_backtick_run_uses_longer_fence", () => {
    const l = styledLine([["a``b", 50, "Courier"]], 100, 10);
    expect(renderLineInline(l)).toBe("``` a``b ```");
  });
});
