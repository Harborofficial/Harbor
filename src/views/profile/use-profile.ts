import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { authToken, currentAuthor, refreshToken, subscribeAuthor } from "@/lib/theme-auth";
import { isNuvioProviderActive } from "@/lib/active-profile-id";
import { loadNuvioState } from "@/lib/nuvio/nuvio-client";
import { resolveNuvioAvatar } from "@/lib/nuvio/nuvio-profiles";
import { fetchActivity, fetchBadges, fetchFriends, fetchSummary, ProfileNotFound } from "./profile-api";
import type { ActivityItem, Badge, Friend, LoadState, ProfileSummary } from "./profile-types";

const LIVE_INTERVAL_MS = 25000;

const LIVE_FIELDS = [
  "online",
  "presence",
  "lastActiveAt",
  "watching",
  "counts",
  "friendState",
  "mutualCount",
  "ratings",
  "showcase",
  "shownBadges",
  "verified",
  "hideVerified",
  "badges",
] as const;

function mergeLive(prev: ProfileSummary, next: ProfileSummary): ProfileSummary {
  let changed = false;
  const out = { ...prev };
  for (const k of LIVE_FIELDS) {
    const a = (prev as Record<string, unknown>)[k];
    const b = (next as Record<string, unknown>)[k];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    (out as Record<string, unknown>)[k] = b;
    changed = true;
  }
  return changed ? out : prev;
}


export type ProfileBundle = {
  state: LoadState;
  summary: ProfileSummary | null;
  friends: Friend[];
  badges: Badge[];
  activity: ActivityItem[];
  reload: () => void;
  patchSummary: (next: ProfileSummary) => void;
};

export function useProfile(handle: string): ProfileBundle {
  const { authKey } = useAuth();
  const [authorId, setAuthorId] = useState(() => currentAuthor()?.id ?? "");
  const [state, setState] = useState<LoadState>("loading");
  const [summary, setSummary] = useState<ProfileSummary | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [nonce, setNonce] = useState(0);
  const healedForRef = useRef("");

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const patchSummary = useCallback((next: ProfileSummary) => setSummary(next), []);

  useEffect(() => subscribeAuthor(() => setAuthorId(currentAuthor()?.id ?? "")), []);

  useEffect(() => {
    if (!handle) return;
    const ac = new AbortController();
    setState("loading");
    setSummary(null);
    setFriends([]);
    setBadges([]);
    setActivity([]);
    fetchSummary(handle, ac.signal)
      .then((s) => {
        if (ac.signal.aborted) return;
        setSummary(s);
        setState("ready");
        const mine = currentAuthor()?.handle;
        if (mine && s.handle && s.handle.toLowerCase() === mine.toLowerCase() && !s.isOwner && authToken() && healedForRef.current !== handle) {
          healedForRef.current = handle;
          void refreshToken().then((ok) => {
            if (ok && !ac.signal.aborted) reload();
          });
        }
        void fetchFriends(handle, ac.signal).then((f) => !ac.signal.aborted && setFriends(f)).catch(() => {});
        void fetchBadges(handle, ac.signal).then((b) => !ac.signal.aborted && setBadges(b)).catch(() => {});
        void fetchActivity(handle, ac.signal).then((a) => !ac.signal.aborted && setActivity(a)).catch(() => {});
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        if (isNuvioProviderActive()) {
          try {
            const ns = loadNuvioState();
            const primary = ns.profiles.find((p) => p.profile_index === 1) || ns.profiles[0];
            const email = ns.session?.user?.email;
            const nuvioHandle = (
              primary?.name?.toLowerCase().replace(/\s+/g, "") ||
              email?.split("@")[0] ||
              "nuvio"
            ).toLowerCase();
            if (handle.toLowerCase() === nuvioHandle || handle.toLowerCase() === "me") {
              const fallback: ProfileSummary = {
                handle: nuvioHandle,
                alias: primary?.name || email?.split("@")[0] || "Nuvio User",
                avatarUrl: resolveNuvioAvatar(primary) || undefined,
                verified: false,
                featured: false,
                level: 1,
                xp: 0,
                xpToNext: 100,
                online: true,
                memberSince: new Date().toISOString(),
                counts: {
                  watched: 0,
                  episodesWatched: 0,
                  moviesWatched: 0,
                  hoursWatched: 0,
                  minutesWatched: 0,
                  friends: 0,
                  badges: 0,
                  mangaRead: 0,
                },
                isOwner: true,
              };
              setSummary(fallback);
              setState("ready");
              return;
            }
          } catch {}
        }
        setState(e instanceof ProfileNotFound ? "empty" : "error");
      });
    return () => ac.abort();
  }, [handle, authKey, authorId, nonce]);

  useEffect(() => {
    if (!handle || state !== "ready") return;
    const ac = new AbortController();
    const sync = () => {
      if (document.visibilityState === "hidden") return;
      void fetchSummary(handle, ac.signal)
        .then((s) => !ac.signal.aborted && setSummary((prev) => (prev ? mergeLive(prev, s) : s)))
        .catch(() => {});
      void fetchFriends(handle, ac.signal).then((f) => !ac.signal.aborted && setFriends(f)).catch(() => {});
      void fetchBadges(handle, ac.signal).then((b) => !ac.signal.aborted && setBadges(b)).catch(() => {});
    };
    const id = window.setInterval(sync, LIVE_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      ac.abort();
      window.clearInterval(id);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [handle, state]);

  return { state, summary, friends, badges, activity, reload, patchSummary };
}
