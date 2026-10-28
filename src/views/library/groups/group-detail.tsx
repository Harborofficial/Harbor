import { useState } from "react";
import { HarborMark } from "@/components/icons/harbor-mark";
import { useT } from "@/lib/i18n";
import { randomUuid } from "@/lib/uuid";
import { moveGroupItem, parseGroupListUrl, type LibraryGroup } from "@/lib/library-groups";
import { GroupEditor, groupButtonClass, groupInputClass } from "./group-editor";
import { GroupListRow } from "./group-list-row";

export function GroupDetail({
  group,
  onSave,
  onBack,
  onDelete,
}: {
  group: LibraryGroup;
  onSave: (group: LibraryGroup) => void;
  onBack: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editList, setEditList] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  if (editing)
    return (
      <GroupEditor
        group={group}
        onCancel={() => setEditing(false)}
        onSave={(nextName, image) => {
          onSave({ ...group, name: nextName, image });
          setEditing(false);
        }}
      />
    );
  return (
    <section className="flex flex-col gap-6">
      <button type="button" className={`${groupButtonClass} self-start`} onClick={onBack}>
        {t("Back to My Groups")}
      </button>
      <header className="flex flex-wrap items-center gap-4">
        {group.image ? (
          <img
            src={group.image}
            alt=""
            className="h-20 w-32 rounded-xl bg-elevated object-contain"
          />
        ) : (
          <HarborMark className="h-20 w-32 shrink-0 text-ink" />
        )}
        <h2 className="min-w-0 flex-1 break-words text-3xl font-semibold text-ink">{group.name}</h2>
        <button type="button" className={groupButtonClass} onClick={() => setEditing(true)}>
          {t("Edit group")}
        </button>
        <button
          type="button"
          aria-pressed={group.pinnedToHome === true}
          className={groupButtonClass}
          onClick={() => onSave({ ...group, pinnedToHome: !group.pinnedToHome })}
        >
          {group.pinnedToHome ? t("Remove from Home") : t("Add to Home")}
        </button>
        <button
          type="button"
          className={groupButtonClass}
          onClick={() => setRefresh((value) => value + 1)}
        >
          {t("Refresh")}
        </button>
        <button
          type="button"
          className={groupButtonClass}
          onClick={() => {
            setAdding(true);
            setEditList(null);
            setName("");
            setUrl("");
            setError("");
          }}
        >
          {t("Add list")}
        </button>
        <button type="button" className={groupButtonClass} onClick={() => setDeleting(true)}>
          {t("Delete group")}
        </button>
      </header>
      {deleting && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-edge p-4">
          <p className="text-sm text-ink-muted">
            {t("Delete this group? The original lists on MDBList and Trakt will not be changed.")}
          </p>
          <button type="button" className={groupButtonClass} onClick={onDelete}>
            {t("Delete")}
          </button>
          <button type="button" className={groupButtonClass} onClick={() => setDeleting(false)}>
            {t("Cancel")}
          </button>
        </div>
      )}
      {adding && (
        <form
          className="flex max-w-xl flex-col gap-3 rounded-xl border border-edge p-4"
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = parseGroupListUrl(url);
            if (!parsed) {
              setError(t("Enter an MDBList or Trakt list URL."));
              return;
            }
            if (group.lists.some((list) => list.id !== editList && list.url === parsed.url)) {
              setError(t("This list is already in this group."));
              return;
            }
            const entry = {
              id: editList ?? randomUuid(),
              name: name.trim() || parsed.path.split("/").at(-1)!,
              url: parsed.url,
            };
            onSave({
              ...group,
              lists: editList
                ? group.lists.map((list) => (list.id === editList ? entry : list))
                : [...group.lists, entry],
            });
            setAdding(false);
          }}
        >
          <label className="flex flex-col gap-1 text-sm text-ink-muted">
            {t("MDBList or Trakt list URL")}
            <input
              className={groupInputClass}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              type="url"
              required
              placeholder="https://mdblist.com/lists/…"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink-muted">
            {t("Display name")}
            <input
              className={groupInputClass}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button className={groupButtonClass}>{t("Save")}</button>
            <button type="button" className={groupButtonClass} onClick={() => setAdding(false)}>
              {t("Cancel")}
            </button>
          </div>
        </form>
      )}
      {group.lists.length === 0 && (
        <p className="text-ink-muted">
          {t("Add an MDBList or Trakt list to start filling this group.")}
        </p>
      )}
      {group.lists
        .filter((list) => !expanded || list.id === expanded)
        .map((list) => {
          const index = group.lists.indexOf(list);
          return (
            <div key={list.id} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-ink-subtle">
                  {parseGroupListUrl(list.url)?.source === "trakt" ? "Trakt" : "MDBList"}
                </span>
                <button
                  type="button"
                  className={groupButtonClass}
                  onClick={() => {
                    setAdding(true);
                    setEditList(list.id);
                    setUrl(list.url);
                    setName(list.name);
                    setError("");
                  }}
                >
                  {t("Edit list")}
                </button>
                <button
                  type="button"
                  className={groupButtonClass}
                  disabled={index === 0}
                  aria-label={t("Move {name} up", { name: list.name })}
                  onClick={() =>
                    onSave({ ...group, lists: moveGroupItem(group.lists, list.id, -1) })
                  }
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={groupButtonClass}
                  disabled={index === group.lists.length - 1}
                  aria-label={t("Move {name} down", { name: list.name })}
                  onClick={() =>
                    onSave({ ...group, lists: moveGroupItem(group.lists, list.id, 1) })
                  }
                >
                  ↓
                </button>
                <button
                  type="button"
                  className={groupButtonClass}
                  onClick={() => {
                    onSave({
                      ...group,
                      lists: group.lists.filter((entry) => entry.id !== list.id),
                    });
                    if (expanded === list.id) setExpanded(null);
                  }}
                >
                  {t("Remove list")}
                </button>
              </div>
              <GroupListRow
                list={list}
                refresh={refresh}
                expanded={expanded === list.id}
                onExpand={() => setExpanded(list.id)}
                onBack={() => setExpanded(null)}
              />
            </div>
          );
        })}
    </section>
  );
}
