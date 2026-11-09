# Harbor v1.0.2 Beta

Harbor 1.0.2 focuses on making everyday use smoother and more reliable, with a better playback queue, new episode reviews, profile themes, major Continue Watching improvements, stronger Nuvio Cloud sync, a fuller Music experience, offline downloads, games improvements, and a large number of playback and platform fixes.

---

## 🎬 Better Playback & Queue

- **Expanded Playback Queue:** Add movies and episodes to a queue and keep watching without manually selecting the next item. (@pengunnn)
- **Improved Queue Controls:** Queue navigation and playback transitions are now smoother and more predictable. — Settings → Playback → Player & quality → Up next → Queue drives Next/Previous (@pengunnn).
- **Profile-Safe Queues:** Queue items now stay properly separated between profiles. (@pengunnn)
- **Episode Panel Sync:** The episode panel now follows the episode that is actually playing from the queue. (@Thunderhawkk)
- **More Reliable Rewatching:** Rewatching a show should no longer jump unexpectedly to later seasons. (@glpc-blaze)
- **RAM-Only Video Buffering:** Video buffering is now kept entirely in system RAM and dynamically capped based on available memory, eliminating disk thrashing and reducing playback stalls. — Settings → Playback → Video tuning → Playback buffering (@comet776).
- **macOS Playback Speed Fix:** Fixed playback stalls related to playback-speed controls on newer macOS versions. (@Talal1011)
- **Stable Stream Switching:** Switching sources no longer interrupts Continue Watching or loses the current playback position. (@Thunderhawkk)
- **Confirmed Source Reuse:** Harbor now confirms the exact remembered release before reusing it, instead of silently falling back to a similar source. (@Thunderhawkk)
- **No False Source Errors:** Slow source starts no longer show an error before playback has had a chance to begin. (@Thunderhawkk)
- **Correct Finale Detection:** More Like This no longer appears on unfinished airing seasons, future episodes, or TBA episodes. (@Thunderhawkk)
- **Hide Watched in More Like This:** The end-of-playback recommendation card can now skip titles you have already watched, using the same watch history as the featured hero. — Settings → Playback → Player & quality → Up next → More like this at the end → Hide watched titles (@Thunderhawkk).
- **Episode Descriptions Restored:** Missing episode descriptions are fetched again for Up Next and the episode panel. (@Thunderhawkk)
- **2x Mouse Hold:** Hold the left mouse button on the video for temporary 2x speed. A quick tap still behaves as a normal click, and pausing or cancelling the hold restores the previous speed. (@Thunderhawkk)
- **Faster Seek Previews:** Seek-bar thumbnails on remote streams now appear with much less delay. (@Thunderhawkk)
- **Seekr Preview Thumbnails:** Add your own Seekr API key to use its preview sprites before local generation, with automatic fallback to local FFmpeg trickplay when Seekr has no match or the key is blank. — Settings → Appearance → Player layout → Seek bar → Seekr · preview thumbnails (@Thunderhawkk).
- **Faster Continue Watching Start:** Continue Watching appears faster when Harbor launches. (@Thunderhawkk)
- **Original Audio Language:** A new Original audio preference follows each title's original language, with a Japanese fallback for anime. — Settings → Languages & subtitles → Languages → Audio languages → choose **Original** (@Thunderhawkk).
- **Subtitles Above Controls:** Subtitles can now stay above the visible player controls so buttons no longer cover dialogue. — Settings → Languages & subtitles → Subtitles → **Subtitle style** (Look tab) → **Move subtitles above player controls** (@Thunderhawkk).
- **Player Title Artwork:** Show the movie or show logo instead of the plain title at the top of the player when artwork is available. — Settings → Appearance → Theme & appearance → Interface → Title text → **Use title artwork in the player** (@Thunderhawkk).
- **Content Advisory Fit:** The content advisory card now sizes itself to its text instead of clipping or leaving large empty space. (@Thunderhawkk)
- **Audio Device Fallback:** If the selected audio output device is unavailable, Harbor now falls back to the system default instead of playing video without sound. (@Thunderhawkk)
- **Chapter Marks Off by Default:** Seek-bar chapter marks now start off for new installs. (@Thunderhawkk)
- **Advanced Subtitle Styling:** Embedded playback now respects advanced mpv subtitle styles from your own configuration. (@Thunderhawkk)

