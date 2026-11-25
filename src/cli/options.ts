// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

/** Maps parsed CLI flags onto OcriaNanoOptions and the PDF options. */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ParseArgsConfig } from "node:util";

import type { ModelSources, OcriaNanoOptions } from "../interface.js";
import type { ModelFile } from "../model-catalogue.js";
import { MODEL_FILES } from "../model-catalogue.js";
import { usageError } from "./io.js";

/** `parseArgs` option spec shared by every command. */
export const PARSE_OPTIONS: NonNullable<ParseArgsConfig["options"]> = {
  format: { type: "string" },
  out: { type: "string" },
  "keep-headers-footers": { type: "boolean" },
  "no-layout": { type: "boolean" },
  dpi: { type: "string" },
  "max-pages": { type: "string" },
  password: { type: "string" },
  "model-dir": { type: "string" },
  "execution-providers": { type: "string" },
  output: { type: "string", short: "o" },
  pretty: { type: "boolean" },
  quiet: { type: "boolean", short: "q" },
  verbose: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
};

/** Shape of `parseArgs().values` for the spec above. */
export type CliValues = Record<string, string | boolean | undefined>;

export type OutputFormat = "markdown" | "text" | "json";

/** A string flag's value, if given. */
export function str(values: CliValues, key: string): string | undefined {
  const raw = values[key];
  return typeof raw === "string" ? raw : undefined;
}

function num(values: CliValues, key: string): number | undefined {
  const raw = str(values, key);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) usageError(`--${key} must be a positive number, got "${raw}"`);
  return n;
}

const FORMATS: readonly OutputFormat[] = ["markdown", "text", "json"];

/** Output format; markdown by default (`md` is accepted for markdown). */
export function format(values: CliValues): OutputFormat {
  const raw = str(values, "format");
  if (raw === undefined || raw === "md") return "markdown";
  const hit = FORMATS.find((f) => f === raw);
  if (!hit) usageError(`--format must be one of ${FORMATS.join(" | ")}`);
  return hit;
}

/** The model files found in `--model-dir`; a missing file still downloads from the pinned release. */
function modelDir(values: CliValues): ModelSources | undefined {
  const dir = str(values, "model-dir");
  if (dir === undefined) return undefined;
  if (!existsSync(dir)) usageError(`--model-dir ${dir} does not exist`);
  const entries = Object.entries(MODEL_FILES).flatMap(([file, pin]): [ModelFile, string][] =>
    existsSync(join(dir, pin.name))
      ? // SAFETY: Object.entries of a Record<ModelFile, PinnedFile> yields its ModelFile keys.
        [[file as ModelFile, join(dir, pin.name)]]
      : []
  );
  return Object.fromEntries(entries);
}

/** The service options from parsed flags. */
export function buildOptions(values: CliValues): OcriaNanoOptions {
  const providers = str(values, "execution-providers");
  return {
    models: modelDir(values),
    layout: !values["no-layout"],
    keepHeadersFooters: Boolean(values["keep-headers-footers"]),
    session: providers
      ? { executionProviders: providers.split(",").map((p) => p.trim()) }
      : undefined,
    verbose: Boolean(values.verbose),
  };
}

/** The PDF flags: OCR render DPI, page limit and password (the `PdfOptions` of `ppu-ocria-nano/pdf`). */
export type PdfFlags = { dpi?: number; maxPages?: number; password?: string };

/** The PDF options from parsed flags. */
export function buildPdfOptions(values: CliValues): PdfFlags {
  return {
    dpi: num(values, "dpi"),
    maxPages: num(values, "max-pages"),
    password: str(values, "password"),
  };
}
