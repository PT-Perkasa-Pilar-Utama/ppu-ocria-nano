import type { BatchItemResult, Detection, Page } from "ppu-ocria-nano";
import { isPdf } from "../../../../src/core/is-pdf.js";
import { config } from "./config.js";
import { badRequest } from "./errors.js";
import { resolveSource } from "./input.js";
import { requirePdf } from "./pdf.js";
import type { BatchOcrBody, OcrOptions } from "./schemas.js";
import { getService, queue } from "./service.js";

/** A page as the API returns it: `Page` without `parsed`, the stage value for the library's own stages. */
export type ApiPage = Omit<Page, "parsed">;

/** One batch item as the API returns it; a rejection carries its message, since an Error has no JSON form. */
export type ApiBatchItem =
  | { index: number; status: "fulfilled"; value: ApiPage }
  | { index: number; status: "rejected"; reason: string };

export type OcrMeta = { ms: number };
export type OcrResponse = { result: { pages: ApiPage[] }; meta: OcrMeta };

const round1 = (n: number): number => Math.round(n * 10) / 10;

function toApiPage({ parsed: _parsed, ...page }: Page): ApiPage {
  return page;
}

function toApiItem(item: BatchItemResult<Page>): ApiBatchItem {
  if (item.status === "fulfilled") {
    return { index: item.index, status: "fulfilled", value: toApiPage(item.value) };
  }
  const { reason } = item;
  return {
    index: item.index,
    status: "rejected",
    reason: reason instanceof Error ? reason.message : String(reason),
  };
}

/** OCR one image or PDF through the bounded inference queue. A PDF gives one page each. */
export async function runOcr(input: ArrayBuffer, opts: OcrOptions): Promise<OcrResponse> {
  const pdf = isPdf(input) ? await requirePdf() : null;
  const svc = await getService();
  const start = performance.now();
  const pages = pdf
    ? await queue.run(() =>
        pdf(svc, input, {
          dpi: config.pdfDpi,
          maxPages: Math.min(opts.maxPages ?? config.maxPdfPages, config.maxPdfPages),
        })
      )
    : [await queue.run(() => svc.convert(input))];
  return {
    result: { pages: pages.map(toApiPage) },
    meta: { ms: round1(performance.now() - start) },
  };
}

export type DetectResponse = { result: Detection; meta: OcrMeta };

/** Detect text lines only (no recognition) through the bounded inference queue. */
export async function runDetect(image: ArrayBuffer): Promise<DetectResponse> {
  const svc = await getService();
  const start = performance.now();
  const result = await queue.run(() => svc.detect(image));
  return { result, meta: { ms: round1(performance.now() - start) } };
}

/** Resolve a batch of `sources` to image buffers, bounded by MAX_BATCH_IMAGES. */
export async function resolveBatch(sources: string[]): Promise<ArrayBuffer[]> {
  if (sources.length > config.maxBatchImages) {
    throw badRequest(`Too many sources (max ${config.maxBatchImages})`);
  }
  return Promise.all(sources.map(resolveSource));
}

export type BatchResponse = { results: ApiPage[] | ApiBatchItem[] };

/**
 * Convert a batch of images; convertBatch applies its own bounded concurrency.
 * A PDF in a batch is rejected by convert() as an unreadable image; PDFs go through /v1/ocr.
 */
export async function runBatch(
  images: ArrayBuffer[],
  body: BatchOcrBody,
  signal?: AbortSignal
): Promise<BatchResponse> {
  const svc = await getService();
  const concurrency = body.concurrency ?? config.concurrency;
  if (body.settle) {
    const items = await svc.convertBatch(images, { concurrency, settle: true, signal });
    return { results: items.map(toApiItem) };
  }
  const pages = await svc.convertBatch(images, { concurrency, signal });
  return { results: pages.map(toApiPage) };
}

/** Stream batch results as each image finishes (completion order). */
export async function* streamBatch(
  images: ArrayBuffer[],
  body: BatchOcrBody
): AsyncGenerator<ApiBatchItem> {
  const svc = await getService();
  for await (const item of svc.convertStream(images, {
    concurrency: body.concurrency ?? config.concurrency,
    settle: body.settle ?? false,
  })) {
    yield toApiItem(item);
  }
}
