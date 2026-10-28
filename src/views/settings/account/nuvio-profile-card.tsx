import { useEffect, useState } from "react";
import { User, Users } from "../icons";
import { SettingRow } from "../kit";
import { useT } from "@/lib/i18n";
import { useProfiles } from "@/lib/profiles";
import {
  getNuvioProfileIndexForHarborProfile,
  loadNuvioState,
  setNuvioProfileIndexForHarborProfile,
} from "@/lib/nuvio/nuvio-client";
import { resolveNuvioAvatar } from "@/lib/nuvio/nuvio-profiles";
import type { NuvioProfile } from "@/lib/nuvio/nuvio-types";

export function NuvioProfileMappingCard() {
  const t = useT();
  const { activeId, activeProfile } = useProfiles();
  const [nuvioProfiles, setNuvioProfiles] = useState<NuvioProfile[]>(() => loadNuvioState().profiles);
  const [selectedSlot, setSelectedSlot] = useState<number>(() =>
    getNuvioProfileIndexForHarborProfile(activeId || "primary"),
  );

  useEffect(() => {
    const onStateChange = () => setNuvioProfiles(loadNuvioState().profiles);
    window.addEventListener("harbor:nuvio-state-changed", onStateChange);
    return () => window.removeEventListener("harbor:nuvio-state-changed", onStateChange);
  }, []);

  useEffect(() => {
    setSelectedSlot(getNuvioProfileIndexForHarborProfile(activeId || "primary"));
  }, [activeId]);

  const onSelectSlot = (slot: number) => {
    setSelectedSlot(slot);
    setNuvioProfileIndexForHarborProfile(activeId || "primary", slot);
  };

  const state = loadNuvioState();
  if (!state.session) return null;

  return (
    <SettingRow
      icon={<Users size={18} strokeWidth={2} />}
      label={t("Sync with Nuvio Profile")}
      desc={t(
        "Link this Harbor profile ({name}) to a specific Nuvio cloud profile slot. Watch progress and Continue Watching will remain isolated to this profile.",
        { name: activeProfile?.name || "Primary" },
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {[1, 2, 3, 4, 5, 6].map((slot) => {
          const profile = nuvioProfiles.find((p) => p.profile_index === slot);
          const label = profile?.name || `${t("Profile")} ${slot}`;
          const isSelected = selectedSlot === slot;

          return (
            <button
              key={slot}
              type="button"
              onClick={() => onSelectSlot(slot)}
              className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-[13px] font-medium transition-all ${
                isSelected
                  ? "bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-400"
                  : "bg-raised text-ink-muted hover:bg-elevated hover:text-ink ring-1 ring-edge-soft"
              }`}
            >
              {resolveNuvioAvatar(profile) ? (
                <img src={resolveNuvioAvatar(profile)!} alt="" className="h-4 w-4 rounded-full object-cover" />
              ) : (
                <User size={14} />
              )}
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </SettingRow>
  );
}
