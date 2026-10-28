import { useView } from "@/lib/view";

export function useQueueSurface(): boolean {
  const { topKind, meta, metaLiveContext } = useView();

  switch (topKind) {
    case "home":
    case "movies":
    case "shows":
    case "anime":
    case "discover":
    case "catalogs":
      return true;

    case "meta":
      return !metaLiveContext && (meta?.type === "series" || meta?.type === "anime");

    case "episode-detail":
      return true;

    default:
      return false;
  }
}
