import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { addAbortListener, once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { Cdp } from "../scripts/harbor-diag.mjs";

const chromium = process.env.HARBOR_SCROLLBAR_CHROME;
const appCss = new URL("../src/index.css", import.meta.url);
const pageZoom = 1.6;
const title = "Harbor scrollbar regression";

// Opt in with HARBOR_SCROLLBAR_CHROME pointing at a Windows Chromium executable.
// CDP exercises CSS and scroll input in an isolated page. Read the actual Windows cursor separately.
test(
  "the Settings rail keeps its scrollbar geometry and drag behavior with the anchor",
  {
    skip: process.platform !== "win32" || !chromium,
    timeout: 20_000,
  },
  async ({ signal }) => {
    const profile = await mkdtemp(join(tmpdir(), "harbor-scrollbar-"));
    let browser;
    let exited;
    let socket;
    let abortListener;
    const server = createServer();
    try {
      const styles = new Map([
        ["/app.css", await readFile(appCss, "utf8")],
        ["/harbor-cursor.css", await readFile(new URL("harbor-cursor.css", appCss), "utf8")],
      ]);
      const cursor = await readFile(new URL("assets/harbor-cursor.png", appCss));
      server.on("request", (req, res) => {
        if (styles.has(req.url)) {
          res.setHeader("Content-Type", "text/css");
          res.end(styles.get(req.url));
        } else if (req.url === "/anchor.png") {
          res.setHeader("Content-Type", "image/png");
          res.end(cursor);
        } else if (req.url === "/") {
          res.setHeader("Content-Type", "text/html");
          res.end(`<!doctype html><html data-os="windows" style="--harbor-cursor-image:url('/anchor.png') 9 1">
          <title>${title}</title>
          <link rel="stylesheet" href="/app.css">
          <style>
            body {margin: 0; --color-edge: #889099}
            .fixture {margin: 70px; width: 210px; height: 230px; display: flex; flex-direction: column}
            .spacer {flex: none; height: 900px}
          </style>
          <div class="fixture" style="--hset-ui-scale:${pageZoom}">
            <div class="hset-rail-nav" tabindex="0"><div class="spacer"></div></div>
          </div>`);
        } else {
          res.writeHead(404).end();
        }
      });
      const listening = once(server, "listening", { signal });
      server.listen(0, "127.0.0.1");
      await listening;
      const url = `http://127.0.0.1:${server.address().port}/`;
      const profileDir = join(profile, "Default");
      await mkdir(profileDir);
      // Chromium browser zoom, matching WebView2's zoom rather than CSS zoom.
      await writeFile(
        join(profileDir, "Preferences"),
        JSON.stringify({
          partition: { default_zoom_level: { x: Math.log(pageZoom) / Math.log(1.2) } },
        }),
      );
      browser = spawn(
        chromium,
        [
          "--headless=new",
          "--disable-gpu",
          "--disable-background-networking",
          "--no-first-run",
          "--no-default-browser-check",
          "--remote-debugging-port=0",
          "--force-device-scale-factor=1",
          "--window-size=1000,800",
          `--user-data-dir=${profile}`,
          url,
        ],
        { signal, stdio: "ignore", windowsHide: true },
      );
      exited = new Promise((resolve) => browser.once("close", resolve));
      const launched = once(browser, "spawn", { signal });
      // Aborting the spawned child emits an error before it closes.
      browser.on("error", () => {});
      await launched;
      const endpointFile = join(profile, "DevToolsActivePort");
      let target;
      for (let attempt = 0; !target && attempt < 60; attempt++) {
        await delay(100, undefined, { signal });
        const endpoint = await readFile(endpointFile, "utf8").catch(() => "");
        if (!endpoint) continue;
        const targets = await fetch(`http://127.0.0.1:${endpoint.split("\n")[0]}/json/list`, {
          signal,
        })
          .then((res) => res.json())
          .catch(() => []);
        target = targets.find(
          (page) => page.type === "page" && page.url === url && page.title === title,
        );
      }
      assert.ok(target, "Chromium did not open the test fixture");
      socket = new WebSocket(target.webSocketDebuggerUrl);
      await once(socket, "open", { signal });
      const cdp = new Cdp(socket, target);
      socket.addEventListener("message", (event) => cdp.onMessage(String(event.data)));
      const aborted = new Promise((_, reject) => {
        abortListener = addAbortListener(signal, () => reject(signal.reason));
      });
      const withinTimeout = (operation) => Promise.race([operation, aborted]);
      const send = (method, params) => withinTimeout(cdp.send(method, params));
      const evaluate = async (expression) => {
        const reply = await send("Runtime.evaluate", {
          expression,
          returnByValue: true,
          awaitPromise: true,
        });
        assert.equal(
          reply.exceptionDetails,
          undefined,
          reply.exceptionDetails?.exception?.description,
        );
        return reply.result.value;
      };
      await evaluate(
        "new Promise(resolve => document.readyState === 'complete' ? resolve() : window.addEventListener('load', resolve, { once: true }))",
      );
      const measure = () =>
        evaluate(`(() => {
      const rail = document.querySelector(".hset-rail-nav");
      const rect = rail.getBoundingClientRect();
      const content = rail.firstElementChild.getBoundingClientRect();
      const style = getComputedStyle(rail);
      const thumb = getComputedStyle(rail, "::-webkit-scrollbar-thumb");
      return {
        dpr: devicePixelRatio,
        width: (rect.width - content.width) * devicePixelRatio,
        standardWidth: style.scrollbarWidth,
        standardColor: style.scrollbarColor,
        cursor: thumb.cursor,
        x: content.left - rect.left > .1
          ? (rect.left + content.left) / 2
          : (content.right + rect.right) / 2,
        y: rect.top + rect.height / 8,
        lane: content.left - rect.left > .1 ? "left" : "right",
      };
    })()`);
      for (const direction of ["ltr", "rtl"]) {
        await evaluate(`document.documentElement.dir = "${direction}";
        document.documentElement.removeAttribute("data-harbor-cursor");
        document.querySelector(".hset-rail-nav").scrollTop = 0`);
        const native = await measure();
        assert.ok(Math.abs(native.dpr - pageZoom) < 0.01, "fixture uses browser zoom 160%");
        assert.equal(native.standardWidth, "thin");
        assert.equal(native.lane, direction === "ltr" ? "right" : "left");
        assert.ok(native.width > 0);
        await evaluate('document.documentElement.setAttribute("data-harbor-cursor", "")');
        const custom = await measure();
        assert.equal(custom.standardWidth, "auto");
        assert.equal(custom.standardColor, "auto");
        assert.equal(custom.lane, native.lane);
        assert.match(custom.cursor, /anchor\.png.*9 1, default$/);
        assert.ok(
          Math.abs(custom.width - native.width) <= 1,
          `${direction} scrollbar gutter changed`,
        );
        const { x, y } = custom;
        await evaluate(
          "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
        );
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
        await send("Input.dispatchMouseEvent", {
          type: "mousePressed",
          x,
          y,
          button: "left",
          buttons: 1,
          clickCount: 1,
        });
        await send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x,
          y: y + 45,
          button: "left",
          buttons: 1,
        });
        await send("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x,
          y: y + 45,
          button: "left",
          clickCount: 1,
        });
        const offset = await evaluate(
          'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(document.querySelector(".hset-rail-nav").scrollTop))))',
        );
        assert.ok(offset > 0, `${direction} scrollbar thumb did not scroll`);
      }
      await withinTimeout(Promise.race([cdp.send("Browser.close"), exited]));
      await withinTimeout(exited);
    } finally {
      abortListener?.[Symbol.dispose]();
      socket?.close();
      if (browser?.exitCode === null && browser.signalCode === null) browser.kill();
      await exited;
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  },
);
