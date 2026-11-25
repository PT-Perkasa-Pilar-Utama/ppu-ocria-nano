// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of OcriaEngine in liteparse crates/liteparse/src/ocr/ocria/mod.rs (crates-v2.21.2, Apache-2.0).

// The OCR stage with the settings the benchmarks use: line detector (long
// side 1600, the detector's own threshold, collinear merge 0.6), column-gutter
// split, sideways-page retry, a script router feeding four recognizers (Latin,
// CJK, RTL, world) with the low-confidence script rescue, homoglyph folding
// and the junk filter.

import { f32, trim } from "../rust.js";
import type { Adaptive, Faint } from "./det.js";
import { Detector } from "./det.js";
import type { Img, Quad } from "./img.js";
import { rot90 } from "./img.js";
import { splitGutters } from "./gutters.js";
import * as page from "./page.js";
import * as scripts from "./scripts.js";
import type { Reading, Recognizer, Router } from "./rec.js";
import { GROUPS } from "./rec.js";
import type { Model } from "./model.js";
import type { OcrResult } from "./types.js";

/** A faint candidate is kept only at this confidence. */
const FAINT_CONF = f32(0.9);

/** Detector thresholds for a model without `det.meta.json`. */
export const DET_THRESH = 0.5;
export const DET_MERGE = 0.6;

/** Pipeline switches and thresholds. The defaults are the benchmarked configuration. */
export type OcriaOptions = {
  detLongSide: number;
  /** Detector probability threshold. Undefined: the model's `det.meta.json` "thresh", else 0.5. */
  detThresh?: number;
  /** Collinear box merge threshold. Undefined: `det.meta.json` "merge", else 0.6. */
  detMerge?: number;
  /** Second detection pass for small print (undefined = one pass at `detLongSide`). */
  detAdaptive?: Adaptive;
  /** Cut boxes that run across a column gutter. */
  gutter: boolean;
  /** Retry pages that look sideways a quarter turn round. */
  orient: boolean;
  /** Re-read low-confidence "Latin" pages with the other recognizers. */
  rescue: boolean;
  /** Drop readings with no letter or digit, or 1-2 unsure characters. */
  junk: boolean;
  /** Read faint short tokens next to detected lines, kept at confidence 0.9 (undefined = off). */
  faint?: Faint;
};

export const DEFAULT_OCRIA_OPTIONS: OcriaOptions = {
  detLongSide: 1600,
  gutter: true,
  orient: true,
  rescue: true,
  junk: true,
  faint: { thresh: 0.1, max: 24 },
};

/** The detector's recommended thresholds (`det.meta.json`). */
export type DetMeta = { thresh?: number; merge?: number };

/** The loaded models of an ocria-nano package. */
export type OcriaModels = {
  det: Model;
  detMeta: DetMeta;
  router: Router;
  /**
   * The recognizer of a script group (a `GROUPS` index). The service loads
   * each on first use; the engine asks only for the groups a page needs.
   */
  rec: (group: number) => Promise<Recognizer>;
};

/** Readings per box, whether the page was read upside down, and the page's script group. */
type PageReads = { reads: Reading[]; flip: boolean; dom: number };

/** np.mean over Python floats: NaN for no values. */
function mean(v: readonly number[]): number {
  if (v.length === 0) return NaN;
  let s = 0;
  for (const x of v) s += x;
  return s / v.length;
}

export class OcriaEngine {
  /** The line detector with the engine's thresholds (the first stage of `run`). */
  public readonly det: Detector;

  public constructor(
    private readonly models: OcriaModels,
    private readonly opts: OcriaOptions = DEFAULT_OCRIA_OPTIONS
  ) {
    this.det = new Detector(models.det, {
      longSide: opts.detLongSide,
      thresh: opts.detThresh ?? models.detMeta.thresh ?? DET_THRESH,
      merge: opts.detMerge ?? models.detMeta.merge ?? DET_MERGE,
      adaptive: opts.detAdaptive,
      faint: opts.faint,
    });
  }

