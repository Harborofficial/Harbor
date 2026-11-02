import { useEffect, useRef, useState, type RefObject } from "react";
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

  useEffect(() => {
    setActive(false);
    if (!enabled) return;
    const root = rootRef.current;
    const video = videoRef.current;
    if (!root || !video) return;
    let disposed = false;
    let raf = 0;
    let transitionRaf = 0;
    let pending: GlassLayout | null = null;
    let sending = false;
    let signature = "";
    const ownerId = crypto.randomUUID();
    const ownerGeneration = ++nextOwnerGeneration;
    let activeSurfaces: HTMLElement[] = [];
    const markSurfaces = (surfaces: HTMLElement[]) => {
      for (const node of activeSurfaces) {
        if (!surfaces.includes(node)) node.removeAttribute("data-mpv-glass-active");
      }
      for (const node of surfaces) node.setAttribute("data-mpv-glass-active", "");
      activeSurfaces = surfaces;
    };
    const send = (layout: GlassLayout) => {
      const nextSignature = JSON.stringify(layout);
      if (nextSignature === signature) return;
      signature = nextSignature;
      pending = layout;
      if (sending) return;
      sending = true;
      void (async () => {
        try {
          while (pending) {
            const next = pending;
            pending = null;
            await invoke("mpv_glass_layout", { ownerId, ownerGeneration, layout: next });
            if (!disposed) setActive(next.regions.length > 0);
          }
        } catch {
          signature = "";
          if (!disposed) setActive(false);
        } finally {
          sending = false;
        }
      })();
    };
    const measure = () => {
      if (disposed) return;
      const frame = video.getBoundingClientRect();
      const nodes = document.hidden ? [] : Array.from(root.querySelectorAll<HTMLElement>(SELECTOR));
      const candidates = nodes.filter(
        (node) =>
          (!node.closest("[data-mpv-controls]") || node.dataset.mpvGlass === "panel") &&
          visibleSurface(node, root),
      );
      const surfaces = candidates
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
          const inset = node.dataset.mpvGlass === "priority" ? 1 : 0;
          const radius = (value: string) =>
            Math.max(0, Math.min(parseFloat(value) || 0, rect.width / 2, rect.height / 2) - inset);
          return {
            node,
            region: {
              x: rect.left - frame.left + inset,
              y: rect.top - frame.top + inset,
              width: rect.width - inset * 2,
              height: rect.height - inset * 2,
              radius: radius(style.borderTopLeftRadius || style.borderRadius),
              radii: [
                radius(style.borderTopLeftRadius),
                radius(style.borderTopRightRadius),
                radius(style.borderBottomRightRadius),
                radius(style.borderBottomLeftRadius),
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
      markSurfaces(surfaces.map(({ node }) => node));
      send({
        regions: surfaces.map(({ region }) => region),
        viewportWidth: Math.max(1, frame.width),
        viewportHeight: Math.max(1, frame.height),
        optics: opticsRef.current,
      });
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    const movingSurfaces = new Set<HTMLElement>();
    const trackTransition = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.matches(SELECTOR)) return;
      if (event.type === "transitionrun") {
        movingSurfaces.add(target);
        if (transitionRaf) return;
        const follow = () => {
          transitionRaf = 0;
          if (disposed) return;
          measure();
          for (const surface of movingSurfaces) {
            if (!surface.getAnimations().some((animation) => animation.playState === "running")) {
              movingSurfaces.delete(surface);
            }
          }
          if (movingSurfaces.size) {
            transitionRaf = requestAnimationFrame(follow);
          }
        };
        transitionRaf = requestAnimationFrame(follow);
      } else {
        if (!target.getAnimations().some((animation) => animation.playState === "running")) {
          movingSurfaces.delete(target);
        }
        schedule();
      }
    };
    const nativeResize = () => {
      signature = "";
      schedule();
    };
    scheduleRef.current = schedule;
    const resize = new ResizeObserver(measure);
    const observed = new Set<Element>();
    const observe = () => {
      if (!observed.has(video)) {
        resize.observe(video);
        observed.add(video);
      }
      root.querySelectorAll(SELECTOR).forEach((node) => {
        if (!observed.has(node)) {
          resize.observe(node);
          observed.add(node);
        }
      });
      schedule();
    };
    const mutation = new MutationObserver(observe);
    mutation.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "inert", "aria-hidden"],
    });
    observe();
    window.addEventListener("resize", schedule);
    window.addEventListener("harbor:mpv-refresh-geom", schedule);
    window.addEventListener("harbor:mpv-output-layout", nativeResize);
    document.addEventListener("visibilitychange", schedule);
    root.addEventListener("transitionrun", trackTransition);
    root.addEventListener("transitionend", trackTransition);
    root.addEventListener("transitioncancel", trackTransition);
    root.addEventListener("animationend", schedule);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      cancelAnimationFrame(transitionRaf);
      resize.disconnect();
      mutation.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("harbor:mpv-refresh-geom", schedule);
      window.removeEventListener("harbor:mpv-output-layout", nativeResize);
      document.removeEventListener("visibilitychange", schedule);
      root.removeEventListener("transitionrun", trackTransition);
      root.removeEventListener("transitionend", trackTransition);
      root.removeEventListener("transitioncancel", trackTransition);
      root.removeEventListener("animationend", schedule);
      scheduleRef.current = null;
      markSurfaces([]);
      send({ regions: [], viewportWidth: 1, viewportHeight: 1, optics: opticsRef.current });
    };
  }, [rootRef, videoRef, enabled, sessionKey]);

  useEffect(() => {
    scheduleRef.current?.();
  }, [optics.zoom, optics.refraction, optics.dispersion, optics.blur]);
  return enabled && active;
}
