import { useEffect, useRef, useState } from "react";
import { Award, Captions, Check, Eye, HardDrive, Sparkles, Tag, Trophy, Type } from "../icons";
import { useSettings } from "@/lib/settings";
import { useT } from "@/lib/i18n";
import { ROW_DESC, Section, Segmented, ToggleRow } from "../shared";
import { SettingGroup, SettingRow, Nested, SettingsWorkbench } from "../kit";
import { SongCardStylePicker } from "../song-card-style-picker";
import { HoverStyleGallery } from "../hover-style-preview";
import { CardOverlayPreview } from "../card-overlay-preview";
import { RatingsMatrix } from "../ratings-matrix";
import {
  CardBadgesPanel,
  CardScoresPreview,
  WatchlistControl,
  type PreviewFlags,
} from "../card-badges-panel";
import { TV_CARD_MIN } from "@/components/row";

export function CardsTab() {
  const { settings: baseSettings, update } = useSettings();
  const [layout, setLayout] = useState<"poster" | "tv">(baseSettings.rowCardStyle);
  const settings =
    layout === "tv" ? { ...baseSettings, ...baseSettings.tvCardOptions } : baseSettings;
  const tvPreviewCardWidth = Math.max(72, Math.round(TV_CARD_MIN * settings.posterScale));
  const updateCard = (patch: Partial<typeof settings>) => {
    if (layout === "poster") {
      update(patch);
      return;
    }
    const tvOptions = { ...baseSettings.tvCardOptions };
    const sharedPatch: Partial<typeof baseSettings> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (key in tvOptions) {
        Object.assign(tvOptions, { [key]: value });
      } else {
        Object.assign(sharedPatch, { [key]: value });
      }
    }
    update({ ...sharedPatch, tvCardOptions: tvOptions });
  };
  const t = useT();

  const badgeFlags: PreviewFlags = {
    showImdb: settings.showImdbBadge && !!settings.tmdbKey,
    showTmdb: settings.showTmdbBadge && !!settings.tmdbKey,
    showRt: settings.showRtBadge && !!settings.omdbKey,
    showPopcorn: settings.showPopcornBadge && !!settings.mdblistKey,
    showMetacritic: settings.showMetacriticBadge && !!settings.mdblistKey,
    showLetterboxd: settings.showLetterboxdBadge && !!settings.mdblistKey,
    showMdblist: settings.showMdblistBadge && !!settings.mdblistKey,
    showTrakt: settings.showTraktBadge && !!settings.mdblistKey,
    showMal: settings.showMalBadge,
    showSimkl: settings.showSimklBadge,
  };
  const enabledBadgeCount =
    (badgeFlags.showImdb || badgeFlags.showTmdb || badgeFlags.showMal ? 1 : 0) +
    (badgeFlags.showRt ? 1 : 0) +
    (badgeFlags.showPopcorn ? 1 : 0) +
    (badgeFlags.showMetacritic ? 1 : 0) +
    (badgeFlags.showLetterboxd ? 1 : 0) +
    (badgeFlags.showMdblist ? 1 : 0) +
    (badgeFlags.showTrakt ? 1 : 0) +
    (badgeFlags.showSimkl ? 1 : 0);

  const prevBadgeCountRef = useRef(enabledBadgeCount);
  useEffect(() => {
    if (layout !== "poster") return;
    const prev = prevBadgeCountRef.current;
    prevBadgeCountRef.current = enabledBadgeCount;
    if (enabledBadgeCount > prev && enabledBadgeCount > settings.cardBadgeLimit) {
      updateCard({ cardBadgeLimit: Math.min(6, enabledBadgeCount) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledBadgeCount]);

  return (
    <>
      <Segmented
        value={layout}
        options={[
          { value: "poster", label: t("Poster") },
          { value: "tv", label: t("TV") },
        ]}
        onChange={(v) => setLayout(v as "poster" | "tv")}
      />
      <Section
        title={layout === "poster" ? t("On the poster") : t("On the TV")}
        anchorTitle="Card overlays"
      >
        <ToggleRow
          label={t("Show tags on cards")}
          leading={<Tag size={18} strokeWidth={2} />}
          sub={t(
            "The New, In Cinema, Rerun. Turn off for a cleaner grid. Score chips are separate, below.",
          )}
          value={settings.showCardBadges}
          onChange={(v) => updateCard({ showCardBadges: v })}
        />
        <SettingsWorkbench
          compact
          widePreview={layout === "tv"}
          widePreviewWidth={tvPreviewCardWidth + 40}
          preview={
            <CardOverlayPreview
              layout={layout}
              settings={settings}
              cardWidth={tvPreviewCardWidth}
            />
          }
        >
          <SettingRow
            wide
            label={t("Award display mode")}
            desc={t(
              layout === "tv"
                ? t(
                    "Choose how award wins appear on cards. TV award tabs are always shown at the top.",
                  )
                : t("Choose how award wins appear on cards. You can position award tabs below."),
            )}
            icon={<Award size={18} strokeWidth={2} />}
          >
            <Segmented
              value={settings.cardAwardDisplay}
              options={[
                { value: "tabs", label: t("Award tabs") },
                { value: "badge", label: t("Award badge") },
                { value: "none", label: t("No award") },
              ]}
              onChange={(v) => {
                const display = v as "tabs" | "badge" | "none";
                updateCard({
                  cardAwardDisplay: display,
                  awardTabs: display === "tabs",
                });
              }}
            />
          </SettingRow>
          {layout === "poster" && settings.cardAwardDisplay === "tabs" && (
            <Nested>
              <SettingRow
                wide
                label={t("Award tab position")}
                desc={t("Where the laurel tab sits relative to the score chips on the poster.")}
              >
                <Segmented
                  value={settings.awardTabPosition}
                  options={[
                    { value: "above", label: t("Above ratings") },
                    { value: "below", label: t("Below ratings") },
                    { value: "top", label: t("Top of card") },
                  ]}
                  onChange={(v) => updateCard({ awardTabPosition: v as "above" | "below" | "top" })}
                />
              </SettingRow>
            </Nested>
          )}
          <ToggleRow
            label={t("Top 10 ribbon")}
            newId="library:top-10"
            leading={<Trophy size={18} strokeWidth={2} />}
            sub={t(
              "Mark Top 10 titles with a corner ribbon. Bookmarks move down when they share its corner.",
            )}
            value={settings.top10Ribbon}
            onChange={(v) => updateCard({ top10Ribbon: v })}
          />
          {settings.top10Ribbon && (
            <Nested>
              <SettingRow
                wide
                label={t("Ribbon corner")}
                desc={t("Which top corner of the poster the ribbon folds over.")}
              >
                <Segmented
                  value={settings.top10RibbonSide}
                  options={[
                    { value: "left", label: t("Top left") },
                    { value: "right", label: t("Top right") },
                  ]}
                  onChange={(v) => updateCard({ top10RibbonSide: v as "left" | "right" })}
                />
              </SettingRow>
            </Nested>
          )}
          <WatchlistControl
            value={settings.watchlistBadge}
            onChange={(v) => updateCard({ watchlistBadge: v })}
          />
        </SettingsWorkbench>
        <ToggleRow
          label={t("Watched badge")}
          sub={t("Puts a check on titles you have already finished.")}
          leading={<Check size={18} strokeWidth={2.4} />}
          value={settings.showWatchedBadge}
          onChange={(v) => updateCard({ showWatchedBadge: v })}
        />
        <ToggleRow
          label={t("Show an “on disk” badge on cards")}
          leading={<HardDrive size={18} strokeWidth={2} />}
          sub={t(
            "Marks movies and shows across Home, the catalogs, and detail pages when a matching file already exists in your local library.",
          )}
          value={settings.showLocalLibraryBadge}
          onChange={(v) => updateCard({ showLocalLibraryBadge: v })}
        />
        <ToggleRow
          label={t("Show DUB badge on anime cards")}
          leading={<Captions size={18} strokeWidth={2} />}
          sub={t("Flags anime with an English dub. Also tags dub / sub / dual on stream sources.")}
          value={settings.showDubBadge}
          onChange={(v) => updateCard({ showDubBadge: v })}
        />
      </Section>

      <Section title={t("Scores")}>
        <SettingsWorkbench
          compact
          widePreview={layout === "tv"}
          widePreviewWidth={tvPreviewCardWidth + 40}
          preview={
            <CardScoresPreview
              settings={settings}
              flags={badgeFlags}
              enabledBadgeCount={enabledBadgeCount}
              layout={layout}
              cardWidth={tvPreviewCardWidth}
            />
          }
        >
          <RatingsMatrix settings={settings} update={updateCard} />
          <CardBadgesPanel
            settings={settings}
            update={updateCard}
            enabledBadgeCount={enabledBadgeCount}
            layout={layout}
          />
          {settings.showMalBadge && (
            <SettingRow
              label={t("Anime card rating source")}
              desc={t(
                "Pick which score anime cards show. IMDb falls back to MAL when a title has no IMDb rating yet.",
              )}
            >
              <Segmented
                value={settings.animeCardRating}
                options={[
                  { value: "mal", label: t("MAL") },
                  { value: "imdb", label: t("IMDb") },
                ]}
                onChange={(v) => updateCard({ animeCardRating: v as "mal" | "imdb" })}
              />
            </SettingRow>
          )}
        </SettingsWorkbench>
      </Section>

      <Section title={t("Titles")}>
        <ToggleRow
          label={t("Hide titles under posters")}
          leading={<Type size={18} strokeWidth={2} />}
          sub={t("Cleaner grid when your poster service already prints the title on the artwork.")}
          value={settings.hidePosterTitles}
          onChange={(v) => update({ hidePosterTitles: v })}
        />
      </Section>

      <SongCardStylePicker />

      <Section title={t("Hover preview")}>
        <ToggleRow
          label={t("Peek at a title on hover")}
          leading={<Eye size={18} strokeWidth={2} />}
          sub={t(
            "Rest the cursor on a poster to peek at the rating, story, and quick actions without opening it. Off by default.",
          )}
          value={settings.hoverPreviewEnabled}
          onChange={(v) => update({ hoverPreviewEnabled: v })}
        />
        {settings.hoverPreviewEnabled && (
          <Nested>
            <SettingGroup label={t("Hover style")}>
              <p className={`max-w-[70ch] ${ROW_DESC}`}>
                {t("Pick the card that appears. Each tile previews the real thing.")}
              </p>
              <HoverStyleGallery
                value={settings.cardHoverStyle}
                customHoverId={settings.customHoverId}
                onChange={(style, customId) =>
                  update(
                    customId != null
                      ? { cardHoverStyle: style, customHoverId: customId }
                      : { cardHoverStyle: style },
                  )
                }
              />
              {(settings.cardHoverStyle === "default" || settings.cardHoverStyle === "marquee") && (
                <SettingRow
                  wide
                  label={t("Open preview")}
                  desc={t("Whether the card grows over the poster or slides out beside it.")}
                >
                  <Segmented
                    value={settings.hoverPreviewPlacement}
                    options={[
                      { value: "over", label: t("On the card") },
                      { value: "side", label: t("To the side") },
                    ]}
                    onChange={(v) => update({ hoverPreviewPlacement: v as "over" | "side" })}
                  />
                </SettingRow>
              )}
            </SettingGroup>
          </Nested>
        )}
        <ToggleRow
          label={t("Poster shine on hover")}
          leading={<Sparkles size={18} strokeWidth={2} />}
          sub={t(
            "A subtle tvOS style light sweep across a poster when you hover it. Off by default; the card lift stays either way.",
          )}
          value={settings.cardHoverShine}
          onChange={(v) => update({ cardHoverShine: v })}
        />
      </Section>
    </>
  );
}
