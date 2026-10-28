import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as icons from "lucide-react";
import { JSDOM } from "jsdom";
import { parseQuotedBody } from "../src/lib/ratings/quote.ts";

/**
 * The reply composer is driven the way the confirmation guard drives comment-item: the module
 * is transpiled against a fixed map of its imports and CommentCompose is captured, so the test
 * can hand it a quote and read back what the reply actually submits.
 */
test("a comment reply quotes a rating and keeps the parent it answers", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://fixture.invalid" });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  window.matchMedia = () => ({ matches: true });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};

  const compose: any[] = [];
  const empty = () => null;
  const dependencies: Record<string, unknown> = {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "lucide-react": icons,
    "@/lib/i18n": {
      useT: () => (key: string, values?: Record<string, unknown>) =>
        key.replace(/\{(\w+)\}/g, (_, name) => String(values?.[name] ?? name)),
    },
    "@/lib/social/mentions": { segmentMentions: (text: string) => [{ text }] },
    "@/lib/ratings/quote": { parseQuotedBody },
    "./profile-bits": { Avatar: empty, timeAgo: () => "just now" },
    "./comment-compose": {
      CommentCompose: (props: any) => {
        compose.push(props);
        return null;
      },
    },
    "./mention-link": { MentionLink: empty },
    "./quoted-rating": { QuotedRating: empty },
    "./text-safety": { segmentProfanity: (text: string) => [{ text }] },
    "./user-hover-card": { UserHoverCard: ({ children }: any) => children },
    "./use-self-avatar": { useSelfAvatar: () => ({ handle: "reader" }) },
    "@/views/account/verified-badge": { VerifiedBadge: empty },
    "@/lib/context-menu": { useContextTarget: () => empty },
    "@/components/context-menu/content-actions": { copyContextText: () => {} },
    "@/lib/social/open-profile": { canOpenProfile: () => false },
    "@/components/context-menu/action-items": { ConfirmableAction: empty },
    "@/lib/social/action-actor": {
      captureSocialActor: () => ({}),
      isSocialActorCurrent: () => true,
      assertSocialActor: () => {},
    },
  };

  const output = ts.transpileModule(
    readFileSync(new URL("../src/views/profile/comment-item.tsx", import.meta.url), "utf8"),
    {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  );
  const exports: any = {};
  new Function("require", "exports", output.outputText)((name) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, exports);

  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  const sources = [{ handle: "owner", kind: "owner" }];
  const quoted = {
    authorHandle: "owner",
    itemKey: "tt1",
    mediaType: "movie",
    score: 9,
  };
  const posted: Array<{ raw: string; parentId?: string; quote?: unknown }> = [];
  const comment = {
    id: "c1",
    body: "Top level comment",
    authorHandle: "writer",
    authorAlias: "Writer",
    at: "2026-09-11",
  };
  const nested = {
    id: "c2",
    body: "Nested reply",
    authorHandle: "other",
    authorAlias: "Other",
    at: "2026-09-12",
  };
  const reply = async (raw: string, parentId?: string, quote?: unknown) => {
    posted.push({ raw, parentId, quote });
    return null;
  };
  const render = () =>
    React.createElement(exports.CommentItem, {
      c: comment,
      canDelete: false,
      signedIn: true,
      replyToId: "root-id",
      replies: [nested],
      sources,
      onReply: reply,
    });
  const buttons = (label: string) =>
    Array.from(document.querySelectorAll("button")).filter(
      (b) => b.textContent?.trim() === label,
    ) as HTMLButtonElement[];
  const click = (button: HTMLButtonElement) =>
    React.act(async () => {
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

  try {
    await React.act(() => root.render(render()));

    // The reply composer is opened and gets the same people the main composer offers.
    await click(buttons("Reply")[0]);
    assert.ok(compose.length >= 1, "opening a reply mounts a composer");
    assert.equal(compose.at(-1).sources, sources, "the reply composer receives the rating sources");
    assert.equal(typeof compose.at(-1).onQuoteChange, "function");

    // Picking a rating becomes the composer's quote chip, like it does for a new comment.
    await React.act(async () => {
      compose.at(-1).onQuoteChange(quoted);
    });
    assert.deepEqual(compose.at(-1).quote, quoted);

    await React.act(async () => {
      await compose.at(-1).onSubmit("my take");
    });
    assert.deepEqual(posted, [{ raw: "my take", parentId: "root-id", quote: quoted }]);
    assert.equal(posted[0].parentId, "root-id", "the quote rides on the reply's parent id");

    // Cancelling clears the pending quote, so it cannot leak into a later reply.
    await click(buttons("Reply")[0]);
    await React.act(async () => {
      compose.at(-1).onQuoteChange(quoted);
    });
    await click(buttons("Cancel")[0]);
    await click(buttons("Show 1 reply")[0]);
    await click(buttons("Reply").at(-1)!);

    assert.equal(compose.at(-1).sources, sources, "nested replies inherit the same sources");
    assert.equal(compose.at(-1).quote, null, "the discarded quote does not come back");

    await React.act(async () => {
      await compose.at(-1).onSubmit("nested take");
    });
    assert.equal(posted[1].raw, "nested take");
    assert.equal(posted[1].parentId, "root-id", "a nested reply stays attached to its thread");
    assert.equal(posted[1].quote, null);
  } finally {
    await React.act(() => root.unmount());
    dom.window.close();
  }
});
