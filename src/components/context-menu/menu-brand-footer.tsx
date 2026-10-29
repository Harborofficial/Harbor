import { useId, useState } from "react";
import { HarborMark } from "@/components/icons/harbor-mark";
import { useHarborLogo } from "@/lib/harbor-logo";
import "./menu-brand-footer.css";

/** Decorative identity for the root context menu, never a menu item. */
export function MenuBrandFooter() {
  const { mark, wordmark } = useHarborLogo();
  const tintId = useId();
  const [failedMark, setFailedMark] = useState<string | null>(null);
  const [failedWordmark, setFailedWordmark] = useState<string | null>(null);
  return (
    <div data-context-brand-footer aria-hidden className="context-menu-brand-footer">
      {mark && mark !== failedMark ? (
        <>
          <svg aria-hidden className="context-menu-brand-filter">
            <defs>
              <filter id={tintId} colorInterpolationFilters="sRGB">
                <feFlood floodColor="#EBA018" />
                <feComposite in2="SourceAlpha" operator="in" />
              </filter>
            </defs>
          </svg>
          <img
            src={mark}
            alt=""
            draggable={false}
            className="context-menu-brand-mark"
            style={{ filter: `url(#${tintId})` }}
            onError={() => setFailedMark(mark)}
          />
        </>
      ) : (
        <HarborMark className="context-menu-brand-mark" />
      )}
      {wordmark && wordmark !== failedWordmark && (
        <img
          src={wordmark}
          alt=""
          draggable={false}
          className="context-menu-brand-wordmark"
          onError={() => setFailedWordmark(wordmark)}
        />
      )}
    </div>
  );
}
