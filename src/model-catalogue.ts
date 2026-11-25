// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The OCRia-nano-1 files this package runs, pinned as LiteParse
// crates-v2.21.2 pins them (crates/liteparse/src/ocr/ocria/package.rs): by
// release, size and SHA-256. The weights, charsets and metadata are LlamaIndex's,
// under the OCRia-nano-1 license, not this package's license; they are
// downloaded at run time and never bundled.

/** The model files of OCRia-nano-1, by role. */
export type ModelFile =
  | "det"
  | "detMeta"
  | "router"
  | "recLatin"
  | "recLatinCharset"
  | "recCjk"
  | "recCjkCharset"
  | "recRtl"
  | "recRtlCharset"
  | "recRtlMeta"
  | "recWorld"
  | "recWorldCharset"
  | "layout";

/** A released file: its name in the model repository, its size in bytes and its SHA-256. */
export type PinnedFile = { name: string; size: number; sha256: string };

export const MODEL_FILES: Readonly<Record<ModelFile, PinnedFile>> = {
  det: {
    name: "det.onnx",
    size: 347580,
    sha256: "70ea641d74c4d7d3acb734002cc1507350d8350ad44aeedc6f8ac6017dbcff7a",
  },
  detMeta: {
    name: "det.meta.json",
    size: 17,
    sha256: "ada6b3c5de0800eb43fa81dbec714d47cd2a712a22952ef23cf38c805b27350e",
  },
  router: {
    name: "router.onnx",
    size: 159029,
    sha256: "daccb2e3ce3891b7cb95037ada3861e05fd288d7678d2a1e662d9483e04dd361",
  },
  recLatin: {
    name: "rec_latin.onnx",
    size: 943530,
    sha256: "7ac8f6815b4b127f244c14f86c51f65224c82e022c1ee71f867f2be955be4da4",
  },
  recLatinCharset: {
    name: "rec_latin.charset.json",
    size: 4933,
    sha256: "d386eea5691a4f3d9e40f48a3979cf859caf626c3ec43214c7911a713e1f4ed0",
  },
  recCjk: {
    name: "rec_cjk.onnx",
    size: 5077778,
    sha256: "ad7154b54a549dbfead48dd49142bcc76ee168cb0cd874f6efacab543f0b9262",
  },
  recCjkCharset: {
    name: "rec_cjk.charset.json",
    size: 43274,
    sha256: "0e48eca81c1c0afa5a3e081fdf5fcbdc669e746e7e0a7f264e85ac76c496035b",
  },
  recRtl: {
    name: "rec_rtl.onnx",
    size: 2842451,
    sha256: "9ccee36bb07b81ef310c6b50e707adabe8c6b92caea61105213686ea8977f4cf",
  },
  recRtlCharset: {
    name: "rec_rtl.charset.json",
    size: 1876,
    sha256: "8ad9b8f6c1bdc17b42a2351948e84a73c487f5bed7f783bc5e8474efad126a80",
  },
  recRtlMeta: {
    name: "rec_rtl.meta.json",
    size: 20,
    sha256: "31fd2893cc4d48ec50b4b21a1f113f527ae9a4ac1b3ea395b0cc5969f56d46b5",
  },
  recWorld: {
    name: "rec_world.onnx",
    size: 3913987,
    sha256: "c57d01a945d741886d356bdedc636f0572d0810c6a7c2f26dbb9ce0466b92220",
  },
  recWorldCharset: {
    name: "rec_world.charset.json",
    size: 11602,
    sha256: "ebfd39142cec3f267eda2b81b42966ac9b0f73841a52285770f4db40a016d689",
  },
  layout: {
    name: "tablenet.onnx",
    size: 17182635,
    sha256: "3b913866067d6e43f73a4e4c9c1eace955b7959447043cc39ea1d30e4c552a95",
  },
};

/** The files of one script group's recognizer. `meta` exists for the RTL group only. */
export type RecognizerFiles = { model: ModelFile; charset: ModelFile; meta?: ModelFile };

/** Each script group's recognizer files, in the router's group order. */
export const RECOGNIZER_FILES: Readonly<
  Record<"latin" | "cjk" | "rtl" | "world", RecognizerFiles>
> = {
  latin: { model: "recLatin", charset: "recLatinCharset" },
  cjk: { model: "recCjk", charset: "recCjkCharset" },
  rtl: { model: "recRtl", charset: "recRtlCharset", meta: "recRtlMeta" },
  world: { model: "recWorld", charset: "recWorldCharset" },
};

/** The files a service loads when it starts; the other recognizers load on first use. */
export const BASE_FILES: readonly ModelFile[] = [
  "det",
  "detMeta",
  "router",
  "recLatin",
  "recLatinCharset",
];

/** The OCRia-nano-1 release these pins belong to. */
export const MODEL_VERSION = "1.0.0";

/** Commit of llamaindex/OCRia-nano-1 at tag v1.0.0. */
export const MODEL_REVISION = "11f092be242844361666e8bac97da168b0f4a299";

/** LlamaIndex's Hugging Face repository at {@link MODEL_REVISION}. */
export const MODEL_BASE_URL: string = `https://huggingface.co/llamaindex/OCRia-nano-1/resolve/${MODEL_REVISION}`;

/**
 * The unmodified v1.0.0 files on this project's Hugging Face mirror, with
 * LlamaIndex's license and credit; read when the upstream download fails.
 */
export const MODEL_MIRROR_BASE_URL =
  "https://huggingface.co/snowfluke/ppu-ocria-nano-models/resolve/main/v1.0.0";

/** Upstream URL of a model file. */
export function defaultModelUrl(file: ModelFile): string {
  return `${MODEL_BASE_URL}/${MODEL_FILES[file].name}`;
}

/** Mirror URL of a model file. */
export function mirrorModelUrl(file: ModelFile): string {
  return `${MODEL_MIRROR_BASE_URL}/${MODEL_FILES[file].name}`;
}

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Check downloaded bytes against a file's pin: the size always, the SHA-256
 * where the runtime has WebCrypto (Node, Bun, Deno and browsers; React Native
 * has none, and the download is then checked by size over HTTPS only).
 */
export async function verifyModelFile(file: ModelFile, bytes: ArrayBuffer): Promise<void> {
  const pin = MODEL_FILES[file];
  if (bytes.byteLength !== pin.size) {
    throw new Error(
      `${pin.name}: ${bytes.byteLength} bytes, expected ${pin.size} (OCRia-nano-1 ${MODEL_VERSION})`
    );
  }
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return;
  const got = hex(await subtle.digest("SHA-256", bytes));
  if (got !== pin.sha256) {
    throw new Error(
      `${pin.name}: sha256 ${got}, expected ${pin.sha256} (OCRia-nano-1 ${MODEL_VERSION})`
    );
  }
}
