import { X } from "lucide-react";
import { useEffect } from "react";
import { useT } from "@/lib/i18n";

function embedUrl(id: string): string {
  const params = new URLSearchParams({
    autoplay: "1",
    rel: "0",
    modestbranding: "1",
    playsinline: "1",
    iv_load_policy: "3",
  });
  const proto = typeof window !== "undefined" ? (window.location?.protocol ?? "") : "";
  if (/^https?:$/.test(proto) && window.location?.origin) {
    params.set("origin", window.location.origin);
  }
  return `https://www.youtube-nocookie.com/embed/${id}?${params.toString()}`;
}

export function YouTubeEmbedFrame({
  id,
  title,
  onClose,
}: {
  id: string;
  title: string;
  onClose: () => void;
}) {
  const t = useT();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      role="region"
      aria-label={title}
      onClick={(event) => event.stopPropagation()}
      className="absolute inset-0 z-10 overflow-hidden rounded-[12px] bg-black"
    >
      <iframe
        src={embedUrl(id)}
        title={title}
        allow="autoplay; encrypted-media; picture-in-picture; clipboard-write; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        className="absolute inset-0 h-full w-full border-0"
      />
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        aria-label={t("Close")}
        className="absolute end-2 top-2 z-20 grid h-9 w-9 place-items-center rounded-full bg-black/60 text-white ring-1 ring-white/15 backdrop-blur-sm transition-colors hover:bg-black/80 active:scale-95"
      >
        <X size={16} />
      </button>
    </div>
  );
}
