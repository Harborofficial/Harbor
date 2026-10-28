import { usePageVisible } from "@/lib/visibility";
import { HarborSocialArt } from "./harbor-social-art";
import "./harbor-social-cover.css";

export function HarborSocialCover({ active = true }: { active?: boolean }) {
  const visible = usePageVisible();
  return (
    <div
      className="harbor-social-cover mx-6 mt-4 aspect-[1005/405] shrink-0 overflow-hidden rounded-xl border border-edge-soft bg-canvas"
      aria-hidden="true"
      data-active={active}
      data-paused={!visible}
    >
      <HarborSocialArt />
    </div>
  );
}
