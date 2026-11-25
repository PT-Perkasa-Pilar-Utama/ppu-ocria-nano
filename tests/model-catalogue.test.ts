// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

import { describe, expect, test } from "bun:test";

import type { ModelFile } from "../src/model-catalogue.js";
import {
  BASE_FILES,
  MODEL_BASE_URL,
  MODEL_FILES,
  MODEL_MIRROR_BASE_URL,
  MODEL_REVISION,
  MODEL_VERSION,
  RECOGNIZER_FILES,
  defaultModelUrl,
  mirrorModelUrl,
  verifyModelFile,
} from "../src/model-catalogue.js";
import { NodePlatformProvider } from "../src/processor/platform.node.js";

/**
 * LiteParse crates-v2.21.2, crates/liteparse/src/ocr/ocria/package.rs: the
 * size and SHA-256 of each file of the OCRia-nano-1 v1.0.0 package, copied
 * here on purpose. MODEL_FILES must equal this list; do not derive one from
 * the other. (`tablenet.bin` is in upstream's list and not read here.)
 */
const LITEPARSE_PINS: readonly { name: string; size: number; sha256: string }[] = [
  {
    name: "det.onnx",
    size: 347580,
    sha256: "70ea641d74c4d7d3acb734002cc1507350d8350ad44aeedc6f8ac6017dbcff7a",
  },
  {
    name: "det.meta.json",
    size: 17,
    sha256: "ada6b3c5de0800eb43fa81dbec714d47cd2a712a22952ef23cf38c805b27350e",
  },
  {
    name: "router.onnx",
    size: 159029,
    sha256: "daccb2e3ce3891b7cb95037ada3861e05fd288d7678d2a1e662d9483e04dd361",
  },
  {
    name: "rec_latin.onnx",
    size: 943530,
    sha256: "7ac8f6815b4b127f244c14f86c51f65224c82e022c1ee71f867f2be955be4da4",
  },
  {
    name: "rec_latin.charset.json",
    size: 4933,
    sha256: "d386eea5691a4f3d9e40f48a3979cf859caf626c3ec43214c7911a713e1f4ed0",
  },
  {
    name: "rec_cjk.onnx",
    size: 5077778,
    sha256: "ad7154b54a549dbfead48dd49142bcc76ee168cb0cd874f6efacab543f0b9262",
  },
  {
    name: "rec_cjk.charset.json",
    size: 43274,
    sha256: "0e48eca81c1c0afa5a3e081fdf5fcbdc669e746e7e0a7f264e85ac76c496035b",
  },
  {
    name: "rec_rtl.onnx",
    size: 2842451,
    sha256: "9ccee36bb07b81ef310c6b50e707adabe8c6b92caea61105213686ea8977f4cf",
  },
  {
    name: "rec_rtl.charset.json",
    size: 1876,
    sha256: "8ad9b8f6c1bdc17b42a2351948e84a73c487f5bed7f783bc5e8474efad126a80",
  },
  {
    name: "rec_rtl.meta.json",
    size: 20,
    sha256: "31fd2893cc4d48ec50b4b21a1f113f527ae9a4ac1b3ea395b0cc5969f56d46b5",
  },
  {
    name: "rec_world.onnx",
    size: 3913987,
    sha256: "c57d01a945d741886d356bdedc636f0572d0810c6a7c2f26dbb9ce0466b92220",
  },
  {
    name: "rec_world.charset.json",
    size: 11602,
    sha256: "ebfd39142cec3f267eda2b81b42966ac9b0f73841a52285770f4db40a016d689",
  },
  {
    name: "tablenet.onnx",
    size: 17182635,
    sha256: "3b913866067d6e43f73a4e4c9c1eace955b7959447043cc39ea1d30e4c552a95",
  },
];

// SAFETY: Object.keys of a Record<ModelFile, _> lists exactly its ModelFile keys.
const ROLES = Object.keys(MODEL_FILES) as ModelFile[];

/** The real bytes of a small pinned file, from the warmed disk cache. */
function realBytes(file: ModelFile): Promise<ArrayBuffer> {
  return new NodePlatformProvider().loadResource(undefined, defaultModelUrl(file));
}

