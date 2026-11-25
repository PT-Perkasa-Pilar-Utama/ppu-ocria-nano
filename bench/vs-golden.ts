// ppu-ocria-nano against LiteParse (crates-v2.21.2, same models): speed, memory
// and how close the markdown is to LiteParse's own, on the PNG fixture pages.
//
//   bun bench/vs-golden.ts
//   ROUNDS=9 bun bench/vs-golden.ts
//
// The reference is the `text` recorded in tests/fixtures/golden/parse (scripts/golden/),
// so a score of 1 means the port reads the page as LiteParse does. The receipt in
// assets/ has no golden: it is scored against its transcript instead. ROUNDS times
// each image (default 5; the median counts). One process, default options.
import { join } from "node:path";

import { OcriaNanoService } from "../src/index.js";
import { loadParseGolden, parseGoldenNames } from "../tests/ocria/parse-golden.js";

type Run = { name: string; ms: number; text: string; want: string; exact: boolean | null };

const ROUNDS = Number(process.env.ROUNDS ?? 5);
const ROOT = join(import.meta.dir, "..");

/** F1 of two bags (multisets) of strings. */
function bagF1(got: string[], want: string[]): number {
  const count = (xs: string[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
    return m;
  };
  const w = count(want);
  let hit = 0;
  for (const [t, n] of count(got)) hit += Math.min(n, w.get(t) ?? 0);
  const total = got.length + want.length;
  return total === 0 ? 1 : (2 * hit) / total;
}

/** Uppercase words. Order does not count; a missing space does. */
const words = (s: string): string[] => s.toUpperCase().split(/\s+/).filter(Boolean);
const tokenF1 = (got: string, want: string): number => bagF1(words(got), words(want));

/** Uppercase characters without whitespace: neither order nor spacing counts. */
const chars = (s: string): string[] => [...s.toUpperCase().replace(/\s+/g, "")];
const charF1 = (got: string, want: string): number => bagF1(chars(got), chars(want));

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const sub = (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, sub);
    }
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

/** CER with case and all whitespace removed. Still order-sensitive. */
function cer(got: string, want: string): number {
  const norm = (s: string): string => s.toUpperCase().replace(/\s+/g, "");
  const w = norm(want);
  return w.length ? levenshtein(norm(got), w) / w.length : 0;
}

function exactLabel(exact: boolean | null): string {
  if (exact === null) return "-";
  return exact ? "yes" : "no";
}

function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

async function main(): Promise<void> {
  const goldens = parseGoldenNames()
    .map((name) => ({ name, golden: loadParseGolden(name) }))
    .filter((x) => x.golden.image.endsWith(".png"));
  console.log(
    `\n=== ppu-ocria-nano vs LiteParse on ${goldens.length} pages, ${ROUNDS} round(s) ===`
  );
  console.log(`${process.platform}/${process.arch}, bun ${Bun.version}, default options\n`);

  const started = performance.now();
  const service = new OcriaNanoService();
  await service.initialize();
  const initMs = performance.now() - started;

  const pages: { name: string; image: string; want: string; golden: boolean }[] = [
    ...goldens.map((x) => ({
      name: x.golden.image,
      image: join(ROOT, "tests/fixtures/pages", x.golden.image),
      want: x.golden.text,
      golden: true,
    })),
    {
      name: "receipt.jpg",
      image: join(ROOT, "assets/receipt.jpg"),
      want: await Bun.file(join(ROOT, "assets/receipt-ground-truth.txt")).text(),
      golden: false,
    },
  ];

  const first = pages[0];
  if (first) await service.convert(await Bun.file(first.image).arrayBuffer()); // warmup
  let peak = process.memoryUsage().rss;
  const runs: Run[] = [];
  for (const { name, image: path, want, golden } of pages) {
    const image = await Bun.file(path).arrayBuffer();
    const times: number[] = [];
    let text = "";
    for (let r = 0; r < ROUNDS; r++) {
      const t0 = performance.now();
      const page = await service.convert(image);
      times.push(performance.now() - t0);
      // the golden is markdown; the receipt transcript is plain lines
      text = golden ? page.markdown : page.text;
      peak = Math.max(peak, process.memoryUsage().rss);
    }
    runs.push({ name, ms: quantile(times, 0.5), text, want, exact: golden ? text === want : null });
  }
  await service.destroy();

  console.table(
    runs.map((r) => ({
      page: r.name,
      "ms (median)": r.ms.toFixed(0),
      exact: exactLabel(r.exact),
      "char-F1": charF1(r.text, r.want).toFixed(3),
      "token-F1": tokenF1(r.text, r.want).toFixed(3),
      CER: cer(r.text, r.want).toFixed(3),
    }))
  );
  const ms = runs.map((r) => r.ms);
  const exact = runs.filter((r) => r.exact).length;
  console.log(
    `init ${(initMs / 1000).toFixed(1)} s, median ${quantile(ms, 0.5).toFixed(0)} ms, ` +
      `p90 ${quantile(ms, 0.9).toFixed(0)} ms, peak RSS ${(peak / 2 ** 20).toFixed(0)} MB, ` +
      `mean token-F1 ${mean(runs.map((r) => tokenF1(r.text, r.want))).toFixed(3)}`
  );
  console.log(`exact markdown matches: ${exact} of ${runs.filter((r) => r.exact !== null).length}`);
  console.log(
    "exact: the markdown equals LiteParse's. char-F1: characters read, ignoring order\n" +
      "and spacing. token-F1: words, so a dropped space costs. CER: ignores case and\n" +
      "whitespace but not order. receipt.jpg is scored against its transcript (page.text)."
  );
}

await main();
