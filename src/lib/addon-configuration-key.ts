import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import type { AddonOrigin } from "./cinemeta";

export function addonConfigurationKey(base: string): string | undefined {
  if (!/^https?:\/\//i.test(base)) return undefined;
  const normalized = base.replace(/\/manifest\.json$/, "");
  return bytesToHex(sha256(new TextEncoder().encode(normalized)));
}

export function persistableAddonOrigin(origin: unknown): AddonOrigin | undefined {
  if (!origin || typeof origin !== "object") return undefined;
  const value = origin as {
    id?: unknown;
    name?: unknown;
    logo?: unknown;
    base?: unknown;
    configurationKey?: unknown;
  };
  if (typeof value.id !== "string" || !value.id) return undefined;
  // Plugin catalogue identifiers pin saved rows to their provider. Network transport URLs can
  // contain credentials; resolve those from the installed addon configuration instead.
  const base =
    typeof value.base === "string" &&
    /^harbor-plugin:\/\/[A-Za-z0-9._:-]+(?:\/[A-Za-z0-9._:-]+)*$/.test(value.base)
      ? value.base
      : undefined;
  const configurationKey =
    (typeof value.base === "string" ? addonConfigurationKey(value.base) : undefined) ??
    (typeof value.configurationKey === "string" && /^[a-f0-9]{64}$/.test(value.configurationKey)
      ? value.configurationKey
      : undefined);
  return {
    id: value.id,
    name: typeof value.name === "string" && value.name ? value.name : value.id,
    logo: typeof value.logo === "string" ? value.logo : undefined,
    ...(base ? { base } : {}),
    ...(configurationKey ? { configurationKey } : {}),
  };
}
