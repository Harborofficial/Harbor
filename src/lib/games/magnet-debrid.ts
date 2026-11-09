import type { CloudKeys, CloudProvider } from "./cloud-files";
import { SOURCE_LINK_PROVIDERS, type SourceLinkProvider } from "./source-links";

export const connectedMagnetProviders = (keys: CloudKeys): SourceLinkProvider[] =>
  SOURCE_LINK_PROVIDERS.filter((provider) => !!keys[provider]?.trim());

const preferenceKey = (profile: string) =>
  "harbor.games.magnet-provider.v1." + encodeURIComponent(profile);

export function preferredMagnetProvider(
  profile: string,
  connected: SourceLinkProvider[],
): SourceLinkProvider | null {
  if (!connected.length) return null;
  try {
    const previous = localStorage.getItem(preferenceKey(profile));
    if (previous && connected.some((value) => value === previous)) {
      return previous as SourceLinkProvider;
    }
  } catch {
    // Storage may be unavailable.
  }
  return connected[0];
}

export function rememberMagnetProvider(profile: string, provider: SourceLinkProvider): void {
  try {
    localStorage.setItem(preferenceKey(profile), provider);
  } catch {
    // Session selection still works when storage is unavailable.
  }
}

export function magnetCloudProvider(provider: SourceLinkProvider): provider is CloudProvider {
  return provider !== "ad";
}

export function validCloudJobId(id: unknown): id is string {
  return (
    typeof id === "string" &&
    id.length > 0 &&
    id.length <= 128 &&
    id !== "." &&
    id !== ".." &&
    /^[a-zA-Z0-9_.:-]+$/.test(id)
  );
}
