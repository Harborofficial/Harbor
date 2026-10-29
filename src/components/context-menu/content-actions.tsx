import { Copy, ExternalLink, Link2 } from "lucide-react";
import type { ContentContext } from "@/lib/context-content";
import type { ContextAction } from "@/lib/context-actions";
import { publicContextImageUrl } from "@/lib/context-image-policy";
import { copyText } from "@/components/player/copy-link-button";
import { parseExternalLink } from "@/lib/social/external-link-policy";
import { openLinkOut } from "@/lib/social/link-out";
import { t } from "@/lib/i18n";

export async function copyContextText(text: string): Promise<void> {
  if (!(await copyText(text))) throw new Error(t("Could not copy to the clipboard."));
}

export function contentActions(content: ContentContext): ContextAction[] {
  const actions: ContextAction[] = [];
  if (content.selection)
    actions.push({
      id: "selection:copy",
      label: t("Copy selected text"),
      icon: <Copy size={14} />,
      run: () => copyContextText(content.selection!),
      group: "selection",
    });
  const parsed = content.link && parseExternalLink(content.link);
  const linkIsImage =
    parsed &&
    parsed.ok &&
    content.image &&
    [content.image.src, content.image.originalSrc, content.image.publicUrl].some((src) => {
      if (!src) return false;
      const imageLink = parseExternalLink(src);
      return imageLink.ok && imageLink.link.href === parsed.link.href;
    });
  if (parsed && parsed.ok && !linkIsImage) {
    actions.push({
      id: "link:open",
      label: t("Open link"),
      icon: <ExternalLink size={14} />,
      run: () => openLinkOut(content.link!),
      restoreFocus: false,
      group: "link",
    });
    const shareable = publicContextImageUrl({ src: content.link!, publicUrl: content.link! });
    if (shareable)
      actions.push({
        id: "link:copy",
        label: t("Copy link"),
        icon: <Link2 size={14} />,
        run: () => copyContextText(shareable),
        group: "link",
      });
  }
  return actions;
}
