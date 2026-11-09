import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT } from "../src/lib/settings/defaults.ts";
import { mergeRecoveredSettings, recoveryMatchesSource } from "../src/lib/settings/recovery.ts";
import type { Settings } from "../src/lib/settings/types.ts";

function settings(patch: Partial<Settings> = {}): Settings {
  return { ...DEFAULT, ...patch, theme: { ...DEFAULT.theme, ...patch.theme } };
}

test("a background image loaded before disk recovery survives the recovered theme", () => {
  const initial = settings();
  const current = settings({ theme: { ...initial.theme, backgroundImage: "data:image/loaded" } });
  const recovered = settings({
    seekrApiKey: "from-disk",
    theme: { ...DEFAULT.theme, preset: "midnight" },
  });

  const merged = mergeRecoveredSettings(recovered, current, initial);
  assert.equal(merged.seekrApiKey, "from-disk");
  assert.equal(merged.theme.preset, "midnight");
  assert.equal(merged.theme.backgroundImage, "data:image/loaded");
});

test("a background image loaded after disk recovery is applied to the recovered theme", () => {
  const initial = settings();
  const recovered = settings({ theme: { ...DEFAULT.theme, preset: "midnight" } });

  const merged = mergeRecoveredSettings(recovered, initial, initial);
  assert.equal(merged.theme.preset, "midnight");
  assert.equal(merged.theme.backgroundImage, null);

  // The background effect runs later and must not undo the recovered theme.
  const afterImage = {
    ...merged,
    theme: { ...merged.theme, backgroundImage: "data:image/later" },
  };
  assert.equal(afterImage.theme.preset, "midnight");
  assert.equal(afterImage.theme.backgroundImage, "data:image/later");
});

test("user edits made during recovery win without discarding recovered values", () => {
  const initial = settings();
  const current = settings({
    seekrApiKey: "typed-now",
    theme: {
      ...initial.theme,
      preset: "custom",
      backgroundImage: "data:image/typed",
    },
  });
  const recovered = settings({
    seekrApiKey: "from-disk",
    theme: { ...DEFAULT.theme, preset: "midnight" },
  });

  const merged = mergeRecoveredSettings(recovered, current, initial);
  assert.equal(merged.seekrApiKey, "typed-now");
  assert.equal(merged.theme.preset, "custom");
  assert.equal(merged.theme.backgroundImage, "data:image/typed");
});

test("a rewritten theme object with the same values is not treated as an edit", () => {
  const initial = settings();
  const current = settings({ theme: { ...initial.theme } });
  const recovered = settings({ theme: { ...DEFAULT.theme, preset: "midnight" } });

  const merged = mergeRecoveredSettings(recovered, current, initial);
  assert.equal(merged.theme.preset, "midnight");
});

test("disk recovery is skipped when the profile changed while it loaded", () => {
  assert.equal(
    recoveryMatchesSource(
      { profileId: "alice", linked: false },
      { profileId: "alice", linked: false },
    ),
    true,
  );
  assert.equal(
    recoveryMatchesSource(
      { profileId: "alice", linked: false },
      { profileId: "bob", linked: false },
    ),
    false,
  );
  assert.equal(
    recoveryMatchesSource(
      { profileId: "alice", linked: false },
      { profileId: "alice", linked: true },
    ),
    false,
  );
});
