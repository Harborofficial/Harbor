import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { stremioSourceProfileId, useProfiles, type Profile } from "./profiles";
import { getUser, login as apiLogin, invalidateLibraryCache, type User } from "./stremio";
import { clearWatchedFlags } from "./watched-flag";
import { clearMovieWatched } from "./movie-watched";
import { clearManualWatched } from "./manual-watched";
import { clearStremioFreshWatched } from "./stremio-watched-sync";
import { resetReconciledStremioWatched } from "./stremio-watched-pull";
import { clearAllLocalCw } from "./local-cw";
import { clearAllResumeForProfile } from "./resume";
import { clearCwCache } from "./continue-watching";
import { clearWatchlistCache } from "./watchlist";

type Session = { authKey: string; user: User };
type AuthValue = {
  user: User | null;
  authKey: string | null;
  signIn: (email: string, password: string, remember?: boolean) => Promise<void>;
  signInWithKey: (authKey: string) => Promise<void>;
  signOut: () => void;
};

const PROFILE_KEY_PREFIX = "harbor.auth.";

function profileAuthKey(id: string): string {
  return PROFILE_KEY_PREFIX + id;
}

function readProfileSession(id: string): Session | null {
  try {
    const raw = localStorage.getItem(profileAuthKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (!parsed?.authKey || !parsed?.user) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeProfileSession(id: string, session: Session | null): void {
  try {
    if (session) localStorage.setItem(profileAuthKey(id), JSON.stringify(session));
    else localStorage.removeItem(profileAuthKey(id));
  } catch {
    return;
  }
}

export function readActiveStremioAuthKey(): string | null {
  try {
    const raw = localStorage.getItem("harbor.profiles.v1");
    if (!raw) return null;
    const state = JSON.parse(raw) as { profiles?: Profile[]; activeId?: string | null };
    const profiles = Array.isArray(state.profiles) ? state.profiles : [];
    const active = profiles.find((p) => p.id === state.activeId) ?? null;
    const sourceId = stremioSourceProfileId(active, profiles);
    if (!sourceId) return null;
    return readProfileSession(sourceId)?.authKey ?? null;
  } catch {
    return null;
  }
}

export function readPrimaryStremioSession(): Session | null {
  try {
    const raw = localStorage.getItem("harbor.profiles.v1");
    if (raw) {
      const state = JSON.parse(raw) as { profiles?: Profile[]; activeId?: string | null };
      const profiles = Array.isArray(state.profiles) ? state.profiles : [];
      const active = profiles.find((p) => p.id === state.activeId) ?? profiles.find((p) => p.isPrimary) ?? profiles[0] ?? null;
      const sourceId = stremioSourceProfileId(active, profiles);
      if (sourceId) {
        const sess = readProfileSession(sourceId);
        if (sess) return sess;
      }
      for (const p of profiles) {
        const sess = readProfileSession(p.id);
        if (sess) return sess;
      }
    }
    return readProfileSession("default");
  } catch {
    return null;
  }
}

export function purgeStremioAccountData(profileId?: string): void {
  const pid = profileId || "default";
  clearWatchedFlags(pid);
  clearWatchedFlags();
  clearMovieWatched(pid);
  clearMovieWatched();
  clearManualWatched(pid);
  clearManualWatched();
  clearStremioFreshWatched(pid);
  resetReconciledStremioWatched();
  clearAllLocalCw(pid);
  clearAllLocalCw();
  clearAllResumeForProfile(pid);
  clearCwCache();
  invalidateLibraryCache();
  clearWatchlistCache(pid);

  try {
    const keys = [
      `harbor.watchedFlag.v1.${pid}`,
      "harbor.watchedFlag.v1",
      `harbor.moviewatched.v1.${pid}`,
      "harbor.moviewatched.v1",
      `harbor.manualwatched.v1.${pid}`,
      "harbor.manualwatched.v1",
      `harbor.manualunwatched.v1.${pid}`,
      "harbor.manualunwatched.v1",
      `harbor.manualwatched.meta.v1.${pid}`,
      "harbor.manualwatched.meta.v1",
      `harbor.manualwatched.dismissed.v1.${pid}`,
      "harbor.manualwatched.dismissed.v1",
      `harbor.manualunwatched.at.v1.${pid}`,
      "harbor.manualunwatched.at.v1",
      `harbor.manualwatched.fromremote.v1.${pid}`,
      "harbor.manualwatched.fromremote.v1",
      `harbor.stremio.freshwatched.v1.${pid}`,
      "harbor.stremio.freshwatched.v1",
      `harbor.localcw.v1.${pid}`,
      "harbor.localcw.v1",
      `harbor.localcw.private.v1.${pid}`,
      `harbor.resume.private.v1.${pid}`,
      "harbor.resume",
      `harbor.cw.dismissed.${pid}`,
      `harbor.cw.dismissed.private.v1.${pid}`,
      `harbor.watchevents.v1.${pid}`,
      `harbor.playback-history.v1.${pid}`,
      `harbor.watchlist.v1.${pid}`,
      "harbor.watchlist.v1",
      `harbor.watchlist.aggregate.v1.${pid}`,
      "harbor.watchlist.aggregate.v1",
      `harbor.newEpisodes.dismissed.${pid}`,
    ];
    for (const k of keys) localStorage.removeItem(k);
  } catch {}

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("harbor:watched-changed"));
    window.dispatchEvent(new CustomEvent("harbor:continue-watching-updated"));
    window.dispatchEvent(new CustomEvent("harbor:library-changed"));
    window.dispatchEvent(new CustomEvent("harbor:watchlist-changed"));
  }
}

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { profiles, activeProfile, updateProfile } = useProfiles();
  const sourceId = stremioSourceProfileId(activeProfile, profiles);

  const [session, setSession] = useState<Session | null>(() =>
    sourceId ? readProfileSession(sourceId) : null,
  );

  useEffect(() => {
    setSession(sourceId ? readProfileSession(sourceId) : null);
  }, [sourceId]);

  const commitSession = useCallback(
    (fresh: Session) => {
      const prevSession = activeProfile ? readProfileSession(activeProfile.id) : null;
      if (prevSession?.user?._id && prevSession.user._id !== fresh.user._id) {
        purgeStremioAccountData(activeProfile?.id ?? "default");
      }
      if (!activeProfile) {
        setSession(fresh);
        return;
      }
      if (activeProfile.shareStremioWith) {
        updateProfile(activeProfile.id, { shareStremioWith: null });
      }
      writeProfileSession(activeProfile.id, fresh);
      setSession(fresh);
    },
    [activeProfile, updateProfile],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      commitSession(await apiLogin(email, password));
    },
    [commitSession],
  );

  const signInWithKey = useCallback(
    async (authKey: string) => {
      const key = authKey.trim();
      if (!key) throw new Error("No sign-in key received. Try again.");
      const fetched = await getUser(key).catch(() => null);
      const user: User = fetched?._id ? fetched : { _id: `stremio:${key.slice(0, 10)}`, email: "" };
      commitSession({ authKey: key, user });
    },
    [commitSession],
  );

  const signOut = useCallback(() => {
    const pid = activeProfile?.id ?? "default";
    if (!activeProfile) {
      purgeStremioAccountData("default");
      setSession(null);
      return;
    }
    if (activeProfile.shareStremioWith) {
      updateProfile(activeProfile.id, { shareStremioWith: null });
    } else {
      writeProfileSession(activeProfile.id, null);
    }
    purgeStremioAccountData(pid);
    setSession(null);
  }, [activeProfile, updateProfile]);

  const value = useMemo<AuthValue>(
    () => ({
      user: session?.user ?? null,
      authKey: session?.authKey ?? null,
      signIn,
      signInWithKey,
      signOut,
    }),
    [session, signIn, signInWithKey, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
