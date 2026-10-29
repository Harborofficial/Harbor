import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tmdbBackdropAtSize } from "@/lib/tmdb-backdrop-size";
import {
  firstUsableHeroBackdrop,
  isHighQualityHeroArt,
  knownHeroArtQuality,
  nextUsableHeroBackdrop,
  rememberHeroArtQuality,
} from "@/lib/hero-art-quality";

const MAX_CANDIDATES = 8;

function Layer({
  url,
  first,
  fullQuality,
  onReady,
  onMeasured,
  onUnavailable,
  objectPosition = "center",
}: {
  url: string;
  first: boolean;
  fullQuality: boolean;
  onReady: () => void;
  onMeasured: (suitable: boolean) => void;
  onUnavailable: () => void;
  objectPosition?: string;
}) {
  const lowUrl = tmdbBackdropAtSize(url, "w300");
  const highUrl = tmdbBackdropAtSize(url, fullQuality ? "original" : "w1280");
  const canBlurUp = first && lowUrl !== highUrl;
  const [ready, setReady] = useState(false);
  const measured = useRef(false);
  const done = (image?: HTMLImageElement) => {
    if (image && !measured.current) {
      measured.current = true;
      const { naturalWidth: width, naturalHeight: height } = image;
      const suitable =
        isHighQualityHeroArt(width, height) ||
        // A TMDB w1280 response is intentionally capped by the user's quality setting.
        // Accept that rendition when it is close to its size ceiling and well proportioned.
        (!fullQuality &&
          highUrl !== url &&
          width >= 1200 &&
          height >= 640 &&
          width / height >= 1.45 &&
          width / height <= 2.4);
      rememberHeroArtQuality(url, suitable ? Math.max(width, 1600) : width, suitable ? Math.max(height, 800) : height);
      onMeasured(suitable);
    }
    setReady(true);
    onReady();
  };
  return (
    <>
      {canBlurUp && (
        <img
          src={lowUrl}
          alt=""
          aria-hidden="true"
          decoding="async"
          className="absolute inset-0 h-full w-full scale-105 object-cover blur-2xl"
        />
      )}
      <img
        src={highUrl}
        alt=""
        decoding="async"
        fetchPriority="high"
        ref={(el) => {
          if (el?.complete && el.naturalWidth > 0) done(el);
        }}
        onLoad={(event) => done(event.currentTarget)}
        onError={() => {
          rememberHeroArtQuality(url, 0, 0);
          onUnavailable();
        }}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${ready ? "opacity-100" : "opacity-0"}`}
        style={{ objectPosition }}
      />
    </>
  );
}

export function HeroBackdrop({
  url,
  fallbacks = [],
  fullQuality = false,
  objectPosition,
}: {
  url: string;
  fallbacks?: string[];
  fullQuality?: boolean;
  objectPosition?: string;
}) {
  const candidates = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const candidate of [url, ...fallbacks]) {
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);
      list.push(candidate);
    }
    return list.slice(0, MAX_CANDIDATES);
  }, [url, fallbacks]);
  const candidateKey = candidates.join("\n");
  const [chosen, setChosen] = useState(() => firstUsableHeroBackdrop(candidates) ?? url);
  const [layers, setLayers] = useState<{ id: number; url: string }[]>([{ id: 0, url: chosen }]);
  const nextId = useRef(1);

  useEffect(() => {
    setChosen((current) =>
      candidates.includes(current) && knownHeroArtQuality(current) !== false
        ? current
        : (firstUsableHeroBackdrop(candidates) ?? candidates[0] ?? url),
    );
  }, [candidateKey]);

  useEffect(() => {
    const id = nextId.current++;
    setLayers((prev) =>
      prev[prev.length - 1]?.url === chosen ? prev : [...prev, { id, url: chosen }],
    );
  }, [chosen]);

  const advance = useCallback(
    (from: string) => {
      setChosen((current) =>
        current === from ? (nextUsableHeroBackdrop(candidates, current) ?? current) : current,
      );
    },
    [candidateKey],
  );

  const settle = (id: number) =>
    setLayers((prev) => {
      const index = prev.findIndex((layer) => layer.id === id);
      return index > 0 ? prev.slice(index) : prev;
    });
  if (candidates.length === 0) return null;
  return (
    <>
      {layers.map((layer) => (
        <Layer
          key={`${layer.id}:${fullQuality}`}
          url={layer.url}
          first={layer.id === 0}
          fullQuality={fullQuality}
          onReady={() => settle(layer.id)}
          onMeasured={(suitable) => {
            if (!suitable) advance(layer.url);
          }}
          onUnavailable={() => advance(layer.url)}
          objectPosition={objectPosition}
        />
      ))}
    </>
  );
}