---

## ⭐ Reviews, Ratings & Social Features

- **Episode Reviews:** Read IMDb user reviews and Trakt comments directly from episode list, grid, and strip views, with sorting by likes, date, rating, and length. (@Ammar1OP)
- **Review Translation:** Translate individual reviews or all currently shown reviews from Letterboxd, Trakt, and episode reviews into your preferred language. (@Ammar1OP, @Thunderhawkk)
- **Better Review Sorting:** Letterboxd reviews can now be sorted by most liked, most recent, highest rated, lowest rated, or longest, while episode review sorting is handled directly through IMDb and Trakt. (@Ammar1OP, @Thunderhawkk)
- **Improved Spoiler Handling:** Spoiler review titles are now hidden together with the review body, and explicitly revealed spoilers can be included when translating shown reviews. (@Ammar1OP, @Thunderhawkk)
- **Search Your Full Ratings History:** Find a title across your entire ratings history, not just the ratings currently loaded on screen. (@Auramist)
- **Sort & Filter Ratings:** Sort your ratings by score and filter entries that include written reviews. (@Auramist)
- **Edit Ratings & Reviews:** Update your own ratings and written reviews directly from your profile. (@Auramist)
- **Quote Ratings:** Quote a rating as a rich card with its poster, title, score, and review in profile comments or group posts, including published ratings from friends and other users. (@Auramist)
- **More Reliable Review Loading:** Improved loading, retry behavior, and pagination for reviews and ratings. (@Ammar1OP, @Auramist, @Thunderhawkk)

---

## 🎨 Themes & Profile Customization

- **Per-Profile Themes:** Each Harbor profile can now use its own theme. — Your profile → Edit profile → Profile theme (@Auramist).
- **Custom Color Palettes:** Personalize profile colors without losing your custom choices when switching palettes. — Your profile → Edit profile → Profile theme → Custom (@Auramist).
- **New Midnight Theme:** Added a new dark glass-style theme with updated cards and hover effects. — Settings → Appearance → Theme & appearance → Theme → Midnight (@3-pr).
- **Theme Author Credits:** Beta themes now show who created them. (@3-pr)
- **Improved Theme Readability:** Profile dialogs and surfaces now stay easier to read with custom themes. (@Auramist)
- **Midnight Notification Indicator:** Unread notifications are now shown in the account menu when using Midnight. (@3-pr)
- **Midnight Polish:** Improved hover-preview behavior and scrolling on nested pages. (@3-pr)
- **Theme Studio Layout Reset:** Reset individual layout pieces in Theme Studio instead of losing the whole layout. — Settings → Appearance → Theme & appearance → Theme → open **Theme Studio** → layout reset controls (@Thunderhawkk).
- **Color Editor From Theme Banner:** Clicking the active theme banner now opens the colour editor directly. (@Thunderhawkk)
- **Palette Preview Restored:** Leaving the colour editor without saving now restores the previous palette preview. (@Thunderhawkk)
- **Poster Overlay Toggle:** TV cards can hide the logo and poster overlay for a cleaner wide card. — Settings → Appearance → Theme & appearance → Interface → Poster card style → **Logo position** → **Off** (@Thunderhawkk).
- **Custom Poster Service TV Art:** Custom poster services can now supply 16:9 TV artwork, and templates can switch between landscape and poster with `{shape}`. — Settings → Sources & library → Library & metadata → **Metadata providers** → API budget → custom poster service (@Thunderhawkk).
- **Screensaver Title Logos:** The ambient screensaver uses title logos for a cleaner idle screen. (@Thunderhawkk)

---

## 📂 Collections & Library

