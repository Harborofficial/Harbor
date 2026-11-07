import { Check, Minus } from "lucide-react";
import "./selection-check.css";

/** A decorative Harbor-style selection indicator. The parent row provides
 * checkbox semantics and keyboard access, so this remains out of the tab order. */
export function DownloadSelectionCheck({
  checked,
  partial = false,
  delayMs = 0,
}: {
  checked: boolean;
  partial?: boolean;
  delayMs?: number;
}) {
  const active = checked || partial;
  return (
    <span
      aria-hidden="true"
      style={{ animationDelay: `${delayMs}ms` }}
      className={`harbor-download-selection-check flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-[6px] ring-1 transition-[background-color,box-shadow,color] duration-200 ${
        active
          ? "bg-accent text-canvas ring-accent/80 shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_13%,transparent)]"
          : "bg-canvas/65 text-transparent ring-edge-soft"
      }`}
    >
      {partial ? (
        <Minus size={13} strokeWidth={3} />
      ) : checked ? (
        <Check size={13} strokeWidth={3} />
      ) : null}
    </span>
  );
}
