export type ConfirmActionOptions = {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
};

export type ConfirmActionState = ConfirmActionOptions & { open: boolean };

const closed: ConfirmActionState = {
  open: false,
  title: "",
  message: "",
  confirmLabel: "",
  destructive: false,
};

let state = closed;
let resolveCurrent: ((confirmed: boolean) => void) | null = null;
const listeners = new Set<() => void>();

function publish(next: ConfirmActionState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function confirmAction(options: ConfirmActionOptions): Promise<boolean> {
  const previous = resolveCurrent;
  resolveCurrent = null;
  previous?.(false);
  publish({ open: true, destructive: false, ...options });
  return new Promise<boolean>((resolve) => {
    resolveCurrent = resolve;
  });
}

export function resolveConfirmAction(confirmed: boolean): void {
  if (!state.open) return;
  const resolve = resolveCurrent;
  resolveCurrent = null;
  publish(closed);
  resolve?.(confirmed);
}

export function getConfirmActionState(): ConfirmActionState {
  return state;
}

export function subscribeConfirmAction(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