- **Collection Folder Hub:** Multi-source collection folders now open in a dedicated hub instead of automatically choosing the first source, with Classic rows and Grid layouts. — Library → open a multi-source folder → Classic / Grid (@3-pr, @Thunderhawkk).
- **Remembered Folder Layouts:** Choose a Classic rows or Grid layout for collection folders and Harbor will remember the layout for each folder. — Library → folder card → Edit folder images → Layout Style (@3-pr, @Thunderhawkk).
- **PublicMetaDB Watchlist Fix:** Restored missing watchlist actions on title pages. (@comet776)
- **Better Profile Separation:** Library and watched-state data are now more reliably kept separate between profiles and accounts. (@glpc-blaze, @comet776)
- **Custom Group Artwork & Titles:** Customize the artwork and title of your library groups. — Library → My groups → edit a group → artwork and title controls (@Thunderhawkk).
- **Choose Home Sections per Group:** Pick which home sections a library group shows. — Library → My groups → edit a group → Home sections (@Thunderhawkk).
- **International List URLs:** MDBList and Trakt list URLs with non-Latin characters or percent-encoding now work. (@Thunderhawkk)
- **Jellyfin Collection Members:** Jellyfin collections now show their members in your library and in search. (@Thunderhawkk)
- **Search Collections by Member Titles:** Search a media server collection by the titles inside it. (@Thunderhawkk)
- **Manga Favorites Reliability:** Favorites are preserved when a save fails, and the error message now explains what happened. (@Thunderhawkk)
- **Manga Source Identity:** Favorites and sources stay correctly tied to their original plugin source. (@Thunderhawkk)
- **Manga Pagination:** Source pages load once per scroll, with a manual retry after a failed page. (@Thunderhawkk)
- **Better Plugin Covers:** Manga plugin covers now load more reliably, with HTTPS-first loading and a native proxy fallback. (@Thunderhawkk)
- **Manga Reader Upscaling:** Upscale manga pages on demand with Fast waifu2x or MangaJaNai models, cached per page and prefetched before you scroll to them. — Settings → Playback → Shaders → Manga Shaders → **Manga upscaling** → **Upscale manga pages** / **Upscaling model** (@Thunderhawkk).
- **Manga-Specific Copy:** The create-list dialog now uses manga wording instead of movie wording. (@Thunderhawkk)
- **Ebook Immersive Mode & Sound:** The e-book reader can hide app chrome and remembers a page-turn sound preference. — E-book reader → toolbar → **Mute page-turn sound** / **Unmute page-turn sound** (@Thunderhawkk).
- **Catalog Browser Moved:** The catalog browser now lives outside Discover, with the Surprise Me heading aligned to it. (@Thunderhawkk)

---

## ☁️ Nuvio Cloud Improvements

- **Better Cross-Device Sync:** Playback progress, watched episodes, Continue Watching, and Next Up now sync more reliably between Harbor and Nuvio Mobile. (@glpc-blaze)
- **Faster Watch-State Updates:** Marking an episode watched or unwatched now updates related views more consistently. (@glpc-blaze)
- **Improved Continue Watching Sync:** Resume points and Continue Watching changes now stay more consistent across devices. (@glpc-blaze)
- **Better Next Up Handling:** Improved season transitions, upcoming episodes, and caught-up series behavior. (@glpc-blaze, @comet776)
- **Synced Continue Watching Removals:** Removing or dismissing a title now carries over more reliably between devices. (@glpc-blaze)
- **Improved Trakt & Simkl Support:** External tracking progress is blended into Continue Watching more cleanly with fewer duplicate cards. (@glpc-blaze)
- **Addon Sync Improvements:** Nuvio addon synchronization is more reliable and supports separate or combined display modes. — Settings → Account → Nuvio → Synced addons (@glpc-blaze).
- **Profile Picture Sync:** Fixed profile pictures not updating correctly between Harbor and Nuvio Cloud. (@glpc-blaze, @comet776)
- **Stronger Profile Security:** Improved PIN verification and profile switching, with safer profile transfers that can roll back if a cloud migration fails. (@glpc-blaze, @comet776)
- **Better Account Separation:** Fixed several cases where watched state, progress, or profile data could appear under the wrong account or provider. (@glpc-blaze, @comet776)
- **Safer Provider Switching:** Switching between Nuvio and Stremio now does a better job of preserving your existing data. (@comet776)
- **Less Background Sync Work:** Harbor now avoids unnecessary cloud sync activity, especially while you are watching something. (@comet776)

---

## 📺 Anime & Continue Watching

