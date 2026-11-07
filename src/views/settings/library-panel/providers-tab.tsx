import {
  resetOmdbBudget,
  subscribeOmdbBudget,
  type OmdbBudget,
  omdbBudget as readOmdbBudget,
} from "@/lib/providers/omdb";
import { useEffect, useState } from "react";
import { Music, Check, RotateCw } from "../icons";
import { useSettings } from "@/lib/settings";
import { useAuth } from "@/lib/auth";
import { hasCustomMetaAddon, hasCustomMetaAddonAsync } from "@/lib/meta-resource";
import { useT } from "@/lib/i18n";
import { Section, Segmented, ToggleRow } from "../shared";
import { ROW_ACTION, SettingGroup, SettingRow, Nested } from "../kit";
import { EpisodeOrderSetting } from "../episode-order-setting";
import { SportsApiSetting } from "../sports-api-setting";
import { GameMetadataSetting } from "../game-metadata-setting";
import { useProviderKeys, type ProviderKeysArgs } from "./provider-keys";
import { MetadataSourceConfig } from "./metadata-source-config";
import { Tag } from "../player-panel/choice";

export function ProvidersTab(props: ProviderKeysArgs) {
  const { settings, update } = useSettings();
  const { authKey } = useAuth();
  const [metaAddonResult, setMetaAddonResult] = useState<{
    authKey: string | null;
    found: boolean;
  } | null>(null);
  const hasMetaAddon =
    metaAddonResult?.authKey === authKey ? metaAddonResult.found : hasCustomMetaAddon();
  useEffect(() => {
    let cancelled = false;
    void hasCustomMetaAddonAsync(authKey)
      .then((found) => {
        if (!cancelled) setMetaAddonResult({ authKey, found });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [authKey]);
  const t = useT();
  const { keyRow, modals } = useProviderKeys(props);
  const [configureSources, setConfigureSources] = useState(false);

  return (
    <>
      {modals}

      <Section
        title={t("Metadata providers")}
        subtitle={t(
          "Add TMDB for more catalogs and artwork. Other providers add the features listed below. You can use Harbor with Cinemeta without adding a key.",
        )}
      >
        <SettingGroup>
          {keyRow("tmdb")}
          {keyRow("omdb")}
          {keyRow("tvdb")}
          {keyRow("mdblist")}
          {keyRow("fanart")}
          {keyRow("rpdb")}
          {keyRow("postersrv")}
          {keyRow("nyt")}
        </SettingGroup>
      </Section>

      <SportsApiSetting />
      <GameMetadataSetting />

      <Section title={t("Titles and descriptions")}>
        <SettingGroup>
          <ToggleRow
            label={t("Disable built-in metadata")}
            badge={<Tag text={t("Experimental")} accent />}
            sub={t(
              "Use installed addons and providers you configured. Disable Harbor's keyless built-in metadata and fallbacks. Restart Harbor after changing this option.",
            )}
            value={settings.addonOnlyMetadata}
            onChange={(v) => {
              update({ addonOnlyMetadata: v });
              if (!v) setConfigureSources(false);
            }}
          />
          {settings.addonOnlyMetadata && (
            <SettingRow
              label={t("Metadata source priority")}
              desc={t(
                "Choose which addons and configured providers supply each section. The first source with a value wins.",
              )}
            >
              <button
                type="button"
                className={ROW_ACTION}
                onClick={() => setConfigureSources(true)}
              >
                {t("Configure")}
              </button>
            </SettingRow>
          )}
          <ToggleRow
            label={t("Use TMDB for Top Match in search")}
            sub={t(
              "Use your saved TMDB key for Top Match, even in addon-only mode. If unavailable or turned off, use your highest-priority metadata addon's search results.",
            )}
            value={settings.searchTmdbTopMatch}
            onChange={(v) => update({ searchTmdbTopMatch: v })}
          />
          <ToggleRow
            label={t("Use Cinemeta for title metadata")}
            lockReason={
              settings.addonOnlyMetadata ? t("Controlled by disabled built-in metadata") : undefined
            }
            sub={t(
              "Cinemeta supplies titles and descriptions. Turn it off when an installed metadata addon supplies them instead.",
            )}
            value={settings.cinemetaEnabled}
            onChange={(v) => update({ cinemetaEnabled: v })}
            warn={
              !settings.addonOnlyMetadata && !settings.cinemetaEnabled && !hasMetaAddon
                ? t(
                    "No metadata addon detected. Harbor is falling back to Cinemeta so titles still load, but turn this back on unless you are installing one.",
                  )
                : undefined
            }
          />
          <ToggleRow
            label={t("Prefer my installed metadata addon")}
            lockReason={
              settings.addonOnlyMetadata ? t("Controlled by disabled built-in metadata") : undefined
            }
            sub={t(
              "Try your addon first for titles and descriptions. Use Cinemeta when the addon has no result.",
            )}
            value={settings.preferCustomMetaAddon}
            onChange={(v) => update({ preferCustomMetaAddon: v })}
          />
          <ToggleRow
            label={t("Use free IMDb data without a TMDB key")}
            lockReason={
              settings.addonOnlyMetadata ? t("Controlled by disabled built-in metadata") : undefined
            }
            sub={t(
              "With no TMDB key, the About panel pulls cast, crew, and title info from a free IMDb source. TMDB is still used whenever a key is set.",
            )}
            value={settings.imdbApiFallback}
            onChange={(v) => update({ imdbApiFallback: v })}
          />
        </SettingGroup>
      </Section>

      <MetadataSourceConfig open={configureSources} onClose={() => setConfigureSources(false)} />

      <Section title={t("Episode order")}>
        <SettingGroup>
          <EpisodeOrderSetting />
        </SettingGroup>
      </Section>

      <Section title={t("Song identification")}>
        <SettingGroup>
          <SettingRow
            wide
            icon={<Music size={18} strokeWidth={2} />}
            label={t("Song ID provider")}
            desc={t("Which service names the track when you tap Identify song in the player.")}
          >
            <Segmented
              value={settings.songIdProvider}
              options={[
                { value: "audd", label: t("AudD") },
                { value: "ai", label: t("AI (Gemini)") },
              ]}
              onChange={(v) => update({ songIdProvider: v as "audd" | "ai" })}
            />
          </SettingRow>
          <Nested>{settings.songIdProvider === "ai" ? keyRow("songai") : keyRow("audd")}</Nested>
        </SettingGroup>
      </Section>

      <Section title={t("API budget")}>
        <SettingGroup>
          <OmdbBudgetRow />
        </SettingGroup>
      </Section>
    </>
  );
}

function OmdbBudgetRow() {
  const tr = useT();
  const { settings } = useSettings();
  const [budget, setBudget] = useState<OmdbBudget>(() => readOmdbBudget());
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => subscribeOmdbBudget(setBudget), []);
  useEffect(() => {
    if (!confirmed) return;
    const t = setTimeout(() => setConfirmed(false), 1400);
    return () => clearTimeout(t);
  }, [confirmed]);

  const label = tr("OMDB daily budget");

  if (!settings.omdbKey) {
    return (
      <SettingRow
        label={label}
        lockReason={tr("Save an OMDB key in Library & metadata to enable rating fetches.")}
      />
    );
  }

  const desc = budget.keyInvalid
    ? tr("Key rejected. Check it on Library & metadata.")
    : tr("{used} / {limit} requests today.", { used: budget.used, limit: budget.limit }) +
      (budget.exhausted ? " " + tr("Budget exhausted, resets at midnight UTC.") : "");

  return (
    <SettingRow label={label} desc={desc}>
      <button
        type="button"
        onClick={() => {
          resetOmdbBudget();
          setConfirmed(true);
        }}
        className={ROW_ACTION}
      >
        {confirmed ? (
          <Check size={18} strokeWidth={2.4} className="text-accent" />
        ) : (
          <RotateCw size={18} strokeWidth={2.2} />
        )}
        {confirmed ? tr("Reset") : tr("Reset counter")}
      </button>
    </SettingRow>
  );
}
