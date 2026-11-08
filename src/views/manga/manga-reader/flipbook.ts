export type FlipPage = {
  _setAngle?: (deg: number) => void;
  angle?: number;
  dragging?: boolean;
};

export type FlipBookView = {
  onSwipe?: (
    target: unknown,
    phase: string,
    deltaX: number,
    deltaY: number,
    dist: number,
    touches: number,
  ) => void;
  wrapperW?: number;
  isZoomed?: () => boolean;
  getRightPage?: () => FlipPage | null | undefined;
  getLeftPage?: () => FlipPage | null | undefined;
  _start?: (target?: unknown) => void;
  _move?: (target: unknown, deltaX: number, deltaY: number) => void;
  _end?: (target?: unknown) => void;
};

export type FlipInstance = {
  goToPage?: (n: number, skipAnim?: boolean) => void;
  nextPage?: () => void;
  prevPage?: () => void;
  toggleSound?: (on: boolean) => void;
  zoomTo?: (level: number, time?: number, ev?: unknown) => void;
  getZoomMin?: () => number;
  moveBook?: (dir: "left" | "right" | "up" | "down") => void;
  Book?: FlipBookView;
  dispose?: () => void;
  destroy?: () => void;
};

export type FlipCtor = new (el: HTMLElement, opts: Record<string, unknown>) => FlipInstance;

export type FlipMainInstance = { options?: unknown };
type FlipMainProto = {
  pageLoaded?: (this: FlipMainInstance, ...args: Array<unknown>) => unknown;
  loadPageHTML?: (
    this: FlipMainInstance,
    page: number,
    callback: (this: FlipMainInstance, content: unknown, ...args: Array<unknown>) => unknown,
  ) => unknown;
  __harborPageLoadedGuard?: boolean;
  __harborPageHtmlContentGuard?: boolean;
};

type PageFinish = (this: FlipMainInstance, content: unknown, ...args: Array<unknown>) => unknown;

const disposed = new WeakSet<object>();
const pendingFinishes = new WeakMap<object, Set<PageFinish>>();

function objectKey(value: unknown): object | null {
  return value && (typeof value === "object" || typeof value === "function")
    ? (value as object)
    : null;
}

export function disposeFlipbook(value: unknown): void {
  const key = objectKey(value);
  if (!key) return;
  disposed.add(key);
  const pending = pendingFinishes.get(key);
  if (!pending) return;
  pendingFinishes.delete(key);
  for (const finish of pending) {
    try {
      finish.call(key as FlipMainInstance, null);
    } catch {
      /* a destroyed reader must not turn a settled page into an unhandled rejection */
    }
  }
}

function isDisposed(value: unknown): boolean {
  const key = objectKey(value);
  return !!key && disposed.has(key);
}

function isNode(value: unknown): value is Node {
  return typeof Node !== "undefined" && value instanceof Node;
}

function jqueryNode(value: unknown): Node | null {
  const wrapper = objectKey(value) as {
    jquery?: unknown;
    0?: unknown;
    get?: (index?: number) => unknown;
  } | null;
  if (!wrapper || wrapper.jquery == null) return null;
  const first = typeof wrapper.get === "function" ? wrapper.get(0) : wrapper[0];
  return isNode(first) ? first : null;
}

/**
 * The vendor passes back several content shapes: DOM nodes, jQuery wrappers,
 * HTML strings, and `{}` for pages outside the book. Its page code calls
 * appendChild on the callback argument, so every shape must become a Node.
 */
function pageContent(value: unknown): Node {
  if (isNode(value)) return value;
  const jquery = jqueryNode(value);
  if (jquery) return jquery;
  const wrapper = document.createElement("div");
  if (typeof value === "string") wrapper.innerHTML = value;
  return wrapper;
}

export function guardPageLoaded(): void {
  if (typeof window === "undefined") return;
  const mainProto = (window as unknown as { FLIPBOOK?: { Main?: { prototype?: FlipMainProto } } })
    .FLIPBOOK?.Main?.prototype;
  if (
    mainProto &&
    typeof mainProto.pageLoaded === "function" &&
    !mainProto.__harborPageLoadedGuard
  ) {
    const original = mainProto.pageLoaded;
    mainProto.pageLoaded = function (this: FlipMainInstance, ...args: Array<unknown>): unknown {
      if (!this || this.options == null || isDisposed(this)) return undefined;
      return original.apply(this, args);
    };
    mainProto.__harborPageLoadedGuard = true;
  }

  if (
    !mainProto ||
    typeof mainProto.loadPageHTML !== "function" ||
    mainProto.__harborPageHtmlContentGuard
  )
    return;
  const originalLoadPageHTML = mainProto.loadPageHTML;
  mainProto.loadPageHTML = function (this: FlipMainInstance, page, callback): unknown {
    let settled = false;
    let waiters = pendingFinishes.get(this);
    if (!waiters) {
      waiters = new Set();
      pendingFinishes.set(this, waiters);
    }
    const finish = function (
      this: FlipMainInstance,
      content: unknown,
      ...args: Array<unknown>
    ): unknown {
      if (settled) return undefined;
      settled = true;
      waiters?.delete(finish);
      return callback.call(this, pageContent(content), ...args);
    };
    waiters.add(finish);
    let result: unknown;
    try {
      result = originalLoadPageHTML.call(this, page, finish);
    } catch (error) {
      if (!settled && isDisposed(this)) {
        finish.call(this, null, page);
        return undefined;
      }
      throw error;
    }
    // A rejected JSON/page source otherwise leaves Book3's page promise pending.
    const pendingResult = result as Promise<unknown> | null;
    if (pendingResult && typeof pendingResult.catch === "function") {
      void pendingResult.catch(() => {
        if (!settled) finish.call(this, null, page);
      });
    }
    return result;
  };
  mainProto.__harborPageHtmlContentGuard = true;
}

export function hasNativeZoom(inst: FlipInstance | null): boolean {
  return !!inst && typeof inst.zoomTo === "function";
}

export function fitLevel(inst: FlipInstance): number {
  if (typeof inst.getZoomMin !== "function") return 1;
  try {
    const m = inst.getZoomMin();
    return Number.isFinite(m) && m > 0 ? m : 1;
  } catch {
    return 1;
  }
}

export function nativePan(inst: FlipInstance, dx: number, dy: number): void {
  const view = inst.Book;
  if (!view || typeof view._start !== "function" || typeof view._move !== "function") return;
  if (typeof view.isZoomed === "function" && !view.isZoomed()) return;
  try {
    view._start?.();
    view._move?.(null, dx, dy);
    view._end?.();
  } catch {
    /* noop */
  }
}
