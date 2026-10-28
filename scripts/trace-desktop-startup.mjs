import { writeFile } from "node:fs/promises";

const targets = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const target = targets.find(
  (entry) => entry.type === "page" && entry.url === "http://localhost:1420/",
);
if (!target) throw new Error("Desktop Harbor target not found");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});
let nextId = 0;
const pending = new Map();
const events = [];
let complete;
const completed = new Promise((resolve) => {
  complete = resolve;
});
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request?.reject(new Error(message.error.message));
    else request?.resolve(message.result);
  } else if (message.method === "Tracing.dataCollected") events.push(...message.params.value);
  else if (message.method === "Tracing.tracingComplete") complete();
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
try {
  await send("Profiler.enable");
  await send("Profiler.setSamplingInterval", { interval: 500 });
  await send("Profiler.start");
  await send("Tracing.start", {
    categories: "devtools.timeline,v8,blink.user_timing,disabled-by-default-devtools.timeline",
    options: "record-as-much-as-possible",
    transferMode: "ReportEvents",
  });
  if (process.argv.includes("--browse") || process.argv.includes("--wheel")) {
    const evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) throw new Error("Desktop browse action failed");
    };
    for (const page of ["Home", "Discover", "Home"]) {
      await evaluate(`document.querySelector('button[aria-label="${page}"]')?.click()`);
      await new Promise((resolve) => setTimeout(resolve, 1800));
      if (process.argv.includes("--wheel")) {
        const { result } = await send("Runtime.evaluate", {
          expression: `(() => {
            const main = [...document.querySelectorAll('main')].find(el => el.clientHeight > 0 && !el.closest('[data-layer-inactive]'));
            if (!main) throw new Error('Active scroll container missing');
            const r = main.getBoundingClientRect();
            return { x: r.left + r.width * 0.6, y: r.top + r.height * 0.65 };
          })()`,
          returnByValue: true,
        });
        const { x, y } = result.value;
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
        for (let n = 0; n < 60; n++) {
          await send("Input.dispatchMouseEvent", {
            type: "mouseWheel",
            x,
            y,
            deltaX: 0,
            deltaY: n < 30 ? 120 : -120,
          });
          await new Promise((resolve) => setTimeout(resolve, 32));
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
      } else
        await evaluate(`new Promise(resolve => {
        const main = [...document.querySelectorAll('main')].find(el => el.clientHeight > 0 && !el.closest('[data-layer-inactive]'));
        if (!main) return resolve();
        let n = 0;
        const timer = setInterval(() => {
          main.scrollTop += n < 35 ? 100 : -100;
          if (++n >= 70) { clearInterval(timer); resolve(); }
        }, 32);
      })`);
    }
  } else {
    await send("Page.navigate", { url: "http://localhost:1420/" });
    await new Promise((resolve) => setTimeout(resolve, 20000));
  }
  const { profile } = await send("Profiler.stop");
  await send("Tracing.end");
  await completed;
  const base = process.argv[2];
  if (!base) throw new Error("Output base path required");
  await writeFile(`${base}.cpuprofile`, JSON.stringify(profile));
  // Trace arguments can contain private request URLs; keep raw captures local.
  await writeFile(`${base}.trace.json`, JSON.stringify({ traceEvents: events }));
  console.log(
    JSON.stringify({
      target: "desktop Harbor WebView2",
      samples: profile.samples?.length,
      traceEvents: events.length,
      output: base,
    }),
  );
} finally {
  socket.close();
}
