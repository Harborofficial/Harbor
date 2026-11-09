import { useEffect } from "react";
import { findHotkeyMatch, shouldHandleGlobalKeyboardEvent } from "@/lib/hotkeys";
import { useSearchActions } from "@/lib/search-context";
import { useSettings } from "@/lib/settings";

export function SearchHotkey() {
  const { setOpen } = useSearchActions();
  const { settings } = useSettings();
  const hotkeys = settings.hotkeys;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!shouldHandleGlobalKeyboardEvent(e)) return;
      if (findHotkeyMatch(e, hotkeys ?? {}, "Global") !== "globalSearchFocus") return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkeys, setOpen]);
  return null;
}
