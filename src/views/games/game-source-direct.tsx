import { useState } from "react";
import { ArrowDown } from "lucide-react";
import type { GameTransfers } from "@/hooks/use-game-transfers";
import type { SourceLink } from "@/lib/games/source-links";
import { downloadFilename } from "@/lib/games/transfers";
import { useT } from "@/lib/i18n";

export function SourceDirectDownload({
  link,
  downloads,
  onDone,
}: {
  link: SourceLink;
  downloads: GameTransfers;
  onDone: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const downloading = busy || downloads.busy.includes("new");
  const start = async () => {
    if (downloading || !downloads.available) return;
    setBusy(true);
    downloads.dismissError();
    try {
      const started = await downloads.start(
        {
          url: link.url,
          sourceLink: link.url,
          name: link.title,
          expectedBytes: link.expectedBytes,
          expectedSha256: link.expectedSha256,
          game: link.game,
        },
        link.filename ?? downloadFilename(link.url),
      );
      if (started) onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="games-source-link-content">
      <div className="games-source-link-body">
        <p>{t("games.sources.download.directNote")}</p>
        {downloads.error && (
          <p role="alert" className="games-source-batch-error">
            {t(downloads.error)}
          </p>
        )}
      </div>
      <footer>
        <span>{t("games.sources.links.note")}</span>
        <button
          type="button"
          className="games-button games-button-primary"
          disabled={downloading || !downloads.available}
          onClick={() => void start()}
        >
          <ArrowDown size={16} />
          {t("games.sources.links.destination")}
        </button>
      </footer>
    </div>
  );
}
