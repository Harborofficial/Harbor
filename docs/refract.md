# Refract tracker

[Refract](https://getrefract.app/) · [API documentation](https://getrefract.app/developers)

In Harbor, open Settings → Trackers → Refract and connect using a personal API key from Refract. Use profile:read, library:read, library:write and history:write. Do not share or commit your key. Harbor uses its existing secret store.

This opt-in integration sends movie and episode watches (manual or playback) and new Harbor watchlist additions/removals to Refract. The playback setting accepts a percentage or a time threshold; natural completion also logs. Early Refract logging counts as watched in Refract but does not change Harbor's own completion threshold. Only the primary profile is synced.

Watched events are queued locally for retry, with original timestamps and duplicate protection. Identity resolution uses external IDs rather than guessed titles. Watchlist changes use membership-only endpoints, preserving existing watched history and other library statuses. Unmatched items are reported in the Refract settings.

The initial upstream contribution is outbound only. Reverse history/watchlist sync, bulk imports and additional media types are not included.

## Validation

The earlier isolated Windows preview was smoke-tested by users across multiple accounts, including authentication, manual and automatic logging, time/percentage thresholds, and watchlist addition/removal. The port to the latest upstream development branch needs a fresh automated and Windows smoke-test pass.

Run the project's standard typecheck and tests. Focused Refract tests: `node --test tests/refract-api.test.mjs tests/refract-sync.test.mjs`. The existing resume-autosave session tests also exercise the separation between early Refract logging and native completion.
