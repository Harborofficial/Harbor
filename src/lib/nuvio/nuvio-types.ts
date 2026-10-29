/**
 * Nuvio Types & Schema Definitions
 * Supports Supabase PostgREST & GoTrue auth for Nuvio TV backend.
 */

export type NuvioSession = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix timestamp in seconds
  token_type: string;
  user: {
    id: string;
    email?: string;
    created_at?: string;
  };
};

export type NuvioProfile = {
  id: string;
  user_id: string;
  profile_index: number; // Strictly 1..6
  name: string;
  avatar_color_hex?: string;
  avatar_id?: string | null;
  avatar_url?: string | null;
  profile_background_id?: string | null;
  profile_background_url?: string | null;
  is_kids?: boolean;
  uses_primary_addons?: boolean;
  uses_primary_plugins?: boolean;
  pin_enabled?: boolean;
  pin_locked_until?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type ProfilePushPayload = {
  profile_index: number;
  name: string;
  avatar_color_hex: string;
  avatarColorHex?: string;
  uses_primary_addons?: boolean;
  uses_primary_plugins?: boolean;
  avatar_id?: string | null;
  avatarId?: string | null;
  avatar_url?: string | null;
  avatarUrl?: string | null;
  profile_background_id?: string | null;
  profile_background_url?: string | null;
  pin_enabled?: boolean;
};

export type PinVerifyResult = {
  unlocked: boolean;
  retry_after_seconds?: number;
  message?: string;
};

export type AvatarCatalogItem = {
  id: string;
  display_name: string;
  storage_path: string;
  category: string;
  sort_order: number;
  is_active: boolean;
  bg_color?: string | null;
};

export type NuvioDeviceCodeSession = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
};

export type NuvioWatchProgress = {
  id?: string;
  user_id?: string;
  profile_id: number;
  content_id: string; // e.g. "tt1234567"
  progress_key: string; // e.g. "tt1234567" or "tt1234567_s1e2"
  progress_seconds: number;
  duration_seconds: number;
  season?: number | null;
  episode?: number | null;
  updated_at?: string;
  last_watched?: number;
  title?: string | null;
  name?: string | null;
  poster?: string | null;
  background?: string | null;
};

export type NuvioWatchedItem = {
  id?: string;
  user_id?: string;
  profile_id?: number;
  content_id: string;
  content_type?: string;
  title?: string;
  season?: number | null;
  episode?: number | null;
  watched_at?: string | number;
};

export type NuvioAddonItem = {
  url: string;
  name: string;
  enabled: boolean;
  sort_order: number;
};

export type NuvioAccountState = {
  session: NuvioSession | null;
  profiles: NuvioProfile[];
  activeProfileIndex: number; // 1..6
  lastSyncedAt: number | null;
};

export type NuvioPosterShape = "POSTER" | "SQUARE" | "LANDSCAPE";

export type NuvioLibraryItem = {
  content_id: string;
  content_type: string;
  name: string;
  poster?: string | null;
  poster_shape?: NuvioPosterShape;
  background?: string | null;
  logo?: string | null;
  description?: string | null;
  release_info?: string | null;
  imdb_rating?: number | null;
  genres?: string[];
  addon_base_url?: string | null;
  added_at: number;
};

export type NuvioLibrarySyncKey = {
  content_id: string;
  content_type: string;
};

export type NuvioLibraryDeltaItem = NuvioLibraryItem & {
  event_id: number;
  operation: "UPSERT" | "DELETE";
};
