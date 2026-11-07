import { findAction, type ContextAction } from "./context-actions";
import type { ContextMenuTarget } from "./context-menu";
import { isBackgroundMenuTarget } from "./context-page-background";

export function omitContextActions(
  actions: ContextAction[],
  moved: ReadonlySet<string>,
): ContextAction[] {
  return actions.flatMap((action) => {
    if (moved.has(action.id)) return [];
    if (!action.children) return [action];
    const children = omitContextActions(action.children, moved);
    return children.length ? [{ ...action, children }] : [];
  });
}

export function partitionContextActions(
  entity: ContextAction[],
  content: ContextAction[],
  navigation: ContextAction[],
  target?: ContextMenuTarget,
): { quick: ContextAction[]; entity: ContextAction[]; content: ContextAction[] } {
  const quick = (
    isBackgroundMenuTarget(target)
      ? [findAction(navigation, "page:back"), findAction(navigation, "page:go:settings")]
      : []
  ).filter((action): action is ContextAction => !!action);
  // Page commands are exclusively rendered in the background strip/footer.
  // Item copy commands remain in their original command list.
  const moved = new Set(
    entity.filter((action) => action.id.startsWith("page:")).map((action) => action.id),
  );
  return {
    quick,
    entity: omitContextActions(entity, moved),
    content,
  };
}

/** Root-only navigation; never insert these commands into content or membership children. */
export function contextNavigationFooter(
  navigation: ContextAction[],
  quick: ContextAction[],
): ContextAction[] {
  return omitContextActions(
    [
      findAction(navigation, "page:my-profile"),
      findAction(navigation, "page:go-to"),
      findAction(navigation, "page:refresh"),
    ].filter((action): action is ContextAction => !!action),
    new Set(quick.map((action) => action.id)),
  );
}
