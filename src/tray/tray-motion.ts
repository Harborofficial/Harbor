const FADE_MS = 120;

/** The tray must still work where the platform cannot answer media queries. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function fadeTrayMenu(
  element: HTMLElement,
  opacity: 0 | 1,
  reducedMotion: boolean,
  completed: () => void = () => {},
): () => void {
  const from = getComputedStyle(element).opacity || element.style.opacity || "0";
  element.style.opacity = String(opacity);
  if (reducedMotion || Number(from) === opacity || typeof element.animate !== "function") {
    completed();
    return () => {};
  }
  const animation = element.animate([{ opacity: from }, { opacity: String(opacity) }], {
    duration: FADE_MS,
    easing: "ease-out",
  });
  let cancelled = false;
  const finish = () => {
    if (!cancelled) completed();
  };
  void animation.finished.then(finish, finish);
  return () => {
    cancelled = true;
    // Preserve a partial entry fade when dismissal interrupts it.
    const current = getComputedStyle(element).opacity;
    animation.cancel();
    element.style.opacity = current;
  };
}

export function presentTrayMenu(
  element: HTMLElement,
  present: () => Promise<unknown>,
  reducedMotion: () => boolean,
): { ready: Promise<void>; cancel: () => void } {
  let cancelled = false;
  let cancelFade = () => {};
  element.style.opacity = "0";
  const ready = Promise.resolve()
    .then(present)
    .then(() => {
      // Hidden WebViews can advance animation clocks before the native show.
      if (!cancelled) cancelFade = fadeTrayMenu(element, 1, reducedMotion());
    });
  return {
    ready,
    cancel() {
      cancelled = true;
      cancelFade();
    },
  };
}

/**
 * Entrance for the theme submenu: it slides out of the main panel while it
 * fades in, so the panel never appears over the row that opened it.
 */
export function presentTraySubmenu(
  element: HTMLElement,
  reducedMotion: boolean,
  side: "left" | "right",
): () => void {
  if (reducedMotion || typeof element.animate !== "function") return () => {};
  const offset = side === "right" ? -6 : 6;
  const animation = element.animate(
    [
      { opacity: "0", transform: `translateX(${offset}px)` },
      { opacity: "1", transform: "translateX(0)" },
    ],
    { duration: FADE_MS, easing: "ease-out" },
  );
  return () => {
    animation.cancel();
  };
}

/**
 * Exit for the theme submenu: it slides back into the main panel while it
 * fades out, and the caller learns when the panel is safe to remove.
 */
export function dismissTraySubmenu(
  element: HTMLElement,
  reducedMotion: boolean,
  side: "left" | "right",
  completed: () => void,
): () => void {
  if (reducedMotion || typeof element.animate !== "function") {
    completed();
    return () => {};
  }
  const offset = side === "right" ? -6 : 6;
  const animation = element.animate(
    [
      { opacity: "1", transform: "translateX(0)" },
      { opacity: "0", transform: `translateX(${offset}px)` },
    ],
    { duration: FADE_MS, easing: "ease-in" },
  );
  let cancelled = false;
  const finish = () => {
    if (!cancelled) completed();
  };
  void animation.finished.then(finish, finish);
  return () => {
    cancelled = true;
    animation.cancel();
  };
}
