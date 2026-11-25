// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// Assemble the Hugging Face mirror folder: download the pinned v1.0.0 files
// from LlamaIndex's repository, check each against its pin, and add the
// upstream LICENSE and the mirror's model card. Upload the folder yourself:
//
//   bun scripts/mirror/prepare.ts .mirror
//   hf upload snowfluke/ppu-ocria-nano-models .mirror .
//
// Throwaway tooling: it runs once per model release.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ModelFile } from "../../src/model-catalogue.js";
import {
  MODEL_BASE_URL,
  MODEL_FILES,
  MODEL_VERSION,
  defaultModelUrl,
  verifyModelFile,
} from "../../src/model-catalogue.js";

const out = process.argv[2];
if (!out) throw new Error("usage: bun scripts/mirror/prepare.ts <out-dir>");
const dir = join(out, `v${MODEL_VERSION}`);
mkdirSync(dir, { recursive: true });

async function fetchOnce(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.arrayBuffer();
}

// Bun 1.4.2 drops a connection to Hugging Face part way through a run of
// downloads (ECONNRESET); the same file downloads on a second try.
async function download(url: string): Promise<ArrayBuffer> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetchOnce(url);
    } catch (error) {
      if (attempt === 3) throw error;
      console.warn(`retry ${url}: ${String(error)}`);
    }
  }
}

for (const file of Object.keys(MODEL_FILES) as ModelFile[]) {
  const bytes = await download(defaultModelUrl(file));
  await verifyModelFile(file, bytes);
  writeFileSync(join(dir, MODEL_FILES[file].name), Buffer.from(bytes));
  console.log(`ok ${MODEL_FILES[file].name}`);
}
writeFileSync(join(dir, "LICENSE"), Buffer.from(await download(`${MODEL_BASE_URL}/LICENSE`)));
writeFileSync(join(out, "README.md"), readFileSync(join(import.meta.dir, "README.md")));
console.log(`mirror folder ready: ${out}`);
