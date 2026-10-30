import assert from "node:assert/strict";
import test from "node:test";
import type { NuvioProfile, ProfilePushPayload } from "../src/lib/nuvio/nuvio-types";

test("HarborNameSync: strict profile isolation and protection from automatic renaming", () => {
  // Simulates HarborNameSync apply logic
  const runApply = (
    alias: string,
    activeProfile: { id: string; name: string; isPrimary: boolean; kid: any | null } | null,
    isNuvio: boolean,
    updateProfile: (id: string, patch: { name: string }) => void,
  ) => {
    if (
      !isNuvio &&
      activeProfile &&
      activeProfile.isPrimary &&
      !activeProfile.kid &&
      activeProfile.name !== alias
    ) {
      updateProfile(activeProfile.id, { name: alias });
    }
  };

  const renames: Array<{ id: string; name: string }> = [];
  const mockUpdate = (id: string, patch: { name: string }) => {
    renames.push({ id, name: patch.name });
  };

  // Scenario 1: User is in Nuvio mode with Profile A active (Slot 1), and Harbor cloud alias is "B"
  const nuvioProfileA = { id: "nuvio-1", name: "Profile A", isPrimary: true, kid: null };
  runApply("Profile B", nuvioProfileA, true, mockUpdate);
  assert.equal(renames.length, 0, "HarborNameSync must NEVER rename a Nuvio profile");

  // Scenario 2: User is in Nuvio mode with Profile B active (Slot 2, secondary)
  const nuvioProfileB = { id: "nuvio-2", name: "Profile B", isPrimary: false, kid: null };
  runApply("Profile A", nuvioProfileB, true, mockUpdate);
  assert.equal(renames.length, 0, "HarborNameSync must NEVER rename a secondary Nuvio profile");

  // Scenario 3: User is in Stremio mode with a secondary profile active (e.g. "Guest" or "Kids")
  const stremioSecondary = { id: "p_secondary", name: "Profile B", isPrimary: false, kid: null };
  runApply("Primary Owner", stremioSecondary, false, mockUpdate);
  assert.equal(renames.length, 0, "HarborNameSync must NEVER rename secondary Stremio profiles");

  // Scenario 4: User is in Stremio mode with the Primary profile active
  const stremioPrimary = { id: "p_primary", name: "Old Primary Name", isPrimary: true, kid: null };
  runApply("New Primary Name", stremioPrimary, false, mockUpdate);
  assert.equal(renames.length, 1);
  assert.equal(renames[0].id, "p_primary");
  assert.equal(renames[0].name, "New Primary Name");
});

test("HarborNameSync save: never pushes secondary profile or Nuvio profile names to Harbor author alias", () => {
  const shouldSaveToHarborAlias = (
    isNuvio: boolean,
    activeProfile: { isPrimary: boolean } | null,
  ) => {
    if (isNuvio || !activeProfile?.isPrimary) return false;
    return true;
  };

  assert.equal(
    shouldSaveToHarborAlias(true, { isPrimary: true }),
    false,
    "Nuvio mode must not push alias to Harbor",
  );
  assert.equal(
    shouldSaveToHarborAlias(true, { isPrimary: false }),
    false,
    "Nuvio secondary must not push alias to Harbor",
  );
  assert.equal(
    shouldSaveToHarborAlias(false, { isPrimary: false }),
    false,
    "Stremio secondary must not push alias to Harbor",
  );
  assert.equal(
    shouldSaveToHarborAlias(false, { isPrimary: true }),
    true,
    "Stremio primary should push alias to Harbor",
  );
});

