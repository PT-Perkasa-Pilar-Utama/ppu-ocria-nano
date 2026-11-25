# ppu-ocria-nano-serve

Production-grade REST API around [`ppu-ocria-nano`](../../README.md) - Hono + Bun. POST an image or a PDF, get markdown, text and layout blocks as JSON.

Pick the path that fits you:

### A) Run the published image (no clone)

For deploying or just trying it - nothing to build, models are pre-baked.

```bash
docker run -p 8080:8080 ghcr.io/pt-perkasa-pilar-utama/ppu-ocria-nano/serve:latest
curl -F file=@receipt.jpg http://localhost:8080/v1/ocr
```

Images publish to GitHub Container Registry on each release (slimmed with docker-slim). GPU users build the CUDA image from `Dockerfile.cuda`. Configure via `-e` env vars (see below).

### B) Clone & run from source

For developing or self-building. From the repo root:

```bash
cd apps/serve
bun install
bash ../../scripts/pdfium/build.sh   # pdfium for PDF input
cp .env.example .env          # optional - sane defaults otherwise
bun run dev                   # watch mode on http://localhost:8080
```

Or build the image yourself (from the **repo root**, the build context). PDF
input needs pdfium, which the image copies from `.pdfium-build/`; build it
first (it installs a pinned emsdk on its first run):

```bash
bash scripts/pdfium/build.sh
docker compose -f apps/serve/docker-compose.yml up --build
```

Open **http://localhost:8080/docs** for the Scalar API reference.

## Model license

The OCRia-nano-1 weights, character sets and metadata are LlamaIndex's, under
the OCRia-nano-1 license (modified AI Pubs Open RAIL-M), not under this
project's Apache-2.0 license. The image downloads them at build time from the
pinned release and checks each file's size and SHA-256. The license counts a
hosted service as distribution: give your users its use restrictions
(Attachment A) and a copy of the license, and check the revenue, funding and
Competing Service limits before you deploy. See
[LICENSE-STATUS.md](../../LICENSE-STATUS.md).

## Why

The library is a building block; this wraps it as a service you'd be comfortable running in production: one warmed `OcriaNanoService` shared behind a **bounded inference queue** (no OOM, no VRAM blow-up), graceful lifecycle, optional auth, Prometheus metrics, and OpenAPI docs.

## Endpoints

| Method | Path                      | Purpose                                                                           |
| ------ | ------------------------- | --------------------------------------------------------------------------------- |
| POST   | `/v1/ocr`                 | Sync OCR of an image or PDF - `multipart/form-data` (`file`) or JSON `{ source }` |
| POST   | `/v1/detect`              | Detection only - line quads, no recognition (same input as `/v1/ocr`)             |
| POST   | `/v1/ocr/batch`           | Sync batch - JSON `{ sources: string[] }`                                         |
| POST   | `/v1/ocr/stream`          | SSE - one event per image as it finishes                                          |
| POST   | `/v1/ocr/async`           | Enqueue a batch -> `202 { taskId }`                                               |
| GET    | `/v1/tasks/:id`           | Task status                                                                       |
| GET    | `/v1/tasks/:id/result`    | Task result (409 until done)                                                      |
| DELETE | `/v1/tasks/:id`           | Cancel a task                                                                     |
| GET    | `/v1/models`              | The pinned OCRia-nano-1 files and the server settings                             |
| GET    | `/health` / `/ready`      | Liveness / readiness (200 once warmed)                                            |
| GET    | `/metrics`                | Prometheus                                                                        |
| GET    | `/docs` / `/openapi.json` | Scalar UI / spec                                                                  |

### Input

`POST /v1/ocr` accepts `multipart/form-data` with a `file` field, or JSON:

```jsonc
{
  "source": "data:application/pdf;base64,...", // an image or a PDF
  "maxPages": 10, // PDFs: at most this many pages (capped by MAX_PDF_PAGES)
}
```

A PDF reads its text layer where it can be trusted and OCRs the rest; an image is one page. Without the `ppu-ocria-nano/pdf` entry, a PDF is a `501`. The batch, stream, and async endpoints take images.

`source` must be a `data:` URI or an `https` URL whose host is in `SOURCE_URL_ALLOWLIST` (empty = https disabled). **Local filesystem paths are rejected**, and URL fetches refuse redirects - so the API never reads arbitrary host files or gets steered off-allowlist. Uploads are sniffed by magic bytes; anything that is not an image or a PDF gets a `400`, not a `500`. An allowlisted host that cannot be reached (DNS, TLS, refused, or a redirect) is a `502` naming the host.

`POST /v1/detect` takes an image (`file` or `{ source }`) and returns `{ boxes, faint }`: each entry is a quad of four `[x, y]` points (top-left, top-right, bottom-right, bottom-left) in image pixels, and `faint` holds the short-token candidates the detector scored under its threshold. `metadata` carries `speed` and `count`.

