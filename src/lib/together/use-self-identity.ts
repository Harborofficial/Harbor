import { useAuth } from "@/lib/auth";
import { useProfiles } from "@/lib/profiles";
import { useSettings } from "@/lib/settings";
import { isNuvioProviderActive } from "@/lib/nuvio/nuvio-client";

export function useSelfIdentity(): { avatar: string | null; color: string | null } {
  const { user } = useAuth();
  const { settings } = useSettings();
  const { activeProfile } = useProfiles();
  const isNuvio = settings.accountProvider === "nuvio" || isNuvioProviderActive();
  return {
    avatar:
      activeProfile?.avatar ?? (isNuvio ? null : (settings.harborAvatar ?? user?.avatar ?? null)),
    color: (isNuvio ? activeProfile?.color : settings.harborColor || activeProfile?.color) || null,
  };
}
