const INTERACTIVE_TARGET =
  'button, a[href], input, textarea, select, summary, [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="checkbox"], [role="radio"], [role="tab"], [role="switch"], [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"]), audio[controls], video[controls]';

export function shouldIgnoreSourceDrawerKey(
  target: EventTarget | null,
  picker: HTMLElement,
): boolean {
  const element = target as Element | null;
  if (element && typeof element.closest === "function" && element.closest(INTERACTIVE_TARGET)) {
    return true;
  }
  if (
    element &&
    typeof element.closest === "function" &&
    element.closest('[aria-modal="true"], [role="dialog"]')
  ) {
    return true;
  }
  if (
    element &&
    element !== picker.ownerDocument.body &&
    !picker.contains(element)
  ) {
    return true;
  }
  const activeModal = picker.ownerDocument.querySelector<HTMLElement>('[aria-modal="true"]');
  return activeModal !== null && !picker.contains(activeModal);
}
