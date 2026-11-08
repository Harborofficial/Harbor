import type { PDFDocumentProxy } from "pdfjs-dist";
import { PdfDocumentCache, type PdfLoadTask } from "./pdf-cache";
import { PDF_RENDER_LIMITS, pageRenderSize, type PdfRenderLimits } from "./pdf-render";

export type PdfBookInfo = {
  title?: string;
  authors: string[];
  pages: number;
  cover?: string;
  year?: number;
};

export type PdfDocumentErrorKind = "password" | "corrupt" | "inaccessible" | "cancelled";

export class PdfDocumentError extends Error {
  readonly kind: PdfDocumentErrorKind;

  constructor(message: string, kind: PdfDocumentErrorKind) {
    super(message);
    this.name = "PdfDocumentError";
    this.kind = kind;
  }
}

const WORKER_URL = "/pdfjs/pdf.worker.min.mjs";
const CMAP_URL = "/pdfjs/cmaps/";
const STANDARD_FONT_URL = "/pdfjs/standard_fonts/";
const MAX_RENDER_TASKS = 2;

let library: Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> | null = null;

async function pdfjs() {
  const module = await (library ??= import("pdfjs-dist/legacy/build/pdf.mjs"));
  if (!module.GlobalWorkerOptions.workerSrc) module.GlobalWorkerOptions.workerSrc = WORKER_URL;
  return module;
}

function abortError(): Error {
  const error = new Error("PDF loading was cancelled");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

export function pdfError(error: unknown, signal?: AbortSignal): PdfDocumentError {
  if (error instanceof PdfDocumentError) return error;
  if (signal?.aborted || (error as { name?: string } | null)?.name === "AbortError") {
    return new PdfDocumentError("PDF loading was cancelled.", "cancelled");
  }
  const name = (error as { name?: string } | null)?.name ?? "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  const text = `${name} ${message}`;
  if (/password/i.test(text)) {
    return new PdfDocumentError(
      "This PDF is password-protected. Remove the password and try again.",
      "password",
    );
  }
  if (/invalidpdf|formaterror|invalid pdf|corrupt|damaged|malformed/i.test(text)) {
    return new PdfDocumentError("This PDF is damaged and could not be opened.", "corrupt");
  }
  if (
    /no such file|not found|forbidden|not allowed|not permitted|permission|denied|scope|access|os error|i\/o/i.test(
      text,
    )
  ) {
    return new PdfDocumentError("The PDF file could not be read.", "inaccessible");
  }
  return new PdfDocumentError("This PDF could not be opened. The file may be damaged.", "corrupt");
}

async function statFile(path: string): Promise<string> {
  const { stat } = await import("@tauri-apps/plugin-fs");
  const info = await stat(path);
  return `${info.size}:${info.mtime?.getTime() ?? 0}`;
}

async function loadFile(path: string, signal: AbortSignal): Promise<PdfLoadTask<PDFDocumentProxy>> {
  throwIfAborted(signal);
  const [module, { readFile }] = await Promise.all([pdfjs(), import("@tauri-apps/plugin-fs")]);
  throwIfAborted(signal);
  const bytes = await readFile(path);
  throwIfAborted(signal);
  const task = module.getDocument({
    data: bytes,
    isEvalSupported: false,
    cMapUrl: CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: STANDARD_FONT_URL,
  });
  return {
    promise: task.promise,
    cancel: () => task.destroy(),
  };
}

const documents = new PdfDocumentCache<PDFDocumentProxy>(
  {
    stat: statFile,
    load: loadFile,
    destroy: (document) => document.destroy(),
  },
  { maxDocuments: 3, maxLoading: 2 },
);

async function acquire(path: string, signal?: AbortSignal) {
  try {
    return await documents.acquire(path, signal);
  } catch (error) {
    throw pdfError(error, signal);
  }
}

let renderCount = 0;
const renderQueue: Array<() => void> = [];

function releaseRenderSlot(): void {
  renderCount = Math.max(0, renderCount - 1);
  renderQueue.shift()?.();
}

function takeRenderSlot(signal?: AbortSignal): Promise<() => void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let granted = false;
    const grant = () => {
      if (granted) return;
      granted = true;
      signal?.removeEventListener("abort", onAbort);
      renderCount += 1;
      resolve(releaseRenderSlot);
    };
    const onAbort = () => {
      if (granted) return;
      const index = renderQueue.indexOf(grant);
      if (index >= 0) renderQueue.splice(index, 1);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    if (renderCount < MAX_RENDER_TASKS) {
      grant();
      return;
    }
    renderQueue.push(grant);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function renderPage(
  file: PDFDocumentProxy,
  pageNumber: number,
  limits: Partial<PdfRenderLimits>,
  signal?: AbortSignal,
): Promise<string> {
  const page = await file.getPage(pageNumber);
  let canvas: HTMLCanvasElement | null = null;
  try {
    const base = page.getViewport({ scale: 1 });
    const size = pageRenderSize(base.width, base.height, { ...PDF_RENDER_LIMITS, ...limits });
    const release = await takeRenderSlot(signal);
    try {
      throwIfAborted(signal);
      const viewport = page.getViewport({ scale: size.scale });
      canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("The PDF page could not be rendered");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      const task = page.render({ canvasContext: context, viewport });
      const cancel = () => task.cancel();
      signal?.addEventListener("abort", cancel, { once: true });
      try {
        await task.promise;
        throwIfAborted(signal);
        return canvas.toDataURL("image/jpeg", 0.9);
      } finally {
        signal?.removeEventListener("abort", cancel);
      }
    } finally {
      release();
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    }
  } finally {
    page.cleanup();
  }
}

function metadataValue(info: unknown, key: string): string | undefined {
  if (!info || typeof info !== "object") return undefined;
  const value = (info as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function pdfBookInfo(path: string, signal?: AbortSignal): Promise<PdfBookInfo> {
  const lease = await acquire(path, signal);
  try {
    const metadata = await lease.document.getMetadata().catch(() => null);
    const info = metadata?.info;
    const created = metadataValue(info, "CreationDate")?.match(/\d{4}/)?.[0];
    const pages = lease.document.numPages;
    const cover =
      pages > 0
        ? await renderPage(
            lease.document,
            1,
            { maxWidth: 480, maxHeight: 640, maxPixels: 1_000_000 },
            signal,
          ).catch(() => undefined)
        : undefined;
    throwIfAborted(signal);
    return {
      title: metadataValue(info, "Title"),
      authors: (metadataValue(info, "Author") ?? "").split(/\s*[,;/]\s*/).filter(Boolean),
      pages,
      cover,
      ...(created ? { year: Number(created) } : {}),
    };
  } catch (error) {
    throw pdfError(error, signal);
  } finally {
    lease.release();
  }
}

export async function pdfPageCount(path: string, signal?: AbortSignal): Promise<number> {
  const lease = await acquire(path, signal);
  try {
    return lease.document.numPages;
  } catch (error) {
    throw pdfError(error, signal);
  } finally {
    lease.release();
  }
}

export async function pdfPageImage(
  path: string,
  pageNumber: number,
  signal?: AbortSignal,
): Promise<string> {
  const lease = await acquire(path, signal);
  try {
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > lease.document.numPages) {
      throw new PdfDocumentError("That PDF page does not exist.", "corrupt");
    }
    return await renderPage(lease.document, pageNumber, {}, signal);
  } catch (error) {
    throw pdfError(error, signal);
  } finally {
    lease.release();
  }
}
