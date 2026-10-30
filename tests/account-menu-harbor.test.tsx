import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as jsxRuntime from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import * as icons from "lucide-react";
import ts from "typescript";
import { AvatarImage } from "../src/components/avatar-image.tsx";

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

async function fixture(harborSignedIn = false, stremioSignedIn = false, kid = false) {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://fixture.invalid" });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const profiles = [
    {
      id: "local",
      name: "Local captain",
      avatar: "/local-avatar.png",
      color: "#123456",
      isPrimary: true,
      kid: kid ? { age: 7, curfewMinutes: null, parentPinHash: null } : undefined,
    },
    { id: "other", name: "Other local profile", avatar: "/other-avatar.png", color: "#654321" },
  ];
  let activeProfile = profiles[0];
  const writeProfiles = () =>
    localStorage.setItem(
      "harbor.profiles.v1",
      JSON.stringify({ profiles, activeId: activeProfile.id }),
    );
  writeProfiles();
  localStorage.setItem("harbor.theme-session.repaired.v2", "1");
  const session = (id: string) => ({
    token: `fixture-${id}`,
    user: { id, username: `Harbor ${id}`, handle: id },
  });
  if (harborSignedIn)
    localStorage.setItem("harbor.theme-session.local", JSON.stringify(session("first")));
  localStorage.setItem("harbor.theme-session.other", JSON.stringify(session("second")));
  const translations: Record<string, string> = {
    "profile.signedIn": "Signed in to Stremio",
    "profile.signOut": "Sign out of Stremio",
    "profile.signIn": "Sign in to Stremio",
    "profile.whoWatching": "Who's watching?",
    "profile.editThis": "Edit this profile",
    "profile.new": "New profile",
  };
  const navigation: unknown[][] = [];
  const picker: unknown[] = [];
  const accountRequests: string[] = [];
  let dialogReturnFocus: HTMLElement | null | undefined;
  let signOuts = 0;
  const dependencies: Record<string, any> = {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "react-dom": ReactDOM,
    "lucide-react": icons,
    "@/lib/config/endpoints": { HARBOR_API_BASE: "https://fixture.invalid" },
    "@/lib/safe-fetch": {
      safeFetch: async (url: string, options: RequestInit) => {
        if (url.endsWith("/auth/logout") && options.method === "POST") {
          accountRequests.push(url);
          return Response.json({});
        }
        throw new Error("Unexpected account request");
      },
    },
    "@/lib/i18n": { useT: () => (key: string) => translations[key] ?? key },
    "@/lib/auth": {
      useAuth: () => ({
        user: stremioSignedIn
          ? {
              _id: "stremio",
              fullname: "Stremio name",
              email: "stremio@example.invalid",
              avatar: "/stremio-avatar.png",
            }
          : null,
        signOut: () => signOuts++,
      }),
    },
    "@/lib/profiles": {
      useProfiles: () => ({
        profiles,
        activeProfile,
        openPicker: (value: unknown) => picker.push(value),
        selectProfile: () => {},
      }),
      useActiveKid: () => (kid ? { age: 7, curfewMinutes: null, parentPinHash: null } : null),
      isPlaceholderName: (name?: string | null) =>
        !name || name === "Guest" || name.startsWith("Guest "),
    },
    "@/lib/view": {
      useView: () => ({
        openSettings: (...args: unknown[]) => navigation.push(args),
        setView: (...args: unknown[]) => navigation.push(args),
      }),
    },
    "@/lib/settings": {
      useSettings: () => ({
        settings: { harborAvatar: "/fallback-avatar.png", accountProvider: "stremio" },
      }),
    },
    "@/lib/settings/defaults": {
      getSecondaryPrivileges: () => ({ canAddProfiles: true, canSignOutRoot: true }),
    },
    "@/lib/nuvio/nuvio-client": {
      loadNuvioState: () => ({ session: null, profiles: [], activeProfileIndex: 1 }),
      isNuvioSignedIn: () => false,
      isNuvioProviderActive: () => false,
    },
    "@/lib/nuvio/nuvio-auth": {
      signOutNuvio: async () => {},
    },
    "@/lib/nuvio/nuvio-profiles": {
      resolveNuvioAvatar: () => null,
      setActiveNuvioProfile: () => true,
    },
    "@/lib/nuvio/nuvio-types": {},
    "@/lib/active-profile-id": {
      isStremioActivePrimary: (p: any) => !!p?.isPrimary,
      isNuvioProviderActive: () => false,
      activeProfileIsPrimary: () => true,
    },
    "@/lib/social/presence": {
      currentStatus: () => "online",
      subscribeStatus: () => () => {},
      setStatus() {},
    },
    "@/lib/social/open-my-profile": { openMyProfile: async () => false },
    "@/lib/social/notification-open": { openNotificationCenter() {} },
    "@/lib/window": {
      openUrl() {
        throw new Error("Unexpected external sign-in");
      },
    },
    "@/components/avatar-image": { AvatarImage },
    "@/components/auth-modal": {
      AuthModal: () => React.createElement("div", { role: "dialog" }, "Stremio sign in"),
    },
    "@/views/account/harbor-account-dialog": {
      HarborAccountDialog: ({
        onClose,
        returnFocus,
      }: {
        onClose: () => void;
        returnFocus?: HTMLElement | null;
      }) => {
        dialogReturnFocus = returnFocus;
        return React.createElement(
          "div",
          { role: "dialog", "aria-label": "Harbor account" },
          React.createElement("button", { onClick: onClose }, "Close"),
        );
      },
    },
    "@/components/parental-pin-modal": { ParentalPinModal: () => null },
    "@/lib/profile-password": { verifyProfilePassword: async () => true },
    "@/chrome/sidebar/status-control": { StatusDot: () => null, StatusPicker: () => null },
  };
  const auth = load("lib/theme-auth.ts", dependencies);
  dependencies["@/lib/theme-auth"] = auth;
  const menuEvents = load("lib/social/account-menu-open.ts", dependencies);
  dependencies["@/lib/social/account-menu-open"] = menuEvents;
  dependencies["./account-menu-parts"] = load(
    "chrome/account-menu/account-menu-parts.tsx",
    dependencies,
  );
  dependencies["./use-account-menu"] = load(
    "chrome/account-menu/use-account-menu.ts",
    dependencies,
  );
  dependencies["./account-menu-panel"] = load(
    "chrome/account-menu/account-menu-panel.tsx",
    dependencies,
  );
  const { AccountMenu } = load("chrome/account-menu/account-menu.tsx", dependencies);
  const { AccountMenuFloating } = load(
    "chrome/account-menu/account-menu-floating.tsx",
    dependencies,
  );
  const root = createRoot(document.getElementById("root")!);
  const render = (trigger: "row" | "pill" | "avatar" = "row", collapsed = false) =>
    React.act(() => root.render(React.createElement(AccountMenu, { trigger, collapsed })));
  const button = (label: string) => {
    const found = Array.from(document.querySelectorAll("button")).find(
      (el) => el.getAttribute("aria-label") === label || el.textContent === label,
    );
    assert.ok(found, `Missing button: ${label}`);
    return found;
  };
  const click = (element: HTMLElement) =>
    React.act(async () => {
      element.click();
    });
  const renderSidebar = async () => {
    const { SettingsSidebar } = load("views/settings/settings-sidebar.tsx", {
      ...dependencies,
      "@/lib/account/avatar-sync": { syncAvatar: () => {} },
      "@/components/icons/harbor-mark": load("components/icons/harbor-mark.tsx", dependencies),
      "@/assets/nav-icons/download.svg?raw": { default: "<svg />" },
      "@/chrome/account-menu/account-menu-parts": dependencies["./account-menu-parts"],
      "./account/avatar-utils": {
        resizeAvatar: async () => {
          throw new Error("Unexpected avatar upload");
        },
      },
      "./groups": { TOP_GROUPS: [] },
      "./section-icons": { SECTION_ICONS: {} },
      "./set-icon": { SetIcon: () => null },
      "./tab-registry": { tabsFor: () => [] },
      "./nav": { useNavSearch: () => ({ matches: [], optionMatches: [] }) },
      "./shared": { settingsAnchor: (title: string) => title },
    });
    await React.act(() =>
      root.render(
        React.createElement(SettingsSidebar, {
          active: "account",
          activeTab: "harbor",
          meta: {},
          onSelect() {},
        }),
      ),
    );
  };
  await render();
  return {
    auth,
    navigation,
    picker,
    accountRequests,
    render,
    renderSidebar,
    button,
    click,
    renderFloating: () => React.act(() => root.render(React.createElement(AccountMenuFloating))),
    openFloating: (opener?: HTMLElement) =>
      React.act(() =>
        menuEvents.openAccountMenu(opener ? { bottom: 40, right: 40, opener } : null),
      ),
    dialogReturnFocus: () => dialogReturnFocus,
    signOuts: () => signOuts,
    open: () => click(document.querySelector<HTMLButtonElement>("button")!),
    switchProfile: (index: number) =>
      React.act(() => {
        activeProfile = profiles[index];
        writeProfiles();
        window.dispatchEvent(new dom.window.Event("harbor:active-profile-changed"));
      }),
    close: async () => {
      await React.act(() => root.unmount());
      dom.window.close();
    },
  };
}

