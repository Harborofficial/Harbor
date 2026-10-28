import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { HarborMark } from "@/components/icons/harbor-mark";
import { useSettings } from "@/lib/settings";
import { useT } from "@/lib/i18n";
import { randomUuid } from "@/lib/uuid";
import { moveGroupItem, type LibraryGroup } from "@/lib/library-groups";
import { GroupEditor, groupButtonClass } from "./groups/group-editor";
import { GroupDetail } from "./groups/group-detail";

export function MyGroupsTab() {
  const t = useT();
  const { settings, update } = useSettings();
  const groups = settings.libraryGroups;
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const selectRequested = () => {
      const id = sessionStorage.getItem("harbor.library.open-group");
      if (!id) return;
      sessionStorage.removeItem("harbor.library.open-group");
      setSelected(id);
    };
    selectRequested();
    window.addEventListener("harbor:open-library-group", selectRequested);
    return () => window.removeEventListener("harbor:open-library-group", selectRequested);
  }, []);
  const group = groups.find((entry) => entry.id === selected);
  const save = (next: LibraryGroup) =>
    update({ libraryGroups: groups.map((entry) => (entry.id === next.id ? next : entry)) });
  if (group)
    return (
      <GroupDetail
        key={group.id}
        group={group}
        onSave={save}
        onBack={() => setSelected(null)}
        onDelete={() => {
          update({ libraryGroups: groups.filter((entry) => entry.id !== group.id) });
          setSelected(null);
        }}
      />
    );
  return (
    <section className="flex flex-col gap-6">
      {creating && (
        <GroupEditor
          onCancel={() => setCreating(false)}
          onSave={(name, image) => {
            const id = randomUuid();
            update({ libraryGroups: [...groups, { id, name, image, lists: [] }] });
            setCreating(false);
            setSelected(id);
          }}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold text-ink">{t("My Groups")}</h2>
        <button
          type="button"
          className={`${groupButtonClass} flex items-center gap-2`}
          onClick={() => setCreating(true)}
        >
          <Plus size={16} />
          {t("New group")}
        </button>
      </div>
      {groups.length === 0 && (
        <p className="text-ink-muted">
          {t("Create a group, choose its artwork, and organize MDBList and Trakt lists inside it.")}
        </p>
      )}
      <div
        className="grid gap-5"
        style={{ gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))" }}
      >
        {groups.map((entry, index) => (
          <div
            key={entry.id}
            className="overflow-hidden rounded-2xl border border-edge bg-elevated"
          >
            <button
              type="button"
              onClick={() => setSelected(entry.id)}
              className="flex w-full flex-col text-start"
            >
              <span className="flex aspect-video w-full items-center justify-center bg-canvas p-4">
                {entry.image ? (
                  <img src={entry.image} alt="" className="h-full w-full object-contain" />
                ) : (
                  <HarborMark className="h-20 w-20 text-ink" />
                )}
              </span>
              <span className="w-full truncate px-4 pt-3 text-lg font-semibold text-ink">
                {entry.name}
              </span>
              <span className="px-4 pb-3 text-sm text-ink-subtle">
                {t("{n} lists", { n: entry.lists.length })}
              </span>
            </button>
            <div className="flex gap-2 px-4 pb-3">
              <button
                type="button"
                className={groupButtonClass}
                disabled={index === 0}
                aria-label={t("Move {name} up", { name: entry.name })}
                onClick={() => update({ libraryGroups: moveGroupItem(groups, entry.id, -1) })}
              >
                ↑
              </button>
              <button
                type="button"
                className={groupButtonClass}
                disabled={index === groups.length - 1}
                aria-label={t("Move {name} down", { name: entry.name })}
                onClick={() => update({ libraryGroups: moveGroupItem(groups, entry.id, 1) })}
              >
                ↓
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
