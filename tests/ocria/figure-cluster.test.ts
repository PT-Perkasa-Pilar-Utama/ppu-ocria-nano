// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// figure_cluster.rs: its unit tests, and the figure rectangles of every parse
// golden (merge.pages in, project.pages[].figures out).

import { describe, expect, test } from "bun:test";

import {
  FIG_CLUSTER_GAP_PT,
  clusterBboxesSpatial,
  closeEnough,
  detectFigureRects,
  detectFigureRectsWithClusterer,
  textCoverage,
  ufFind,
  ufUnion,
} from "../../src/ocria/figure-cluster/index.js";
import { f32 } from "../../src/ocria/rust.js";
import { graphicBbox } from "../../src/ocria/types/geometry.js";
import type { GraphicPrimitive, Rect } from "../../src/ocria/types/geometry.js";
import { textItem } from "../../src/ocria/types/text-item.js";
import type { ParsedPage } from "../../src/ocria/types/page.js";
import {
  canon,
  loadParseGolden,
  pageFromJson,
  parseGoldenNames,
  parsedPageFromJson,
  stage,
} from "./parse-golden.js";

function stroke(x1: number, y1: number, x2: number, y2: number): GraphicPrimitive {
  return { Stroke: { x1, y1, x2, y2, color: null, width: 0.5 } };
}

function rect(x: number, y: number, w: number, h: number): GraphicPrimitive {
  return { Rect: { bbox: { x, y, width: w, height: h }, fill: null, stroke: null } };
}

const U64_MASK = (1n << 64n) - 1n;

/** The Rust test's `Lcg`: a 64-bit linear congruential generator. */
class Lcg {
  private state: bigint;
  constructor(seed: number) {
    this.state = BigInt(seed);
  }
  nextU32(): number {
    this.state = (this.state * 6364136223846793005n + 1n) & U64_MASK;
    return Number(this.state >> 32n);
  }
  range(min: number, max: number): number {
    const fraction = f32(f32(this.nextU32()) / f32(4294967295));
    return f32(min + f32(fraction * f32(max - min)));
  }
}

function randomGraphics(seed: number): GraphicPrimitive[] {
  const rng = new Lcg(seed);
  const count = rng.nextU32() % 401;
  const graphics: GraphicPrimitive[] = [];
  for (let n = 0; n < count; n++) {
    const x = rng.range(-120, 740);
    const y = rng.range(-120, 900);
    switch (rng.nextU32() % 4) {
      case 0:
        graphics.push(rect(x, y, rng.range(0.5, 40), rng.range(0.5, 40)));
        break;
      case 1:
        graphics.push(stroke(x, y, rng.range(-120, 740), rng.range(-120, 900)));
        break;
      case 2:
        graphics.push(rect(x, y, rng.range(2, 612), rng.range(2, 792)));
        break;
      default:
        graphics.push(rect(x, y, rng.range(2, 80), rng.range(2, 80)));
    }
  }
  if (count >= 4) {
    graphics[0] = rect(1000, -1000, 12, 12);
    graphics[1] = rect(1022, -1000, 12, 12);
    graphics[2] = rect(1300, -1000, 12, 12);
    graphics[3] = rect(f32(1322.01), -1000, 12, 12);
  }
  return graphics;
}

function allPairsClusterBboxes(bboxes: readonly Rect[]): number[] {
  const parent = bboxes.map((_, i) => i);
  for (let i = 0; i < bboxes.length; i++) {
    for (let j = i + 1; j < bboxes.length; j++) {
      if (closeEnough(bboxes[i], bboxes[j], FIG_CLUSTER_GAP_PT)) ufUnion(parent, i, j);
    }
  }
  return parent;
}

function componentPartition(parent: number[]): number[][] {
  const groups = new Map<number, number[]>();
  for (let i = 0; i < parent.length; i++) {
    const root = ufFind(parent, i);
    const g = groups.get(root) ?? [];
    g.push(i);
    groups.set(root, g);
  }
  const partition = [...groups.values()];
  for (const c of partition) c.sort((a, b) => a - b);
  // Vec<Vec<usize>> orders lexicographically.
  partition.sort((a, b) => {
    for (let k = 0; k < Math.min(a.length, b.length); k++) if (a[k] !== b[k]) return a[k] - b[k];
    return a.length - b.length;
  });
  return partition;
}

