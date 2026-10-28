import {
  createMediaCache,
  episodeCacheTtl,
  metadataCacheTtl,
  MEDIA_TTL,
} from "../../src/lib/media-cache.ts";

export function memoryMediaCache(options = {}) {
  const records = new Map();
  const invalidators = new Set();
  const cache = createMediaCache(
    {
      async get(key) {
        return structuredClone(records.get(key) ?? null);
      },
      async put(record) {
        records.set(record.key, structuredClone(record));
        return true;
      },
      async list() {
        return [...records.values()].map(({ value: _value, ...index }) => index);
      },
      async remove(keys) {
        keys.forEach((key) => records.delete(key));
      },
      async clear() {
        records.clear();
        return true;
      },
    },
    options,
  );
  const key = (namespace, scope) => `${namespace}:${JSON.stringify(scope)}`;
  const api = {
    MEDIA_TTL,
    episodeCacheTtl,
    metadataCacheTtl,
    mediaCacheGeneration: cache.generation,
    onMediaCacheClear: (clear) => invalidators.add(clear),
    loadMedia: (namespace, scope, loader, policy) =>
      cache.load(key(namespace, scope), loader, policy),
    async cachedMedia(...args) {
      return (await api.loadMedia(...args)).value;
    },
    readMedia: (namespace, scope) => cache.peek(key(namespace, scope)),
    saveMedia: (namespace, scope, value, policy, storedAt, generation = cache.generation()) =>
      generation === cache.generation() &&
      cache.save(key(namespace, scope), value, policy, storedAt),
    async clearMediaCache() {
      const cleared = cache.clear();
      invalidators.forEach((clear) => clear());
      return cleared;
    },
  };
  return api;
}
