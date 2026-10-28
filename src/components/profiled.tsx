import {
  Profiler,
  useEffect,
  type ReactNode,
  type DependencyList,
  type EffectCallback,
} from "react";
import { isProfilerRunning, recordRender } from "@/lib/memory-profiler";

/**
 * Routes React's own render timing into the memory profiler's report.
 *
 * The wrapper stays mounted on purpose: swapping it in when the HUD toggles would remount the
 * subtree under test and discard the state being measured. Until the profiler is started the
 * callback is inert, and an idle Profiler only costs the timing pair React already takes.
 */
export function Profiled({ id, children }: { id: string; children: ReactNode }) {
  return (
    <Profiler
      id={id}
      onRender={(_id, _phase, actualDuration) => {
        if (isProfilerRunning()) recordRender(id, actualDuration);
      }}
    >
      {children}
    </Profiler>
  );
}

/** Measures synchronous effect setup, not the lifetime of requests it starts. */
export function useProfiledEffect(
  id: string,
  effect: EffectCallback,
  dependencies: DependencyList,
) {
  useEffect(() => {
    const started = isProfilerRunning() ? performance.now() : null;
    try {
      return effect();
    } finally {
      if (started !== null) recordRender(`effect-setup.${id}`, performance.now() - started);
    }
    // The caller supplies the same dependencies as useEffect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
}
