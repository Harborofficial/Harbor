import { useState } from "react";
import { Dropdown } from "@/components/dropdown";
import { useT } from "@/lib/i18n";
import {
  catalogSections,
  setPinnedCatalogSections,
  usePinnedCatalogs,
  PINNED_CATALOGS_CAP,
  type CatalogSection,
  type PinnedCatalog,
} from "@/lib/pinned-catalogs";

export function CatalogSectionPicker({ catalog }: { catalog: PinnedCatalog }) {
  const t = useT();
  const pinned = usePinnedCatalogs().find((c) => c.id === catalog.id);
  const sections = pinned ? catalogSections(pinned) : [];
  const labels = { home: t("Home"), movies: t("Movies"), shows: t("Shows"), anime: t("Anime") };
  const [full, setFull] = useState(false);
  return (
    <div className="flex flex-col items-end gap-1">
      <Dropdown
        size="sm"
        ariaLabel={`${t("Show in")}: ${catalog.name}`}
        value={sections[0] ?? ""}
        selectedValues={sections}
        selectionLabel={
          sections.length ? sections.map((s) => labels[s]).join(", ") : t("Catalogs only")
        }
        className="max-w-64"
        menuClassName="space-y-1"
        options={[
          { value: "home", label: t("Home") },
          { value: "movies", label: t("Movies") },
          { value: "shows", label: t("Shows") },
          { value: "anime", label: t("Anime") },
        ]}
        onChange={(value) => {
          setFull(false);
          const section = value as CatalogSection;
          const next = sections.includes(section)
            ? sections.filter((s) => s !== section)
            : [...sections, section];
          setFull(!setPinnedCatalogSections(catalog, next));
        }}
      />
      {full && (
        <span role="status" className="max-w-56 text-xs text-danger">
          {t("You can add up to {count} catalogs. Remove one first.", {
            count: PINNED_CATALOGS_CAP,
          })}
        </span>
      )}
    </div>
  );
}
