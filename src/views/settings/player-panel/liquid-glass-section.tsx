import {
  GLASS_DEFAULTS,
  GLASS_LIMITS,
  normalizeGlassOptics,
  type GlassOptics,
} from "@/lib/player/liquid-glass";
import { useSettings } from "@/lib/settings";
import { useUiLanguage } from "@/lib/i18n";
import { ToggleRow } from "../shared";
import { fillStyle } from "@/components/slider";

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
        label={
          arabic
            ? "اللكويد جلاس داخل MPV بلاير (GPU، تجريبي)"
            : "MPV Liquid Glass (GPU, experimental)"
        }
        sub={
          arabic
            ? "زجاج يستخدم صورة الفيديو نفسها لمحاكاة الانكسار خلف عناصر واجهة MPV بواسطة GPU. إعداد مستقل ومعطّل افتراضيًا."
            : "Uses the video image itself to simulate glass refraction behind MPV interface elements on the GPU. Independent and off by default."
        }
        value={settings.playerLiquidGlass}
        onChange={(playerLiquidGlass) => update({ playerLiquidGlass })}
      />
      <p className="-mt-3 text-sm leading-relaxed text-ink-muted">
        {arabic
          ? "يظهر على زر الرجوع، وقوائم الترجمة والصوت، وزر Up Next ولوحة الحلقات، وتحذيرات المحتوى، وأزرار التخطي ومؤشر الصوت العائم والقوائم الأخرى فوق الفيديو. لا يُضاف إلى شريط التحكم السفلي."
          : "Appears on the back button, subtitle and audio menus, the Up Next button and episode panel, content warnings, skip buttons, the floating volume indicator, and other overlays above the video. It is not added to the bottom playback bar."}
      </p>
      <p className="-mt-3 text-xs leading-relaxed text-ink-subtle">
        <span className="font-semibold text-ink-muted">
          {arabic ? "استهلاك الموارد:" : "Resource use:"}
        </span>{" "}
        {arabic
          ? "يضيف معالجة على GPU وقد يؤثر في سلاسة الفيديو والبطارية، خصوصًا على الأجهزة الأضعف وSteam Deck. يتوقف التأثير مؤقتًا أثناء تحريك اللوحات أو تغيير حجمها ويعود بعد استقرارها لتقليل التقطيع وتأخر الزجاج. لم يتم التحقق من الأداء على جميع الأجهزة."
          : "Adds GPU processing and may affect playback smoothness and battery life, especially on less powerful devices and Steam Deck. Glass pauses while panels move or resize and returns once they settle to reduce stuttering and trailing. Performance has not been validated on all devices."}
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
              style={fillStyle(optics[key], GLASS_LIMITS[key][0], GLASS_LIMITS[key][1], 0.01)}
              className="harbor-slider col-span-2 w-full"
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
        disabled={!settings.playerLiquidGlass}
        className="self-start text-sm text-ink-muted hover:text-ink disabled:opacity-40"
        onClick={() => update({ playerGlassOptics: { ...GLASS_DEFAULTS } })}
      >
        {arabic ? "استعادة الإعدادات الافتراضية" : "Restore defaults"}
      </button>
    </div>
  );
}
