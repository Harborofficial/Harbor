import { useCallback } from "react";
import { getQueueStartItem } from "@/lib/queue";
import { useSettings } from "@/lib/settings";
import { usePlayerNavigation } from "@/lib/view";

type StartQueueOptions = {
  resume?: boolean;
};

export function useStartQueue() {
  const { settings, update } = useSettings();
  const { openPicker } = usePlayerNavigation();

  return useCallback(
    ({ resume = false }: StartQueueOptions = {}) => {
      const item = getQueueStartItem(resume);
      if (!item) return false;

      update({ queueDrivesNav: true });
      openPicker(item.meta, item.episode, {
        queueItemId: item.id,
        autoPlay: settings.instantPlay,
        resume: true,
      });
      return true;
    },
    [update, openPicker, settings.instantPlay],
  );
}
