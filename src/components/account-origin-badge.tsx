import { resolveAddonOrigin, type AddonOriginTag } from "@/lib/nuvio/nuvio-addon-registry";

export function AccountOriginBadge({
  addonUrl,
  size = "sm",
}: {
  addonUrl?: string | null;
  size?: "sm" | "md";
}) {
  const origin: AddonOriginTag = resolveAddonOrigin(addonUrl);
  if (origin === "custom") return null;

  const isSmall = size === "sm";

  if (origin === "nuvio") {
    return (
      <span
        title="Provided by Nuvio addon collection"
        className={`inline-flex items-center gap-1 rounded-md bg-cyan-950/60 font-medium text-cyan-300 ring-1 ring-cyan-500/30 ${
          isSmall ? "px-1.5 py-0.5 text-[10.5px]" : "px-2 py-1 text-[12px]"
        }`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
        Nuvio
      </span>
    );
  }

  if (origin === "stremio") {
    return (
      <span
        title="Provided by Stremio addon collection"
        className={`inline-flex items-center gap-1 rounded-md bg-purple-950/60 font-medium text-purple-300 ring-1 ring-purple-500/30 ${
          isSmall ? "px-1.5 py-0.5 text-[10.5px]" : "px-2 py-1 text-[12px]"
        }`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-purple-400" />
        Stremio
      </span>
    );
  }

  if (origin === "both") {
    return (
      <span
        title="Shared across Stremio and Nuvio"
        className={`inline-flex items-center gap-1 rounded-md bg-indigo-950/60 font-medium text-indigo-300 ring-1 ring-indigo-500/30 ${
          isSmall ? "px-1.5 py-0.5 text-[10.5px]" : "px-2 py-1 text-[12px]"
        }`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
        Stremio + Nuvio
      </span>
    );
  }

  return null;
}
