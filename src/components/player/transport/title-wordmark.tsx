import { useState, type ReactNode } from "react";

/** Artwork title for the player chrome, falling back to the text title if it fails to load. */
export function TitleWordmark({
  src,
  alt,
  maxHeight,
  fallback,
}: {
  src: string;
  alt: string;
  maxHeight: number;
  fallback: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return (
    <img
      src={src}
      alt={alt}
      decoding="async"
      onError={() => setFailed(true)}
      style={{ maxHeight }}
      className="w-auto max-w-[min(52vw,460px)] object-contain object-left drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)] rtl:object-right"
    />
  );
}