- **Faster Large Anime Pages:** Large shows now open much faster and are less likely to freeze while loading episodes. (@3-pr, @comet776)
- **Improved Anime Episode Mapping:** Harbor can now recover missing anime mappings, retry unavailable episode data, and better match episode artwork across seasons and sequel entries. (@comet776)
- **Better Anime Continue Watching:** Improved matching and deduplication for anime Continue Watching cards. (@comet776)
- **Fewer Duplicate Cards:** Reduced duplicate Continue Watching entries caused by alternate IDs or manual watch states. (@comet776)
- **Better Season Progression:** Continue Watching now handles season changes, ongoing shows, and future episodes more reliably. (@glpc-blaze, @comet776)
- **Improved Release Timers:** Upcoming episode countdowns and Next Up behavior are more accurate. (@glpc-blaze, @comet776)
- **More Reliable Dismissals:** Dismissed titles should no longer unexpectedly return. (@glpc-blaze)
- **Faster Trakt & Simkl Progress:** Tracking progress can appear more quickly thanks to improved local caching. (@glpc-blaze)
- **Partial Sync Protection:** Incomplete cloud sync results no longer erase valid local Continue Watching progress that was not part of the returned snapshot. (@comet776)
- **Season-Specific Watched State:** Fixed cases where watching episodes in one anime season could incorrectly mark episodes in another season as watched. (@comet776)
- **Episode Thumbnail Recovery:** Harbor now retries episode artwork when updated stills become available. (@comet776)
- **Higher-Quality Anime Hero Art:** Anime pages now skip low-resolution or failed hero images and prefer original-size artwork. (@Thunderhawkk)
- **AniZip Cache Reconciliation:** Anime identity lookups and cached AniZip data now stay in sync. (@Thunderhawkk)
- **Big Picture Continue Watching Advance:** Big Picture now advances to the next episode, shows Up Next, and dedupes cards the same way the main app does. (@Thunderhawkk)
- **Continue Watching Name Dedupe:** The same franchise from two sources no longer appears twice in Big Picture Continue Watching. (@Thunderhawkk)
- **Faster Continue Watching Startup:** Continue Watching cards load faster on launch. (@Thunderhawkk)

---

## 💬 Subtitles & External MPV

- **Addon Subtitles in External MPV:** Harbor can now pass prepared addon subtitles to your own mpv player, filter duplicate tracks, and label tracks by subtitle source so they are easier to identify. (@momo-labsz)
- **Better ASS Subtitle Support:** Styled subtitles and positioned signs are preserved more accurately. (@momo-labsz)
- **Change Font Only:** Added a subtitle option that changes the font while keeping the subtitle's original styling. — Settings → Languages & subtitles → Subtitles → Subtitle style → Styled (ASS) subtitles → Change font only (@momo-labsz).
- **Preserved MPV Settings:** Harbor now avoids overwriting more of your existing mpv subtitle settings. (@momo-labsz)
- **Localized Subtitle Settings:** New subtitle options are translated across supported languages. (@momo-labsz)
- **Clearer External MPV Subtitle List:** Subtitle tracks with the same name are numbered so they can be told apart, exact duplicates are removed, and the external-player subtitle note now appears correctly in both desktop and Big Picture views. (@momo-labsz)
- **Audio-Assisted Auto Sync:** Automatic subtitle sync can use the embedded subtitle track and speech recognition as a reference, including cross-language matching. — Settings → Languages & subtitles → Subtitles → **Subtitle timing** (Sync tab) → **Auto-sync subtitles** → **Match subtitles across languages (experimental)** (@Thunderhawkk).
- **Whisper Speech Model:** Download and re-download the optional Whisper Tiny speech model used for difficult sync attempts. — Settings → Languages & subtitles → Subtitles → **Subtitle timing** (Sync tab) → **Whisper Tiny speech model** → **Download model** / **Remove model** (@Thunderhawkk).
- **Sync From Current Playback:** The subtitle sync dropdown now offers syncing from the current playback position. — In the player → subtitles menu → sync controls (@Thunderhawkk).
- **Skip Disabled Addons:** Disabled cloud and local addons are no longer searched for subtitles, and toggling an addon takes effect immediately. (@Thunderhawkk)
- **Better Track Extraction:** Subtitle track extraction is more reliable and timing offsets stay isolated between tracks. (@Thunderhawkk)
- **Anime Subtitle Search & Addon Fallback:** Anime subtitle search now falls back to addon sources more reliably. (@Thunderhawkk)
- **Embedded Timestamp Preservation:** Auto sync keeps the embedded subtitle timestamps and uses them as a reference across languages. (@Thunderhawkk)
- **SubMaker Localized Progress:** SubMaker translation progress is recognized in all supported interface languages, including partial translations. (@Thunderhawkk)

