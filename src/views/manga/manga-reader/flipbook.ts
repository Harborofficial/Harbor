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

type FlipMainInstance = { options?: unknown };
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

export function guardPageLoaded(): void {
  if (typeof window === "undefined") return;
  const mainProto = (window as unknown as { FLIPBOOK?: { Main?: { prototype?: FlipMainProto } } })
    .FLIPBOOK?.Main?.prototype;
  if (mainProto && typeof mainProto.pageLoaded === "function" && !mainProto.__harborPageLoadedGuard) {
    const original = mainProto.pageLoaded;
    mainProto.pageLoaded = function (this: FlipMainInstance, ...args: Array<unknown>): unknown {
      if (!this || this.options == null) return undefined;
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
    return originalLoadPageHTML.call(this, page, function (content, ...args) {
      if (content == null || typeof content === "string") {
        const wrapper = document.createElement("div");
        if (typeof content === "string") wrapper.innerHTML = content;
        content = wrapper;
      }
      return callback.call(this, content, ...args);
    });
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
