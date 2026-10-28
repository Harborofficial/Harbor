// Keep independently sourced metadata from influencing adjacent text in RTL layouts.
export function bidiIsolate(text: string): string {
  return text ? `\u2068${text}\u2069` : text;
}

export function bidiLines(text: string): string {
  return text.split("\n").map(bidiIsolate).join("\n");
}