---

## 🖥️ Interface & Navigation

- **Improved Source Picker:** The condensed source picker now uses tighter spacing and automatically brings the source drawer into view as you navigate toward it. — Settings → Sources & library → Streaming sources → Source picker → Condensed (@AnessBen).
- **Better Mouse & Keyboard Support:** Scrolling to the bottom or using Arrow Down, Page Down, or Space can reveal the source drawer automatically, and closing it returns you to the top cleanly. (@AnessBen)
- **Fixed Missing Addon Logos:** Plugin and addon logos now appear more reliably in source and filter views. (@AnessBen)
- **Better Cached Stream Indicators:** Improved cached-stream detection and download markers. (@AnessBen)
- **Cleaner Account Menu:** Removed the redundant Stremio sign-out action from the account menu when it is not needed. (@glpc-blaze)
- **Improved Ratings UI:** Ratings now have better search, editing, filtering, and loading behavior. (@Auramist)
- **Dismissible Torrents-Off Banner:** The source picker's torrents-disabled banner can now be dismissed. (@Thunderhawkk)
- **Remembered View Filters:** View filters now stay applied when Harbor evicts and restores a layer. (@Thunderhawkk)
- **Readable Live Guide:** Short guide programs no longer clip into unreadable text. (@Thunderhawkk)
- **Guide Scroll Restored:** Returning from a live stream now restores your place in the guide. (@Thunderhawkk)
- **Cleaner Big Picture Home:** The addons rail has been removed from the Big Picture home, and custom posters no longer get a duplicate title overlay. (@Thunderhawkk)
- **Big Picture Live TV:** Live TV sources are persisted and TV playback mounts correctly. (@Thunderhawkk)
- **Big Picture Metadata:** Metadata now renders in Big Picture even when the catalog seed is missing. (@Thunderhawkk)
- **Surprise Me Hide Watched:** Filter random movie picks to skip titles you have already watched. — Discover → Surprise Me → **Hide watched movies** (@Thunderhawkk).
- **Poster Captions:** Custom posters no longer show a redundant tile title in Big Picture. (@Thunderhawkk)

---

## ⚡ Performance & Stability

- **Faster Large Series:** Reduced freezing and loading delays on shows with very large episode counts. (@3-pr, @comet776)
- **Improved Image & Media Caching:** Posters, artwork, and media data now load more reliably. (@comet776)
- **Smoother Continue Watching:** Improved Continue Watching performance and episode advancement. (@comet776)
- **Reduced Duplicate Cloud Work:** Harbor now avoids repeated Nuvio sync pulls, duplicate cache writes, and unnecessary view refreshes, reducing background activity. (@comet776)
- **Linux Source Picker Stability:** When using embedded mpv on Linux, Harbor now reduces source-picker animations, blur, shadows, and other compositor-heavy effects to lower GPU overhead and help prevent system freezes. (@Thunderhawkk)
- **Linux Gamescope Stability:** Fixed embedded mpv crashes related to Gamescope and Vulkan. (@Thunderhawkk)
- **Flatpak Media Keys:** Media keys now work correctly in the Flatpak build. (@Thunderhawkk)
- **Linux Cached Thumbnail Fix:** Fixed episode stills and cached artwork appearing correctly the first time but turning blank on later views, while keeping cache access restricted to the intended Harbor directory. (@kalashnikxvxiii)
- **macOS Live TV Fix:** Live TV multiview now works correctly on macOS. (@Talal1011)
- **macOS Window Fixes:** Harbor no longer restores stale oversized or fullscreen window states on launch and now opens at a centered standard window size. (@3-pr)
- **macOS Playback Stability:** Fixed newer macOS playback-speed stalls. (@Talal1011)
- **macOS Embedded Layering:** Fixed compositing where windowed playback showed controls over a black video surface and fullscreen playback lost the controls. (@Thunderhawkk)
- **Faster Seek Previews:** Remote seek previews appear sooner. (@Thunderhawkk)
- **Non-Blocking HDR Polling:** HDR state polling no longer blocks playback, with better mpv freeze diagnostics. (@Thunderhawkk)
- **Faster Calendar Loading:** Library calendars load faster and lazy-load their sources. (@Thunderhawkk)
- **Streamed Trailers:** HLS trailers now stream through the proxy instead of being fully downloaded first. (@Thunderhawkk)
- **Cloudflare Challenge Handling:** Improved challenge solving, browser-backed source requests, per-host cooldowns, and detection of secondary verification pages. (@Thunderhawkk)
- **Better Account Logout Cleanup:** Logout now cleans up profile-specific data more reliably. (@glpc-blaze)
- **Malformed Authorization Fix:** Fixed a logging crash caused by malformed authorization headers. (@comet776)