  /** OCR one page image (RGB or grey, row-major). */
  public async run(data: Uint8Array, width: number, height: number): Promise<OcrResult[]> {
    const w = width;
    const h = height;
    let img0: Img = { w, h, ch: data.length === w * h ? 1 : 3, data };
    if (img0.ch === 1) {
      // the reference decodes every page as RGB
      const rgb = new Uint8Array(w * h * 3);
      for (let i = 0; i < data.length; i++) {
        const v = data[i];
        rgb[i * 3] = v;
        rgb[i * 3 + 1] = v;
        rgb[i * 3 + 2] = v;
      }
      img0 = { w, h, ch: 3, data: rgb };
    }
    let { boxes, faint } = await this.det.detectWithFaint(img0);
    let sideways = false;
    let img = img0;
    if (this.opts.orient && page.looksSideways(boxes)) {
      // maybe a page scanned on its side: detect again a quarter turn
      // counter-clockwise and keep that when it finds far more lines (the
      // router's flip vote finishes 270 deg)
      const turned = rot90(img0, 1);
      const tboxes = await this.det.detect(turned);
      if (page.longLines(tboxes) > 2 * page.longLines(boxes) + 5) {
        img = turned;
        boxes = tboxes;
        faint = [];
        sideways = true;
      }
    }
    if (this.opts.gutter) boxes = splitGutters(img, boxes);
    const empty: PageReads = { reads: [], flip: false, dom: 0 };
    const pageReads = boxes.length === 0 ? empty : await this.read(img, boxes);
    const { flip, dom } = pageReads;
    let { reads } = pageReads;
    const nLines = boxes.length;
    if (faint.length > 0 && !flip) {
      // with the page's recognizer: a lone glyph is too short for the router
      const res = await (await this.models.rec(dom)).read(faint.map((b) => page.crop(img, b)));
      boxes = boxes.slice();
      reads = reads.slice();
      faint.forEach((quad, k) => {
        const r = res[k];
        const text = scripts.cleanLatin(r.text);
        if (r.conf >= FAINT_CONF && scripts.isShortToken(text)) {
          boxes.push(quad);
          reads.push({ text, conf: r.conf });
        }
      });
    }
    const out: OcrResult[] = [];
    boxes.forEach((quad, k) => {
      const { text, conf } = reads[k];
      if (trim(text) === "" || (this.opts.junk && scripts.isJunk(text, conf))) return;
      const pts: Quad = this.opts.orient ? page.readingFrame(quad, flip, sideways, img0.w) : quad;
      let x1 = Infinity;
      let y1 = Infinity;
      let x2 = -Infinity;
      let y2 = -Infinity;
      for (const p of pts) {
        x1 = Math.min(x1, p[0]);
        y1 = Math.min(y1, p[1]);
        x2 = Math.max(x2, p[0]);
        y2 = Math.max(y2, p[1]);
      }
      out.push({
        text,
        // the reference sends int() of each extent
        bbox: [Math.trunc(x1), Math.trunc(y1), Math.trunc(x2), Math.trunc(y2)],
        confidence: conf,
        polygon: pts,
        words: [],
        faint: k >= nLines,
      });
    });
    return out;
  }

