import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { mountHarborCursor, observeStoredHarborCursor } from "../src/lib/harbor-cursor.ts";
import { DEFAULT } from "../src/lib/settings/defaults.ts";
import { PROFILES_KEY, persistEffective } from "../src/lib/settings/profile-store.ts";

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function cursorWindow(dense = false) {
  const dom = new JSDOM("", { url: "https://harbor.test" });
  const target = dom.window as unknown as Window;
  const root = target.document.documentElement;
  Object.defineProperty(dom.window, "CSS", {
    value: { supports: () => dense },
  });
  dom.window.HTMLImageElement.prototype.decode = async () => {};
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage: () => {} });
  dom.window.HTMLCanvasElement.prototype.toDataURL = function () {
    return `data:image/png;size=${this.width},test`;
  };
  const image = () => root.style.getPropertyValue("--harbor-cursor-image");
  const active = () => root.hasAttribute("data-harbor-cursor");
  return { dom, target, image, active };
}

test("companions apply the active profile size and release only their own cursor", async () => {
  const first = cursorWindow();
  const second = cursorWindow();
  const { localStorage } = first.target;
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true });
  const notify = (key: string) => {
    for (const { dom, target } of [first, second]) {
      target.dispatchEvent(
        new dom.window.StorageEvent("storage", { key, storageArea: target.localStorage }),
      );
    }
  };
  try {
    persistEffective({ ...DEFAULT, harborCursor: true, harborCursorScale: 1.5 }, "default", true);
    persistEffective({ ...DEFAULT, harborCursor: false, harborCursorScale: 2 }, "private", false);
    const stopFirst = observeStoredHarborCursor(first.target);
    const stopSecond = observeStoredHarborCursor(second.target);
    await settle();
    assert.match(first.image(), /size=48/);
    assert.match(second.image(), /size=48/);

    localStorage.setItem(
      PROFILES_KEY,
      JSON.stringify({ activeId: "private", profiles: [{ id: "private", settingsLinked: false }] }),
    );
    notify(PROFILES_KEY);
    assert.equal(first.active(), false);
    assert.equal(second.active(), false);

    persistEffective({ ...DEFAULT, harborCursor: true, harborCursorScale: 2 }, "private", false);
    notify("harbor.settings.private");
    await settle();
    assert.match(first.image(), /size=64/);
    assert.match(second.image(), /size=64/);
    stopFirst();
    assert.equal(first.image(), "");
    assert.match(second.image(), /size=64/);
    stopSecond();
    assert.equal(second.image(), "");
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
    first.dom.window.close();
    second.dom.window.close();
  }
});

test("the last decoded cursor stays visible while newer sizes race or fail", async (t) => {
  const { dom, target, image, active } = cursorWindow();
  t.mock.method(console, "warn", () => {});
  const pending = new Map<string, ReturnType<typeof Promise.withResolvers<void>>>();
  dom.window.HTMLImageElement.prototype.decode = function () {
    const size = this.src.match(/size=(\d+)/)?.[1];
    if (!size || size === "24") return Promise.resolve();
    const decode = Promise.withResolvers<void>();
    pending.set(size, decode);
    return decode.promise;
  };
  const cursor = mountHarborCursor(target);
  cursor.setScale(0.75);
  await settle();
  const initial = image();
  assert.match(initial, /size=24/);

  cursor.setScale(2);
  await settle();
  assert.equal(image(), initial);
  cursor.setScale(1.25);
  await settle();
  assert.equal(image(), initial);
  pending.get("40")!.resolve();
  await settle();
  const latest = image();
  assert.match(latest, /size=40/);
  pending.get("64")!.resolve();
  await settle();
  assert.equal(image(), latest);

  cursor.setScale(1.5);
  await settle();
  pending.get("48")!.reject(new Error("image decode failed"));
  await settle();
  assert.equal(image(), latest);
  assert.equal(active(), true);
  cursor.dispose();
  assert.equal(active(), false);
  assert.equal(image(), "");
  dom.window.close();
});

test("a late decode cannot restore a disabled cursor or interfere with a new session", async () => {
  const { dom, target, image, active } = cursorWindow();
  const decoded = Promise.withResolvers<void>();
  const pending: HTMLImageElement[] = [];
  dom.window.HTMLImageElement.prototype.decode = function () {
    if (!this.src.includes("size=64")) return Promise.resolve();
    pending.push(this);
    return decoded.promise;
  };
  const old = mountHarborCursor(target);
  old.setScale(2);
  await settle();
  assert.ok(pending[0]?.hasAttribute("src"));
  old.dispose();
  assert.equal(pending[0]?.hasAttribute("src"), false);
  assert.equal(active(), false);

  const next = mountHarborCursor(target);
  next.setScale(0.75);
  await settle();
  const chosen = image();
  assert.match(chosen, /size=24/);
  decoded.resolve();
  await settle();
  old.dispose();
  assert.equal(image(), chosen);
  next.dispose();
  assert.equal(image(), "");
  dom.window.close();
});

test("every slider grade fits within 128 source pixels at 2x and keeps a logical hotspot", async () => {
  const { dom, target, image } = cursorWindow(true);
  const cursor = mountHarborCursor(target);
  for (let percent = 75; percent <= 200; percent += 5) {
    cursor.setScale(percent / 100);
    await settle();
    const css = image();
    const size = Math.round((32 * percent) / 100);
    assert.ok(size * 2 <= 128);
    assert.match(
      css,
      new RegExp(`^image-set\\(url\\("data:image/png;size=${size * 2},test"\\) 2x\\)`),
    );
    assert.ok(css.endsWith(` ${Math.round((9 * size) / 32)} ${Math.round(size / 32)}`));
  }
  cursor.setScale(Infinity);
  await settle();
  assert.match(image(), /size=64/);
  cursor.dispose();
  dom.window.close();
});