for (const harborSignedIn of [false, true]) {
  for (const stremioSignedIn of [false, true]) {
    test(`Harbor status and account action are independent of Stremio (Harbor=${harborSignedIn}, Stremio=${stremioSignedIn})`, async () => {
      const f = await fixture(harborSignedIn, stremioSignedIn);
      try {
        const status = harborSignedIn ? "Signed in to Harbor" : "Signed out of Harbor";
        assert.ok(
          document.querySelector("[data-harbor-sidebar-label]")!.textContent!.includes(status),
        );
        await f.render("pill");
        await f.open();
        const panel = document.querySelector(".harbor-profile-dropdown")!;
        assert.ok(
          panel.textContent!.includes(status),
          "dropdown header reflects Harbor authentication",
        );
        assert.ok(!panel.textContent!.includes("stremio@example.invalid"));
        assert.ok(!panel.textContent!.includes("Sign out of Stremio"));
        await f.click(f.button(harborSignedIn ? "Sign out of Harbor" : "Sign in to Harbor"));
        assert.deepEqual(f.navigation, []);
        assert.equal(
          document.querySelector(".harbor-profile-dropdown"),
          null,
          "the account action closes the menu",
        );
        assert.equal(f.signOuts(), 0);
        if (harborSignedIn) {
          assert.equal(f.auth.currentAuthor(), null);
          assert.equal(f.accountRequests.length, 1);
          assert.equal(document.querySelector("[role='dialog']"), null);
        } else {
          assert.equal(
            document.querySelector("[role='dialog']")!.getAttribute("aria-label"),
            "Harbor account",
          );
          assert.equal(f.accountRequests.length, 0);
        }
      } finally {
        await f.close();
      }
    });
  }
}

