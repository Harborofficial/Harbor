import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useProfiles, useActiveKid, type Profile } from "@/lib/profiles";
import type { NuvioProfile } from "@/lib/nuvio/nuvio-types";
import { setActiveNuvioProfile } from "@/lib/nuvio/nuvio-profiles";
import { currentAuthor, logoutAuthor, subscribeAuthor, type Author } from "@/lib/theme-auth";
import {
  currentStatus,
  setStatus,
  subscribeStatus,
  type PresenceStatus,
} from "@/lib/social/presence";
import { openMyProfile } from "@/lib/social/open-my-profile";
import { openNotificationCenter } from "@/lib/social/notification-open";

export function useAccountMenu() {
  const { user } = useAuth();
  const { profiles, activeProfile, openPicker, selectProfile } = useProfiles();
  const activeKid = useActiveKid();
  const [author, setAuthor] = useState<Author | null>(currentAuthor);
  useEffect(() => subscribeAuthor(() => setAuthor(currentAuthor())), []);
  const [status, setStatusState] = useState<PresenceStatus>(currentStatus);
  useEffect(() => subscribeStatus(() => setStatusState(currentStatus())), []);
  const [menuOpen, setMenuOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [harborAuthOpen, setHarborAuthOpen] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<Profile | null>(null);
  const [pendingNuvioSwitch, setPendingNuvioSwitch] = useState<NuvioProfile | null>(null);
  const [nuvioPinTarget, setNuvioPinTarget] = useState<NuvioProfile | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const authReturnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => setAuthOpen(false), [activeProfile?.id]);

  useEffect(() => {
    if (!menuOpen) setManageOpen(false);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen && !statusOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.closest('[role="dialog"]') ||
        target?.closest('[data-portal]') ||
        target?.closest('.harbor-portal')
      ) {
        return;
      }
      if (!ref.current?.contains(e.target as Node)) {
        setMenuOpen(false);
        setStatusOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen, statusOpen]);

  const doSwitch = (p: Profile) => {
    if (p.passwordHash) openPicker({ kind: "unlock", profileId: p.id });
    else selectProfile(p.id);
  };

  const requestSwitch = (p: Profile) => {
    setMenuOpen(false);
    if (activeKid?.parentPinHash) {
      setPendingSwitch(p);
      return;
    }
    doSwitch(p);
  };

  const requestNuvioSwitch = (p: NuvioProfile) => {
    setMenuOpen(false);
    if (activeKid?.parentPinHash) {
      setPendingNuvioSwitch(p);
      return;
    }
    if (p.pin_enabled) {
      openPicker({ kind: "unlock", profileId: String(p.profile_index) });
    } else {
      setActiveNuvioProfile(p.profile_index);
    }
  };

  const viewMyProfile = async () => {
    setMenuOpen(false);
    if (!(await openMyProfile(author?.handle))) openHarborAuth();
  };

  const toggleStatus = () => {
    setMenuOpen(false);
    setStatusOpen((o) => !o);
  };

  const pickStatus = (s: PresenceStatus) => {
    setStatus(s);
    setStatusOpen(false);
  };

  const openNotifications = () => {
    setMenuOpen(false);
    openNotificationCenter();
  };

  const openHarborAuth = () => {
    if (activeProfile?.kid) return;
    const focused = document.activeElement;
    const trigger = ref.current?.querySelector<HTMLButtonElement>("button[aria-haspopup='menu']");
    if (trigger) {
      authReturnFocus.current = trigger;
    } else if (
      focused instanceof HTMLElement &&
      focused !== document.body &&
      !focused.closest(".harbor-profile-dropdown")
    ) {
      authReturnFocus.current = focused;
    }
    setMenuOpen(false);
    setStatusOpen(false);
    setAuthOpen(true);
  };

  const signOutHarbor = () => {
    setMenuOpen(false);
    setStatusOpen(false);
    void logoutAuthor();
  };

  return {
    ref,
    authReturnFocus,
    user,
    profiles,
    activeProfile,
    openPicker,
    author,
    status,
    menuOpen,
    setMenuOpen,
    statusOpen,
    setStatusOpen,
    manageOpen,
    setManageOpen,
    authOpen,
    setAuthOpen,
    harborAuthOpen,
    setHarborAuthOpen,
    pendingSwitch,
    setPendingSwitch,
    pendingNuvioSwitch,
    setPendingNuvioSwitch,
    nuvioPinTarget,
    setNuvioPinTarget,
    activeKid,
    selectProfile,
    requestSwitch,
    requestNuvioSwitch,
    viewMyProfile,
    toggleStatus,
    pickStatus,
    openNotifications,
    openHarborAuth,
    signOutHarbor,
  };
}

export type AccountMenuController = ReturnType<typeof useAccountMenu>;
