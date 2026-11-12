import { CLOUD_PROVIDERS, type CloudKeys } from "./cloud-files";
import type { DownloadGame } from "./transfers";

export const SOURCE_LINK_PROVIDERS = ["rd", "tb", "pm", "ad"] as const;
export type SourceLinkProvider = (typeof SOURCE_LINK_PROVIDERS)[number];
export const SOURCE_LINK_SERVICES = [...CLOUD_PROVIDERS, { id: "ad" as const, name: "AllDebrid" }];
export type SourceLink = {
  url: string;
  title: string;
  game?: DownloadGame;
  kind?: "magnet" | "page" | "direct";
  filename?: string;
  expectedBytes?: number;
  expectedSha256?: string;
  repackSize?: string;
};
export const connectedSourceLinkProviders = (keys: CloudKeys) =>
  SOURCE_LINK_PROVIDERS.filter((provider) => !!keys[provider]?.trim());
export function sourceLinkError(reason: unknown) {
  const code = reason instanceof Error ? reason.message : String(reason);
  const key =
    code === "cloud_key"
      ? "account"
      : code === "cloud_rate_limit"
        ? "rate"
        : code === "cloud_limit"
          ? "limit"
          : code === "cloud_missing"
            ? "empty"
            : code === "cloud_link" || code === "cloud_metadata"
              ? "invalid"
              : "failed";
  return `games.sources.links.${key}`;
}

/** Every supported source opens the same chooser when the game download scope is available. */
export function sourceDownloadAction(
  kind: "direct" | "page" | "magnet",
  hasChooser: boolean,
): "options" | "direct" | "torrent" | "source" {
  if (hasChooser) return "options";
  return kind === "direct" ? "direct" : kind === "magnet" ? "torrent" : "source";
}
