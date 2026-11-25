// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { renderPages } from "../src/cli/commands.js";
import { expandPatterns, isMissingLocalFile, loadImageInput } from "../src/cli/io.js";
import { buildOptions, buildPdfOptions, format } from "../src/cli/options.js";
import { main } from "../src/cli/run.js";
import { toPage } from "../src/core/page.js";
import { MODEL_FILES, MODEL_REVISION } from "../src/model-catalogue.js";
import { formatText } from "../src/ocria/output/index.js";
import { loadParseGolden, parsedPageFromJson } from "./ocria/parse-golden.js";
import { pdfReady } from "./has-pdf-entry.js";

const PAGES = `${import.meta.dir}/fixtures/pages`;
const TABLE = `${PAGES}/table.png`;
const DIGITAL = `${PAGES}/digital.pdf`;

let workdir: string;

/** Run `main` with stdout/stderr captured in-process. */
async function run(args: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk: string | Uint8Array): boolean => ((out += String(chunk)), true);
  process.stderr.write = (chunk: string | Uint8Array): boolean => ((err += String(chunk)), true);
  try {
    return { code: await main(args), out, err };
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
}

/** A page built from LiteParse's recorded parse of a fixture, with no models. */
function goldenPage(name: string): ReturnType<typeof toPage> {
  const g = loadParseGolden(name);
  return toPage(parsedPageFromJson(g.pages[0]), g.text, 150);
}

beforeAll(() => {
  workdir = mkdtempSync(join(tmpdir(), "ppu-ocria-nano-cli-"));
});

afterAll(() => {
  if (workdir && existsSync(workdir)) rmSync(workdir, { recursive: true, force: true });
});

describe("option builders (no models)", () => {
  test("buildOptions maps layout, headers, providers, verbose and --model-dir", () => {
    const dir = join(workdir, "models");
    mkdirSync(dir, { recursive: true });
    for (const f of ["det.onnx", "rec_latin.charset.json"]) writeFileSync(join(dir, f), "");
    const opts = buildOptions({
      "no-layout": true,
      "keep-headers-footers": true,
      "execution-providers": "cuda, cpu",
      "model-dir": dir,
      verbose: true,
    });
    expect(opts.layout).toBe(false);
    expect(opts.keepHeadersFooters).toBe(true);
    expect(opts.verbose).toBe(true);
    expect(opts.session?.executionProviders).toEqual(["cuda", "cpu"]);
    expect(opts.models?.det).toBe(join(dir, "det.onnx"));
    expect(opts.models?.recLatinCharset).toBe(join(dir, "rec_latin.charset.json"));
    // A file the folder lacks is left out, so it downloads from the pinned release.
    expect(opts.models?.router).toBeUndefined();
  });

  test("the defaults run LayoutNet, drop headers and footers and set no session", () => {
    expect(buildOptions({})).toEqual({
      models: undefined,
      layout: true,
      keepHeadersFooters: false,
      session: undefined,
      verbose: false,
    });
    expect(() => buildOptions({ "model-dir": join(workdir, "nope") })).toThrow("does not exist");
  });

  test("buildPdfOptions maps the PDF flags", () => {
    expect(buildPdfOptions({ dpi: "150", "max-pages": "2", password: "p" })).toEqual({
      dpi: 150,
      maxPages: 2,
      password: "p",
    });
    expect(buildPdfOptions({})).toEqual({
      dpi: undefined,
      maxPages: undefined,
      password: undefined,
    });
  });

  test("bad flag values are usage errors", () => {
    expect(() => buildPdfOptions({ dpi: "-1" })).toThrow("--dpi must be a positive number");
    expect(() => buildPdfOptions({ "max-pages": "x" })).toThrow("--max-pages must be");
    expect(() => format({ format: "html" })).toThrow("--format must be one of");
    expect(format({})).toBe("markdown");
    expect(format({ format: "md" })).toBe("markdown");
  });

  test("renderPages writes markdown joined by LiteParse's separator, text and JSON", () => {
    const page = goldenPage("table");
    expect(renderPages([page, page], "markdown", false)).toBe(
      `${page.markdown}\n\n-----\n\n${page.markdown}`
    );
    expect(renderPages([page], "text", false)).toBe(formatText([page.parsed]));
    const json = JSON.parse(renderPages([page, page], "json", false));
    expect(json.total_pages).toBe(2);
    expect(json.pages[0].text).toBe(page.text);
    expect(renderPages([page], "json", true)).toBe(
      JSON.stringify(JSON.parse(renderPages([page], "json", false)), null, 2)
    );
  });
});

