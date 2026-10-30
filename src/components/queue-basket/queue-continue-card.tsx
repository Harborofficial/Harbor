import { ListVideo, Play, X } from "lucide-react";
import { useStartQueue } from "@/hooks/use-start-queue";
import { useT } from "@/lib/i18n";
import { queueClear, useQueue, useQueueResumeItem } from "@/lib/queue";
import "./queue-continue-card.css";
import { useEffect, useState } from "react";
import { QueueClearConfirm } from "./queue-clear-confirm";

export function QueueContinueCard() {
  const t = useT();
  const queue = useQueue();
  const resumeItem = useQueueResumeItem();
  const startQueue = useStartQueue();
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (queue.length === 0) setConfirmClear(false);
  }, [queue.length]);

  if (!resumeItem) return null;

  const title = resumeItem.episode
    ? resumeItem.episode.name ||
      `${resumeItem.meta.name} · S${resumeItem.episode.season} E${resumeItem.episode.episode}`
    : resumeItem.meta.name;

  const posters = Array.from(
    new Set(
      [resumeItem, ...queue]
        .map((item) => item.meta.poster)
        .filter((poster): poster is string => Boolean(poster)),
    ),
  ).slice(0, 4);

  return (
    <div className="queue-continue-card">
      <button
        type="button"
        className="queue-continue-card__play"
        onClick={() => startQueue({ resume: true })}
        aria-label={`${t("Continue your queue?")} ${title}`}
      >
        <span
          className="queue-continue-card__posters"
          data-count={posters.length}
          aria-hidden="true"
        >
          {posters.length > 0 ? (
            posters.map((poster) => <img key={poster} src={poster} alt="" draggable={false} />)
          ) : (
            <ListVideo size={40} />
          )}
        </span>

        <span className="queue-continue-card__shade" aria-hidden="true" />

        <span className="queue-continue-card__caption">
          <Play size={17} fill="currentColor" aria-hidden="true" />
          <span className="queue-continue-card__heading">{t("Continue your queue?")}</span>
          <span className="queue-continue-card__title" title={title}>
            {title}
          </span>
        </span>
      </button>

      <button
        type="button"
        className="queue-continue-card__clear"
        onClick={() => setConfirmClear(true)}
        aria-label={t("Clear your queue")}
      >
        <X size={14} aria-hidden="true" />
        <span className="queue-continue-card__clear-label" aria-hidden="true">
          <span>{t("Clear your queue")}</span>
        </span>
      </button>
      {confirmClear && (
        <QueueClearConfirm
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            setConfirmClear(false);
            queueClear();
          }}
        />
      )}
    </div>
  );
}
