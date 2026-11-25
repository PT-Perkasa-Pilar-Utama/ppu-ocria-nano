// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

/**
 * Command implementations. Each owns one OcriaNanoService lifecycle and throws
 * CliError on failure; the dispatcher maps that to an exit code. Results go
 * to stdout (or files); progress and logs go to stderr.
 */

import { mkdirSync, rmSync } from "node:fs";
import { basename, extname, join } from "node:path";

import { isPdf } from "../core/is-pdf.js";
import type { Page } from "../core/page.js";
import { MODEL_FILES, MODEL_REVISION, MODEL_VERSION, defaultModelUrl } from "../model-catalogue.js";
import type { ModelFile } from "../model-catalogue.js";
import { formatJson, formatText } from "../ocria/output/index.js";
import type * as PdfModule from "../pdf/index.js";
import { CACHE_DIR } from "../processor/model-cache.js";
import { OcriaNanoService } from "../processor/ocria-nano.service.js";
import {
  CliError,
  expandPatterns,
  isMissingLocalFile,
  loadImageInput,
  logStderr,
  writeOutput,
} from "./io.js";
import type { CliValues, OutputFormat } from "./options.js";
import { buildOptions, buildPdfOptions, format, str } from "./options.js";

const EXTENSIONS: Record<OutputFormat, string> = { markdown: ".md", text: ".txt", json: ".json" };

/** LiteParse's separator between the pages of one document's markdown. */
const PAGE_SEPARATOR = "\n\n-----\n\n";

function errMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** One document's pages in the chosen format, as `lit parse` writes them (JSON and text use LiteParse's formatters). */
export function renderPages(pages: readonly Page[], fmt: OutputFormat, pretty: boolean): string {
  const parsed = pages.map((p) => p.parsed);
  if (fmt === "text") return formatText(parsed);
  if (fmt === "json") {
    const json = formatJson(parsed);
    return pretty ? JSON.stringify(JSON.parse(json), null, 2) : json;
  }
  return pages.map((p) => p.markdown).join(PAGE_SEPARATOR);
}

async function readPdf(
  service: OcriaNanoService,
  bytes: ArrayBuffer,
  values: CliValues
): Promise<Page[]> {
  const pdf: typeof PdfModule = await import("../pdf/index.js");
  return pdf.convertPdf(service, bytes, buildPdfOptions(values));
}

async function withService<T>(
  values: CliValues,
  run: (service: OcriaNanoService) => Promise<T>
): Promise<T> {
  const service = new OcriaNanoService(buildOptions(values));
  try {
    logStderr("Loading models...", Boolean(values.quiet));
    await service.initialize();
    return await run(service);
  } finally {
    await service.destroy();
  }
}

export async function runConvert(patterns: string[], values: CliValues): Promise<void> {
  if (!patterns.length) throw new CliError("convert takes one or more files", 2);
  const files = expandPatterns(patterns);
  const missing = files.filter(isMissingLocalFile);
  if (missing.length)
    throw new CliError(`No such file${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`);
  const fmt = format(values);
  const outDir = str(values, "out");
  if (outDir) mkdirSync(outDir, { recursive: true });
  const outputs: string[] = [];
  let failed = 0;
  await withService(values, async (service) => {
    for (const file of files) {
      try {
        const bytes = await loadImageInput(file);
        const pages = isPdf(bytes)
          ? await readPdf(service, bytes, values)
          : [await service.convert(bytes)];
        const rendered = renderPages(pages, fmt, Boolean(values.pretty));
        if (outDir)
          writeOutput(rendered, join(outDir, basename(file, extname(file)) + EXTENSIONS[fmt]));
        else outputs.push(rendered);
      } catch (err) {
        failed++;
        process.stderr.write(`${file}: ${errMessage(err)}\n`);
      }
    }
  });
  if (!outDir && outputs.length) writeOutput(outputs.join("\n\n"), str(values, "output"));
  if (failed) throw new CliError(`${failed} of ${files.length} file(s) failed`);
}

export async function runDetect(images: string[], values: CliValues): Promise<void> {
  const [image] = images;
  if (!image || images.length !== 1) throw new CliError("detect takes exactly one image", 2);
  if (isMissingLocalFile(image)) throw new CliError(`No such file: ${image}`);
  const found = await withService(values, async (service) =>
    service.detect(await loadImageInput(image))
  );
  writeOutput(JSON.stringify(found, null, values.pretty ? 2 : undefined), str(values, "output"));
}

export async function runDownloadModels(values: CliValues): Promise<void> {
  // the CJK, RTL and world recognizers load on first use: fetch them all now,
  // so a later run needs no network
  await OcriaNanoService.downloadModels({
    layout: !values["no-layout"],
    verbose: Boolean(values.verbose),
  });
  logStderr(`OCRia-nano-1 ${MODEL_VERSION} cached in ${CACHE_DIR}`, Boolean(values.quiet));
}

export function runClearCache(values: CliValues): void {
  rmSync(CACHE_DIR, { recursive: true, force: true });
  logStderr(`Removed ${CACHE_DIR}`, Boolean(values.quiet));
}

export function runModels(values: CliValues): void {
  // SAFETY: the keys of MODEL_FILES are its ModelFile roles.
  const files = (Object.keys(MODEL_FILES) as ModelFile[]).map((role) => ({
    role,
    ...MODEL_FILES[role],
    url: defaultModelUrl(role),
  }));
  if (format(values) === "json") {
    const doc = { version: MODEL_VERSION, revision: MODEL_REVISION, cache: CACHE_DIR, files };
    writeOutput(JSON.stringify(doc, null, values.pretty ? 2 : undefined), str(values, "output"));
    return;
  }
  writeOutput(
    [
      `OCRia-nano-1 ${MODEL_VERSION} (llamaindex/OCRia-nano-1 at ${MODEL_REVISION})`,
      `Cache: ${CACHE_DIR}`,
      ...files.map(
        (f) => `  ${f.name.padEnd(24)}${String(f.size).padStart(10)} bytes  sha256 ${f.sha256}`
      ),
      "",
      "The model files are LlamaIndex's, under the OCRia-nano-1 license with use restrictions.",
    ].join("\n"),
    str(values, "output")
  );
}
