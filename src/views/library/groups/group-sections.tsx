import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useSettings } from "@/lib/settings";
import { useT } from "@/lib/i18n";
import { randomUuid } from "@/lib/uuid";
import { groupButtonClass, groupInputClass } from "./group-editor";

export function GroupSections() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const { settings, update } = useSettings();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const sections = settings.libraryGroupSections;
  const begin = (id: string, title: string) => {
    setEditing(id);
    setName(title);
  };
  return (
    <section className="overflow-hidden rounded-xl border border-edge-soft bg-elevated">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-start text-[14px] font-semibold text-ink transition-colors hover:bg-raised"
      >
        {t("Home sections")}
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={`shrink-0 text-ink-muted transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div id={panelId} className="flex flex-col gap-3 border-t border-edge-soft p-4">
          <p className="text-sm text-ink-muted">
            {t(
              "Create sections here, then choose a Home section when editing a group. Use Customize Home to arrange the rows.",
            )}
          </p>
          {sections.map((section) => {
            const key = `library-groups:${section.id}`;
            const title = settings.homeRows.renamed[key] ?? section.name;
            return (
              <div key={section.id} className="flex flex-wrap items-center gap-3">
                <span className="min-w-0 flex-1 break-words text-ink">{title}</span>
                <button
                  type="button"
                  className={groupButtonClass}
                  aria-label={t("Rename {name}", { name: title })}
                  onClick={() => begin(section.id, title)}
                >
                  {t("Rename")}
                </button>
                <button
                  type="button"
                  className={groupButtonClass}
                  aria-label={t("Remove {name}", { name: title })}
                  onClick={() => {
                    update({
                      libraryGroupSections: sections.filter((entry) => entry.id !== section.id),
                      libraryGroups: settings.libraryGroups.map((group) =>
                        group.homeSectionId === section.id
                          ? { ...group, homeSectionId: undefined }
                          : group,
                      ),
                    });
                    if (editing === section.id) setEditing(null);
                  }}
                >
                  {t("Remove section")}
                </button>
              </div>
            );
          })}
          <p className="text-xs text-ink-subtle">
            {t(
              "Removing a section moves its groups back to My Groups. Your groups and lists are kept.",
            )}
          </p>
          {editing !== null ? (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const title = name.trim();
                if (!title) return;
                const renamed = { ...settings.homeRows.renamed };
                delete renamed[`library-groups:${editing}`];
                update({
                  libraryGroupSections:
                    editing === ""
                      ? [...sections, { id: randomUuid(), name: title }]
                      : sections.map((section) =>
                          section.id === editing ? { ...section, name: title } : section,
                        ),
                  homeRows: { ...settings.homeRows, renamed },
                });
                setEditing(null);
              }}
            >
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm text-ink-muted">
                {t("Section name")}
                <input
                  className={groupInputClass}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={100}
                  required
                />
              </label>
              <button className={`${groupButtonClass} self-end`} disabled={!name.trim()}>
                {t("Save")}
              </button>
              <button
                type="button"
                className={`${groupButtonClass} self-end`}
                onClick={() => setEditing(null)}
              >
                {t("Cancel")}
              </button>
            </form>
          ) : (
            <button
              type="button"
              className={`${groupButtonClass} self-start`}
              onClick={() => begin("", "")}
            >
              {t("New Home section")}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
