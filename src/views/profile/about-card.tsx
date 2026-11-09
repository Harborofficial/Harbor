import { Pencil, ScrollText } from "lucide-react";
import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n";
import { renderBbcode } from "@/lib/social/bbcode";
import { handleLinkOutActivation } from "@/lib/social/link-out-activation";
import { openLinkOut } from "@/lib/social/link-out";
import { YouTubeEmbedFrame } from "@/components/youtube-embed-frame";
import { SectionHeader } from "./section-header";
import { useRenderedContentContext } from "@/components/context-menu/rendered-content-context";

export function AboutCard({
  description,
  isOwner,
  userFont,
  onEdit,
  hideTitle,
}: {
  description?: string;
  isOwner: boolean;
  userFont?: string;
  onEdit?: () => void;
  hideTitle?: boolean;
}) {
  const t = useT();
  const onContextMenu = useRenderedContentContext();
  const [video, setVideo] = useState<{ id: string; target: HTMLElement } | null>(null);
  const html = useMemo(() => (description ? renderBbcode(description) : ""), [description]);
  const markup = useMemo(() => ({ __html: html }), [html]);
  const copyFont = userFont ? { fontFamily: `"${userFont}", inherit` } : undefined;

  useEffect(() => {
    setVideo(null);
  }, [description]);

  const onContentClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const embed = (e.target as HTMLElement | null)?.closest?.("[data-harbor-youtube]");
    const id = embed?.getAttribute("data-harbor-youtube");
    const frame = embed?.closest("[data-harbor-youtube-frame]");
    if (id && frame instanceof HTMLElement) {
      e.preventDefault();
      setVideo({ id, target: frame });
      return;
    }
    handleLinkOutActivation(e, openLinkOut);
  };

  return (
    <>
      <section aria-label={t("About")} className="rounded-lg bg-surface p-5 ring-1 ring-edge-soft">
        {!hideTitle && <SectionHeader icon={<ScrollText size={20} />} label={t("About")} />}
        {html ? (
          <div
            className="max-w-none select-text break-words text-[14px] leading-relaxed text-ink-muted [&_a]:break-words"
            style={copyFont}
            onContextMenu={onContextMenu}
            onClick={onContentClick}
            onAuxClick={(e) => handleLinkOutActivation(e, openLinkOut)}
            dangerouslySetInnerHTML={markup}
          />
        ) : isOwner ? (
          <button
            onClick={onEdit}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md border border-dashed border-edge text-[13px] font-medium text-ink-muted transition-colors hover:border-accent/40 hover:text-ink"
          >
            <Pencil size={16} /> {t("Write something about yourself")}
          </button>
        ) : (
          <p className="py-6 text-center text-[13px] text-ink-subtle">
            {t("This user hasn't written anything yet")}
          </p>
        )}
      </section>
      {video &&
        createPortal(
          <YouTubeEmbedFrame id={video.id} title={t("YouTube")} onClose={() => setVideo(null)} />,
          video.target,
        )}
    </>
  );
}
