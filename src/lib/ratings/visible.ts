import { fetchUserRatings } from "@/lib/social/ratings-api";

const TTL = 5 * 60_000;

const cache = new Map<string, { at: number; value: boolean }>();
const inflight = new Map<string, Promise<boolean>>();

/**
 * Whether someone's ratings can be quoted: their list has to be readable and hold at least one
 * rating, so people who hide their ratings never show up as a person to quote. A refused request
 * is remembered, an unknown (network) failure is not, so a flaky connection cannot pin a
 * "hidden" verdict on someone for five minutes.
 */
export function ratingsVisible(handle: string): Promise<boolean> {
  const key = handle.trim().toLowerCase();
  if (!key) return Promise.resolve(false);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.value);
  const running = inflight.get(key);
  if (running) return running;
  const p = fetchUserRatings(handle)
    .then((page) => {
      const visible = page.items.length > 0;
      cache.set(key, { at: Date.now(), value: visible });
      return visible;
    })
    .catch((err: unknown) => {
      const status = (err as { status?: number }).status;
      if (typeof status !== "number") return true;
      cache.set(key, { at: Date.now(), value: false });
      return false;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

/** Runs `fn` over `items` a few at a time, so a long friends list does not fire all at once. */
export async function eachLimit<T>(
  items: readonly T[],
  width: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      await fn(items[i]);
    }
  };
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.max(1, Math.min(width, items.length)); i += 1) workers.push(worker());
  await Promise.all(workers);
}
