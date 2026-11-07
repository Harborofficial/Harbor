import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { setItemWithRecovery } from "@/lib/storage-recovery";

type Flags = { onboarded: boolean; nudges: Record<string, boolean> };

type OnboardingValue = {
  onboarded: boolean;
  finishOnboarding: () => void;
  resetOnboarding: () => void;
  resetNudges: () => void;
  isDismissed: (key: string) => boolean;
  dismiss: (key: string) => void;
};

const STORAGE_KEY = "harbor.onboarding";
export const CONTENT_ADVISORY_NUDGE = "content-advisory";
const DEFAULT: Flags = { onboarded: false, nudges: { [CONTENT_ADVISORY_NUDGE]: false } };

export function parseOnboardingFlags(raw: string | null): Flags {
  if (!raw) return DEFAULT;
  try {
    const parsed = JSON.parse(raw) as Partial<Flags>;
    // Only fresh installs are invited; upgrades keep their existing advisory preference.
    return {
      ...DEFAULT,
      ...parsed,
      nudges: { [CONTENT_ADVISORY_NUDGE]: true, ...parsed.nudges },
    };
  } catch {
    return DEFAULT;
  }
}

const Ctx = createContext<OnboardingValue | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [flags, setFlags] = useState<Flags>(() =>
    parseOnboardingFlags(localStorage.getItem(STORAGE_KEY)),
  );

  useEffect(() => {
    // This provider wraps the whole app, so a bare setItem throwing here (a full store
    // throws on every write) takes the tree down during commit, before anything can
    // signal the boot splash to clear. Prune and keep going instead.
    setItemWithRecovery(STORAGE_KEY, JSON.stringify(flags));
  }, [flags]);

  const finishOnboarding = useCallback(() => setFlags((f) => ({ ...f, onboarded: true })), []);
  const resetOnboarding = useCallback(() => setFlags(DEFAULT), []);
  const resetNudges = useCallback(
    () => setFlags((f) => ({ ...f, nudges: { ...DEFAULT.nudges } })),
    [],
  );
  const isDismissed = useCallback((key: string) => !!flags.nudges[key], [flags.nudges]);
  const dismiss = useCallback(
    (key: string) => setFlags((f) => ({ ...f, nudges: { ...f.nudges, [key]: true } })),
    [],
  );

  const value = useMemo(
    () => ({
      onboarded: flags.onboarded,
      finishOnboarding,
      resetOnboarding,
      resetNudges,
      isDismissed,
      dismiss,
    }),
    [flags.onboarded, finishOnboarding, resetOnboarding, resetNudges, isDismissed, dismiss],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOnboarding() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useOnboarding outside OnboardingProvider");
  return v;
}
