/** Keep transport query parameters separate from Stremio resource paths. */
export function addonBaseUrl(transportUrl: string): string {
  const url = new URL(transportUrl);
  url.pathname = url.pathname.replace(/\/manifest\.json\/?$/i, "").replace(/\/+$/, "");
  url.hash = "";
  return url.toString().replace(/^(https?:\/\/[^/?#]+)\/(?=[?#]|$)/, "$1");
}

/** resourcePath is an already encoded, relative Stremio resource path. */
export function addonResourceUrl(transportUrl: string, resourcePath: string): string {
  const url = new URL(addonBaseUrl(transportUrl));
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${resourcePath.replace(/^\/+/, "")}`;
  return url.toString();
}
