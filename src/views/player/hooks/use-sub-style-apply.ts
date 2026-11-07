import { useEffect, useRef, useState } from "react";
import { isLinuxDesktop, isMacDesktop } from "@/lib/platform";
import { applyMotionInterp } from "@/lib/player/motion-interp";
import { applyRtxVideo, resetRtxVideoState } from "@/lib/player/rtx-video";
import {
  applySubPos,
  applySubStyle,
  readOsdBox,
  subPosLiftPercent,
  subUsesMargins,
} from "@/lib/player/sub-style";
import type { useSettings } from "@/lib/settings";

export function useSubStyleApply(params: {
  engine: "html5" | "mpv";
  settings: ReturnType<typeof useSettings>["settings"];
  assNativeActive: boolean;
  imageNativeActive: boolean;
  subNativeRender: boolean;
  controlsInset: number;
  bridgeReady: boolean;
  mediaReady: boolean;
  sourceGamma: string;
  bridgeKey: string | number;
  svpActive: boolean;
  assScale?: number;
  subTrackId?: string;
  sdhFilterAllowed: boolean;
}): number {
  const {
    engine,
    settings,
    assNativeActive,
    imageNativeActive,
    subNativeRender,
    controlsInset,
    bridgeReady,
    mediaReady,
    sourceGamma,
    bridgeKey,
    svpActive,
    assScale,
    subTrackId,
    sdhFilterAllowed,
  } = params;

  const styleReady = engine === "mpv" && bridgeReady && mediaReady;
  const usesMargins = subUsesMargins(settings, { assNativeActive, imageNativeActive });
  const liftCover = styleReady && subNativeRender ? controlsInset : 0;
  const [liftPct, setLiftPct] = useState(0);
  const liftPctRef = useRef(liftPct);
  liftPctRef.current = liftPct;

  useEffect(() => {
    if (liftCover <= 0) {
      setLiftPct(0);
      return;
    }
    let live = true;
    void readOsdBox().then((osd) => {
      if (live) setLiftPct(subPosLiftPercent(liftCover, osd, usesMargins));
    });
    return () => {
      live = false;
    };
  }, [liftCover, usesMargins, bridgeKey]);

  useEffect(() => {
    if (!styleReady) return;
    void applySubStyle(settings, {
      assNativeActive,
      imageNativeActive,
      assScale,
      sdhFilterAllowed,
      liftPct: liftPctRef.current,
    });
  }, [
    styleReady,
    bridgeKey,
    assNativeActive,
    imageNativeActive,
    assScale,
    subTrackId,
    sdhFilterAllowed,
    settings.subHideSdh,
    settings.subAssNormalizeSize,
    settings.subFontSize,
    settings.subFontColor,
    settings.subBorderColor,
    settings.subBorderSize,
    settings.subMarginY,
    settings.subAlignX,
    settings.subAssOverride,
    settings.subStyle,
    settings.subFontFamily,
    settings.subLineSpacing,
    settings.subOpacity,
    settings.subBoxOpacity,
    settings.subBoxColor,
    settings.subBold,
  ]);

  useEffect(() => {
    if (!styleReady) return;
    void applySubPos(settings, {
      assNativeActive,
      imageNativeActive,
      assScale,
      sdhFilterAllowed,
      liftPct,
    });
  }, [liftPct]);

  useEffect(() => () => resetRtxVideoState(), [bridgeKey]);

  useEffect(() => {
    if (engine !== "mpv") return;
    if ((isMacDesktop() || isLinuxDesktop()) && settings.playerMpvEmbed) return;
    if (!bridgeReady) return;
    if (!mediaReady || !sourceGamma) {
      void applyRtxVideo(
        { hdr: false, vsr: false, svpActive, hdrToSdr: settings.playerHdrToSdr },
        bridgeKey,
      );
      return;
    }
    void applyMotionInterp(settings.playerMotionInterp && !svpActive);
    void applyRtxVideo(
      {
        hdr: settings.playerRtxHdr,
        vsr: settings.playerRtxVsr,
        svpActive,
        hdrToSdr: settings.playerHdrToSdr,
      },
      bridgeKey,
    );
  }, [
    engine,
    bridgeReady,
    mediaReady,
    sourceGamma,
    bridgeKey,
    svpActive,
    settings.playerMpvEmbed,
    settings.playerMotionInterp,
    settings.playerHdrToSdr,
    settings.playerRtxHdr,
    settings.playerRtxVsr,
  ]);

  return liftPct;
}
