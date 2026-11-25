// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

import { describe, expect, test } from "bun:test";

import { ModelLoader } from "../src/core/model-loader.js";
import type { PlatformProvider } from "../src/core/platform.js";
import type { ModelFile } from "../src/model-catalogue.js";
import {
  MODEL_BASE_URL,
  MODEL_FILES,
  MODEL_MIRROR_BASE_URL,
  defaultModelUrl,
  mirrorModelUrl,
} from "../src/model-catalogue.js";
import { NodePlatformProvider } from "../src/processor/platform.node.js";

/**
 * The mirror is a Hugging Face repository the maintainer uploads, so the
 * repository holds no model files to compare. What the code owns is the URL
 * scheme and the fallback: the mirror is read only when the upstream download
 * fails, and its bytes are checked against the same pins.
 */

const FILE: ModelFile = "detMeta";
const UPSTREAM = defaultModelUrl(FILE);
const MIRROR = mirrorModelUrl(FILE);

type Loader = (
  source: string | ArrayBuffer | undefined,
  defaultUrl: string
) => Promise<ArrayBuffer>;

/** A loader over a fake platform that only has `loadResource`, the one method `bytes()` calls. */
function loaderOver(
  loadResource: Loader,
  models: ConstructorParameters<typeof ModelLoader>[1] = {}
) {
  // SAFETY: ModelLoader.bytes() reads only platform.loadResource.
  const platform = { loadResource } as unknown as PlatformProvider;
  const logs: string[] = [];
  return { loader: new ModelLoader(platform, models, (m) => logs.push(m)), logs };
}

describe("mirror URL scheme", () => {
  test("every file sits under snowfluke/ppu-ocria-nano-models, in the folder of the release", () => {
    expect(MODEL_MIRROR_BASE_URL).toBe(
      "https://huggingface.co/snowfluke/ppu-ocria-nano-models/resolve/main/v1.0.0"
    );
    // SAFETY: Object.keys of a Record<ModelFile, _> lists exactly its ModelFile keys.
    for (const role of Object.keys(MODEL_FILES) as ModelFile[]) {
      expect(mirrorModelUrl(role)).toBe(`${MODEL_MIRROR_BASE_URL}/${MODEL_FILES[role].name}`);
    }
  });

  test("the mirror is not the upstream host", () => {
    expect(mirrorModelUrl(FILE)).not.toStartWith(MODEL_BASE_URL);
  });
});

describe("ModelLoader mirror fallback", () => {
  test("reads the upstream and never the mirror when the upstream works", async () => {
    const real = await new NodePlatformProvider().loadResource(undefined, UPSTREAM);
    const seen: string[] = [];
    const { loader } = loaderOver(async (_s, url) => {
      seen.push(url);
      return real;
    });
    expect(await loader.bytes(FILE)).toBe(real);
    expect(seen).toEqual([UPSTREAM]);
  });

  test("falls back to the mirror when the upstream fails, and checks the mirror's bytes", async () => {
    const real = await new NodePlatformProvider().loadResource(undefined, UPSTREAM);
    const seen: string[] = [];
    const { loader, logs } = loaderOver(async (_s, url) => {
      seen.push(url);
      if (url === UPSTREAM) throw new Error("HTTP 429");
      return real;
    });
    expect(await loader.bytes(FILE)).toBe(real);
    expect(seen).toEqual([UPSTREAM, MIRROR]);
    expect(logs.join("\n")).toContain("trying the mirror");
  });

  test("rejects mirror bytes that fail the pin", async () => {
    const { loader } = loaderOver(async (_s, url) => {
      if (url === UPSTREAM) throw new Error("HTTP 429");
      return new ArrayBuffer(5);
    });
    await expect(loader.bytes(FILE)).rejects.toThrow("det.meta.json: 5 bytes, expected 17");
  });

  test("names the file and keeps both causes when both hosts fail", async () => {
    const { loader } = loaderOver(async (_s, url) => {
      throw new Error(`down: ${url}`);
    });
    const error = await loader.bytes(FILE).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(`could not download det.meta.json from ${UPSTREAM}`);
    const causes = ((error as Error).cause as AggregateError).errors.map((e: Error) => e.message);
    expect(causes).toEqual([`down: ${UPSTREAM}`, `down: ${MIRROR}`]);
  });

  test("a source the caller gives is read as given, with no download and no mirror", async () => {
    const calls: Array<[unknown, string]> = [];
    const { loader } = loaderOver(
      async (source, url) => {
        calls.push([source, url]);
        return new ArrayBuffer(1);
      },
      { models: { [FILE]: "/my/det.meta.json" } }
    );
    // The caller's own file is not checked against the pin.
    expect((await loader.bytes(FILE)).byteLength).toBe(1);
    expect(calls).toEqual([["/my/det.meta.json", ""]]);
  });

  test("a caller's source that fails names the file and the source", async () => {
    const { loader } = loaderOver(
      async () => {
        throw new Error("ENOENT");
      },
      { models: { [FILE]: "/no/such/det.meta.json" } }
    );
    await expect(loader.bytes(FILE)).rejects.toThrow(
      "could not load det.meta.json from /no/such/det.meta.json"
    );
  });
});
