import { useReaderBackground as useImageReaderBackground } from "@/components/reader-background/use-reader-background";

const OPTIONS = {
  imageKey: "harbor.ebook.reader.background.v1",
  transformKey: "harbor.ebook.reader.background.transform.v1",
  idPrefix: "ebook",
};

export function useReaderBackground() {
  return useImageReaderBackground(OPTIONS);
}
