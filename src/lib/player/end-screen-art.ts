/** Catalog imagery is served at medium sizes; ask for the largest variant. */
export function endScreenArt(url?: string): string | undefined {
  if (!url) return undefined;
  return url
    .replace(/\/(background|poster)\/(small|medium)\//, "/$1/large/")
    .replace(/(\/t\/p\/)(?:w\d+|h\d+|original)(?:_and_h\d+)?(?:_bestv2)?\//, "$1original/");
}

export async function warmEndScreenArt(urls: Array<string | undefined>): Promise<void> {
  await Promise.all(
    [...new Set(urls.filter((url): url is string => !!url))].map(
      (url) =>
        new Promise<void>((resolve) => {
          const image = new Image();
          const timer = globalThis.setTimeout(finish, 3000);
          function finish() {
            globalThis.clearTimeout(timer);
            image.onload = null;
            image.onerror = null;
            resolve();
          }
          image.decoding = "async";
          image.onload = () => {
            void image
              .decode()
              .catch(() => {})
              .then(finish);
          };
          image.onerror = finish;
          image.src = url;
        }),
    ),
  );
}
