# License status

> **Subject to change.** This page records where this project stands on the
> license of the OCRia-nano-1 model files. It changes when LlamaIndex
> contacts us or changes its license. Last updated: 2026-11-25.
>
> This page is not legal advice. Read the license yourself before you use the
> models.

## Two licenses apply

| Part                                                       | Owner                  | License                                                 |
| ---------------------------------------------------------- | ---------------------- | ------------------------------------------------------- |
| The code in this repository                                | PT Perkasa Pilar Utama | Apache-2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE) |
| The ported LiteParse code                                  | LlamaIndex, Inc.       | Apache-2.0                                              |
| The OCRia-nano-1 models, character sets and metadata files | LlamaIndex, Inc.       | OCRia-nano-1 license (modified AI Pubs Open RAIL-M)     |

The Apache-2.0 license of the code does not cover the model files. The
library cannot run without them, so the OCRia-nano-1 license applies to every
user who runs it.

## What the model license asks of you

When you download or run the models, you are the licensee. The library
downloads them for you on first use. The obligations are yours, not ours.

Attachment A of the license forbids any use of the models, the character
sets and metadata ("Licensed Code"), and their output in these cases:

- **Revenue limit.** You, your employer, or the entity you are affiliated
  with had more than USD 2,000,000 in gross revenue in the prior year.
  Personal use and Research Purposes are excepted.
- **Funding limit.** That entity has raised more than USD 2,000,000 in total
  equity or debt funding. Personal use and Research Purposes are excepted.
- **Competing Service.** You use them to provide, or as part of, a
  product or service that offers document parsing, OCR, or extraction of
  text, tables, charts or fields from documents and competes with a product
  of LlamaIndex or its affiliates, such as LlamaParse and LlamaCloud. This
  applies whatever your revenue or funding. Research Purposes are excepted.

"Research Purposes" is defined in the license. It covers non-commercial
research and teaching, evaluating and benchmarking, and internal research
and development that does not reach a product, a service, or your business
operations.

Other terms to read:

- **Section 1A.** The character sets and metadata files are Licensed Code
  under the same terms as the models. A port of them, or software that
  incorporates them, is a derivative. This is why this repository and its
  packages contain none of them.
- **Section 4.** If you redistribute the models, or run a service on them for
  others, you must pass the use restrictions on to your users as an
  enforceable term and give them a copy of the license.
- **Section 7.** Credit LlamaIndex, link to the original models, include the
  license, and say what you changed.
- **Section 8.** Output may not be used to create a derivative model (for
  example by distillation) except for Research Purposes.
- **Section 9.** LlamaIndex can restrict use of the models and update them.

For uses the license restricts, contact LlamaIndex at
<https://www.llamaindex.ai/contact>.

## What this project does with the models

- **Default download.** The library downloads the files from LlamaIndex's own
  repository, [llamaindex/OCRia-nano-1](https://huggingface.co/llamaindex/OCRia-nano-1),
  pinned to commit `11f092be242844361666e8bac97da168b0f4a299` (tag v1.0.0),
  and checks each file's size and SHA-256 against the values LiteParse
  crates-v2.21.2 pins.
- **No model files in the package or the repository.** The npm and JSR
  packages and this repository contain the code only. The test goldens hold
  stage outputs, not model files, character sets or metadata.
- **Mirror.** The Hugging Face repository
  [snowfluke/ppu-ocria-nano-models](https://huggingface.co/snowfluke/ppu-ocria-nano-models)
  holds unmodified copies of the v1.0.0 files in `v1.0.0/`, with LlamaIndex's
  license and attribution. The library reads it only when the download from
  LlamaIndex fails, and checks the same pins.
- **REST server image.** The Dockerfiles in [apps/serve](apps/serve) download
  the models at build time, so a built image contains them. Publishing that
  image, or running it as a service for others, is redistribution under
  Section 4.
- **Name.** "ocria-nano" in the package name refers to the models it runs.
  This is a community project. It is not affiliated with or endorsed by
  LlamaIndex.

## What can change

If LlamaIndex asks, objects, or changes its license, we will follow its
answer and cooperate. Possible changes:

- remove the mirror and the fallback;
- rename the package;
- change how the library gets the models;
- take the packages down or archive the project.

We record each change on this page and in [CHANGELOG.md](CHANGELOG.md).

## Contact

LlamaIndex, or anyone with a question about this page, can open an issue on
this repository. We answer license requests from LlamaIndex first.