test("Harbor sign-in, sign-out and local-profile switching update the mounted subtitle", async () => {
  const f = await fixture(false, true);
  const subtitle = () => document.querySelector("[data-harbor-sidebar-label]")!.textContent!;
  try {
    assert.ok(subtitle().includes("Signed out of Harbor"));
    await React.act(() =>
      f.auth.applyAuthResult({
        token: "signed-in",
        user: { id: "first", username: "Account name" },
      }),
    );
    assert.ok(subtitle().includes("Signed in to Harbor"));
    await f.switchProfile(1);
    assert.ok(subtitle().includes("Other local profile"));
    assert.ok(subtitle().includes("Signed in to Harbor"));
    await React.act(() => f.auth.logoutAuthor());
    assert.ok(subtitle().includes("Signed out of Harbor"));
    await f.switchProfile(0);
    assert.ok(subtitle().includes("Local captain"));
    assert.ok(
      subtitle().includes("Signed in to Harbor"),
      "each local profile retains its own Harbor session",
    );
  } finally {
    await f.close();
  }
});

test("Harbor account access preserves local profile identity, avatar and profile management", async () => {
  const f = await fixture(true, true);
  try {
    assert.equal(document.querySelector("button")!.getAttribute("aria-label"), "Local captain");
    assert.equal(document.querySelector("img")!.getAttribute("src"), "/local-avatar.png");
    await f.open();
    await f.click(f.button("Manage profiles"));
    await f.click(f.button("Edit this profile"));
    assert.deepEqual(f.picker, [{ kind: "edit", profileId: "local" }]);
    assert.equal(document.querySelector(".harbor-profile-dropdown"), null);
    await f.open();
    await f.click(f.button("Manage profiles"));
    await f.click(f.button("New profile"));
    assert.deepEqual(f.picker[1], { kind: "create" });
    assert.equal(f.signOuts(), 0);
  } finally {
    await f.close();
  }
});