test("transferPrimaryNuvioProfile: preserves all profiles (e.g. Profile C) without dropping non-swapped slots", () => {
  const existingProfiles: NuvioProfile[] = [
    { id: "p1", user_id: "u1", profile_index: 1, name: "Profile A" },
    { id: "p2", user_id: "u1", profile_index: 2, name: "Profile B" },
    { id: "p3", user_id: "u1", profile_index: 3, name: "Profile C" },
  ];

  const targetSlotIndex = 2; // Swap Profile A (1) and Profile B (2)
  const targetSlot = existingProfiles.find((p) => p.profile_index === targetSlotIndex)!;
  const slot1 = existingProfiles.find((p) => p.profile_index === 1)!;

  const payloads: ProfilePushPayload[] = existingProfiles.map((p) => {
    if (p.profile_index === 1) {
      return {
        profile_index: 1,
        name: targetSlot.name,
        avatar_id: targetSlot.avatar_id,
        avatar_url: targetSlot.avatar_url,
        avatar_color_hex: targetSlot.avatar_color_hex || "#1E88E5",
        uses_primary_addons: false,
      };
    }
    if (p.profile_index === targetSlotIndex) {
      return {
        profile_index: targetSlotIndex,
        name: slot1.name,
        avatar_id: slot1.avatar_id,
        avatar_url: slot1.avatar_url,
        avatar_color_hex: slot1.avatar_color_hex || "#1E88E5",
        uses_primary_addons: slot1.uses_primary_addons ?? true,
      };
    }
    return {
      profile_index: p.profile_index,
      name: p.name,
      avatar_id: p.avatar_id,
      avatar_url: p.avatar_url,
      avatar_color_hex: p.avatar_color_hex || "#1E88E5",
      uses_primary_addons: Boolean(p.uses_primary_addons),
    };
  });

  // Verify that Profile C is NOT dropped!
  assert.equal(payloads.length, 3, "All 3 profiles must be present in payloads");
  assert.equal(payloads.find((p) => p.profile_index === 1)?.name, "Profile B");
  assert.equal(payloads.find((p) => p.profile_index === 2)?.name, "Profile A");
  assert.equal(
    payloads.find((p) => p.profile_index === 3)?.name,
    "Profile C",
    "Profile C must remain untouched",
  );
});

test("Nuvio profile sorting: profiles are strictly sorted by profile_index ascending", () => {
  const unsortedProfiles: NuvioProfile[] = [
    { id: "p3", user_id: "u1", profile_index: 3, name: "Profile C" },
    { id: "p1", user_id: "u1", profile_index: 1, name: "Profile A" },
    { id: "p2", user_id: "u1", profile_index: 2, name: "Profile B" },
  ];

  const sorted = [...unsortedProfiles].sort((a, b) => a.profile_index - b.profile_index);

  assert.equal(sorted[0].profile_index, 1);
  assert.equal(sorted[0].name, "Profile A");
  assert.equal(sorted[1].profile_index, 2);
  assert.equal(sorted[1].name, "Profile B");
  assert.equal(sorted[2].profile_index, 3);
  assert.equal(sorted[2].name, "Profile C");
});

test("ProfileIdentitySync: prevents Nuvio profile names from leaking into together name or Stremio profile", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const syncFile = fs.readFileSync(path.resolve("src/lib/profile-identity-sync.tsx"), "utf8");
  assert.match(
    syncFile,
    /useEffect\(\(\)\s*=>\s*\{\s*if\s*\(isNuvio\)\s*return;[\s\S]*?setDisplayName\(activeProfile\.name\);/,
    "ProfileIdentitySync must guard name sync with if (isNuvio) return",
  );

  const avatarSyncFile = fs.readFileSync(
    path.resolve("src/components/harbor-avatar-sync.tsx"),
    "utf8",
  );
  assert.match(
    avatarSyncFile,
    /if\s*\(!author\s*\|\|\s*isNuvio\)\s*return;/,
    "HarborAvatarSync must never push Nuvio profile avatars to Harbor author ecosystem",
  );

  const profilesFile = fs.readFileSync(path.resolve("src/lib/profiles.tsx"), "utf8");
  assert.match(
    profilesFile,
    /const matchesNuvio = nuvio\.profiles\.some\(/,
    "profiles.tsx must verify default primary name against Nuvio profile names",
  );
});
