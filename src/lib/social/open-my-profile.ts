import { fetchMe } from "@/lib/account/identity";
import { requestOpenProfile } from "@/lib/social/open-profile";
import { currentAuthor } from "@/lib/theme-auth";
import { captureSocialActor, assertSocialActor } from "./action-actor";
import { isNuvioProviderActive } from "@/lib/active-profile-id";
import { loadNuvioState } from "@/lib/nuvio/nuvio-client";

export async function openMyProfile(fallbackHandle?: string | null): Promise<boolean> {
  if (isNuvioProviderActive()) {
    const nuvioState = loadNuvioState();
    if (nuvioState.session?.access_token) {
      const primary =
        nuvioState.profiles.find((p) => p.profile_index === 1) || nuvioState.profiles[0];
      const handle = (
        primary?.name?.toLowerCase().replace(/\s+/g, "") ||
        nuvioState.session.user?.email?.split("@")[0] ||
        "nuvio"
      ).trim();
      if (handle) {
        requestOpenProfile(handle);
        return true;
      }
    }
  }

  const actor = captureSocialActor();
  let handle = (currentAuthor()?.handle || fallbackHandle || "").trim();
  if (!handle) {
    await fetchMe().catch(() => {});
    assertSocialActor(actor);
    handle = (currentAuthor()?.handle || "").trim();
  }
  if (!handle) return false;
  assertSocialActor(actor);
  requestOpenProfile(handle);
  return true;
}
