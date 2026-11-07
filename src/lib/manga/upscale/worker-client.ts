import type { MangaQuality, MangaUpscaleRequest, MangaUpscaleResponse } from "./protocol";

type Pending = {
  resolve: (value: Blob | undefined) => void;
  reject: (error: Error) => void;
};

/**
 * One dedicated worker per quality. The high-quality model takes seconds per
 * page, so it must not queue in front of the fast upscales the reader needs
 * while turning pages.
 */
export class MangaWorkerClient {
  private worker: Worker | null = null;
  private nextId = 0;
  private pending = new Map<number, Pending>();
  private modelKey: string | null = null;
  private ready: Promise<void> | null = null;
  activeProvider: "webgpu" | "wasm" | null = null;

  constructor(private readonly quality: MangaQuality) {}

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const created = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    created.addEventListener("message", (event: MessageEvent<MangaUpscaleResponse>) => {
      if (event.data.ok && event.data.provider) this.activeProvider = event.data.provider;
      const entry = this.pending.get(event.data.id);
      if (!entry) return;
      this.pending.delete(event.data.id);
      if (event.data.ok) entry.resolve(event.data.result);
      else entry.reject(new Error(event.data.error));
    });
    created.addEventListener("error", (event) => {
      this.failAll(new Error(event.message || "Manga upscaler crashed"));
    });
    this.worker = created;
    return created;
  }

  private failAll(error: Error) {
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
    this.modelKey = null;
    this.ready = null;
    this.activeProvider = null;
  }

  private call(
    request: MangaUpscaleRequest,
    transfer: Transferable[] = [],
  ): Promise<Blob | undefined> {
    const worker = this.ensureWorker();
    return new Promise((resolve, reject) => {
      this.pending.set(request.id, { resolve, reject });
      worker.postMessage(request, transfer);
    });
  }

  isLoaded(key: string): boolean {
    return !!this.ready && this.modelKey === key;
  }

  ensure(model: ArrayBuffer, key: string): Promise<void> {
    if (this.ready && this.modelKey === key) return this.ready;
    this.ready = this.call(
      { id: ++this.nextId, type: "ensure", quality: this.quality, modelKey: key, model },
      [model],
    )
      .then(() => {
        this.modelKey = key;
      })
      .catch((error) => {
        this.ready = null;
        this.modelKey = null;
        throw error;
      });
    return this.ready;
  }

  async upscale(bitmap: ImageBitmap): Promise<Blob> {
    const blob = await this.call(
      { id: ++this.nextId, type: "upscale", quality: this.quality, bitmap },
      [bitmap],
    );
    if (!blob) throw new Error("The upscaler returned no image");
    return blob;
  }

  reset() {
    this.failAll(new Error("Manga upscaler stopped"));
  }
}