### Response format

Every JSON response uses a consistent envelope and carries the request id (also returned as the `X-Request-Id` header):

```jsonc
// success
{
  "status": "success",
  "version": "0.1.4",
  "metadata": { "id": "<request-id>", "speed": 0.27, "pages": 1 },
  "data": { "pages": [{ "pageNumber": 1, "width": 612, "height": 792, "dpi": 150, "markdown": "...", "text": "...", "items": [ ... ], "blocks": [ ... ] }] }
}
// error
{ "status": "error", "version": "0.1.4", "data": { "message": "...", "requestId": "<request-id>" } }
```

A page is the library's `Page` without its `parsed` stage value: `items` are the OCR lines (or text-layer runs) with boxes in points, and `blocks` are the layout blocks the markdown is written from. In a settled batch or a stream, a failed item is `{ index, status: "rejected", reason: "<message>" }`.

`/metrics` is the only exception (Prometheus text). The spec at `/openapi.json` (rendered at `/docs`) is generated from the valibot schemas via `hono-openapi`.

## Configuration (env)

See [`.env.example`](.env.example) for the full annotated list.

| Var                                                   | Default            | Notes                                                                  |
| ----------------------------------------------------- | ------------------ | ---------------------------------------------------------------------- |
| `API_ENV`                                             | `development`      | `development` \| `production`                                          |
| `PORT` / `HOST`                                       | `8080` / `0.0.0.0` |                                                                        |
| `SECRET_KEY`                                          | -                  | If set, `Bearer <key>` required on `/v1/*` (`openssl rand -hex 32`)    |
| `IP_WHITE_LIST` / `IP_DENY_LIST`                      | `*` / -            | Comma lists; `*` allows all (deny still applies)                       |
| `CORS_ORIGINS`                                        | `*`                | Comma list or `*`                                                      |
| `DOCS_ENABLED`                                        | `true`             | Serve `/docs` + `/openapi.json`                                        |
| `RATE_LIMIT_ENABLED`                                  | `true`             | Fixed-window per client IP on `/v1/*`                                  |
| `RATE_LIMIT_PER_WINDOW` / `RATE_LIMIT_WINDOW_SECONDS` | `120` / `60`       | `429` + `Retry-After` past the limit                                   |
| `REQUEST_TIMEOUT_SECONDS`                             | `30`               |                                                                        |
| `MAX_UPLOAD_BYTES`                                    | `10485760`         | Per image or PDF                                                       |
| `MAX_BATCH_IMAGES`                                    | `32`               |                                                                        |
| `EXECUTION_PROVIDERS`                                 | `cpu`              | Comma list, e.g. `cuda,cpu`                                            |
| `MODEL_DIR`                                           | default download   | A folder with the OCRia-nano-1 files; a missing file still downloads   |
| `LAYOUT`                                              | `true`             | Run LayoutNet (`tablenet.onnx`, 17 MB) for tables, headings and blocks |
| `KEEP_HEADERS_FOOTERS`                                | `false`            | Keep page headers and footers in the markdown                          |
| `PDF_DPI` / `MAX_PDF_PAGES`                           | `250` / `50`       | PDF render resolution for OCR; pages read per PDF                      |
| `MAX_CONCURRENCY`                                     | `0` (auto)         | Auto = 1: each page allocates large tensors                            |
| `MAX_QUEUE_DEPTH`                                     | `100`              | Excess inferences get `429` + `Retry-After`                            |
| `TASK_TTL_SECONDS`                                    | `600`              | Async task retention                                                   |
| `SOURCE_URL_ALLOWLIST`                                | -                  | Comma list of allowed https hosts                                      |

## Architecture

`test/api.test.ts` covers the HTTP layer without loading models; `test/ocr.test.ts` loads them and compares `/v1/ocr` output with the LiteParse golden markdown. The PDF test skips until `ppu-ocria-nano/pdf` exports `convertPdf`. The app imports the library from source via a tsconfig path (`../../src`), so no build step is needed in dev; it is a standalone package (its own `node_modules`), kept out of the library's workspace so the published package is unaffected.

Layout: shared infrastructure in `src/core/` (config, queue, service, metrics, input, runner, api-response), and one vertical slice per endpoint in `src/modules/<endpoint>/` (each a `describeRoute` + handler registered on the `Hono` app).

## Notes & limits

- **Concurrency model.** Single-image OCR flows through the shared queue. Batch endpoints use `convertBatch`'s own bounded concurrency (defaults to the same value); they aren't additionally gated by the single-image queue.
- **Async tasks are in-memory** (per-instance). For multi-replica deployments, swap the `TaskStore` implementation for Redis/BullMQ behind the same interface.
- **GPU** throughput is the win for the CUDA image; on CPU, ONNX Runtime already saturates cores, so concurrency mainly bounds memory.
