import { useState } from "react";
import { useSettings } from "@/lib/settings";
import { tmdbBackdropAtSize } from "@/lib/tmdb-backdrop-size";

function BlurUpBackdrop({
  src,
  forceBlur,
  fullQuality,
}: {
  src: string;
  forceBlur: boolean;
  fullQuality: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const lowSrc = tmdbBackdropAtSize(src, "w300");
  const hiSrc = tmdbBackdropAtSize(src, forceBlur ? "w780" : fullQuality ? "original" : "w1280");
  return (
    <>
      <img
        src={lowSrc}
        alt=""
        decoding="async"
        className="absolute inset-0 h-full w-full scale-105 object-cover opacity-50 blur-2xl"
      />
      <img
        src={hiSrc}
        alt=""
        decoding="async"
        ref={(el) => {
          if (el?.complete && el.naturalWidth > 0) setLoaded(true);
        }}
        onLoad={() => setLoaded(true)}
        className={`absolute inset-0 h-full w-full scale-105 object-cover transition-opacity duration-700 ${
          forceBlur ? "blur-2xl" : ""
        } ${loaded ? "opacity-50" : "opacity-0"}`}
      />
    </>
  );
}

export function BackdropLayer({ src }: { src?: string }) {
  const { settings } = useSettings();
  return (
    <div
      aria-hidden
      className="harbor-picker-backdrop pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      {src && (
        <BlurUpBackdrop
          key={`${src}:${settings.streamBackdropBlur}:${settings.heroFullQuality}`}
          src={src}
          forceBlur={settings.streamBackdropBlur}
          fullQuality={settings.heroFullQuality}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-canvas/30 via-canvas/85 to-canvas" />
      <div className="absolute inset-0 bg-gradient-to-r from-canvas/55 via-transparent to-canvas/55" />
    </div>
  );
}
