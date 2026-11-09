import { invoke } from "@tauri-apps/api/core";
import { activeProfileId } from "@/lib/active-profile-id";
import { confirmAction } from "@/lib/confirm-action";
import { t } from "@/lib/i18n";
import { renamePinnedMusicPlaylist } from "./pinned-playlists";
import type { MusicAlbum, MusicArtist, MusicPlaylist, MusicTrack } from "./types";

export function confirmLinkedMusicPlaylistEdit(
  playlist: Pick<MusicPlaylist, "source">,
): Promise<boolean> {
  if (!playlist.source) return Promise.resolve(true);
  return confirmAction({
    title: t("music.linked.editTitle"),
    message: t("music.linked.editConfirm"),
    confirmLabel: t("music.linked.editContinue"),
  });
}

export type MusicLibrarySnapshot = {
  albums: MusicAlbum[];
  artists: MusicArtist[];
  playlists: MusicPlaylist[];
};

export async function loadMusicLibrary(): Promise<MusicLibrarySnapshot> {
  const [albums, artists, playlists] = await Promise.all([
    invoke<MusicAlbum[]>("music_list_albums"),
    invoke<MusicArtist[]>("music_list_artists"),
    invoke<MusicPlaylist[]>("music_list_playlists"),
  ]);
  return { albums, artists, playlists };
}

export async function createMusicPlaylist(name: string): Promise<MusicPlaylist> {
  const base = name.trim();
  let candidate = base;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await invoke<MusicPlaylist>("music_create_playlist", { name: candidate });
    } catch (error) {
      // Keep the database's uniqueness guarantee, including concurrent creations.
      if (attempt >= 4 || !/UNIQUE constraint failed:\s*playlists\.name/i.test(String(error))) {
        throw error;
      }
      const playlists = await listMusicPlaylists();
      const names = new Set(playlists.map((playlist) => playlist.name.trim().toLocaleLowerCase()));
      let suffix = 1;
      do {
        candidate = `${base} (${suffix++})`;
      } while (names.has(candidate.toLocaleLowerCase()));
    }
  }
}

export function renameMusicPlaylist(playlistId: string, name: string): Promise<MusicPlaylist> {
  return invoke<MusicPlaylist>("music_rename_playlist", { playlistId, name }).then((playlist) => {
    window.dispatchEvent(new Event("harbor:music-library-changed"));
    return playlist;
  });
}

export function deleteMusicPlaylist(playlistId: string): Promise<void> {
  return invoke("music_delete_playlist", { playlistId }).then(() => {
    window.dispatchEvent(new Event("harbor:music-library-changed"));
  });
}

export function listMusicPlaylists(): Promise<MusicPlaylist[]> {
  return invoke<MusicPlaylist[]>("music_list_playlists");
}

async function linkedPlaylistCommand(command: string, args: Record<string, string>): Promise<MusicPlaylist> {
  const profile = activeProfileId();
  const playlist = await invoke<MusicPlaylist>(command, args);
  if (activeProfileId() !== profile) {
    throw new Error("Music profile changed while fetching playlist; retry in the current profile");
  }
  if (command === "music_sync_linked_playlist") renamePinnedMusicPlaylist(playlist.id, playlist.name);
  window.dispatchEvent(new Event("harbor:music-library-changed"));
  return playlist;
}

export function importLinkedMusicPlaylist(sourceId: string): Promise<MusicPlaylist> {
  return linkedPlaylistCommand("music_import_linked_playlist", { connectorId: "youtube", sourceId });
}

export function syncLinkedMusicPlaylist(playlistId: string): Promise<MusicPlaylist> {
  return linkedPlaylistCommand("music_sync_linked_playlist", { playlistId });
}

export function unlinkMusicPlaylist(playlistId: string): Promise<MusicPlaylist> {
  return linkedPlaylistCommand("music_unlink_playlist", { playlistId });
}

export function addTrackToMusicPlaylist(
  playlistId: string,
  track: MusicTrack,
): Promise<MusicPlaylist> {
  return invoke<MusicPlaylist>("music_add_to_playlist", { playlistId, track });
}

export function addTracksToMusicPlaylist(
  playlistId: string,
  tracks: MusicTrack[],
): Promise<MusicPlaylist> {
  return invoke<MusicPlaylist>("music_add_tracks_to_playlist", { playlistId, tracks });
}

export function reorderMusicPlaylist(
  playlistId: string,
  trackId: string,
  toIndex: number,
): Promise<MusicPlaylist> {
  return invoke<MusicPlaylist>("music_reorder_playlist", { playlistId, trackId, toIndex });
}

export function removeTrackFromMusicPlaylist(
  playlistId: string,
  trackId: string,
): Promise<MusicPlaylist> {
  return invoke<MusicPlaylist>("music_remove_from_playlist", { playlistId, trackId });
}

export function importMusicM3u(path: string): Promise<MusicTrack[]> {
  return invoke<MusicTrack[]>("music_import_m3u", { path });
}

export function exportMusicM3u(playlistId: string, path: string): Promise<void> {
  return invoke("music_export_m3u", { playlistId, path });
}