describe("io helpers", () => {
  test("expandPatterns resolves globs and keeps plain paths", () => {
    expect(expandPatterns([`${PAGES}/two-*.png`])).toEqual([`${PAGES}/two-column.png`]);
    expect(expandPatterns(["missing.png", "https://x/y.png"])).toEqual([
      "missing.png",
      "https://x/y.png",
    ]);
    expect(() => expandPatterns([`${PAGES}/*.nothing`])).toThrow("No files match");
  });

  test("isMissingLocalFile and loadImageInput", async () => {
    expect(isMissingLocalFile("nope.png")).toBe(true);
    expect(isMissingLocalFile("https://x/y.png")).toBe(false);
    expect((await loadImageInput(TABLE)).byteLength).toBe(readFileSync(TABLE).byteLength);
    await expect(loadImageInput("nope.png")).rejects.toThrow("No such file");
  });
});

describe("commands", () => {
  test("help, version and usage errors", async () => {
    expect((await run(["help"])).out).toContain("ppu-ocria-nano - OCRia-nano-1");
    expect((await run(["--version"])).out).toMatch(/^\d+\.\d+\.\d+/);
    expect((await run(["frobnicate"])).code).toBe(2);
    expect((await run(["--no-such-flag"])).code).toBe(2);
    expect((await run(["convert"])).code).toBe(2);
    expect((await run(["detect", TABLE, TABLE])).code).toBe(2);
  });

  test("convert writes markdown to stdout, matching LiteParse", async () => {
    const { code, out } = await run(["convert", TABLE, "-q"]);
    expect(code).toBe(0);
    expect(out.trim()).toBe(loadParseGolden("table").text.trim());
  });

  test("--no-layout reads the page with heuristic tables", async () => {
    const { code, out } = await run(["convert", TABLE, "-q", "--no-layout"]);
    expect(code).toBe(0);
    expect(out).toContain("Spring");
  });

  test("--out writes one file per input, in the chosen format", async () => {
    const md = await run(["convert", TABLE, "--out", workdir, "-q"]);
    expect(md.code).toBe(0);
    expect(readFileSync(join(workdir, "table.md"), "utf8").trim()).toBe(
      loadParseGolden("table").text.trim()
    );
    const json = await run(["convert", TABLE, "--out", workdir, "--format", "json", "-q"]);
    expect(json.code).toBe(0);
    expect(JSON.parse(readFileSync(join(workdir, "table.json"), "utf8")).total_pages).toBe(1);
    await run(["convert", TABLE, "--out", workdir, "--format", "text", "-q"]);
    expect(readFileSync(join(workdir, "table.txt"), "utf8")).toContain("Spring");
  });

  test("a file that fails is reported and the exit code is 1", async () => {
    const bad = join(workdir, "not-an-image.png");
    writeFileSync(bad, "this is not a PNG");
    const { code, err } = await run(["convert", bad, "-q"]);
    expect(code).toBe(1);
    expect(err).toContain("not-an-image.png:");
    expect((await run(["convert", "missing.png", "-q"])).code).toBe(1);
  });

  test("detect prints the line quads as JSON", async () => {
    const { code, out } = await run(["detect", TABLE, "-q"]);
    expect(code).toBe(0);
    const found = JSON.parse(out) as { boxes: number[][][]; faint: unknown[] };
    expect(found.boxes.length).toBeGreaterThan(10);
    expect(found.boxes[0]).toHaveLength(4);
  });

  test("models lists every pinned file; --format json names the revision", async () => {
    const out = (await run(["models"])).out;
    for (const pin of Object.values(MODEL_FILES)) expect(out).toContain(pin.name);
    expect(out).toContain(MODEL_REVISION);
    const json = JSON.parse((await run(["models", "--format", "json"])).out);
    expect(json.version).toBe("1.0.0");
    expect(json.revision).toBe(MODEL_REVISION);
    expect(json.files).toHaveLength(Object.keys(MODEL_FILES).length);
    expect(json.files[0]).toMatchObject({ role: "det", name: "det.onnx", size: 347580 });
  });

  test("download-models fills the cache and exits 0 (the cache is warm, so no download)", async () => {
    expect((await run(["download-models", "--no-layout", "-q"])).code).toBe(0);
  });

  // The PDF tests run once src/pdf/index.ts exports convertPdf (tests/has-pdf-entry.ts).
  test.skipIf(!pdfReady)("convert reads a PDF and matches LiteParse's markdown", async () => {
    const { code, out } = await run(["convert", DIGITAL, "-q"]);
    expect(code).toBe(0);
    expect(out.trim()).toBe(loadParseGolden("digital").text.trim());
  });

  test.skipIf(!pdfReady)("--max-pages 1 reads the first page of a PDF only", async () => {
    const { code, out } = await run([
      "convert",
      `${PAGES}/multipage.pdf`,
      "--max-pages",
      "1",
      "-q",
    ]);
    expect(code).toBe(0);
    expect(out).not.toContain("\n\n-----\n\n");
  });
});
