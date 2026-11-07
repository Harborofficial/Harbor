import { ArrowLeft, RotateCcw, Trash2 } from "../icons";
import { useEffect, useRef, useState } from "react";
import {
  applyCustomColorsPreview,
  applyTheme,
  CustomColors,
  type FontPairId,
  type ThemeSettings,
} from "@/lib/theme";
import { useT } from "@/lib/i18n";
import { SettingGroup, SettingRow } from "../kit";
import { ROW_DESC } from "../shared";
import { usePageActions } from "../page-actions";
import { ColorPopoverTrigger } from "../color-picker";

const COLOR_FIELDS: Array<{ key: keyof CustomColors; label: string; hint: string; group: string }> = [
  { key: "canvas", label: "Background", hint: "Page base.", group: "Surfaces" },
  { key: "surface", label: "Surface", hint: "Slightly lighter than background.", group: "Surfaces" },
  { key: "elevated", label: "Elevated", hint: "Cards, panels.", group: "Surfaces" },
  { key: "raised", label: "Raised", hint: "Highlighted blocks.", group: "Surfaces" },
  { key: "ink", label: "Text", hint: "Primary copy.", group: "Text" },
  { key: "inkMuted", label: "Muted text", hint: "Secondary copy.", group: "Text" },
  { key: "inkSubtle", label: "Subtle text", hint: "Captions, eyebrows.", group: "Text" },
  { key: "edge", label: "Border", hint: "Used at 55% / 25% alpha.", group: "Lines" },
  { key: "accent", label: "Accent", hint: "Highlight, progress.", group: "Accents" },
  { key: "danger", label: "Danger", hint: "Errors, destructive.", group: "Accents" },
];

export function CustomEditor({
  seed,
  fontPair,
  restoreTheme,
  onCancel,
  onSave,
  canDelete,
  onDelete,
}: {
  seed: CustomColors;
  fontPair: FontPairId;
  restoreTheme: ThemeSettings;
  onCancel: () => void;
  onSave: (c: CustomColors) => void;
  canDelete: boolean;
  onDelete: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<CustomColors>(seed);
  const restoreRef = useRef(restoreTheme);
  const finishedRef = useRef(false);
  const live = useRef({ draft, seed, onSave, onDelete, onCancel });
  live.current = { draft, seed, onSave, onDelete, onCancel };

  useEffect(() => {
    applyCustomColorsPreview(draft, fontPair);
  }, [draft, fontPair]);

  useEffect(
    () => () => {
      if (!finishedRef.current) applyTheme(restoreRef.current);
    },
    [],
  );

  const cancel = () => {
    applyTheme(restoreRef.current);
    finishedRef.current = true;
    live.current.onCancel();
  };

  usePageActions([
    {
      id: "theme-custom-back",
      label: "Back",
      tone: "quiet" as const,
      icon: <ArrowLeft size={18} strokeWidth={2.2} />,
      onSelect: cancel,
    },
    ...(canDelete
      ? [
          {
            id: "theme-custom-delete",
            label: "Delete",
            tone: "danger" as const,
            icon: <Trash2 size={18} strokeWidth={2.2} />,
            onSelect: () => {
              finishedRef.current = true;
              live.current.onDelete();
            },
          },
        ]
      : []),
    {
      id: "theme-custom-reset",
      label: "Reset",
      icon: <RotateCcw size={18} strokeWidth={2.2} />,
      onSelect: () => setDraft(live.current.seed),
    },
    {
      id: "theme-custom-save",
      label: "Save",
      tone: "primary" as const,
      onSelect: () => {
        finishedRef.current = true;
        live.current.onSave(live.current.draft);
      },
    },
  ]);

  const groups = COLOR_FIELDS.reduce<Record<string, typeof COLOR_FIELDS>>((acc, f) => {
    (acc[f.group] ??= []).push(f);
    return acc;
  }, {});

  return (
    <div className="animate-fade-in flex flex-col gap-6">
      <div className="flex flex-col gap-5">
        {Object.entries(groups).map(([groupName, fields]) => (
          <SettingGroup key={groupName} label={t(groupName)}>
            {fields.map((f) => (
              <ColorRow
                key={f.key}
                label={t(f.label)}
                hint={t(f.hint)}
                value={draft[f.key]}
                resetValue={seed[f.key]}
                onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))}
              />
            ))}
          </SettingGroup>
        ))}
      </div>

      <p className={`max-w-[70ch] ${ROW_DESC}`}>
        {t("Live preview is on. Save keeps what you've picked as your Custom theme. Reset reverts the editor to the saved palette.")}
      </p>
    </div>
  );
}

function ColorRow({
  label,
  hint,
  value,
  resetValue,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  resetValue: string;
  onChange: (v: string) => void;
}) {
  return (
    <SettingRow label={label} desc={hint}>
      <div className="flex items-center gap-2">
        {value !== resetValue && (
          <button
            type="button"
            onClick={() => onChange(resetValue)}
            aria-label={`Reset ${label}`}
            title={`Reset ${label}`}
            className="flex h-10 items-center gap-1 rounded-md px-2 text-[13.5px] font-semibold text-ink-subtle transition-colors hover:bg-elevated hover:text-ink"
          >
            <RotateCcw size={14} strokeWidth={2.2} />
            Reset
          </button>
        )}
        <ColorPopoverTrigger
          value={value}
          onChange={onChange}
          label={value.toUpperCase()}
          align="right"
          direction="down"
          portal
          highlighted
        />
      </div>
    </SettingRow>
  );
}
