import { HOTKEYS, effectiveBinding, type HotkeyId } from "@/lib/hotkeys";

export type PlayerShortcutGroup = {
  name: string;
  items: { id: HotkeyId; label: string; binding: string }[];
};

/** Player shortcuts in their declared order, grouped, with the user's own bindings applied. */
export function playerShortcutGroups(overrides: Record<string, string>): PlayerShortcutGroup[] {
  const groups = new Map<string, PlayerShortcutGroup>();
  for (const def of HOTKEYS) {
    if (def.scope !== "Player") continue;
    const name = def.group ?? "Other";
    let group = groups.get(name);
    if (!group) {
      group = { name, items: [] };
      groups.set(name, group);
    }
    group.items.push({
      id: def.id,
      label: def.label,
      binding: effectiveBinding(def.id, overrides),
    });
  }
  return [...groups.values()];
}
