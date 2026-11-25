// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

import type { InferenceSession } from "onnxruntime-common";

import type { OcriaNanoOptions } from "../interface.js";
import type { ModelFile } from "../model-catalogue.js";
import {
  MODEL_FILES,
  RECOGNIZER_FILES,
  defaultModelUrl,
  mirrorModelUrl,
  verifyModelFile,
} from "../model-catalogue.js";
import type { DetMeta, OcriaModels } from "../ocria/ocr/engine.js";
import type { Model } from "../ocria/ocr/model.js";
import { GROUPS, Recognizer, Router } from "../ocria/ocr/rec.js";
import type { CoreCanvas, PlatformProvider } from "./platform.js";
import { createSessionWithFallback } from "./session-factory.js";

/**
 * Loads the model files for one service: from the caller's source as given,
 * or from the pinned release (upstream, then the mirror) checked against its
 * pin. Keeps every session it creates so `release()` frees them.
 */
export class ModelLoader<TCanvas = CoreCanvas> {
  private sessions: InferenceSession[] = [];
  private readonly recs = new Map<number, Promise<Recognizer>>();

  public constructor(
    private readonly platform: PlatformProvider<TCanvas>,
    private readonly options: OcriaNanoOptions,
    private readonly log: (message: string) => void
  ) {}

  /** A model file's bytes. */
  public async bytes(file: ModelFile): Promise<ArrayBuffer> {
    const source = this.options.models?.[file];
    if (source !== undefined) {
      try {
        return await this.platform.loadResource(source, "");
      } catch (err) {
        const from = source instanceof ArrayBuffer ? "the given bytes" : source;
        throw new Error(`could not load ${MODEL_FILES[file].name} from ${from}`, { cause: err });
      }
    }
    let bytes: ArrayBuffer;
    try {
      bytes = await this.platform.loadResource(undefined, defaultModelUrl(file));
    } catch (upstream) {
      this.log(`${MODEL_FILES[file].name}: upstream download failed, trying the mirror`);
      try {
        bytes = await this.platform.loadResource(undefined, mirrorModelUrl(file));
      } catch (mirror) {
        throw new Error(
          `could not download ${MODEL_FILES[file].name} from ${defaultModelUrl(file)} or its mirror`,
          { cause: new AggregateError([upstream, mirror]) }
        );
      }
    }
    await verifyModelFile(file, bytes);
    return bytes;
  }

  /** A JSON model file (charset or metadata), parsed. */
  public async json<T>(file: ModelFile): Promise<T> {
    // SAFETY: the release's JSON files have the shapes their callers name
    // (string[] charsets, { thresh } and { visual_rtl } metadata).
    return JSON.parse(new TextDecoder().decode(await this.bytes(file))) as T;
  }

  /** An ONNX Runtime session of a model file, with the runtime's Tensor constructor. */
  public async model(file: ModelFile): Promise<Model> {
    return (await this.modelAndBytes(file)).model;
  }

  /** A model file's session and its bytes, read once (LayoutNet's config is in its bytes). */
  public async modelAndBytes(file: ModelFile): Promise<{ model: Model; bytes: Uint8Array }> {
    const bytes = new Uint8Array(await this.bytes(file));
    const session = await createSessionWithFallback(
      this.platform.ort,
      bytes,
      this.options.session,
      this.log,
      (next) => (this.options.session = next)
    );
    this.sessions.push(session);
    return { model: { session, Tensor: this.platform.ort.Tensor }, bytes };
  }

  /** The OCR stage's models: detector and router now, each recognizer on its first use. */
  public async ocrModels(): Promise<OcriaModels> {
    const [det, detMeta, router] = await Promise.all([
      this.model("det"),
      this.json<DetMeta>("detMeta"),
      this.model("router"),
    ]);
    await this.recognizer(0);
    return { det, detMeta, router: new Router(router), rec: (g) => this.recognizer(g) };
  }

  private recognizer(group: number): Promise<Recognizer> {
    const loaded = this.recs.get(group);
    if (loaded) return loaded;
    const files = RECOGNIZER_FILES[GROUPS[group]];
    const open = async (): Promise<Recognizer> => {
      if (group !== 0) this.log(`loading ${MODEL_FILES[files.model].name} on first use`);
      try {
        const [model, charset, meta] = await Promise.all([
          this.model(files.model),
          this.json<string[]>(files.charset),
          files.meta ? this.json<{ visual_rtl?: boolean }>(files.meta) : Promise.resolve({}),
        ]);
        return await Recognizer.create(
          model,
          charset,
          "visual_rtl" in meta && meta.visual_rtl === true
        );
      } catch (err) {
        // a failed load is not kept, so the next page tries again
        this.recs.delete(group);
        throw err;
      }
    };
    const pending = open();
    this.recs.set(group, pending);
    return pending;
  }

  /** Release every session this loader created. */
  public async release(): Promise<void> {
    const sessions = this.sessions;
    this.sessions = [];
    this.recs.clear();
    await Promise.all(sessions.map((s) => s.release()));
  }
}
