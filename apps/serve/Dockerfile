# syntax=docker/dockerfile:1
# CPU image for ppu-ocria-nano-serve. Build from the REPO ROOT:
#   docker build -f apps/serve/Dockerfile -t ppu-ocria-nano-serve .
#
# Licenses: the code in this image is Apache-2.0. The OCRia-nano-1 weights,
# charsets and metadata it downloads at build time are LlamaIndex's, under the
# OCRia-nano-1 license (modified AI Pubs Open RAIL-M), not Apache-2.0. That
# license counts a hosted service as distribution: pass its use restrictions
# (Attachment A) and a copy of the license to your users. See LICENSE-STATUS.md.

# ---- dependencies ----
FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS deps
WORKDIR /app
# Library (root) deps - the serve app imports ppu-ocria-nano from source, which
# pulls onnxruntime-node + ppu-ocv from the root node_modules.
# Library runtime deps only: ppu-ocv (a prod dep) plus onnxruntime-node, which
# is a peer/dev dep so we add it explicitly. --production drops the heavy
# build/test devDeps (typescript, the native tsgo compiler, oxlint, ...).
COPY package.json bun.lock ./
# --ignore-scripts skips the root `prepare: lefthook install` (lefthook is a devDep, absent in
# --production); the onnxruntime native binary is then built via `bun pm trust`.
RUN bun install --production --ignore-scripts \
  && bun add onnxruntime-node --ignore-scripts \
  && bun pm trust onnxruntime-node
# Serve app: only hono + valibot at runtime (its lib deps are devDeps that resolve
# from the root node_modules above).
COPY apps/serve/package.json apps/serve/bun.lock apps/serve/
RUN cd apps/serve && bun install --production

# ---- runtime ----
FROM oven/bun:1.4.2-slim@sha256:cb3bbbb08e13a4a2ff400f24c7a2a1d5efa83f6ef8544d52d95a519631e2fc61 AS runtime
WORKDIR /app

# OCI metadata - without these the ghcr package inherits the base image's
# (Bun's) description.
LABEL org.opencontainers.image.title="ppu-ocria-nano-serve" \
      org.opencontainers.image.description="Production-grade REST API serving ppu-ocria-nano (OCRia-nano-1) - Hono + Bun." \
      org.opencontainers.image.source="https://github.com/PT-Perkasa-Pilar-Utama/ppu-ocria-nano" \
      org.opencontainers.image.licenses="Apache-2.0 AND LicenseRef-OCRia-nano-1"

ENV NODE_ENV=production \
    PORT=8080 \
    EXECUTION_PROVIDERS=cpu

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/serve/node_modules ./apps/serve/node_modules
COPY src ./src
# pdfium for PDF input: run scripts/pdfium/build.sh in the build context first
COPY .pdfium-build ./.pdfium-build
COPY package.json tsconfig.json ./
COPY apps/serve/src ./apps/serve/src
COPY apps/serve/package.json apps/serve/tsconfig.json ./apps/serve/

# Run as the unprivileged `bun` user and pre-bake the 13 OCRia-nano-1 files into
# its cache so the container has zero cold-start downloads. downloadModels reads
# the pinned release (src/model-catalogue.ts) and fails the build when a file's
# size or SHA-256 differs from its pin.
USER bun
RUN bun -e "import { OcriaNanoService } from '/app/src/index.ts'; await OcriaNanoService.downloadModels();"

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(Bun.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "run", "apps/serve/src/index.ts"]
