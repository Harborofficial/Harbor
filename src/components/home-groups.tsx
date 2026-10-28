import { HarborMark } from "@/components/icons/harbor-mark";
import { Row } from "@/components/row";
import { useT } from "@/lib/i18n";
import { useSettings } from "@/lib/settings";
import { useView } from "@/lib/view";

export function HomeGroups({ title }: { title?: string }) {
  const t = useT();
  const { settings } = useSettings();
  const { setView } = useView();
  const groups = settings.libraryGroups.filter((group) => group.pinnedToHome);
  if (!groups.length) return null;
  return (
    <Row title={title ?? t("My Groups")} min={220} shape="tile">
      {groups.map((group) => (
        <button
          key={group.id}
          type="button"
          onClick={() => {
            sessionStorage.setItem("harbor.library.open-group", group.id);
            localStorage.setItem("harbor.library.tab", "groups");
            window.dispatchEvent(new Event("harbor:open-library-group"));
            setView("library");
          }}
          className="flex w-full flex-col gap-2 text-start"
        >
          <span className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl border border-edge bg-elevated p-4">
            {group.image ? (
              <img src={group.image} alt="" className="h-full w-full object-contain" />
            ) : (
              <HarborMark className="h-20 w-20 text-ink" />
            )}
          </span>
          <span className="truncate text-[14px] font-semibold text-ink">{group.name}</span>
        </button>
      ))}
    </Row>
  );
}
