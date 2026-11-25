// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The grid projection against LiteParse's own values: each golden's recorded
// `merge.pages` goes through `projectPagesForMarkdown` and must give the
// recorded `project.pages` and `project.signals`. Content filters are a no-op
// in these runs, so `merge.pages` is the projection's input.

import { describe, expect, test } from "bun:test";

import { projectPagesForMarkdown } from "../../src/ocria/projection/index.js";
import type { ProjSignals } from "../../src/ocria/projection/signals.js";
import type { ParsedPage } from "../../src/ocria/types/page.js";
import type { Json } from "./parse-golden.js";
import { canon, loadParseGolden, pageFromJson, parseGoldenNames, stage } from "./parse-golden.js";

/** The path and values of the first difference between two canonical values, or null. */
export function firstDiff(a: Json, b: Json, path = ""): string | null {
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const d = firstDiff(a[i] ?? null, b[i] ?? null, `${path}[${i}]`);
      if (d !== null) return d;
    }
    return null;
  }
  if (
    a &&
    b &&
    typeof a === "object" &&
    typeof b === "object" &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = firstDiff(a[k] ?? null, b[k] ?? null, `${path}.${k}`);
      if (d !== null) return d;
    }
    return null;
  }
  return Object.is(a, b) ? null : `${path}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`;
}

/** ParsedPage fields in the order they depend on each other, so the first diff names the failing module. */
const FIELDS = [
  "text_items",
  "text",
  "figures",
  "regions",
  "projected_lines",
  "projected_item_frames",
] as const;

describe.each(parseGoldenNames())("%s", (name) => {
  const g = loadParseGolden(name);
  // SAFETY: the recorder writes merge.pages as an array of Page and project.pages as ParsedPage.
  const input = (stage(g, "merge.pages") as unknown as unknown[]).map(pageFromJson);
  const want = stage(g, "project.pages") as unknown as ParsedPage[];
  const wantSignals = stage(g, "project.signals") as unknown as Record<string, ProjSignals>;
  const signals = new Map<number, ProjSignals>();
  const got = projectPagesForMarkdown(input, signals);

  test("merge.pages to project.pages", () => {
    expect(got.length).toBe(want.length);
    got.forEach((page, i) => {
      for (const field of FIELDS) {
        // canon drops empty fields from an object, so compare each field inside one.
        const d = firstDiff(
          canon({ [field]: page[field] }),
          canon({ [field]: want[i][field] }),
          `pages[${i}]`
        );
        if (d !== null) throw new Error(d);
      }
      expect(canon(page)).toEqual(canon(want[i]));
    });
  });

  test("merge.pages to project.signals", () => {
    const d = firstDiff(canon(signals), canon(wantSignals), "signals");
    if (d !== null) throw new Error(d);
  });
});
