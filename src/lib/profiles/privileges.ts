import { DEFAULT_SECONDARY_PRIVILEGES } from "@/lib/settings/defaults";
import type { SecondaryProfilePrivileges, Settings } from "@/lib/settings/types";

export function getSecondaryPrivileges(
  settings?: Partial<
    Pick<Settings, "accountProvider" | "secondaryPrivileges" | "nuvioSecondaryPrivileges">
  > | null,
  isNuvioOverride?: boolean,
): SecondaryProfilePrivileges {
  let isNuvio = typeof isNuvioOverride === "boolean" ? isNuvioOverride : false;
  if (typeof isNuvioOverride !== "boolean") {
    if (settings?.accountProvider) {
      isNuvio = settings.accountProvider === "nuvio";
    } else {
      try {
        const explicit = localStorage.getItem("harbor.account-provider");
        isNuvio =
          explicit === "nuvio" ||
          Boolean(
            !explicit &&
            localStorage.getItem("harbor.settings.shared")?.includes('"accountProvider":"nuvio"'),
          );
      } catch {}
    }
  }

  let sharedBlob: {
    secondaryPrivileges?: Partial<SecondaryProfilePrivileges> | null;
    nuvioSecondaryPrivileges?: Partial<SecondaryProfilePrivileges> | null;
  } | null = null;
  try {
    const raw =
      localStorage.getItem("harbor.settings.shared") ?? localStorage.getItem("harbor.settings");
    if (raw) sharedBlob = JSON.parse(raw);
  } catch {}

  const directSource = isNuvio ? settings?.nuvioSecondaryPrivileges : settings?.secondaryPrivileges;
  if (directSource) return { ...DEFAULT_SECONDARY_PRIVILEGES, ...directSource };

  const sharedSource = isNuvio
    ? sharedBlob?.nuvioSecondaryPrivileges
    : sharedBlob?.secondaryPrivileges;
  if (sharedSource) return { ...DEFAULT_SECONDARY_PRIVILEGES, ...sharedSource };

  return { ...DEFAULT_SECONDARY_PRIVILEGES };
}
