export type PdfLoadTask<T> = {
  promise: Promise<T>;
  cancel?: () => void | Promise<void>;
};

export type PdfDocumentSource<T> = {
  stat(path: string): Promise<string>;
  load(path: string, signal: AbortSignal): PdfLoadTask<T> | Promise<PdfLoadTask<T>>;
  destroy(document: T): void | Promise<void>;
};

export type PdfDocumentLease<T> = {
  document: T;
  release(): void;
};

type Entry<T> = {
  path: string;
  key: string;
  document: T | null;
  task: Promise<T> | null;
  users: number;
  waiters: number;
  loading: boolean;
  cancelled: boolean;
  stale: boolean;
  disposed: boolean;
  lastUsed: number;
  controller: AbortController;
  cancelLoad?: () => void | Promise<void>;
};

export type PdfDocumentCacheOptions = {
  /** Maximum resident documents. Active leases are never evicted. */
  maxDocuments?: number;
  /** Maximum simultaneous document loads. */
  maxLoading?: number;
  now?: () => number;
};

function abortError(): Error {
  const error = new Error("PDF document load was cancelled");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function waitFor<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

/**
 * Keeps PDF documents alive only while a caller holds a lease. A document can
 * be loading without a user; that entry may be cancelled or replaced, but an
 * actively rendered document is never evicted.
 */
export class PdfDocumentCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly source: PdfDocumentSource<T>;
  private readonly maxDocuments: number;
  private readonly maxLoading: number;
  private readonly now: () => number;
  private loadSlots = 0;
  private readonly loadQueue: Array<() => void> = [];

  constructor(source: PdfDocumentSource<T>, options: PdfDocumentCacheOptions = {}) {
    this.source = source;
    this.maxDocuments = Math.max(1, options.maxDocuments ?? 3);
    this.maxLoading = Math.max(1, options.maxLoading ?? 2);
    this.now = options.now ?? Date.now;
  }

  async acquire(path: string, signal?: AbortSignal): Promise<PdfDocumentLease<T>> {
    throwIfAborted(signal);
    const key = await this.source.stat(path);
    throwIfAborted(signal);

    let entry = this.entries.get(path);
    if (entry && entry.key !== key) {
      this.entries.delete(path);
      if (entry.users === 0 && !entry.loading) void this.dispose(entry);
      else entry.stale = true;
      entry = undefined;
    }
    if (!entry) {
      entry = this.createEntry(path, key);
      this.entries.set(path, entry);
      this.start(entry);
    }

    entry.waiters += 1;
    entry.lastUsed = this.now();
    try {
      await waitFor(entry.task!, signal);
    } catch (error) {
      entry.waiters = Math.max(0, entry.waiters - 1);
      this.cancelIfUnused(entry);
      throw error;
    }
    entry.waiters = Math.max(0, entry.waiters - 1);
    throwIfAborted(signal);
    if (!entry.document) {
      this.cancelIfUnused(entry);
      throw new Error("The PDF document is no longer available");
    }

    entry.users += 1;
    entry.lastUsed = this.now();
    const document = entry.document;
    let released = false;
    void this.trim();
    return {
      document,
      release: () => {
        if (released) return;
        released = true;
        entry.users = Math.max(0, entry.users - 1);
        entry.lastUsed = this.now();
        this.afterRelease(entry);
      },
    };
  }

  /** Waits for idle eviction work, which is useful to tests and shutdown. */
  async trim(): Promise<void> {
    const candidates = [...this.entries.values()]
      .filter((entry) => entry.users === 0 && !entry.loading && !entry.stale && !!entry.document)
      .sort((left, right) => left.lastUsed - right.lastUsed);
    let excess = this.entries.size - this.maxDocuments;
    for (const entry of candidates) {
      if (excess <= 0) break;
      this.entries.delete(entry.path);
      excess -= 1;
      await this.dispose(entry);
    }
  }

  async disposeAll(): Promise<void> {
    const entries = [...this.entries.values()];
    this.entries.clear();
    for (const entry of entries) {
      entry.cancelled = true;
      entry.controller.abort();
      try {
        await entry.cancelLoad?.();
      } catch {
        /* best effort */
      }
      await this.dispose(entry);
    }
  }

  private createEntry(path: string, key: string): Entry<T> {
    return {
      path,
      key,
      document: null,
      task: null,
      users: 0,
      waiters: 0,
      loading: true,
      cancelled: false,
      stale: false,
      disposed: false,
      lastUsed: this.now(),
      controller: new AbortController(),
    };
  }

  private start(entry: Entry<T>): void {
    entry.task = (async () => {
      await this.takeLoadSlot();
      try {
        throwIfAborted(entry.controller.signal);
        const task = await this.source.load(entry.path, entry.controller.signal);
        entry.cancelLoad = task.cancel;
        const document = await task.promise;
        if (entry.cancelled || this.entries.get(entry.path) !== entry) {
          await this.source.destroy(document);
          throw abortError();
        }
        entry.document = document;
        return document;
      } finally {
        entry.loading = false;
        this.releaseLoadSlot();
      }
    })();
    entry.task.catch(() => {
      if (this.entries.get(entry.path) === entry) this.entries.delete(entry.path);
      void this.dispose(entry);
      void this.trim();
    });
  }

  private async takeLoadSlot(): Promise<void> {
    if (this.loadSlots < this.maxLoading) {
      this.loadSlots += 1;
      return;
    }
    await new Promise<void>((resolve) => this.loadQueue.push(resolve));
    this.loadSlots += 1;
  }

  private releaseLoadSlot(): void {
    this.loadSlots = Math.max(0, this.loadSlots - 1);
    this.loadQueue.shift()?.();
  }

  private cancelIfUnused(entry: Entry<T>): void {
    if (entry.users > 0 || entry.waiters > 0) return;
    if (entry.loading) {
      entry.cancelled = true;
      entry.controller.abort();
      try {
        void entry.cancelLoad?.();
      } catch {
        /* best effort */
      }
      if (this.entries.get(entry.path) === entry) this.entries.delete(entry.path);
      return;
    }
    if (this.entries.get(entry.path) !== entry) void this.dispose(entry);
  }

  private afterRelease(entry: Entry<T>): void {
    if (entry.users > 0) return;
    if (entry.stale || this.entries.get(entry.path) !== entry) {
      void this.dispose(entry);
      return;
    }
    void this.trim();
  }

  private async dispose(entry: Entry<T>): Promise<void> {
    if (entry.disposed) return;
    entry.disposed = true;
    const document = entry.document;
    entry.document = null;
    if (document == null) return;
    try {
      await this.source.destroy(document);
    } catch {
      /* a damaged document must not turn eviction into an unhandled rejection */
    }
  }
}
