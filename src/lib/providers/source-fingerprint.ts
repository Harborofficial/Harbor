/**
 * A stable, cheap identity for provider payloads.
 *
 * Cache revisions must survive LRU eviction. A reload of the same bytes is not
 * a metadata change, so it has to keep the previous revision; a counter that
 * lives in the evictable entry cannot do that.
 */
export function sourceFingerprint(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    return "invalid";
  }
  let a = 0x811c9dc5;
  let b = 0x9e3779b9 ^ text.length;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 16777619);
    b = Math.imul(b ^ code, 2246822519);
  }
  return `${text.length}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`;
}
