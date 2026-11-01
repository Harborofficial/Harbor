/**
 * Which scrolled element is the page moving, rather than something inside it.
 *
 * The bar recedes for the page alone: the document, <main>, a wrapper that scrolls <main>, or the one
 * container a view hands its scrolling to - Calendar's body is that case, since its <main> clips.
 * Everything else that happens to carry a scrollbar is not the page: a dialog, a menu or a popover is
 * portalled out of <main> altogether, a poster rail or a config pane is a small box beside it, and a
 * pane of text sits under the scroller that already moves the page. Reading the structure instead of
 * a list of views is what keeps this correct for browsing pages that were never named here.
 */

// A container has to hold most of the page to be the page; below this it is a pane within it.
const MIN_PAGE_COVERAGE = 0.6;

function scrollsOwnContent(el: HTMLElement): boolean {
  const overflowY = getComputedStyle(el).overflowY;
  if (overflowY !== "auto" && overflowY !== "scroll") return false;
  return el.scrollHeight > el.clientHeight + 1;
}

/**
 * The vertical offset of a scrolled target, whether it is the viewport or one of the app's many
 * per-view containers.
 */
export function pageScrollTop(target: EventTarget | null): number {
  if (!target || target === (document as unknown as EventTarget)) return window.scrollY;
  return (target as HTMLElement).scrollTop;
}

export function isPageScroller(target: EventTarget | null, page: Element | null): boolean {
  if (!target) return false;
  if (target === (document as unknown as EventTarget)) return true;
  const el = target as HTMLElement;
  if (el === (document.documentElement as unknown as HTMLElement)) return true;
  if (el === (document.body as unknown as HTMLElement)) return true;
  if (!page) return false;
  // The page element itself, or an ancestor that scrolls the whole page.
  if (el === (page as HTMLElement)) return true;
  if (el.contains(page)) return true;
  // Anything portalled out of the page - a dialog, a menu, theme chrome - is not it either.
  if (!page.contains(el)) return false;
  // A scroller under another scroller is a pane the page moves, not the page moving. The walk stops
  // at <main>, which is tested on the way: a view that scrolls <main> keeps its panes out.
  for (let node: HTMLElement | null = el.parentElement; node; node = node.parentElement) {
    if (scrollsOwnContent(node)) return false;
    if (node === (page as HTMLElement)) break;
  }
  // The outermost scroller inside the page is its own only while it covers the page; a rail beside
  // the content scrolls to be read, and reading what is in front of the user is not browsing.
  return (
    el.clientHeight >= (page as HTMLElement).clientHeight * MIN_PAGE_COVERAGE &&
    el.clientWidth >= (page as HTMLElement).clientWidth * MIN_PAGE_COVERAGE
  );
}