test("the signed-out subtitle opens Harbor authentication separately from the profile menu", async () => {
  const f = await fixture(false, true);
  try {
    const signin = f.button("Sign in to Harbor");
    const profileTrigger = document.querySelector<HTMLButtonElement>(
      "button[aria-haspopup='menu']",
    )!;
    assert.equal(
      signin.closest("button button"),
      null,
      "the action is not nested inside the profile button",
    );
    await React.act(() => signin.focus());
    await f.click(signin);
    assert.ok(
      f.dialogReturnFocus() === profileTrigger,
      "authentication can remove the subtitle, so focus returns to the permanent profile trigger",
    );
    assert.equal(document.querySelectorAll("[role='dialog']").length, 1);
    assert.equal(document.querySelector(".harbor-profile-dropdown"), null);
    assert.deepEqual(f.navigation, []);
    await f.click(f.button("Close"));
    assert.equal(document.querySelector("[role='dialog']"), null);
    await f.open();
    assert.ok(document.querySelector(".harbor-profile-dropdown"));
    assert.equal(document.querySelector("[role='dialog']"), null);
    assert.equal(f.signOuts(), 0);
  } finally {
    await f.close();
  }
});

test("Settings sidebar follows Harbor authentication while preserving the local identity", async () => {
  const f = await fixture(true, true);
  try {
    await f.renderSidebar();
    const rail = document.querySelector(".hset-rail-me")!;
    assert.equal(rail.querySelector(".hset-rail-me-sub")!.textContent, "Signed in to Harbor");
    assert.equal(rail.querySelector(".hset-rail-me-name")!.textContent, "Local captain");
    assert.equal(rail.querySelector("img")!.getAttribute("src"), "/local-avatar.png");
    await React.act(() => f.auth.logoutAuthor());
    assert.equal(rail.querySelector(".hset-rail-me-sub")!.textContent, "Signed out of Harbor");
    assert.equal(rail.querySelector(".hset-rail-me-name")!.textContent, "Local captain");
    assert.equal(rail.querySelector("img")!.getAttribute("src"), "/local-avatar.png");
    assert.equal(f.signOuts(), 0);
  } finally {
    await f.close();
  }
});

test("a Harbor popup closes on profile switch without changing either profile's session", async () => {
  const f = await fixture(false, true);
  try {
    await f.click(f.button("Sign in to Harbor"));
    assert.ok(document.querySelector("[role='dialog']"));
    await f.switchProfile(1);
    await f.render();
    assert.equal(document.querySelector("[role='dialog']"), null);
    assert.equal(f.auth.currentAuthor()?.id, "second");
    assert.equal(f.signOuts(), 0);
    assert.equal(f.accountRequests.length, 0);
  } finally {
    await f.close();
  }
});

