import type { ReactNode } from "react";
import "./styles/midnight.css";
import { useSettings } from "@/lib/settings";
import { MidnightTopNav } from "./components/MidnightTopNav";
import { MidnightHoverPreview } from "./components/MidnightHoverPreview";
import { useAppearance } from "./appearance";
import { useRuntime } from "./runtime";
import { useHero } from "./hero-style";
import { useDetailStyle } from "./detail-style";

export interface MidnightShellProps {
  children?: ReactNode;
}

/**
 * Midnight theme shell.
 * Renders the top horizontal liquid-glass nav capsule.
 */
export function MidnightShell({ children }: MidnightShellProps) {
  const appearance = useAppearance();
  // The hero's and the title page's choices are painted by the shell, not by the menu that offers
  // them: both have to be drawn in them on the first frame, long before anyone opens that menu.
  // The runtime carries the lite mode the same way, and its attribute is what the stylesheet reads.
  useRuntime();
  useHero();
  useDetailStyle();
  const { settings } = useSettings();
  // Harbour paints the preset's own glow behind everything. A tinted palette or OLED replaces it
  // with the theme's floor, which has to sit above that layer and below the canvas. A backdrop the
  // owner picked themselves is left alone: only OLED, which is about black, overrides it.
  const keepsOwnBackdrop = !!settings.theme.backgroundImage;
  const floor = appearance.oled || (!keepsOwnBackdrop && appearance.palette !== "frost");

  return (
    <div
      className="midnight-shell contents"
      data-theme-shell="midnight"
    >
      {floor && (
        <div
          className="midnight-floor"
          data-oled={appearance.oled ? "on" : "off"}
          aria-hidden="true"
        />
      )}
      <MidnightTopNav />
      <MidnightHoverPreview />
      {children}
    </div>
  );
}

export default MidnightShell;
