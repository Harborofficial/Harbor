import { HarborMark } from "@/components/icons/harbor-mark";
import { Row } from "@/components/row";
import { useT } from "@/lib/i18n";
import type { LibraryGroup } from "@/lib/library-groups";
import { useView } from "@/lib/view";

export function HomeGroups({ title, groups }: { title?: string; groups: LibraryGroup[] }) {
  const t = useT();
  const { setView } = useView();
  if (!groups.length) return null;
  return (
    <Row title={title ?? t("My Groups")} min={220} shape="tile">
      {groups.map((group) => (
        <button
          key={group.id}
          type="button"
          aria-label={group.name}
          onClick={() => {
            sessionStorage.setItem("harbor.library.open-group", group.id);
            localStorage.setItem("harbor.library.tab", "groups");
            window.dispatchEvent(new Event("harbor:open-library-group"));
            setView("library");
          }}
          className="flex w-full flex-col gap-2 text-start"
        >
          <span className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl border border-edge bg-elevated">
            {group.image ? (
              <img src={group.image} alt="" className="h-full w-full object-cover" />
            ) : (
              <HarborMark className="h-20 w-20 text-ink" />
            )}
          </span>
          {!group.hideHomeTitle && (
            <span className="truncate text-[14px] font-semibold text-ink">{group.name}</span>
          )}
        </button>
      ))}
    </Row>
  );
}
