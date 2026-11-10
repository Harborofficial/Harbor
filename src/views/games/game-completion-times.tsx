import { useEffect, useState } from "react";
import { ArrowUpRight, Clock3 } from "lucide-react";
import { useT } from "@/lib/i18n";
import { openUrl } from "@/lib/window";
import { loadCompletionTimes } from "@/lib/games/completion-times";
import type { GameCompletionTimes } from "@/lib/games/completion-time-data";
import { loadHowLongToBeat } from "@/lib/games/howlongtobeat";
import type { HowLongToBeatTimes } from "@/lib/games/howlongtobeat-data";
import { DetailDisclosure } from "./game-detail-disclosure";

type Estimate =
  | { source: "hltb"; times: HowLongToBeatTimes }
  | { source: "igdb"; times: GameCompletionTimes };

export function GameCompletionTime({
  gameId,
  name,
  releaseYear,
  active,
}: {
  gameId?: number;
  name: string;
  releaseYear?: number;
  active: boolean;
}) {
  const t = useT(),
    [result, setResult] = useState<{ key: string; value: Estimate | null } | null>(null);
  const key = `${name}:${gameId ?? ""}:${releaseYear ?? ""}`;
  useEffect(() => {
    if (!active) return;
    const request = new AbortController();
    void (async () => {
      const hltb = await loadHowLongToBeat(name, releaseYear, request.signal).catch(() => null);
      if (request.signal.aborted) return;
      if (hltb) {
        setResult({ key, value: { source: "hltb", times: hltb } });
        return;
      }
      const igdb = gameId
        ? await loadCompletionTimes(gameId, request.signal).catch(() => null)
        : null;
      if (!request.signal.aborted)
        setResult({ key, value: igdb ? { source: "igdb", times: igdb } : null });
    })();
    return () => request.abort();
  }, [gameId, name, releaseYear, active, key]);
  const data = active && result?.key === key ? result.value : null;
  if (!data) return null;
  const hltb = data.source === "hltb";
  return (
    <DetailDisclosure
      title={t(hltb ? "games.details.howLongToBeat" : "games.details.completionTimes")}
      icon={<Clock3 size={22} />}
    >
      <div className="games-completion-times">
        {(["main", "extras", "complete"] as const).flatMap((item) =>
          data.times[item]
            ? [
                <div key={item}>
                  <span>{t(`games.details.completion.${item}`)}</span>
                  <strong>
                    {t("games.details.hours", {
                      count: (data.times[item]! / 3600).toLocaleString(undefined, {
                        maximumFractionDigits: 1,
                      }),
                    })}
                  </strong>
                </div>,
              ]
            : [],
        )}
        {hltb ? (
          <p>
            <button
              type="button"
              className="games-completion-source-link"
              onClick={() => void openUrl(data.times.url)}
            >
              {t("games.details.hltbSource")}
              <ArrowUpRight size={13} />
            </button>
          </p>
        ) : (
          <p>
            <img className="games-rating-brand-igdb" src="/games/brands/igdb.svg" alt="IGDB" />
            {t("games.details.completionSamples", { count: data.times.count.toLocaleString() })}
          </p>
        )}
      </div>
    </DetailDisclosure>
  );
}
