import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { TrayMenu } from "./tray/tray-menu";
import { fadeTrayMenu, presentTrayMenu, prefersReducedMotion } from "./tray/tray-motion";
import { newerSnapshot, type TrayAction, type TraySnapshot } from "./tray/types";
import "./tray/tray-menu.css";

function TrayRoot() {
  const [snapshot, setSnapshot] = useState<TraySnapshot | null>(null);
  const presented = useRef(0);
  const motion = useRef<HTMLDivElement>(null);
  const openId = snapshot?.openId ?? 0;
  const open = snapshot?.open ?? false;
  const closing = snapshot?.closing ?? false;
  const hasDisplay = !!snapshot?.display;
  const accept = useCallback((incoming: TraySnapshot) => {
    setSnapshot((current) => newerSnapshot(current, incoming));
  }, []);

  useEffect(() => {
    let live = true;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const stop = await listen<TraySnapshot>("harbor://tray-menu-state", (event) => {
        if (live) accept(event.payload);
      });
      if (!live) {
        stop();
        return;
      }
      unlisten = stop;
      const initial = await invoke<TraySnapshot>("tray_popup_snapshot");
      if (live) accept(initial);
    })().catch((error) => console.error("[harbor::tray] initialization failed", error));
    return () => {
      live = false;
      unlisten?.();
    };
  }, [accept]);

  useLayoutEffect(() => {
    if (!snapshot?.display) return;
    const { display } = snapshot;
    const element = document.documentElement;
    for (const [key, value] of Object.entries(display.tokens))
      element.style.setProperty(key, value);
    element.dir = display.direction;
    element.style.colorScheme = display.colorScheme;
  }, [snapshot]);

  useLayoutEffect(() => {
    const element = motion.current;
    if (!element || !hasDisplay) return;
    const reducedMotion = () => prefersReducedMotion();
    if (open) {
      if (presented.current === openId) return;
      presented.current = openId;
      // Commit the themed panel before native code reveals the transparent window.
      element.getBoundingClientRect();
      const presentation = presentTrayMenu(
        element,
        () => invoke("tray_popup_present", { openId }),
        reducedMotion,
      );
      void presentation.ready.catch((error) => {
        console.error("[harbor::tray] presentation failed", error);
      });
      return presentation.cancel;
    }
    if (closing) {
      return fadeTrayMenu(element, 0, reducedMotion(), () => {
        void invoke<TraySnapshot>("tray_popup_dismiss", { completedOpenId: openId })
          .then(accept)
          .catch((error) => console.error("[harbor::tray] dismissal failed", error));
      });
    }
  }, [openId, open, closing, hasDisplay, accept]);

  const action = useCallback(
    async (value: TrayAction) => {
      accept(await invoke<TraySnapshot>("tray_popup_action", { action: value }));
    },
    [accept],
  );
  const dismiss = useCallback(() => {
    void invoke<TraySnapshot>("tray_popup_dismiss")
      .then(accept)
      .catch((error) => console.error("[harbor::tray] dismissal failed", error));
  }, [accept]);
  const submenu = useCallback(async (open: boolean) => {
    await invoke("tray_popup_submenu", { open });
  }, []);

  return snapshot && (open || closing) && snapshot.display ? (
    <div
      key={snapshot.openId}
      ref={motion}
      className="tray-motion"
      inert={closing}
      aria-hidden={closing || undefined}
    >
      <TrayMenu
        snapshot={snapshot}
        onAction={action}
        onDismiss={dismiss}
        onSubmenuChange={submenu}
      />
    </div>
  ) : null;
}

createRoot(document.getElementById("root")!).render(<TrayRoot />);
