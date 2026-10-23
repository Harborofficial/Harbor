import { useProfiles } from "@/lib/profiles";
import { useSettings } from "@/lib/settings";
import { currentAuthor } from "@/lib/theme-auth";
import { isNuvioProviderActive } from "@/lib/nuvio/nuvio-client";

export function useSelfAvatar(): { handle: string | null; avatar: string | undefined } {
  const { activeProfile } = useProfiles();
  const { settings } = useSettings();
  const isNuvio = settings.accountProvider === "nuvio" || isNuvioProviderActive();
  const author = currentAuthor();
  return {
    handle: author?.handle ?? null,
    avatar: activeProfile?.avatar ?? (isNuvio ? undefined : settings.harborAvatar ?? author?.avatar ?? undefined),
  };
}
