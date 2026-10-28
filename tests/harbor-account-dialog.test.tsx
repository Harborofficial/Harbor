import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import * as icons from "lucide-react";
import * as geometry from "../src/lib/keyboard-navigation/geometry.ts";
import * as backdropExpansion from "../src/lib/poster-backdrop-expansion.ts";

function load(file: string, dependencies: Record<string, any>) {
  const output = ts.transpileModule(
    readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const exports: any = {};
  new Function("require", "exports", output)((name: string) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}

async function fixture(
  failure = false,
  fromMenu = false,
  deferred = false,
  configureDom?: (dom: JSDOM) => void,
) {
  const dom = new JSDOM("<button id='opener'>Account</button><div id='root'></div>", {
    url: "https://fixture.invalid",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  window.matchMedia = (() => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  })) as any;
  configureDom?.(dom);
  localStorage.setItem(
    "harbor.profiles.v1",
    JSON.stringify({ profiles: [{ id: "local", isPrimary: true }], activeId: "local" }),
  );
  localStorage.setItem("harbor.theme-session.repaired.v2", "1");
  const requests: { path: string; body: any }[] = [];
  let releaseRequest: (() => void) | undefined;
  const dependencies: Record<string, any> = {
    react: React,
    "react-dom": ReactDOM,
    "react/jsx-runtime": jsxRuntime,
    "lucide-react": icons,
    "@/views/settings/icons": icons,
    "../../../icons": icons,
    "@/lib/keyboard-navigation/geometry": geometry,
    "@/lib/i18n": {
      useT: () => (key: string, values?: Record<string, unknown>) =>
        key.replace(/\{(\w+)\}/g, (_, name) => String(values?.[name] ?? name)),
    },
    "@/lib/config/endpoints": { HARBOR_API_BASE: "https://fixture.invalid" },
    "@/lib/safe-fetch": {
      safeFetch: async (path: string, init: RequestInit) => {
        requests.push({ path, body: JSON.parse(String(init.body)) });
        if (deferred)
          await new Promise<void>((resolve) => {
            releaseRequest = resolve;
          });
        return new Response(
          JSON.stringify(
            failure
              ? { code: "bad_credentials", error: "bad_credentials" }
              : {
                  token: "fixture-token",
                  refresh: "fixture-refresh",
                  user: { id: "captain", username: "captain" },
                  recoveryCode: "ABCDE-FGHIJ-KLMNO-PQRST",
                },
          ),
          { status: failure ? 401 : 200, headers: { "Content-Type": "application/json" } },
        );
      },
    },
    "./harbor-social-cover.css": {},
  };
  const add = (name: string, file: string) => (dependencies[name] = load(file, dependencies));
  // The Settings layout has application-only provider dependencies. Keep its
  // actual Section/kit exports, and fail if this popup invokes those providers.
  const unused = () => {
    throw new Error("Unexpected Settings provider use");
  };
  Object.assign(dependencies, {
    "./icons": icons,
    "@/lib/knob-anim": { useKnobAnim: unused },
    "@/lib/hotkeys": { shouldHandleGlobalKeyboardEvent: unused },
    "@/lib/sfx": { SFX: { navigate: unused } },
    "@/lib/modal-overlay": { isModalOverlayOpen: unused, modalOverlayClose: unused },
    "@/lib/poster-backdrop-expansion": backdropExpansion,
    "./keyboard-navigation/geometry": geometry,
    "@/lib/window": { openUrl: unused },
    "./setting-preview": { HoverPreviewCard: unused },
    "./new-badge": { NewBadge: unused },
    "@/components/ui-icon": { UiIcon: unused },
    "@/components/hover-tooltip": { HoverTooltip: unused },
  });
  dependencies["@/lib/i18n"].sourceTranslationKey = (key: string) => key;
  add("@/lib/keyboard-navigation", "lib/keyboard-navigation.ts");
  const shared = add("@/views/settings/shared", "views/settings/shared.tsx");
  dependencies["./shared"] = dependencies["../../../shared"] = shared;
  add("@/components/modal-shell", "components/modal-shell.tsx");
  dependencies["../../../kit"] = add("@/views/settings/kit", "views/settings/kit.tsx");
  const auth = add("@/lib/theme-auth", "lib/theme-auth.ts");
  add("./authenticated-fetch", "lib/account/authenticated-fetch.ts");
  add("./client", "lib/account/client.ts");
  add("@/lib/account/identity", "lib/account/identity.ts");
  add("@/lib/account/error-messages", "lib/account/error-messages.ts");
  add("@/components/icons/harbor-mark", "components/icons/harbor-mark.tsx");
  add("@/lib/visibility", "lib/visibility.ts");
  add("./harbor-social-art", "views/account/harbor-social-art.tsx");
  add("./harbor-social-cover", "views/account/harbor-social-cover.tsx");
  add("./fields", "views/account/fields.tsx");
  add("./recovery-key-input", "views/account/recovery-key-input.tsx");
  add("./account-recover-form", "views/account/account-recover-form.tsx");
  add("./account-value-props", "views/account/account-value-props.tsx");
  add("./account-auth-form", "views/account/account-auth-form.tsx");
  add(
    "@/views/settings/theme-panel/custom-themes-section/author-account-panel/recovery-reveal",
    "views/settings/theme-panel/custom-themes-section/author-account-panel/recovery-reveal.tsx",
  );
  const { HarborAccountDialog } = load("views/account/harbor-account-dialog.tsx", dependencies);
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  const opener = document.getElementById("opener")!;
  opener.focus();
  let closes = 0;
  function Host() {
    const [open, setOpen] = React.useState(!fromMenu);
    const [, refresh] = React.useState(0);
    React.useEffect(() => auth.subscribeAuthor(() => refresh((n: number) => n + 1)), []);
    return open
      ? React.createElement(HarborAccountDialog, {
          returnFocus: fromMenu ? opener : undefined,
          onClose: () => {
            closes++;
            setOpen(false);
          },
        })
      : fromMenu && !closes
        ? React.createElement("button", { onClick: () => setOpen(true) }, "Sign in to Harbor")
        : null;
  }
  await React.act(() => root.render(React.createElement(Host)));
  if (fromMenu) {
    await React.act(() => {
      const entry = document.querySelector<HTMLButtonElement>("#root button")!;
      entry.focus();
      entry.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
  }
  const button = (text: string) => {
    const found = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (el) => el.textContent?.trim() === text || el.getAttribute("aria-label") === text,
    );
    assert.ok(found, `Button ${text} exists`);
    return found;
  };
  const click = (el: Element) =>
    React.act(() => el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  const input = async (label: string, value: string) => {
    const field = Array.from(document.querySelectorAll<HTMLLabelElement>("label")).find(
      (el) => el.textContent === label,
    );
    const el = field
      ? (document.getElementById(field.htmlFor) as HTMLInputElement)
      : document.querySelector<HTMLInputElement>(`input[aria-label='${label}']`);
    assert.ok(el, `Field ${label} exists`);
    await React.act(() => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(
        el,
        value,
      );
      el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
  };
  const settle = () => React.act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  return {
    dom,
    auth,
    opener,
    requests,
    button,
    click,
    input,
    settle,
    closes: () => closes,
    releaseRequest: () => releaseRequest?.(),
    close: async () => {
      await React.act(() => root.unmount());
      dom.window.close();
    },
  };
}

test("Harbor dialog defaults to sign in, labels the dialog and closes after real login", async () => {
  const f = await fixture();
  try {
    const dialog = document.querySelector("[role='dialog']")!;
    assert.ok(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent);
    assert.equal(f.button("Sign in").getAttribute("aria-pressed"), "true");
    assert.equal(document.querySelectorAll("[role='dialog']").length, 1);
    const cover = dialog.querySelector(".harbor-social-cover svg");
    assert.ok(cover);
    await f.input("Username", "captain");
    await f.input("Password", "password123");
    assert.ok(dialog.querySelector(".harbor-social-cover svg") === cover);
    await f.click(document.querySelector("button[type='submit']")!);
    await f.settle();
    assert.equal(f.auth.currentAuthor()?.username, "captain");
    assert.ok(f.requests[0].path.endsWith("/identity/api/login"));
    assert.equal(f.closes(), 1);
    assert.equal(document.querySelector("[role='dialog']"), null);
    assert.equal(document.activeElement, f.opener);
  } finally {
    await f.close();
  }
});

for (const mode of ["register", "recover"]) {
  test(`${mode} preserves the recovery code after the real author subscription fires`, async () => {
    const f = await fixture();
    try {
      await f.click(f.button(mode === "register" ? "Create account" : "Forgot password?"));
      await f.input("Username", "captain");
      await f.input(mode === "register" ? "Password" : "New password", "password123");
      if (mode === "recover") {
        for (let i = 1; i <= 4; i++) await f.input(`Recovery key block ${i} of 4`, "ABCDE");
      }
      await f.click(f.button(mode === "register" ? "Create my account" : "Reset password"));
      await f.settle();
      assert.ok(f.requests[0].path.endsWith(`/identity/api/${mode}`));
      assert.equal(f.auth.currentAuthor()?.username, "captain");
      assert.equal(f.closes(), 0);
      assert.ok(document.body.textContent?.includes("ABCDE-FGHIJ-KLMNO-PQRST"));
      assert.equal(f.button("Continue").disabled, true);
      await React.act(() =>
        window.dispatchEvent(
          new f.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        ),
      );
      await f.settle();
      assert.equal(f.closes(), 0, "Escape must not discard the one-time code");
      await f.click(f.button("I've saved my recovery code somewhere safe."));
      await f.click(f.button("Continue"));
      await f.settle();
      await f.settle();
      assert.equal(f.closes(), 1);
    } finally {
      await f.close();
    }
  });
}

for (const useObserver of [true, false]) {
  test(`the active mode thumb follows live layout resizing (${useObserver ? "observer" : "window fallback"})`, async () => {
    let width = 220;
    let notifyResize: (() => void) | undefined;
    let observed: Element | undefined;
    let disconnected = false;
    const animations: KeyframeAnimationOptions[] = [];
    const previousObserver = globalThis.ResizeObserver;
    const f = await fixture(false, false, false, (dom) => {
      window.matchMedia = (() => ({ matches: false })) as any;
      globalThis.ResizeObserver = (
        useObserver
          ? class {
              constructor(callback: () => void) {
                notifyResize = callback;
              }
              observe(target: Element) {
                observed = target;
              }
              disconnect() {
                disconnected = true;
              }
            }
          : undefined
      ) as any;
      Object.defineProperties(dom.window.HTMLElement.prototype, {
        offsetLeft: {
          configurable: true,
          get() {
            return this.textContent?.trim() === "Create account" ? width + 4 : 4;
          },
        },
        offsetTop: { configurable: true, get: () => 4 },
        offsetWidth: { configurable: true, get: () => width },
        offsetHeight: { configurable: true, get: () => 44 },
      });
      dom.window.HTMLElement.prototype.animate = ((
        _frames: Keyframe[],
        options: KeyframeAnimationOptions,
      ) => {
        animations.push(options);
        return {} as Animation;
      }) as any;
    });
    try {
      const control = f.button("Sign in").parentElement!;
      const thumb = control.querySelector<HTMLElement>("span[aria-hidden]")!;
      assert.equal(thumb.style.width, "220px");
      await f.click(f.button("Create account"));
      assert.equal(thumb.style.left, "224px");
      assert.equal(animations.length, 1);
      assert.equal(animations[0].duration, 440);
      width = 136;
      await React.act(() => {
        if (useObserver) notifyResize?.();
        else window.dispatchEvent(new f.dom.window.Event("resize"));
      });
      assert.equal(
        thumb.style.width,
        "136px",
        "the indicator uses the resized active button width",
      );
      assert.equal(
        thumb.style.left,
        "140px",
        "the indicator follows the resized active button position",
      );
      assert.equal(animations.length, 1, "layout resizing must not replay the mode animation");
      if (useObserver) assert.equal(observed, control);
    } finally {
      disconnected = false;
      await f.close();
      globalThis.ResizeObserver = previousObserver;
    }
    if (useObserver) assert.equal(disconnected, true);
  });
}

test("login failures remain visible without closing the dialog", async () => {
  const f = await fixture(true);
  try {
    await f.input("Username", "captain");
    await f.input("Password", "password123");
    await f.click(document.querySelector("button[type='submit']")!);
    assert.match(document.querySelector("[role='alert']")!.textContent!, /don't match/);
    assert.equal(f.closes(), 0);
    assert.equal(f.button("Close").disabled, false);
    assert.equal(
      document.querySelector<HTMLButtonElement>("button[type='submit']")!.disabled,
      false,
    );
  } finally {
    await f.close();
  }
});

for (const method of ["Escape", "backdrop", "Close"]) {
  test(`${method} dismisses and restores focus`, async () => {
    const f = await fixture();
    try {
      const dialog = document.querySelector("[role='dialog']")!;
      assert.ok(dialog.contains(document.activeElement), "focus starts within the dialog");
      assert.notEqual(
        document.activeElement?.tagName,
        "INPUT",
        "opening does not activate input editing",
      );
      if (method === "Escape")
        await React.act(() =>
          window.dispatchEvent(
            new f.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
          ),
        );
      else if (method === "Close") await f.click(f.button("Close"));
      else
        await React.act(() =>
          dialog.parentElement!.dispatchEvent(
            new f.dom.window.MouseEvent("mousedown", { bubbles: true }),
          ),
        );
      await f.settle();
      assert.equal(f.closes(), 1);
      assert.equal(document.activeElement, f.opener);
    } finally {
      await f.close();
    }
  });
}

test("Tab and outside focus stay within the active Harbor dialog", async () => {
  const f = await fixture();
  try {
    const dialog = document.querySelector("[role='dialog']")!;
    const controls = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        "button:not([disabled]),input:not([disabled]),[tabindex='0']",
      ),
    );
    const first = controls[0],
      last = controls[controls.length - 1];
    await React.act(() => {
      last.focus();
      last.dispatchEvent(
        new f.dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
      );
    });
    assert.equal(document.activeElement, first);
    await React.act(() => {
      first.dispatchEvent(
        new f.dom.window.KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    assert.equal(document.activeElement, last);
    await React.act(() => f.opener.focus());
    assert.ok(dialog.contains(document.activeElement));
  } finally {
    await f.close();
  }
});

test("a disappearing menu entry returns focus to the explicit permanent profile trigger", async () => {
  const f = await fixture(false, true);
  try {
    await f.click(f.button("Close"));
    await f.settle();
    assert.equal(f.closes(), 1);
    assert.equal(document.activeElement, f.opener);
  } finally {
    await f.close();
  }
});

for (const mode of ["register", "recover"]) {
  test(`${mode} cannot discard the one-time code by dismissing a pending request`, async () => {
    const f = await fixture(false, false, true);
    try {
      await f.click(f.button(mode === "register" ? "Create account" : "Forgot password?"));
      await f.input("Username", "captain");
      await f.input(mode === "register" ? "Password" : "New password", "password123");
      if (mode === "recover") {
        for (let i = 1; i <= 4; i++) await f.input(`Recovery key block ${i} of 4`, "ABCDE");
      }
      await f.click(f.button(mode === "register" ? "Create my account" : "Reset password"));
      assert.equal(f.requests.length, 1);
      await f.click(f.button(mode === "register" ? "Sign in" : "Back"));
      assert.ok(f.button(mode === "register" ? "Create my account" : "Reset password"));
      const dialog = document.querySelector("[role='dialog']")!;
      await f.click(f.button("Close"));
      await React.act(() => {
        window.dispatchEvent(
          new f.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
        dialog.parentElement!.dispatchEvent(
          new f.dom.window.MouseEvent("mousedown", { bubbles: true }),
        );
      });
      await f.settle();
      assert.equal(
        f.closes(),
        0,
        "pending account mutations must keep their recovery-code owner mounted",
      );
      await React.act(async () => {
        f.releaseRequest();
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      assert.equal(f.auth.currentAuthor()?.username, "captain");
      assert.ok(document.body.textContent?.includes("ABCDE-FGHIJ-KLMNO-PQRST"));
    } finally {
      await f.close();
    }
  });
}