---

## 🎮 Games & AI Search

- **Optional Keenable Web Search:** Keenable can now be selected as a live web source for both AI Search and Games AI Search. It works without an API key, with an optional key available for higher rate limits. — Settings → Sources & library → Library & metadata → Search → Search source → Keenable (@ilya-bogin-keenable).
- **Better Search Source Switching:** AI search now refreshes correctly when changing live web sources. (@Thunderhawkk)
- **Game Source Verification Fix:** Improved compatibility with verification pages that use Cloudflare challenge frames. (@kalashnikxvxiii)
- **HowLongToBeat Estimates:** Game details now show completion estimates from HowLongToBeat. (@Thunderhawkk)
- **Nexus Mods Links:** Game details now link straight to the matching Nexus Mods page. (@Thunderhawkk)
- **Game Collection Covers, Pins & Menus:** Add custom collection artwork, pin collections in the sidebar and library, and use collection actions from game and collection context menus. (@Thunderhawkk)
- **Game Downloads & Debrid:** Connected debrid services now work for game magnets, direct links, and hosted sources, with grouped per-game downloads, progress, recovery, and notifications. (@Thunderhawkk)

---

## 📦 Shipyard & Installation

- **Modular Components:** Shipyard can now manage more Harbor components independently. (@Thunderhawkk)
- **Optional Music Module:** The native Music component can now be installed or removed separately while keeping your music data. (@Thunderhawkk)
- **Optional Extensions Runtime:** Extensions can now be installed as a separate removable component. (@Thunderhawkk)
- **More Reliable Repairs:** Improved Shipyard repair behavior when files or modules are still in use. (@Thunderhawkk)
- **Windows Release Installer:** Tagged releases now include the Windows Shipyard installer. (@Thunderhawkk)
- **macOS Intel Support:** Improved support for Intel-based Macs. (@Thunderhawkk)
- **Build Dependency Fixes:** Fixed issues affecting libmpv and Java setup during builds and installation. (@Thunderhawkk)
- **More Reliable Music Host:** Improved startup, responsiveness, and shutdown behavior for the native Music module. (@Thunderhawkk)
- **Windows Whisper Builds:** Windows builds can now include Whisper speech recognition, with model download and removal managed from Settings. (@Thunderhawkk)
- **Installer Language Support:** Shipyard detects the installed Harbor language, shows flags, and includes installer translations and preview testing. (@Thunderhawkk)
- **Component-Aware Build:** Shipyard can build modular components independently. (@Thunderhawkk)
- **Music Module Path Check:** Shipyard verifies the selected Music module path before installing. (@Thunderhawkk)

---

## 🎵 Music & Lyrics

