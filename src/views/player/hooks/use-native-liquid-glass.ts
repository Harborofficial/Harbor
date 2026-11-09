import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  normalizeGlassOptics,
  type GlassLayout,
  type GlassOptics,
} from "@/lib/player/liquid-glass";

const SELECTOR = "[data-mpv-glass], [data-native-glass-surface]";
let nextOwnerGeneration = Date.now() * 1000;

function visibleSurface(node: HTMLElement, root: HTMLElement): boolean {
  for (let parent: HTMLElement | null = node; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (
      parent.hidden ||
      parent.inert ||
      parent.getAttribute("aria-hidden") === "true" ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      (style.opacity !== "" && Number(style.opacity) < 0.02)
    )
      return false;
    if (parent === root) break;
  }
  return true;
}

// Only layout changes cross IPC. Video pixels stay in mpv's GPU renderer.
export function useNativeLiquidGlass(
  rootRef: RefObject<HTMLElement | null>,
  videoRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  sessionKey: string,
  input: GlassOptics,
) {
  const [active, setActive] = useState(false);
  const optics = normalizeGlassOptics(input);
  const opticsRef = useRef(optics);
  opticsRef.current = optics;
  const scheduleRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    setActive(false);
    const root = rootRef.current;
    if (!enabled) {
      root
        ?.querySelectorAll("[data-mpv-glass-active], [data-mpv-glass-prepared]")
        .forEach((node) => {
          node.removeAttribute("data-mpv-glass-active");
          node.removeAttribute("data-mpv-glass-prepared");
        });
      return;
    }
    const video = videoRef.current;
    if (!root || !video) return;
    let disposed = false;
    let raf = 0;
    let settleTimer = 0;
    let restoreImmediately = true;
    let layoutSignature = "";
    let measuredSurfaces = new Set<HTMLElement>();
    let pending: { layout: GlassLayout; surfaces: HTMLElement[] } | null = null;
    let sending = false;
    let signature = "";
    const ownerId = crypto.randomUUID();
    const ownerGeneration = ++nextOwnerGeneration;
    let activeSurfaces: HTMLElement[] = [];
    let preparedSurfaces: HTMLElement[] = [];
    const prepareSurfaces = (surfaces: HTMLElement[]) => {
      for (const node of preparedSurfaces) {
        if (!surfaces.includes(node)) node.removeAttribute("data-mpv-glass-prepared");
      }
      for (const node of surfaces) node.setAttribute("data-mpv-glass-prepared", "");
      preparedSurfaces = surfaces;
    };
    const markSurfaces = (surfaces: HTMLElement[]) => {
      for (const node of activeSurfaces) {
        if (!surfaces.includes(node)) node.removeAttribute("data-mpv-glass-active");
      }
      for (const node of surfaces) node.setAttribute("data-mpv-glass-active", "");
      activeSurfaces = surfaces;
    };
    const send = (layout: GlassLayout, surfaces: HTMLElement[] = []) => {
      const nextSignature = JSON.stringify(layout);
      if (nextSignature === signature) return;
      signature = nextSignature;
      pending = { layout, surfaces };
      if (sending) return;
      sending = true;
      void (async () => {
        try {
          while (pending) {
            const next = pending;
            pending = null;
            await invoke("mpv_glass_layout", { ownerId, ownerGeneration, layout: next.layout });
            if (!disposed && JSON.stringify(next.layout) === signature) {
              markSurfaces(next.surfaces);
              setActive(next.layout.regions.length > 0);
            }
          }
        } catch {
          signature = "";
          layoutSignature = "";
          if (!disposed) {
            markSurfaces([]);
            prepareSurfaces([]);
            setActive(false);
          }
        } finally {
          sending = false;
        }
      })();
    };
    const measure = () => {
      if (disposed) return;
      for (const surface of movingSurfaces) {
        if (
          !root.contains(surface) ||
          !surface
            .getAnimations()
            .some((animation) => animation.playState === "running" || animation.pending)
        )
          movingSurfaces.delete(surface);
      }
      const frame = video.getBoundingClientRect();
      const nodes = document.hidden ? [] : Array.from(root.querySelectorAll<HTMLElement>(SELECTOR));
      const candidates = nodes.filter(
        (node) =>
          (!node.closest("[data-mpv-controls]") || node.dataset.mpvGlass === "panel") &&
          visibleSurface(node, root),
      );
      const prepared = candidates
        .filter((node) => {
          for (
            let parent = node.parentElement;
            parent && parent !== root;
            parent = parent.parentElement
          ) {
            if (candidates.includes(parent)) return false;
          }
          return true;
        })
        .sort(
          (a, b) =>
            Number(b.dataset.mpvGlass === "panel") - Number(a.dataset.mpvGlass === "panel") ||
            Number(b.dataset.mpvGlass === "priority") - Number(a.dataset.mpvGlass === "priority"),
        )
        .map((node) => {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          const inset = (value: string) =>
            node.dataset.mpvGlass === "priority" ? parseFloat(value) || 0 : 0;
          const left = inset(style.borderLeftWidth);
          const right = inset(style.borderRightWidth);
          const top = inset(style.borderTopWidth);
          const bottom = inset(style.borderBottomWidth);
          // The edge tab's shader belongs inside its existing border, which
          // has different widths on the attached and exposed sides.
          const radius = (value: string, border: number) =>
            Math.max(0, Math.min(parseFloat(value) || 0, rect.width / 2, rect.height / 2) - border);
          return {
            node,
            region: {
              x: rect.left - frame.left + left,
              y: rect.top - frame.top + top,
              width: rect.width - left - right,
              height: rect.height - top - bottom,
              ...(node.dataset.mpvGlass === "priority" ? { edgeFeather: 4 } : {}),
              radius: radius(style.borderTopLeftRadius || style.borderRadius, Math.max(top, left)),
              radii: [
                radius(style.borderTopLeftRadius, Math.max(top, left)),
                radius(style.borderTopRightRadius, Math.max(top, right)),
                radius(style.borderBottomRightRadius, Math.max(bottom, right)),
                radius(style.borderBottomLeftRadius, Math.max(bottom, left)),
              ] as [number, number, number, number],
            },
          };
        })
        .filter(
          ({ region: r }) =>
            r.width > 0 &&
            r.height > 0 &&
            r.x < frame.width &&
            r.y < frame.height &&
            r.x + r.width > 0 &&
            r.y + r.height > 0,
        )
        .slice(0, 6);
      // Keep the surface transparent while the native shader is pending or
      // paused for motion. Its ordinary fill returns when glass is disabled.
      prepareSurfaces(prepared.map(({ node }) => node));
      const surfaces = prepared.filter(
        ({ node }) =>
          !node.closest("[data-mpv-glass-moving]") &&
          !Array.from(movingSurfaces).some((surface) => surface === node || surface.contains(node)),
      );
      markSurfaces(
        activeSurfaces.filter((node) => surfaces.some((surface) => surface.node === node)),
      );
      const layout: GlassLayout = {
        regions: surfaces.map(({ region }) => region),
        viewportWidth: Math.max(1, frame.width),
        viewportHeight: Math.max(1, frame.height),
        optics: opticsRef.current,
      };
      const nodesToMark = surfaces.map(({ node }) => node);
      const hasNewSurface = nodesToMark.some((node) => !measuredSurfaces.has(node));
      measuredSurfaces = new Set(nodesToMark);
      const nextSignature = JSON.stringify(layout);
      const moving = movingSurfaces.size > 0 || !!root.querySelector("[data-mpv-glass-moving]");
      if (nextSignature === layoutSignature && !moving) return;
      layoutSignature = nextSignature;
      window.clearTimeout(settleTimer);
      if (moving) {
        restoreImmediately = true;
        layoutSignature = "";
        send(layout, nodesToMark);
        return;
      }
      if (!moving && (restoreImmediately || hasNewSurface)) {
        restoreImmediately = false;
        send(layout, nodesToMark);
        return;
      }
      // The native video and WebView present on independent clocks. Pause
      // refraction during motion instead of chasing the transparent surface.
      markSurfaces([]);
      send({ ...layout, regions: [], viewportWidth: 1, viewportHeight: 1 });
      if (layout.regions.length && !moving) {
        settleTimer = window.setTimeout(() => {
          settleTimer = 0;
          if (!disposed) send(layout, nodesToMark);
        }, 75);
      }
    };
    const schedule = () => {
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          measure();
        });
    };
    const movingSurfaces = new Set<HTMLElement>();
    const trackTransition = (event: Event) => {
      if (event.type.startsWith("transition")) {
        const property = (event as TransitionEvent).propertyName;
        if (
          property &&
          !/^(opacity|transform|translate|scale|rotate|width|height|min-width|max-width|min-height|max-height|top|right|bottom|left|inset.*|padding.*|margin.*)$/.test(
            property,
          )
        )
          return;
      }
      const target = event.target;
      if (
        !(target instanceof HTMLElement) ||
        !(target.matches(SELECTOR) || target.querySelector(SELECTOR))
      )
        return;
      if (event.type === "transitionrun" || event.type === "animationstart") {
        layoutSignature = "";
        movingSurfaces.add(target);
      } else {
        restoreImmediately = true;
      }
      schedule();
    };
    const nativeResize = () => {
      restoreImmediately = false;
      signature = "";
      layoutSignature = "";
      schedule();
    };
    scheduleRef.current = schedule;
    const resize = new ResizeObserver(measure);
    const observed = new Set<Element>();
    const observe = () => {
      let addedSurface = false;
      if (!observed.has(video)) {
        resize.observe(video);
        observed.add(video);
      }
      root.querySelectorAll(SELECTOR).forEach((node) => {
        if (!observed.has(node)) {
          resize.observe(node);
          observed.add(node);
          addedSurface = true;
        }
      });
      if (addedSurface) measure();
      else schedule();
    };
    const mutation = new MutationObserver(observe);
    mutation.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "class",
        "style",
        "hidden",
        "inert",
        "aria-hidden",
        "data-mpv-glass-moving",
      ],
    });
    observe();
    window.addEventListener("resize", schedule);
    window.addEventListener("harbor:mpv-refresh-geom", schedule);
    window.addEventListener("harbor:mpv-output-layout", nativeResize);
    document.addEventListener("visibilitychange", schedule);
    root.addEventListener("transitionrun", trackTransition);
    root.addEventListener("transitionend", trackTransition);
    root.addEventListener("transitioncancel", trackTransition);
    root.addEventListener("animationstart", trackTransition);
    root.addEventListener("animationend", trackTransition);
    root.addEventListener("animationcancel", trackTransition);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(settleTimer);
      resize.disconnect();
      mutation.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("harbor:mpv-refresh-geom", schedule);
      window.removeEventListener("harbor:mpv-output-layout", nativeResize);
      document.removeEventListener("visibilitychange", schedule);
      root.removeEventListener("transitionrun", trackTransition);
      root.removeEventListener("transitionend", trackTransition);
      root.removeEventListener("transitioncancel", trackTransition);
      root.removeEventListener("animationstart", trackTransition);
      root.removeEventListener("animationend", trackTransition);
      root.removeEventListener("animationcancel", trackTransition);
      scheduleRef.current = null;
      markSurfaces([]);
      prepareSurfaces([]);
      send({ regions: [], viewportWidth: 1, viewportHeight: 1, optics: opticsRef.current });
    };
  }, [rootRef, videoRef, enabled, sessionKey]);

  useEffect(() => {
    scheduleRef.current?.();
  }, [optics.zoom, optics.refraction, optics.dispersion, optics.blur]);
  return enabled && active;
}