describe("pinned files", () => {
  test("MODEL_FILES holds exactly the files LiteParse pins, with its sizes and SHA-256 sums", () => {
    const ours = ROLES.map((r) => MODEL_FILES[r]).toSorted((a, b) => a.name.localeCompare(b.name));
    const theirs = LITEPARSE_PINS.toSorted((a, b) => a.name.localeCompare(b.name));
    expect(ours).toEqual(theirs);
  });

  test("scripts/mirror/README.md lists the same SHA-256 for every file", async () => {
    const readme = await Bun.file(`${import.meta.dir}/../scripts/mirror/README.md`).text();
    for (const role of ROLES) {
      const pin = MODEL_FILES[role];
      expect(readme).toContain(`\`${pin.name}\``);
      expect(readme).toContain(`\`${pin.sha256}\``);
    }
  });

  test("the release is v1.0.0 at LlamaIndex's tagged commit", () => {
    expect(MODEL_VERSION).toBe("1.0.0");
    expect(MODEL_REVISION).toBe("11f092be242844361666e8bac97da168b0f4a299");
    expect(MODEL_BASE_URL).toBe(
      `https://huggingface.co/llamaindex/OCRia-nano-1/resolve/${MODEL_REVISION}`
    );
  });

  test("every recognizer and base file is in the catalogue", () => {
    const known = new Set<string>(ROLES);
    for (const files of Object.values(RECOGNIZER_FILES)) {
      expect(known.has(files.model)).toBe(true);
      expect(known.has(files.charset)).toBe(true);
      if (files.meta) expect(known.has(files.meta)).toBe(true);
    }
    for (const file of BASE_FILES) expect(known.has(file)).toBe(true);
    // The first service start needs the Latin recognizer; the others load on first use.
    expect(BASE_FILES).toContain(RECOGNIZER_FILES.latin.model);
    expect(BASE_FILES).not.toContain(RECOGNIZER_FILES.cjk.model);
  });
});

describe("model URLs", () => {
  test("the upstream URL is the file name under the pinned revision", () => {
    expect(defaultModelUrl("det")).toBe(`${MODEL_BASE_URL}/det.onnx`);
    expect(defaultModelUrl("layout")).toBe(`${MODEL_BASE_URL}/tablenet.onnx`);
  });

  test("the mirror URL is the same file name under the version folder", () => {
    expect(mirrorModelUrl("det")).toBe(`${MODEL_MIRROR_BASE_URL}/det.onnx`);
    expect(MODEL_MIRROR_BASE_URL.endsWith(`/v${MODEL_VERSION}`)).toBe(true);
  });
});

describe("verifyModelFile", () => {
  test("accepts the real bytes of a pinned file", async () => {
    await verifyModelFile("detMeta", await realBytes("detMeta"));
    await verifyModelFile("recRtlMeta", await realBytes("recRtlMeta"));
  });

  test("rejects a wrong size and names the file, both sizes and the release", async () => {
    const real = await realBytes("detMeta");
    const short = real.slice(0, real.byteLength - 1);
    await expect(verifyModelFile("detMeta", short)).rejects.toThrow(
      "det.meta.json: 16 bytes, expected 17 (OCRia-nano-1 1.0.0)"
    );
    await expect(verifyModelFile("detMeta", new ArrayBuffer(0))).rejects.toThrow("0 bytes");
  });

  test("rejects the right size with a wrong SHA-256", async () => {
    const real = new Uint8Array(await realBytes("detMeta"));
    const flipped = real.slice();
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    await expect(verifyModelFile("detMeta", flipped.buffer)).rejects.toThrow(
      `sha256 ${new Bun.CryptoHasher("sha256").update(flipped).digest("hex")}, expected ${MODEL_FILES.detMeta.sha256}`
    );
  });

  test("checks the size only where the runtime has no WebCrypto", async () => {
    const real = new Uint8Array(await realBytes("detMeta"));
    const flipped = real.slice();
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    const saved = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    try {
      await verifyModelFile("detMeta", flipped.buffer);
      await expect(verifyModelFile("detMeta", new ArrayBuffer(3))).rejects.toThrow("3 bytes");
    } finally {
      if (saved) Object.defineProperty(globalThis, "crypto", saved);
    }
  });
});