- **Full Windows Media Controls:** Song title, artist, album, cover artwork, duration, position, and seeking now reach Windows media controls, while music and video sessions stay separate. (@Thunderhawkk)
- **Video Mini Player & Theatre Mode:** A persistent resizable mini player with collapse, close, and queue actions, plus theatre layouts and video-scoped search for Watch and Now Playing. (@Thunderhawkk)
- **Guided Live Lyric Sync:** Align a lyric line to the moment you hear it. One alignment shifts the whole song; a second corrects drift, and the corrected timeline is shared by Lyrics, Karaoke, and the video overlay. (@Thunderhawkk)
- **Context-Aware Lyric Translation:** Translate lyrics in AI batches with a target-language picker, mixed-script support, and a Google fallback for lines the AI leaves out. — Music player → Now Playing → Lyrics → **Translate** → choose the target language (@Thunderhawkk).
- **YouTube Music Playlists & Mix Snapshots:** Link YouTube Music playlists and save Mix snapshots for later. (@Thunderhawkk)
- **Queue & Play Next:** Add queue and Play Next actions to music tracks. (@Thunderhawkk)
- **Full Spotify Playlist Queue:** Loading a Spotify playlist now fills the whole queue. (@Thunderhawkk)
- **Mini Player Yields to Video:** The music mini player now pauses and steps aside for movies and series, then returns when playback closes. (@Thunderhawkk)
- **No Duplicate Audio on Loop:** Repeat-one music videos no longer play audio twice. (@Thunderhawkk)
- **YouTube Playback Past 1 MB:** Music videos no longer stop after the first megabyte, using a verified extractor and a prebuffered local proxy. (@Thunderhawkk)
- **Lyrics Retry:** Transient lyric failures and timeouts are retried instead of being cached as missing lyrics. (@Thunderhawkk)
- **Windows Taskbar Icon:** The Harbor icon now stays put during music playback. (@Thunderhawkk)
- **Discord Music RPC:** Invalid asset metadata no longer causes Discord music presence to be rejected. (@Thunderhawkk)
- **Libmpv DLL Lookup:** The native Music module now finds `libmpv-2.dll` even when Harbor is launched from outside its install directory. (@Thunderhawkk)

---

## ⬇️ Downloads & Offline

- **In-Player Episode Downloads:** Download episodes from the player without interrupting playback, with progress, completion, cancellation, and duplicate protection. (@Thunderhawkk)
- **Offline Playback:** Completed episode downloads are preferred for playback, restart, next/previous, automatic advancement, and queue playback, with graceful fallback to streaming sources. (@Thunderhawkk)
- **Keep Same Source Offline:** Online stream identity is preserved separately from downloaded playback, so Keep Same Source still matches torrent hashes, season packs, release groups, audio languages, and resolution. (@Thunderhawkk)
- **Automatic Next-Episode Pre-Download:** A persistent Up Next toggle prepares the next episode in the background using the current release or saved download metadata. — Player → episode panel → **Auto pre-download next episode** (plus the bell toggle for pre-download notifications) (@Thunderhawkk).
- **Multi-Select & Batch Actions:** Select multiple downloads, a whole series, or all visible items, then pause, resume, cancel, retry, or delete them together. (@Thunderhawkk)
- **Download Notifications:** Toggle compact notification icons for pre-download events. — Player → episode panel → pre-download bell button (@Thunderhawkk).
- **Canceled Filter:** Canceled downloads are hidden from the default Downloads page and popover but remain available in the Canceled filter. (@Thunderhawkk)
- **Playback Button in Downloads:** Play a completed download directly from the downloads popup. (@Thunderhawkk)
- **Styled Delete Confirmation:** Deleting a download now uses the same styled confirmation dialog in both download views. (@Thunderhawkk)
- **Idle-Player Deletion:** Downloads can be deleted even when the player is idle, with corrected pause/resume icons. (@Thunderhawkk)

---

## 🏷️ Metadata & Artwork

- **Built-In Metadata Opt-Out:** Disable Harbor's keyless built-in metadata and use addons or providers you configure instead. — Settings → Sources & library → Library & metadata → **Metadata providers** → Titles and descriptions → **Disable built-in metadata** (@Thunderhawkk).
- **Configurable Metadata Sources:** Choose the order of sources for titles, descriptions, ratings, artwork, posters, season posters, season synopsis, episodes, cast, and trailers. — Settings → Sources & library → Library & metadata → **Metadata providers** → **Metadata source priority** → **Configure** (@Thunderhawkk).
- **Priority Everywhere:** Configured metadata priority is now honored in search, posters, Big Picture, playback, ratings, synopses, and episode data. (@Thunderhawkk)
- **Original Language Resolution:** Metadata can resolve a title's original audio language for automatic track selection and the Original audio preference. (@Thunderhawkk)
- **Custom Poster Service TV Art:** Custom poster services can provide 16:9 TV cards and switch shape through `{shape}`. (@Thunderhawkk)
- **Poster Overlay Toggle:** Hide the logo/poster overlay on TV cards. (@Thunderhawkk)
- **Anime Hero Artwork:** Higher-quality anime hero art is preferred, with low-resolution and failed candidates skipped. (@Thunderhawkk)
- **Simkl Anime Backdrops:** TV cards now resolve Simkl anime backdrops. (@Thunderhawkk)