describe("figure_cluster unit tests", () => {
  test("spatial grid matches all pairs for randomized inputs", () => {
    for (let seed = 0; seed < 200; seed++) {
      const graphics = randomGraphics(seed);
      const bboxes = graphics.map(graphicBbox);
      const spatial = clusterBboxesSpatial(bboxes, 612, 792);
      const reference = allPairsClusterBboxes(bboxes);
      expect(componentPartition(spatial)).toEqual(componentPartition(reference));

      const actual = detectFigureRects(graphics, [], 612, 792);
      const expected = detectFigureRectsWithClusterer(
        graphics,
        [],
        612,
        792,
        allPairsClusterBboxes
      );
      expect(actual).toEqual(expected);
    }
  });

  test("spatial grid preserves inclusive gap boundary", () => {
    const bboxes: Rect[] = [
      { x: 1000, y: -1000, width: 12, height: 12 },
      { x: 1022, y: -1000, width: 12, height: 12 },
      { x: 1300, y: -1000, width: 12, height: 12 },
      { x: f32(1322.01), y: -1000, width: 12, height: 12 },
    ];
    expect(closeEnough(bboxes[0], bboxes[1], FIG_CLUSTER_GAP_PT)).toBe(true);
    expect(closeEnough(bboxes[2], bboxes[3], FIG_CLUSTER_GAP_PT)).toBe(false);
    expect(componentPartition(clusterBboxesSpatial(bboxes, 612, 792))).toEqual([[0, 1], [2], [3]]);
  });

  test("empty input returns no figures", () => {
    expect(detectFigureRects([], [], 612, 792)).toEqual([]);
  });

  test("long thin HR is not a figure", () => {
    expect(detectFigureRects([stroke(100, 400, 500, 400)], [], 612, 792)).toEqual([]);
  });

  test("dense stroke cluster becomes a figure", () => {
    const g: GraphicPrimitive[] = [];
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 5; j++) {
        const x = 100 + i * 30;
        const y = 200 + j * 25;
        g.push(stroke(x, y, x + 20, y + 15));
      }
    }
    const figs = detectFigureRects(g, [], 612, 792);
    expect(figs.length).toBe(1);
    const f = figs[0];
    expect(f.width >= 100 && f.height >= 100).toBe(true);
    expect(f.x >= 90 && f.x <= 110).toBe(true);
  });

  test("large solo rect qualifies as figure", () => {
    expect(detectFigureRects([rect(100, 300, 200, 100)], [], 612, 792).length).toBe(1);
  });

  test("full page background rect is skipped", () => {
    expect(detectFigureRects([rect(0, 0, 612, 792)], [], 612, 792)).toEqual([]);
  });

  test("text heavy rect is treated as background, not figure", () => {
    const text = [];
    for (let row = 0; row < 8; row++) {
      text.push(
        textItem({ text: "lorem ipsum dolor", x: 105, y: 105 + row * 12, width: 190, height: 10 })
      );
    }
    expect(detectFigureRects([rect(100, 100, 200, 100)], text, 612, 792)).toEqual([]);
  });

  test("side-by-side text on one row counts as one band of the rect", () => {
    // Two 90pt-wide words on one row of a 200x100 rect cover 180x10 of 20000.
    const words = [
      textItem({ text: "left", x: 105, y: 105, width: 90, height: 10 }),
      textItem({ text: "right", x: 205, y: 106, width: 90, height: 10 }),
    ];
    expect(textCoverage({ x: 100, y: 100, width: 200, height: 100 }, words)).toBe(
      f32(f32(190 * 11) / 20000)
    );
    expect(textCoverage({ x: 100, y: 100, width: 0, height: 100 }, words)).toBe(0);
    expect(textCoverage({ x: 400, y: 400, width: 10, height: 10 }, words)).toBe(0);
  });

  test("distant strokes do not merge", () => {
    const g: GraphicPrimitive[] = [];
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 5; j++) {
        const x = 50 + i * 25;
        const y = 100 + j * 20;
        g.push(stroke(x, y, x + 18, y + 12));
      }
    }
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 5; j++) {
        const x = 400 + i * 25;
        const y = 500 + j * 20;
        g.push(stroke(x, y, x + 18, y + 12));
      }
    }
    expect(detectFigureRects(g, [], 612, 792).length).toBe(2);
  });
});

describe.each(parseGoldenNames())("%s figures", (name) => {
  test("merge.pages to project.pages figures", () => {
    const g = loadParseGolden(name);
    const pages = (stage(g, "merge.pages") as unknown[]).map(pageFromJson);
    const projected: ParsedPage[] = (stage(g, "project.pages") as unknown[]).map(
      parsedPageFromJson
    );
    expect(projected.length).toBe(pages.length);
    pages.forEach((page, i) => {
      const figures = detectFigureRects(
        page.graphics,
        page.text_items,
        page.page_width,
        page.page_height
      );
      expect(canon(figures)).toEqual(canon(projected[i].figures));
    });
  });
});