test("child profiles do not expose an account action through the subtitle or dropdown", async () => {
  const f = await fixture(false, true, true);
  try {
    assert.equal(document.querySelector('[aria-label="Sign in to Harbor"]'), null);
    await f.open();
    assert.ok(
      !document
        .querySelector(".harbor-profile-dropdown")!
        .textContent!.includes("Sign in to Harbor"),
    );
    assert.equal(document.querySelector("[role='dialog']"), null);
  } finally {
    await f.close();
  }
});

test("floating account menu opens Harbor authentication and closes itself", async () => {
  const f = await fixture(false, true);
  try {
    await f.renderFloating();
    await f.openFloating();
    await f.click(f.button("Sign in to Harbor"));
    assert.equal(document.querySelector(".harbor-profile-dropdown"), null);
    assert.equal(
      document.querySelector("[role='dialog']")!.getAttribute("aria-label"),
      "Harbor account",
    );
    assert.equal(f.signOuts(), 0);
    assert.deepEqual(f.navigation, []);
  } finally {
    await f.close();
  }
});

test("collapsed profile rows retain sign-in access through the dropdown", async () => {
  const f = await fixture(false, false);
  try {
    await f.render("row", true);
    assert.equal(document.querySelector('[aria-label="Sign in to Harbor"]'), null);
    await f.open();
    await f.click(f.button("Sign in to Harbor"));
    assert.ok(document.querySelector("[role='dialog']"));
  } finally {
    await f.close();
  }
});

test("dropdown login supplies its permanent profile trigger as the dialog focus return", async () => {
  const f = await fixture(false, false);
  try {
    await f.render("pill");
    const trigger = document.querySelector<HTMLButtonElement>("button[aria-haspopup='menu']")!;
    await f.open();
    await f.click(f.button("Sign in to Harbor"));
    assert.ok(
      f.dialogReturnFocus() === trigger,
      "the dialog receives the connected profile trigger",
    );
    assert.equal(trigger.isConnected, true);
  } finally {
    await f.close();
  }
});

test("floating login retains the original theme trigger after its menu item disappears", async () => {
  const f = await fixture(false, false);
  try {
    await f.renderFloating();
    const trigger = document.createElement("button");
    trigger.textContent = "Theme profile";
    document.body.append(trigger);
    await f.openFloating(trigger);
    await f.click(f.button("Sign in to Harbor"));
    assert.ok(f.dialogReturnFocus() === trigger, "the dialog receives the connected theme trigger");
    assert.equal(trigger.isConnected, true);
  } finally {
    await f.close();
  }
});

test("a Harbor profile destination requiring authentication uses the same popup focus target", async () => {
  const f = await fixture(true, true);
  try {
    await f.render("pill");
    const trigger = document.querySelector<HTMLButtonElement>("button[aria-haspopup='menu']")!;
    await f.open();
    await f.click(f.button("View my profile"));
    assert.ok(document.querySelector("[aria-label='Harbor account'][role='dialog']"));
    assert.ok(f.dialogReturnFocus() === trigger, "the fallback retains its profile trigger");
    assert.equal(f.signOuts(), 0);
  } finally {
    await f.close();
  }
});

test("pressing a floating menu action does not dismiss it before the click", async () => {
  const f = await fixture(false, false);
  try {
    await f.renderFloating();
    await f.openFloating();
    const signin = f.button("Sign in to Harbor");
    await React.act(() =>
      signin.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true })),
    );
    assert.ok(
      document.querySelector(".harbor-profile-dropdown"),
      "an inside pointer press keeps the floating action mounted",
    );
    await f.click(signin);
    assert.ok(document.querySelector("[role='dialog']"));
  } finally {
    await f.close();
  }
});
