import { useEffect, useState } from "react";
import { useSettings } from "@/lib/settings";
import { useT } from "@/lib/i18n";
import {
  BUFFER_SIZES,
  bufferProfileFor,
  bufferSizeFor,
  effectiveBufferProfile,
  bufferTotalBytes,
  formatBufferMemory,
  type BufferSizeId,
} from "@/lib/player/buffer-profile";
import { getTotalPhysBytes, subscribeNativeMemory } from "@/lib/native-memory";
import { Section, Segmented } from "../shared";
import { SettingRow } from "../kit";

const LABELS: Record<BufferSizeId, string> = {
  auto: "Auto",
  small: "Small",
  medium: "Medium",
  large: "Large",
  max: "Maximum",
};

const DESCRIPTIONS: Record<BufferSizeId, string> = {
  auto: "Sizes the cache from this computer's memory: about 1/16 of RAM, between 256 MB and 1 GB, split 75% ahead and 25% behind. Recommended for most connections.",
  small: "Uses less memory and starts quickly. Best for a stable connection.",
  medium: "Reads up to two minutes ahead to cover brief connection drops.",
  large: "Reads up to ten minutes ahead. Uses more memory to help with an unstable connection.",
  max: "Reads up to thirty minutes ahead. Uses the most memory and may take longer to start.",
};

export function BufferSizeSection() {
  const { settings, update } = useSettings();
  const t = useT();
  const value = bufferSizeFor(settings);
  const [totalPhys, setTotalPhys] = useState(getTotalPhysBytes);
  useEffect(() => subscribeNativeMemory(() => setTotalPhys(getTotalPhysBytes())), []);
  const profile = effectiveBufferProfile(value, totalPhys);
  const raw = bufferProfileFor(value);
  const totalBytes = profile ? bufferTotalBytes(profile) : 0;
  const capped = raw != null && profile != null && totalBytes < bufferTotalBytes(raw);
  const adaptive = t("Adaptive");
  const duration = (secs: number) =>
    secs >= 60 ? t("{n} min", { n: Math.round(secs / 60) }) : t("{n} sec", { n: secs });
  const stats = [
    {
      caption: t("Reads ahead"),
      desc: t("Target amount downloaded ahead, within the memory limit."),
      readout: profile ? duration(profile.readaheadSecs) : adaptive,
    },
    {
      caption: t("Memory cap"),
      desc: t("Maximum memory used for buffered video, ahead and behind."),
      readout: profile ? formatBufferMemory(totalBytes) : adaptive,
    },
    {
      caption: t("Wait before playing"),
      desc: t(
        "Amount of video buffered before playback starts. This is not a fixed loading delay.",
      ),
      readout: !profile
        ? adaptive
        : profile.pauseWaitSecs > 0
          ? duration(profile.pauseWaitSecs)
          : t("None"),
    },
  ];

  return (
    <Section
      title={t("Slow or unstable connection")}
      subtitle={t(
        "Download more of a video ahead of playback to help prevent pauses on an unstable connection.",
      )}
      newId="mpv:buffer-size"
    >
      <SettingRow
        wide
        label={t("Buffer size")}
        desc={t(DESCRIPTIONS[value])}
        warn={
          profile && capped
            ? t("Capped to {size} to protect memory.", {
                size: formatBufferMemory(totalBytes),
              })
            : profile && value === "max"
              ? t("Holds up to {size} in memory while a video plays.", {
                  size: formatBufferMemory(totalBytes),
                })
              : undefined
        }
      >
        <Segmented
          value={value}
          options={BUFFER_SIZES.map((id) => ({ value: id, label: LABELS[id] }))}
          onChange={(v) => update({ mpvBufferSize: v })}
        />
      </SettingRow>
      {stats.map((s) => (
        <SettingRow key={s.caption} label={s.caption} desc={s.desc}>
          <span className="text-[15.5px] leading-[22px] tabular-nums text-ink-muted">
            {s.readout}
          </span>
        </SettingRow>
      ))}
    </Section>
  );
}
