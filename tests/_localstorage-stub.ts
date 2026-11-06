const store = new Map<string, string>();

(globalThis as { localStorage?: unknown }).localStorage ??= {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
};

(globalThis as any).window ??= globalThis;
(globalThis as any).addEventListener ??= () => {};
(globalThis as any).removeEventListener ??= () => {};
(globalThis as any).CustomEvent ??= class CustomEvent {
  type: string;
  detail: any;
  constructor(type: string, init?: any) {
    this.type = type;
    this.detail = init?.detail;
  }
};
(globalThis as any).dispatchEvent ??= () => true;

export {};
