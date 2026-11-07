/// <reference lib="webworker" />

import { ensureMangaSession, mangaProvider, upscaleBitmap } from "./worker-engine";
import type { MangaUpscaleRequest, MangaUpscaleResponse } from "./protocol";

const scope = self as DedicatedWorkerGlobalScope;
let queue = Promise.resolve();

function fail(id: number, error: unknown) {
  const response: MangaUpscaleResponse = {
    id,
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
  scope.postMessage(response);
}

async function handle(request: MangaUpscaleRequest): Promise<void> {
  try {
    if (request.type === "ensure") {
      await ensureMangaSession(request.model, request.quality, request.modelKey);
      const response: MangaUpscaleResponse = {
        id: request.id,
        ok: true,
        provider: mangaProvider() ?? undefined,
      };
      scope.postMessage(response);
      return;
    }
    try {
      const result = await upscaleBitmap(request.bitmap, request.quality);
      const response: MangaUpscaleResponse = { id: request.id, ok: true, result };
      scope.postMessage(response);
    } finally {
      request.bitmap.close();
    }
  } catch (error) {
    fail(request.id, error);
  }
}

scope.addEventListener("message", (event: MessageEvent<MangaUpscaleRequest>) => {
  const request = event.data;
  queue = queue.then(
    () => handle(request),
    () => handle(request),
  );
});