---

## 📡 Live TV & Tracking

- **Guide URLs From M3U:** IPTV guide URLs are now read from M3U headers. (@Thunderhawkk)
- **Readable Short Programs:** Short programs in the live guide no longer overflow into unreadable text. (@Thunderhawkk)
- **Guide Scroll Restored:** Leaving a live stream returns you to your previous guide position. (@Thunderhawkk)
- **Big Picture Live TV Persistence:** Live TV sources persist and TV playback mounts. (@Thunderhawkk)
- **Drop Show Actions:** Drop a show from the detail hero, overflow menu, and context menus, with a styled confirmation dialog. (@Thunderhawkk)
- **Tracker Drop Sync:** Dropped status syncs to AniList, MyAnimeList, Simkl, Trakt, and PublicMetaDB, and removes the title from Continue Watching and resume state. (@Thunderhawkk)
- **PMDB Integration:** Improvements to PublicMetaDB Drop Show handling, watchlist cleanup, and resume state. (@Thunderhawkk)
- **Anime Episode Ordering:** Tracker status checks now use verified anime episode ordering, including split seasons and cours. (@Thunderhawkk)

---

## 🔄 Updates & Maintenance

- **GitHub Release Feeds:** Release notes, version history, and changelog installers now come from GitHub releases, with ETag revalidation and bundled offline notes. (@Thunderhawkk)
- **Verified Shipyard Installers:** Windows updates are staged and verified through Shipyard, with safe fallbacks for unsigned builds and macOS. (@Thunderhawkk)
- **Skip Incomplete Releases:** Releases without a complete asset set are ignored by the updater. (@Thunderhawkk)
- **Beta Channel Respect:** The updater ignores drafts and utility tags and respects your chosen release channel. (@Thunderhawkk)
- **Release Channel Display:** The update card now shows which release channel you are on. (@Thunderhawkk)
- **Safer Installer Downloads:** Generic installer downloads go to `%TEMP%\harbor-installers` instead of your Downloads folder. (@Thunderhawkk)

---

## 🛠️ More Fixes

- Fixed adult installed addons appearing in global search results. (@1iiron)
- Fixed Settings release links pointing to the wrong Harbor repository. (@1iiron)
- Fixed profile pictures not updating consistently across Nuvio and Stremio modes. (@glpc-blaze)
- Fixed Continue Watching entries disappearing after episodes were marked watched. (@glpc-blaze)
- Fixed duplicate manually watched cards in Continue Watching. (@comet776)
- Improved account logout cleanup and profile-specific data handling. (@glpc-blaze)
- Prevented Stremio data from being accidentally changed while using Nuvio mode. (@glpc-blaze)
- Fixed profile names being unexpectedly changed during Nuvio synchronization. (@glpc-blaze)
- Improved fallback handling for cloud profile pictures. (@comet776)
- Fixed a logging crash caused by malformed authorization headers. (@comet776)
- Improved multilingual release matching, Unicode title aliases, and IMDb/TMDB fallbacks for empty addon results. (@Thunderhawkk)
- Added season and episode ID preservation and filtering for mismatched or unsupported releases. (@Thunderhawkk)
- YouTube addon sources now play internally, while explicit external links still open in the browser. (@Thunderhawkk)
- Verified extractor updates are shared across trailers and addon streams, off the playback startup path. (@Thunderhawkk)
- Remembered source reuse now requires an exact release group or info hash match. (@Thunderhawkk)
- More Like This no longer appears on unfinished airing seasons. (@Thunderhawkk)
- The selected audio device is validated before playback, with a default-device fallback. (@Thunderhawkk)
- The content advisory card now fits its text. (@Thunderhawkk)
- Seek-bar chapter marks now default to off. (@Thunderhawkk)
- Fixed a profile-switch failure being reported as a storage failure in manga favorites. (@Thunderhawkk)
- Preserved previous favorites during failed retries and cache recovery. (@Thunderhawkk)
- Prevented unsolicited manga searches from Continue Watching anime. (@Thunderhawkk)

---

**Full Changelog:** https://github.com/Harborofficial/Harbor/compare/v1.0.1-beta...beta-branch
