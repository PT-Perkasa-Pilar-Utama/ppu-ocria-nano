# `ppu-ocria-nano` recipes

Task-shaped examples. Each one works as written on Node or Bun unless it
says otherwise.

## 1. Fill the model cache in CI or Docker

```ts
import { OcriaNanoService } from "ppu-ocria-nano";

await OcriaNanoService.downloadModels(); // ~/.cache/ppu-ocria-nano, checked against the pins
```

Or `npx ppu-ocria-nano download-models`. Cache `~/.cache/ppu-ocria-nano` in CI
keyed on the installed package version.

## 2. Load the models from a local folder

```ts
import { join } from "node:path";
import { MODEL_FILES, OcriaNanoService } from "ppu-ocria-nano";

const dir = "/opt/models/ocria-nano";
const models = Object.fromEntries(
  Object.entries(MODEL_FILES).map(([role, pin]) => [role, join(dir, pin.name)])
);
const service = new OcriaNanoService({ models });
```

Local files skip the pin check. Verify them yourself with
`verifyModelFile(role, bytes)` when they come from an untrusted place.

## 3. One warm service in a long-running server

```ts
const service = new OcriaNanoService();
const ready = service.initialize();

export async function handle(bytes: ArrayBuffer): Promise<string> {
  await ready;
  return (await service.convert(bytes)).markdown;
}

process.on("SIGTERM", () => void service.destroy());
```

## 4. Convert a folder of images on Bun

```ts
import { Glob } from "bun";
import { OcriaNanoService } from "ppu-ocria-nano";

const service = new OcriaNanoService();
await service.initialize();
const files = [...new Glob("scans/*.png").scanSync()];
async function* images(): AsyncGenerator<ArrayBuffer> {
  for (const f of files) yield await Bun.file(f).arrayBuffer();
}
for await (const r of service.convertStream(images(), { settle: true })) {
  if (r.status === "fulfilled") await Bun.write(`${files[r.index]}.md`, r.value.markdown);
  else console.error(files[r.index], r.reason);
}
await service.destroy();
```

## 5. Line boxes in pixels

`items` and `blocks` are in points. For an image, scale by `dpi / 72`:

```ts
const page = await service.convert(bytes);
const s = (page.dpi ?? 72) / 72;
const boxes = page.items.map((i) => [i.x * s, i.y * s, i.width * s, i.height * s]);
```

`service.recognize(bytes)` returns the OCR lines in pixels directly.

## 6. LiteParse's JSON output

```ts
import { formatJson } from "ppu-ocria-nano";

const pages = [await service.convert(bytes)];
const json = formatJson(pages.map((p) => p.parsed)); // as `lit parse --format json`
```

## 7. PDFs

```ts
import { convertPdf } from "ppu-ocria-nano/pdf";

const pages = await convertPdf(service, await Bun.file("report.pdf").arrayBuffer(), {
  maxPages: 20,
});
const markdown = pages.map((p) => p.markdown).join("\n\n-----\n\n");
```

## 8. Browser worker

See the README section "Web Workers". Send the `ArrayBuffer` transferred,
and post back plain fields (`markdown`, `blocks`), not the whole `Page`.

## 9. Debugging a bad page

1. `service.detect(bytes)`: are the lines found? Missing lines on faint or
   tiny print are a detector limit.
2. `service.recognize(bytes)`: is the text right per line? Wrong script on a
   mixed page shows in the readings.
3. `new OcriaNanoService({ layout: false })`: does the table or heading come
   back right without LayoutNet? Then LayoutNet's class or table decision
   changed it.
4. Compare with `lit parse` from LiteParse 2.21.2: this package's stages give
   the same values, so a difference there is worth an issue.
