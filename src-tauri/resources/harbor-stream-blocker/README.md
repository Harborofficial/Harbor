# Harbor stream blocker

The extension manifest and request rules Harbor ships for its own in-app blocker.

- `rules.json` is generated from `src/lib/privacy/blocklist.ts` by
  `node scripts/build-stream-blocker.mjs`. Do not edit it by hand; rerun the
  script after changing the blocklist.
- `manifest.json` loads `twitch-vaft.js` on `*.twitch.tv` documents at
  `document_start`, in the page world, so the script runs before the player.
- `twitch-vaft.js` is the `vaft` userscript from
  [pixeltris/TwitchAdSolutions](https://github.com/pixeltris/TwitchAdSolutions),
  version 37.0.0, vendored unmodified at commit
  c51ef2fe8f667f9dc9216eb550924cf0d732ce27. Its MIT license is kept in
  `LICENSE-TwitchAdSolutions`.
