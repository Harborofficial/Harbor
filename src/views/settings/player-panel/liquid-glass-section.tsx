import {
  GLASS_DEFAULTS,
  GLASS_LIMITS,
  normalizeGlassOptics,
  type GlassOptics,
} from "@/lib/player/liquid-glass";
import { useSettings } from "@/lib/settings";
import { useUiLanguage } from "@/lib/i18n";
import { ToggleRow } from "../shared";

export function LiquidGlassSection() {
  const { settings, update } = useSettings();
  const arabic = useUiLanguage() === "ar";
  const optics = normalizeGlassOptics(settings.playerGlassOptics);
  const labels: Record<keyof GlassOptics, string> = {
    zoom: arabic ? "التكبير" : "Magnification",
    refraction: arabic ? "الانكسار" : "Refraction",
    dispersion: arabic ? "فصل الألوان" : "Color separation",
    blur: arabic ? "التمويه" : "Blur",
  };
  return (
    <div className="flex flex-col gap-5">
      <ToggleRow
        label={arabic ? "اللكويد جلاس داخل MPV بلاير" : "Liquid glass inside MPV player"}
        sub={
          arabic
            ? "زجاج وانكسار مباشر خلف زر الرجوع وقوائم الترجمة والصوت والحلقات فوق الفيديو."
            : "Live video refraction behind the back button, subtitle and audio menus, and episode panels."
        }
        value={settings.playerLiquidGlass}
        onChange={(playerLiquidGlass) => update({ playerLiquidGlass })}
      />
      <p className="-mt-3 text-xs leading-relaxed text-ink-subtle">
        <span className="font-semibold text-ink-muted">
          {arabic ? "استهلاك الموارد:" : "Resource use:"}
        </span>{" "}
        {arabic
          ? "يعالج MPV إطارات الفيديو على معالج الرسوميات لمحاكاة انكسار الزجاج خلف عناصر الواجهة. قد يزيد ذلك استهلاك GPU ويؤثر في السلاسة على الأجهزة الأضعف."
          : "MPV processes video frames on the GPU to simulate glass refraction behind interface elements. This can increase GPU use and affect smoothness on less powerful devices."}
      </p>
      <fieldset
        disabled={!settings.playerLiquidGlass}
        className="grid grid-cols-1 gap-5 disabled:opacity-40 sm:grid-cols-2"
      >
        {(Object.keys(GLASS_DEFAULTS) as (keyof GlassOptics)[]).map((key) => (
          <label key={key} className="grid grid-cols-[1fr_auto] gap-3 text-sm text-ink-muted">
            <span>{labels[key]}</span>
            <output className="tabular-nums">
              {key === "zoom" ? `${Math.round(optics[key] * 100)}%` : optics[key].toFixed(2)}
            </output>
            <input
              aria-label={labels[key]}
              type="range"
              min={GLASS_LIMITS[key][0]}
              max={GLASS_LIMITS[key][1]}
              step={0.01}
              value={optics[key]}
              dir="ltr"
              className="col-span-2 w-full accent-accent"
              onChange={(event) =>
                update({
                  playerGlassOptics: { ...optics, [key]: event.currentTarget.valueAsNumber },
                })
              }
            />
          </label>
        ))}
      </fieldset>
      <button
        type="button"
        className="self-start text-sm text-ink-muted hover:text-ink"
        onClick={() => update({ playerGlassOptics: { ...GLASS_DEFAULTS } })}
      >
        {arabic ? "استعادة الإعدادات الافتراضية" : "Restore defaults"}
      </button>
    </div>
  );
}
