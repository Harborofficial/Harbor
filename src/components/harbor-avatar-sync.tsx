import { useEffect, useState } from "react";
import { pushAvatarToEcosystem } from "@/lib/account/avatar-sync";
import { useProfiles } from "@/lib/profiles";
import { useSettings } from "@/lib/settings";
import { isNuvioProviderActive } from "@/lib/nuvio/nuvio-client";
import { currentAuthor, subscribeAuthor } from "@/lib/theme-auth";

export function HarborAvatarSync() {
  const { settings } = useSettings();
  const { activeProfile } = useProfiles();
  const [author, setAuthor] = useState(currentAuthor);

  useEffect(() => subscribeAuthor(() => setAuthor(currentAuthor())), []);

  const isNuvio = settings.accountProvider === "nuvio" || isNuvioProviderActive();
  const value = isNuvio
    ? (activeProfile?.avatar ?? null)
    : (activeProfile?.avatar ?? settings.harborAvatar ?? null);

  useEffect(() => {
    if (!author) return;
    if (isNuvio && !activeProfile?.isPrimary) return;
    void pushAvatarToEcosystem(value);
  }, [author?.id, value, isNuvio, activeProfile?.isPrimary]);

  return null;
}
