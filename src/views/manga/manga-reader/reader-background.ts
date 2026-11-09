import { useReaderBackground as useImageReaderBackground } from "@/components/reader-background/use-reader-background";

const OPTIONS = {
  imageKey: "harbor.manga.reader.background.v1",
  transformKey: "harbor.manga.reader.background.transform.v1",
  idPrefix: "manga",
};

export function useMangaReaderBackground() {
  return useImageReaderBackground(OPTIONS);
}
