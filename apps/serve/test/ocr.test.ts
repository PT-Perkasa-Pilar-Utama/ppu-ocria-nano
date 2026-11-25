import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { loadParseGolden } from "../../../tests/ocria/parse-golden.js";
import { pdfReady } from "./pdf-ready.js";

const ROOT = join(import.meta.dir, "..", "..", "..");
const PAGES = join(ROOT, "tests", "fixtures", "pages");

const { OcriaNanoService } = await import("ppu-ocria-nano");
const { app } = await import("../src/app.js");
const { shutdownService } = await import("../src/core/service.js");

const image = readFileSync(join(PAGES, "table.png"));
const pdf = readFileSync(join(PAGES, "digital.pdf"));
const dataUri = `data:image/png;base64,${image.toString("base64")}`;
const tableGolden = loadParseGolden("table").text;

const json = (body: unknown) =>
  ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as const;

const upload = (
  bytes: Uint8Array,
  name: string,
  type: string,
  fields: Record<string, string> = {}
) => {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], name, { type }));
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return { method: "POST", body: form } as const;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Only the download here: it fits a hook timeout. Models load lazily on the
// first request; the inference tests carry longer timeouts.
beforeAll(async () => {
  await OcriaNanoService.downloadModels();
}, 120_000);

afterAll(async () => {
  await shutdownService();
});

describe("POST /v1/ocr", () => {
  test("an image upload returns one page that matches the reference markdown", async () => {
    const res = await app.request("/v1/ocr", upload(image, "table.png", "image/png"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.data.pages).toHaveLength(1);
    const [page] = body.data.pages;
    expect(page.markdown.trim()).toBe(tableGolden.trim());
    expect(page.pageNumber).toBe(1);
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.blocks.length).toBeGreaterThan(0);
    // `parsed` is the library's stage value; the API leaves it out.
    expect(page.parsed).toBeUndefined();
    expect(body.metadata.pages).toBe(1);
    expect(body.metadata.speed).toBeGreaterThan(0);
  }, 60_000);

  test.skipIf(!pdfReady)(
    "a PDF upload reads the text layer",
    async () => {
      const res = await app.request("/v1/ocr", upload(pdf, "digital.pdf", "application/pdf"));
      expect(res.status).toBe(200);
      const page = (await res.json()).data.pages[0];
      expect(page.markdown.trim()).toBe(loadParseGolden("digital").text.trim());
    },
    60_000
  );

  test("a JSON data: URI source works; bad options are 400", async () => {
    const res = await app.request("/v1/ocr", json({ source: dataUri }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.pages).toHaveLength(1);
    expect((await app.request("/v1/ocr", json({ source: dataUri, maxPages: 0 }))).status).toBe(400);
    expect(
      (await app.request("/v1/ocr", upload(image, "t.png", "image/png", { maxPages: "0" }))).status
    ).toBe(400);
  }, 60_000);
});

describe("POST /v1/detect", () => {
  test("returns line quads with a count", async () => {
    const res = await app.request("/v1/detect", upload(image, "table.png", "image/png"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.boxes.length).toBeGreaterThan(0);
    expect(body.data.boxes[0]).toHaveLength(4);
    expect(body.data.boxes[0][0]).toHaveLength(2);
    expect(body.data.faint).toBeArray();
    expect(body.metadata.count).toBe(body.data.boxes.length);
  }, 60_000);
});

describe("POST /v1/ocr/batch", () => {
  test("returns one page per source; settle reports failures", async () => {
    const res = await app.request("/v1/ocr/batch", json({ sources: [dataUri, dataUri] }));
    expect(res.status).toBe(200);
    const results = (await res.json()).data.results;
    expect(results).toHaveLength(2);
    expect(results[0].markdown.trim()).toBe(tableGolden.trim());
    // A PDF is not an image convert() can decode, so it is the failing item.
    const settled = await app.request(
      "/v1/ocr/batch",
      json({
        sources: [dataUri, `data:application/pdf;base64,${pdf.toString("base64")}`],
        settle: true,
      })
    );
    // SAFETY: the settled batch envelope is { data: { results: items } } with items shaped as asserted.
    const items = (await settled.json()).data.results as { status: string; reason?: string }[];
    expect(items.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
    expect(items[1]?.reason).toBeString();
  }, 120_000);

  test("empty sources array is a validation error", async () => {
    const res = await app.request("/v1/ocr/batch", json({ sources: [] }));
    expect(res.status).toBe(400);
  });
});

describe("POST /v1/ocr/stream", () => {
  test("emits one SSE event per image then done", async () => {
    const res = await app.request("/v1/ocr/stream", json({ sources: [dataUri, dataUri] }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect((text.match(/event: fulfilled/g) ?? []).length).toBe(2);
    expect(text).toContain("event: done");
  }, 60_000);
});

describe("async tasks lifecycle", () => {
  test("submit, poll, result", async () => {
    const submit = await app.request("/v1/ocr/async", json({ sources: [dataUri] }));
    expect(submit.status).toBe(202);
    const { data } = await submit.json();
    let status = "queued";
    for (let i = 0; i < 300 && status !== "done"; i++) {
      status = (await (await app.request(`/v1/tasks/${data.taskId}`)).json()).data.status;
      if (status !== "done") await sleep(100);
    }
    expect(status).toBe("done");
    const result = await app.request(`/v1/tasks/${data.taskId}/result`);
    expect((await result.json()).data.results).toHaveLength(1);
  }, 60_000);

  test("unknown task id is 404; DELETE cancels a task", async () => {
    const id = crypto.randomUUID();
    expect((await app.request(`/v1/tasks/${id}`)).status).toBe(404);
    const submit = await app.request("/v1/ocr/async", json({ sources: [dataUri] }));
    const { data } = await submit.json();
    const del = await app.request(`/v1/tasks/${data.taskId}`, { method: "DELETE" });
    expect((await del.json()).data.status).toBe("cancelled");
  }, 60_000);
});
