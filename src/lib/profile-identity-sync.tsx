import { useEffect } from "react";
import { useProfiles } from "./profiles";
import { useSettings, type ContentFilters } from "./settings";
import { useTogether } from "./together/provider";
import { isNuvioProviderActive } from "./nuvio/nuvio-client";

function sameHideContent(a: ContentFilters, b: ContentFilters): boolean {
  return a.anime === b.anime && a.sports === b.sports && a.adult === b.adult;
}

export function ProfileIdentitySync() {
  const { activeProfile } = useProfiles();
  const { settings, update } = useSettings();
  const { displayName, setDisplayName } = useTogether();
  const isNuvio = settings.accountProvider === "nuvio" || isNuvioProviderActive();

  useEffect(() => {
    if (isNuvio) return;
    if (!activeProfile || activeProfile.kid) return;
    if (settings.harborColor !== activeProfile.color) {
      update({ harborColor: activeProfile.color });
    }
  }, [activeProfile?.id, activeProfile?.color]);

  useEffect(() => {
    if (isNuvio) return;
    if (!activeProfile || activeProfile.kid || !activeProfile.isPrimary) return;
    if (settings.harborAvatar !== activeProfile.avatar) {
      update({ harborAvatar: activeProfile.avatar });
    }
  }, [activeProfile?.id, activeProfile?.avatar]);

  useEffect(() => {
    if (isNuvio) return;
    if (!activeProfile || activeProfile.kid) return;
    if (activeProfile.name && displayName !== activeProfile.name) {
      setDisplayName(activeProfile.name);
    }
  }, [isNuvio, activeProfile?.id, activeProfile?.name, displayName, setDisplayName]);

  useEffect(() => {
    if (isNuvio) return;
    if (!activeProfile?.hideContent) return;
    if (!sameHideContent(settings.hideContent, activeProfile.hideContent)) {
      update({ hideContent: activeProfile.hideContent });
    }
  }, [activeProfile?.id, activeProfile?.hideContent]);

  return null;
}