  /** Readings per box, whether the page was read upside down, and the page's script group. */
  private async read(img: Img, boxes: readonly Quad[]): Promise<PageReads> {
    let crops = boxes.map((b) => page.crop(img, b));
    const { groups, flip, share } = await this.models.router.route(crops);
    if (flip) crops = crops.map((c) => rot90(c, 2));
    const out: Reading[] = crops.map(() => ({ text: "", conf: 0 }));
    const subset = (idx: readonly number[]): Img[] => idx.map((i) => crops[i]);
    for (let gi = 0; gi < GROUPS.length; gi++) {
      const idx = groups.flatMap((g, i) => (g === gi ? [i] : []));
      if (idx.length === 0) continue;
      const res = await (await this.models.rec(gi)).read(subset(idx));
      idx.forEach((i, j) => {
        out[i] = res[j];
      });
    }
    let dom = page.majority(groups);
    // a routed reading this confident is a real reading, not the 0.5-0.7 junk of the wrong recognizer
    const KEEP_CONF = f32(0.75);
    if (this.opts.rescue && dom === 0) {
      // a whole page of another script sent to the Latin recognizer reads as
      // confident-looking junk at 0.5-0.7; the right recognizer then scores 0.83-0.90
      const RESCUE_CONF = 0.75;
      const RESCUE_MARGIN = 0.15;
      // Only scripts the router saw a fair share of are tried: low-confidence
      // Latin regions (chart labels, logos) carry almost none.
      const RESCUE_SHARE = 0.2;
      const lat = groups.flatMap((g, i) => (g === dom ? [i] : []));
      if (lat.length > 0 && share.slice(1).some((s) => s >= RESCUE_SHARE)) {
        const latConf = mean(lat.map((i) => out[i].conf));
        if (latConf < RESCUE_CONF) {
          const sample = lat.slice(0, 40);
          let best: number | undefined;
          let bestConf = latConf + RESCUE_MARGIN;
          for (let gi = 1; gi < GROUPS.length; gi++) {
            if (share[gi] < RESCUE_SHARE) continue;
            const c = mean(
              (await (await this.models.rec(gi)).read(subset(sample))).map((r) => r.conf)
            );
            if (c >= bestConf) {
              best = gi;
              bestConf = c;
            }
          }
          if (best !== undefined) {
            const res = await (await this.models.rec(best)).read(subset(lat));
            lat.forEach((i, j) => {
              const r = res[j];
              // per line: a bilingual page keeps its confident Latin lines
              if (!(out[i].conf >= KEEP_CONF && out[i].conf >= r.conf)) {
                out[i] = r;
                groups[i] = best;
              }
            });
            dom = best;
          }
        }
      }
      // Per-line rescue when the page stays Latin: each line of another
      // script reads at 0.85-0.95 with its own recognizer. A switch needs the
      // margin and the script's own characters, so English lines on a
      // bilingual page stay Latin.
      if (dom === 0) {
        const LINE_MARGIN = f32(0.1);
        const LINE_SHARE = 0.15;
        const LINE_CONF = f32(0.8);
        for (let gi = 1; gi < GROUPS.length; gi++) {
          if (share[gi] < LINE_SHARE) continue;
          const weak = groups.flatMap((g, i) => (g === 0 ? [i] : []));
          if (weak.length === 0) break;
          const res = await (await this.models.rec(gi)).read(subset(weak));
          weak.forEach((i, j) => {
            const r = res[j];
            // a real line of the script reads at 0.83-0.95; specks on old
            // scans read as 2-character CJK at 0.1-0.77
            const sc = scripts.scriptChars(gi, r.text);
            if (
              r.conf >= f32(out[i].conf + LINE_MARGIN) &&
              r.conf >= LINE_CONF &&
              sc >= 3 &&
              sc > scripts.latinLetters(r.text)
            ) {
              out[i] = r;
              groups[i] = gi;
            }
          });
        }
      }
    }
    // lines routed away from the page's script are read with the page's
    // recognizer too; the off-script reading must win clearly
    const odd = groups.flatMap((g, i) => (g !== dom ? [i] : []));
    if (odd.length > 0) {
      const res = await (await this.models.rec(dom)).read(subset(odd));
      odd.forEach((i, j) => {
        const r = res[j];
        const cur = out[i];
        // A confident reading in the routed script stands: the page's
        // recognizer cannot write that script and still scores high ... and
        // is mostly that script.
        const sc = scripts.scriptChars(groups[i], cur.text);
        const routedOk = cur.conf >= KEEP_CONF && sc >= 2 && sc > scripts.latinLetters(cur.text);
        const replace = !routedOk && (cur.conf < f32(r.conf + f32(0.1)) || sc < 3);
        if (replace) out[i] = r;
      });
    }
    // every line, not only Latin-routed ones: lines re-read by the page's
    // Latin recognizer keep their routed group, and the world recognizer
    // writes Latin lines with lookalikes
    const reads = out.map((o) => ({ text: scripts.cleanLatin(o.text), conf: o.conf }));
    return { reads, flip, dom };
  }
}
