const OWNED_CONTENT = [
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "option",
  "iframe",
  "img",
  "picture",
  "svg",
  "canvas",
  "video",
  "audio",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='dialog']",
  "[role='button']",
  "[role='menu']",
  "[role='textbox']",
  "[data-harbor-context-layer]",
  "[data-harbor-player]",
  "[data-harbor-image-viewer]",
  "[data-title-backdrop]",
  "[data-ebook-page]",
  "[data-bp-root]",
  "[data-bp-focusable]",
  "[data-context-page-exclude]",
].join(",");

/** Mark real layout surfaces explicitly; a blank descendant of a card is not
 * page space merely because an ancestor happens to be a main/drag region. */
export function isPageContextBackground(target: Element | null): boolean {
  return (
    !!target &&
    !target.closest(OWNED_CONTENT) &&
    target.matches(
      "main,[data-context-page-background],[data-tauri-drag-region]:not([data-tauri-drag-region='false'])",
    )
  );
}

/** A generic action target is not page space. Only the trusted page binding can
 * opt in, and content under the pointer always keeps its own context. */
export function isBackgroundMenuTarget(
  target:
    | {
        kind: string;
        scope?: "page-background";
        navigation?: boolean;
        image?: unknown;
        link?: string;
        selection?: string;
      }
    | null
    | undefined,
): boolean {
  return (
    !!target &&
    target.kind === "actions" &&
    target.scope === "page-background" &&
    target.navigation !== false &&
    !target.image &&
    !target.link &&
    !target.selection
  );
}
