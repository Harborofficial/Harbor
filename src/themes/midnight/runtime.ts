import { useLayoutEffect, useState } from "react";

/**
 * How the shell runs, rather than how it looks.
 *
 * `navShrink` is the bar receding: while the board scrolls the capsule folds into a tag and comes
 * back on any pointer movement. Turning it off keeps the strip at its full width over the page,
 * which is what a viewer who reads the navigation while scrolling asked for.
 *
 * `lite` is the theme's cost, paid in frames. Every surface it glasses blurs whatever moves behind
 * it - the capsule does so across the whole window for as long as the board is on screen - and two
 * of its compositions keep painting after the page has settled: the title page's artwork drifts for
 * half a minute, and its sections ride a scroll timeline. Lite trades both for a plainer surface.
 *
 * Harbour's settings store lives outside this theme, and the theme must stay removable without a
 * trace, so both choices are kept locally and offered from the theme's own account menu.
 */
export type MidnightRuntime = {
  navShrink: boolean;
  lite: boolean;
};

const SHRINK_KEY = "midnight.navShrink";
const LITE_KEY = "midnight.lite";

const listeners = new Set<() => void>();

export function readRuntime(): MidnightRuntime {
  try {
    return {
      // The recede is the theme's own behaviour and the default; only an explicit answer turns it off.
      navShrink: localStorage.getItem(SHRINK_KEY) !== "off",
      lite: localStorage.getItem(LITE_KEY) === "on",
    };
  } catch {
    // Storage refused (private mode): the defaults apply for this session.
    return { navShrink: true, lite: false };
  }
}

function announce(): void {
  for (const listener of listeners) listener();
}

export function writeNavShrink(navShrink: boolean): void {
  try {
    localStorage.setItem(SHRINK_KEY, navShrink ? "on" : "off");
  } catch {
    // Nothing to persist; the change still applies for this session.
  }
  announce();
}

export function writeLite(lite: boolean): void {
  try {
    localStorage.setItem(LITE_KEY, lite ? "on" : "off");
  } catch {
    // Nothing to persist; the change still applies for this session.
  }
  announce();
}

/**
 * The cost belongs to the document, not to a component: the hover preview is portalled to the body
 * and the stylesheet has to reach it with the board's own answer. The shrink is geometry the nav
 * owns, and it is answered by not arming the scroll listener at all.
 */
function paint(runtime: MidnightRuntime): void {
  document.documentElement.dataset.midnightLite = runtime.lite ? "on" : "off";
}

function unpaint(): void {
  delete document.documentElement.dataset.midnightLite;
}

/**
 * How many shells currently hold the attribute. Harbour can mount more than one on the way from one
 * view to the next, and each of them unpaints on unmount; clearing the document from the first one
 * to leave would strip the mode from the shell still on screen.
 */
let holders = 0;

export function useRuntime(): MidnightRuntime {
  const [runtime, setRuntime] = useState(readRuntime);

  useLayoutEffect(() => {
    const sync = () => setRuntime(readRuntime());
    listeners.add(sync);
    return () => {
      listeners.delete(sync);
    };
  }, []);

  // Layout time, not paint time: a remembered lite mode is in place for the shell's first frame
  // instead of arriving as one blurred frame behind the board.
  useLayoutEffect(() => {
    paint(runtime);
  }, [runtime]);

  useLayoutEffect(() => {
    holders += 1;
    return () => {
      holders -= 1;
      if (holders === 0) unpaint();
    };
  }, []);

  return runtime;
}
