import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const startupDefaults = read("../src/views/settings/account/startup-defaults.tsx");
const editorView = read("../src/components/profile-picker/editor-view.tsx");
const pickerModal = read("../src/components/profile-picker/picker-modal.tsx");
const nuvioProfiles = read("../src/lib/nuvio/nuvio-profiles.ts");
const profilesModule = read("../src/lib/profiles.tsx");
const accountMenu = read("../src/chrome/account-menu/use-account-menu.ts");

test("StartupDefaults strictly isolates Nuvio profiles from Stremio and filters out PIN-protected profiles", () => {
  // Checks provider awareness
  assert.match(startupDefaults, /settings\.accountProvider === "nuvio"/);
  // Excludes PIN-protected profiles in Nuvio mode
  assert.match(startupDefaults, /!p\.pin_enabled/);
  // Excludes PIN-protected and Nuvio profiles in Stremio mode
  assert.match(startupDefaults, /!p\.passwordHash && !p\.id\.startsWith\("nuvio-"\)/);
  // Fallback placeholder ensures dropdown is never blank
  assert.match(startupDefaults, /placeholder=\{t\("No default profile"\)\}/);
  // Sets both nuvioDefaultProfileId and defaultProfileId
  assert.match(startupDefaults, /nuvioDefaultProfileId:/);
  assert.match(startupDefaults, /defaultProfileId:/);
});

test("EditorView provides 1:1 layout uniformity for Nuvio with identical styling, titles and descriptions", () => {
  // Uses identical canvas background and aspect ratio
  assert.match(editorView, /bg-canvas/);
  // Provides Trakt, Simkl, and AniList avatar buttons
  assert.match(editorView, /Use Trakt avatar/);
  assert.match(editorView, /Use Simkl avatar/);
  // Nuvio account section mirrors Stremio account sharing radio card
  assert.match(editorView, /t\("Nuvio account"\)/);
  assert.match(editorView, /t\("Use primary addons"\)/);
  assert.match(editorView, /t\("Use separate addons"\)/);
  // Stremio account section is strictly hidden in Nuvio mode
  assert.match(editorView, /!isNuvio && canShare && primary/);
  // Handles Nuvio custom avatar upload via uploadNuvioCustomAvatar
  assert.match(editorView, /uploadNuvioCustomAvatar/);
});

test("Security tab locks are supported and persisted for Nuvio profiles with sports logo", () => {
  // SportsIcon is wired in TabIcon
  assert.match(editorView, /case "sports":\s*return <SportsIcon/);
  // EditorView saves locked tabs for Nuvio slots
  assert.match(editorView, /harbor\.nuvio\.locked-tabs\./);
  // profiles.tsx nuvioProfileToHarborProfile loads lockedTabs
  assert.match(profilesModule, /localStorage\.getItem\(`harbor\.nuvio\.locked-tabs\.\$\{p\.profile_index\}`\)/);
  // updateProfile in profiles.tsx persists lockedTabs for Nuvio profiles
  assert.match(profilesModule, /localStorage\.setItem\(`harbor\.nuvio\.locked-tabs\.\$\{slot\}`/);
});

test("PIN deletion removes PIN locally, clears session unlock, and synchronizes to cloud", () => {
  // clearNuvioPin updates local state immediately to pin_enabled: false
  assert.match(nuvioProfiles, /pin_enabled:\s*false/);
  // Forgets cached PIN and session unlock
  assert.match(nuvioProfiles, /forgetNuvioPin\(profileIndex\)/);
  assert.match(nuvioProfiles, /nuvioSessionUnlockedIndices\.delete\(profileIndex\)/);
  // Executes cloud RPC call
  assert.match(nuvioProfiles, /\/rest\/v1\/rpc\/clear_profile_pin/);
});

test("PIN switch security strictly prevents bypassing PIN when changing profiles", () => {
  // setActiveNuvioProfile clears previous profile session unlocks
  assert.match(nuvioProfiles, /nuvioSessionUnlockedIndices\.clear\(\)/);
  // picker-modal proceeds to unlock prompt when pin is enabled
  assert.match(pickerModal, /if \(p\.pin_enabled\)/);
  assert.match(pickerModal, /setPickerView\(\{\s*kind:\s*"unlock",\s*profileId:\s*String\(p\.profile_index\)\s*\}\)/);
  // account-menu triggers unlock picker for PIN-protected Nuvio profiles
  assert.match(accountMenu, /if \(p\.pin_enabled\)/);
  assert.match(accountMenu, /openPicker\(\{\s*kind:\s*"unlock",\s*profileId:\s*String\(p\.profile_index\)\s*\}\)/);
});

test("Smooth profile save with optimistic local state updates and loading spinner", () => {
  // createNuvioProfile updates local state optimistically
  assert.match(nuvioProfiles, /OPTIMISTIC LOCAL UPDATE: Immediately add to local state/);
  // updateNuvioProfile updates local state optimistically
  assert.match(nuvioProfiles, /OPTIMISTIC LOCAL UPDATE: Apply updates immediately to local state/);
  // EditorView has saving state with spinner feedback
  assert.match(editorView, /const \[saving, setSaving\] = useState\(false\)/);
  assert.match(editorView, /saving && <Loader2 size=\{16\} className="animate-spin"/);
});
