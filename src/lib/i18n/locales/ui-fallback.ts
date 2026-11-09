// Newly introduced UI copy remains usable until each locale provides an override.
const uiFallback: Record<string, string> = {
  "Episode information is unavailable": "Episode information is unavailable",
  "music.linked.import": "Import from link",
  "music.linked.linkLabel": "YouTube Music playlist link or ID",
  "music.linked.importHelp":
    "Link a public or unlisted YouTube playlist or a generated Mix watch link. Harbor saves a local copy for manual sync. Mixes save only the current queue, not an endless radio playlist. Signing in is not supported.",
  "music.linked.loading": "Loading tracks from YouTube Music…",
  "music.linked.mixHelp":
    "This generated Mix saves the current queue as a snapshot. Sync refreshes that snapshot; the lineup may change and does not include endless radio continuations. Local edits are overwritten. Unlink to keep them permanently.",
  "music.linked.mixSyncConfirm":
    "Replace this playlist with the Mix's current queue snapshot? The lineup may change. Local additions, removals, reordering and title edits will be overwritten.",
  "music.linked.source": "Linked to YouTube Music",
  "music.linked.lastSynced": "Last synced: {date}",
  "music.linked.mirrorHelp":
    "Sync replaces local edits with YouTube's tracks, order and title. Unlink to keep your changes permanently.",
  "music.linked.sync": "Sync now",
  "music.linked.syncTitle": "Sync with YouTube Music?",
  "music.linked.mixSyncTitle": "Refresh this Mix snapshot?",
  "music.linked.syncConfirm":
    "Replace this playlist with YouTube's current tracks, order and title? Local additions, removals and reordering will be overwritten.",
  "music.linked.syncedNotice": "Synced {count} tracks from YouTube Music.",
  "music.linked.importedNotice": "Linked {name} with {count} tracks from YouTube Music.",
  "music.linked.unlink": "Unlink",
  "music.linked.unlinkTitle": "Unlink this playlist?",
  "music.linked.unlinkConfirm":
    "Stop syncing with YouTube Music? The current tracks will stay as a local playlist.",
  "music.linked.editTitle": "Edit linked playlist?",
  "music.linked.editContinue": "Continue editing",
  "music.linked.editConfirm":
    "This playlist is linked to YouTube Music. Local changes will be overwritten on sync. Continue editing? You can unlink it from the playlist page to keep your changes permanently.",
  "music.playlist.deleteTitle": "Delete playlist?",
  "Use installed addons for movie and series metadata, artwork, and episodes. Missing addon metadata stays unavailable. TMDB Top Match is controlled separately below. Restart Harbor after changing this option.":
    "Use installed addons for movie and series metadata, artwork, and episodes. Missing addon metadata stays unavailable. TMDB Top Match is controlled separately below. Restart Harbor after changing this option.",
  "games.collections.open": "Open collection",
  "games.collections.coverUpload": "Change collection picture",
  "games.collections.coverRemove": "Remove collection picture",
  "games.collections.coverFailed": "The collection picture could not be saved.",
  "games.collections.coverType": "Choose a PNG, JPEG, WebP, GIF, or AVIF image.",
  "games.collections.coverSize": "That image is too large. Choose one under 24 MB.",
  "Metadata addon priority": "Metadata addon priority",
  "Metadata addons start in your addon-list order. The first supplies metadata; later addons only fill missing data or replace failed responses. Reordering enables addon preference.":
    "Metadata addons start in your addon-list order. The first supplies metadata; later addons only fill missing data or replace failed responses. Reordering enables addon preference.",
  "Loading metadata addons...": "Loading metadata addons...",
  "Could not load metadata addons": "Could not load metadata addons",
  "No metadata addons installed": "No metadata addons installed",
  "Move {name} up": "Move {name} up",
  "Move {name} down": "Move {name} down",
  "Use addon-list order": "Use addon-list order",
  "Use TMDB for Top Match in search": "Use TMDB for Top Match in search",
  "Use your saved TMDB key for Top Match, even in addon-only mode. If unavailable or turned off, use your highest-priority metadata addon's search results.":
    "Use your saved TMDB key for Top Match, even in addon-only mode. If unavailable or turned off, use your highest-priority metadata addon's search results.",
  "Use only addon metadata": "Use only addon metadata",
  "Disable built-in metadata": "Disable built-in metadata",
  "Use installed addons and providers you configured. Disable Harbor's keyless built-in metadata and fallbacks. Restart Harbor after changing this option.":
    "Use installed addons and providers you configured. Disable Harbor's keyless built-in metadata and fallbacks. Restart Harbor after changing this option.",
  "Metadata source priority": "Metadata source priority",
  "Choose which addons and configured providers supply each section. The first source with a value wins.":
    "Choose which addons and configured providers supply each section. The first source with a value wins.",
  Configure: "Configure",
  "Configure metadata sources": "Configure metadata sources",
  "Each section falls through in order until a source provides a value.":
    "Each section falls through in order until a source provides a value.",
  "Each section falls through in order until a source provides a value. Drag a source or use the arrows to reorder.":
    "Each section falls through in order until a source provides a value. Drag a source or use the arrows to reorder.",
  "fallback order": "fallback order",
  "No sources are available for this section.": "No sources are available for this section.",
  "Only configured providers appear here. Episode and season numbering is kept from one source at a time.":
    "Only configured providers appear here. Episode and season numbering is kept from one source at a time.",
  "Reset section": "Reset section",
  Backdrop: "Backdrop",
  "Episode and Seasons": "Episode and Seasons",
  "Search / Top Match": "Search / Top Match",
  "Addon and TMDB order used by search results and Top Match.":
    "Addon and TMDB order used by search results and Top Match.",
  "Show source labels on the detail page": "Show source labels on the detail page",
  "Useful for checking which addon or provider supplied each part.":
    "Useful for checking which addon or provider supplied each part.",
  Addon: "Addon",
  Key: "Key",
  Transform: "Transform",
  "Controlled by disabled built-in metadata": "Controlled by disabled built-in metadata",
  "Controlled by addon-only metadata": "Controlled by addon-only metadata",
  "Use installed addons for movie and series metadata, artwork, and episodes. Disable Harbor's built-in providers and fallbacks. Missing addon metadata stays unavailable. Restart Harbor after changing this option.":
    "Use installed addons for movie and series metadata, artwork, and episodes. Disable Harbor's built-in providers and fallbacks. Missing addon metadata stays unavailable. Restart Harbor after changing this option.",
  Original: "Original",
  "Hide watched movies": "Hide watched movies",
  "Checking watched movies...": "Checking watched movies...",
  "No unwatched titles available": "No unwatched titles available",
  "No titles available": "No titles available",
  "games.magnet.debrid": "Download via Debrid",
  "games.magnet.choose": "Choose a connected debrid service to prepare this magnet.",
  "games.magnet.none":
    "No debrid services connected. Connect one in Settings to download this magnet via debrid.",
  "games.sources.links.none": "Connect a debrid service in Settings to prepare this download link.",
  "games.magnet.connect": "Connect debrid service",
  "games.magnet.prepare": "Submit magnet to {name}",
  "games.magnet.starting": "Submitting magnet...",
  "games.magnet.preparing":
    "The magnet was submitted. Your provider is preparing the files. You can refresh its status.",
  "games.magnet.failed": "The provider could not prepare this magnet.",
  "games.magnet.review": "Choose files to download",
  "games.magnet.select": "Select files",
  "games.magnet.refresh": "Refresh status",
  "games.magnet.browse": "Browse cloud files",
  "games.magnet.download": "Choose download destination",
  "games.magnet.submitted":
    "Magnet submitted to the debrid service. The remote job remains in your account.",
  "games.magnet.remember": "Last-used provider is remembered for this profile.",
  "Season explorer": "Season explorer",
  "Shows a season shelf with posters, names, and synopses above the episode list. Anime uses Harbor's TVDB service without a key. Regular shows use your TVDB key when set, otherwise their TMDB metadata. Turn this off to hide the shelf and stop its metadata requests.":
    "Shows a season shelf with posters, names, and synopses above the episode list. Anime uses Harbor's TVDB service without a key. Regular shows use your TVDB key when set, otherwise their TMDB metadata. Turn this off to hide the shelf and stop its metadata requests.",
  "Previous seasons": "Previous seasons",
  "More seasons": "More seasons",
  "No season synopsis available.": "No season synopsis available.",
  "Show Harbor": "Show Harbor",
  "Could not apply this change. Try again.": "Could not apply this change. Try again.",
  "Hide watched titles in the featured hero": "Hide watched titles in the featured hero",
  "Hide watched titles": "Hide watched titles",
  "Skip recommendations you've already watched. Uses the same watch history as Hide watched titles in the featured hero.":
    "Skip recommendations you've already watched. Uses the same watch history as Hide watched titles in the featured hero.",
  "Hide watched titles in More like this": "Hide watched titles in More like this",
  "Watched movies and shows you've made progress on are skipped in the featured hero and replaced with the next unwatched pick from the same row. Uses your local watch history, Trakt, and Simkl.":
    "Watched movies and shows you've made progress on are skipped in the featured hero and replaced with the next unwatched pick from the same row. Uses your local watch history, Trakt, and Simkl.",
  "Rewatching on AniList": "Rewatching on AniList",
  "Rewatched on AniList": "Rewatched on AniList",
  "Rewatching on MyAnimeList": "Rewatching on MyAnimeList",
  "Rewatched on MyAnimeList": "Rewatched on MyAnimeList",
  "Count AniList rewatches": "Count AniList rewatches",
  "Count MyAnimeList rewatches": "Count MyAnimeList rewatches",
  "Watching an anime you already finished marks it as Rewatching and counts the rewatch, instead of resetting your progress.":
    "Watching an anime you already finished marks it as Rewatching and counts the rewatch, instead of resetting your progress.",
  "Turn on Sync watch progress first.": "Turn on Sync watch progress first.",
  "Big Picture display": "Big Picture display",
  "Which monitor Big Picture opens on at startup.":
    "Which monitor Big Picture opens on at startup.",
  "Separate window display": "Separate window display",
  "Which monitor the separate mpv window opens on. Harbor's own window stays where it is.":
    "Which monitor the separate mpv window opens on. Harbor's own window stays where it is.",
  "Cover the taskbar": "Cover the taskbar",
  "Span the whole screen including the taskbar. Turn off to keep the taskbar visible on that monitor.":
    "Span the whole screen including the taskbar. Turn off to keep the taskbar visible on that monitor.",
  "True HDR, separate window is selected. That mode always plays in its own window, so mpv cannot be embedded. Choose a different HDR mode to change this.":
    "True HDR, separate window is selected. That mode always plays in its own window, so mpv cannot be embedded. Choose a different HDR mode to change this.",
  "Follow Harbor": "Follow Harbor",
  "Open on the same monitor as Harbor": "Open on the same monitor as Harbor",
  "Open on {name}": "Open on {name}",
  Primary: "Primary",
  "A source couldn't be reached": "A source couldn't be reached",
  "{n} sources couldn't be reached": "{n} sources couldn't be reached",
  "blocked by the network policy": "blocked by the network policy",
  "timed out": "timed out",
  "returned an error": "returned an error",
  "couldn't be reached": "couldn't be reached",
  "{ok} updated · {failed} failed": "{ok} updated · {failed} failed",
  "Added · refresh for updates": "Added · refresh for updates",
  "Refresh subtitle": "Refresh subtitle",
  "Translating… try again in a minute": "Translating… try again in a minute",
  "Translating… we'll add it when it's ready": "Translating… we'll add it when it's ready",
  Translations: "Translations",
  "Showing {lang}": "Showing {lang}",
  "Sends HDR to the display through macOS EDR instead of mapping it down to SDR. Needs HDR-to-SDR tonemapping off, mpv embedded, and a display with HDR headroom. Takes effect on the next video. Experimental: color can look flat, and an SDR video after an HDR one may need a window resize.":
    "Sends HDR to the display through macOS EDR instead of mapping it down to SDR. Needs HDR-to-SDR tonemapping off, mpv embedded, and a display with HDR headroom. Takes effect on the next video. Experimental: color can look flat, and an SDR video after an HDR one may need a window resize.",
  "Hide this tab": "Hide this tab",
  "Show this tab": "Show this tab",
  "Nothing hidden.": "Nothing hidden.",
  "Edit sidebar": "Edit sidebar",
  "Show all tabs": "Show all tabs",
  "Hide categories from recommendations. Customize tabs separately in the sidebar.":
    "Hide categories from recommendations. Customize tabs separately in the sidebar.",
  "Hides anime titles from Home, Discover, Top 10, and catalogs. Western animation stays visible. To hide the Anime tab, edit the sidebar.":
    "Hides anime titles from Home, Discover, Top 10, and catalogs. Western animation stays visible. To hide the Anime tab, edit the sidebar.",
  "Could not sync your display name. Check your connection and try again.":
    "Could not sync your display name. Check your connection and try again.",
  "Syncing display name…": "Syncing display name…",
  "Display name saved to your Harbor account.": "Display name saved to your Harbor account.",
  "Show ignore title button": "Show ignore title button",
  "Display a button on the content advisory card to permanently ignore the title.":
    "Display a button on the content advisory card to permanently ignore the title.",
  "These are compiled Android extensions (.cs3). Harbor runs script plugins only, so they cannot be installed here.":
    "These are compiled Android extensions (.cs3). Harbor runs script plugins only, so they cannot be installed here.",
  "This is a Stremio addon manifest. Add it from the Addons page instead.":
    "This is a Stremio addon manifest. Add it from the Addons page instead.",
  "Skipped: {reason}": "Skipped: {reason}",
  "Share as link": "Share as link",
  "Back in two weeks": "Back in two weeks",
  "Never shown again": "Never shown again",
  "Directed by {name}": "Directed by {name}",
  "Click to choose": "Click to choose",
  "Default drifts through backdrops from what's trending. Boat plays a hand drawn illustration. Custom plays your own videos, GIFs, or images.":
    "Default drifts through backdrops from what's trending. Boat plays a hand drawn illustration. Custom plays your own videos, GIFs, or images.",
  Boat: "Boat",
  "Your screensavers": "Your screensavers",
  "Add videos, GIFs, or images from this computer. Videos loop with the sound off, and everything fills the screen.":
    "Add videos, GIFs, or images from this computer. Videos loop with the sound off, and everything fills the screen.",
  "Nothing added yet. The default screensaver plays until you add one.":
    "Nothing added yet. The default screensaver plays until you add one.",
  "Add video, GIF, or image": "Add video, GIF, or image",
  "Try it now": "Try it now",
  GIF: "GIF",
  "{kind} · In use": "{kind} · In use",
  Use: "Use",
  "Who's watching background": "Who's watching background",
  "Shown behind the profile picker only. It does not change the app theme or wallpaper.":
    "Shown behind the profile picker only. It does not change the app theme or wallpaper.",
  "No background yet. The picker blurs the app behind it.":
    "No background yet. The picker blurs the app behind it.",
  "Who's watching preview": "Who's watching preview",
  "Profile names and avatars should stay readable at this dim.":
    "Profile names and avatars should stay readable at this dim.",
  "0% shows the raw image. 100% covers it in black. 60-80% keeps profiles readable.":
    "0% shows the raw image. 100% covers it in black. 60-80% keeps profiles readable.",
  "Highest rated on IMDb": "Highest rated on IMDb",
  "Prefer episode still artwork": "Prefer episode still artwork",
  "Show the detail page's episode still on the card instead of your saved frame. The saved frame is kept as a fallback when no still exists.":
    "Show the detail page's episode still on the card instead of your saved frame. The saved frame is kept as a fallback when no still exists.",
  "View experimental changelog": "View experimental changelog",
  "Report an issue": "Report an issue",
  "A short note about this list": "A short note about this list",
  "Return to beta": "Return to beta",
  "Experimental {version} · Build {buildId}": "Experimental {version} · Build {buildId}",
  "Couldn't verify your Harbor account access. Check your connection and try again.":
    "Couldn't verify your Harbor account access. Check your connection and try again.",
  "No verified experimental build is available for this device yet.":
    "No verified experimental build is available for this device yet.",
  "No tested return to beta is available for this build.":
    "No tested return to beta is available for this build.",
  "The experimental build changed during the check. Check again before downloading.":
    "The experimental build changed during the check. Check again before downloading.",
  "Couldn't check experimental builds. Check your connection and try again.":
    "Couldn't check experimental builds. Check your connection and try again.",
  "Couldn't verify this return to beta. Check your connection and try again.":
    "Couldn't verify this return to beta. Check your connection and try again.",
  "Couldn't save the recovery backup. Free some storage and try again.":
    "Couldn't save the recovery backup. Free some storage and try again.",
  "Return to beta did not finish. Your recovery files have been kept. Try again from Experimental builds.":
    "Return to beta did not finish. Your recovery files have been kept. Try again from Experimental builds.",
  "Harbor Shipyard did not finish updating Harbor. Check for updates to try again.":
    "Harbor Shipyard did not finish updating Harbor. Check for updates to try again.",
  "Couldn't save the update channel. Free some storage and try again.":
    "Couldn't save the update channel. Free some storage and try again.",
  "Leave experimental builds before changing your normal update channel.":
    "Leave experimental builds before changing your normal update channel.",
  "Finish the current download or installation before changing channels.":
    "Finish the current download or installation before changing channels.",
  "Continue the return to beta in Experimental builds below.":
    "Continue the return to beta in Experimental builds below.",
  "No newer experimental build is available for this device.":
    "No newer experimental build is available for this device.",
  "Replace this experimental installation with a tested beta. Compatible settings and watch progress stay in place. Beta updates resume after a successful restart.":
    "Replace this experimental installation with a tested beta. Compatible settings and watch progress stay in place. Beta updates resume after a successful restart.",
  "Automatic return to beta is not available for this platform yet.":
    "Automatic return to beta is not available for this platform yet.",
  "Beta version": "Beta version",
  "Choose a tested beta": "Choose a tested beta",
  "Beta {version}": "Beta {version}",
  "Harbor saves a local recovery backup before installing. It can contain account details. Old backups are not restored automatically, and recovery files use extra disk space.":
    "Harbor saves a local recovery backup before installing. It can contain account details. Old backups are not restored automatically, and recovery files use extra disk space.",
  "Install beta {version} and restart? This replaces the experimental app, not your current settings.":
    "Install beta {version} and restart? This replaces the experimental app, not your current settings.",
  "Install beta {version} and restart": "Install beta {version} and restart",
  "Download and verify beta": "Download and verify beta",
  "Downloading beta: {pct}%": "Downloading beta: {pct}%",
  "Saving recovery files and installing beta…": "Saving recovery files and installing beta…",
  "Beta download verified. Ready to install.": "Beta download verified. Ready to install.",
  "Checking the selected beta…": "Checking the selected beta…",
  "Experimental builds": "Experimental builds",
  "Return to a regular build": "Return to a regular build",
  "Experimental access requires a Harbor account with a Tester, Moderator, Admin, or Dev badge.":
    "Experimental access requires a Harbor account with a Tester, Moderator, Admin, or Dev badge.",
  "Checking experimental builds…": "Checking experimental builds…",
  "Experimental updates are enabled on this device.":
    "Experimental updates are enabled on this device.",
  "Experimental updates are off.": "Experimental updates are off.",
  "Test upcoming changes": "Test upcoming changes",
  "Available to Harbor accounts with a Tester, Moderator, Admin, or Dev badge.":
    "Available to Harbor accounts with a Tester, Moderator, Admin, or Dev badge.",
  "These builds may crash or change your settings. Back up Harbor before installing. Downloads and installation still require your approval.":
    "These builds may crash or change your settings. Back up Harbor before installing. Downloads and installation still require your approval.",
  "Installed: Harbor {version}": "Installed: Harbor {version}",
  "Update channel: {channel}": "Update channel: {channel}",
  "Experimental installation currently requires a managed Windows installation with a tested return to beta.":
    "Experimental installation currently requires a managed Windows installation with a tested return to beta.",
  "Leave experimental builds": "Leave experimental builds",
  "Enable experimental builds": "Enable experimental builds",
  "View experimental update": "View experimental update",
  "Check experimental builds": "Check experimental builds",
  "Enable experimental updates on this device? This replaces your normal update feed until you leave. It does not install a build now.":
    "Enable experimental updates on this device? This replaces your normal update feed until you leave. It does not install a build now.",
  "Enable and check": "Enable and check",
  "Leaving only turns off experimental checks. Use Return to beta below to replace the experimental app.":
    "Leaving only turns off experimental checks. Use Return to beta below to replace the experimental app.",
  "Find on your sources": "Find on your sources",
  "Search your manga sources": "Search your manga sources",
  "Add a manga source first — a Suwayomi server, Mangayomi, a local folder, or a plugin — then pick the matching copy here.":
    "Add a manga source first — a Suwayomi server, Mangayomi, a local folder, or a plugin — then pick the matching copy here.",
  "Searching your sources…": "Searching your sources…",
  "No match on your extensions. Edit the query above or check the language filter in the manga tab.":
    "No match on your extensions. Edit the query above or check the language filter in the manga tab.",
  "Everything from {name}": "Everything from {name}",
  "Filter, sort and search the full catalogue": "Filter, sort and search the full catalogue",
  Launch: "Launch",
  "Start Harbor in the couch-friendly Big Picture layout whenever the app opens.":
    "Start Harbor in the couch-friendly Big Picture layout whenever the app opens.",
  "Animate backdrop art on Big Picture screens.": "Animate backdrop art on Big Picture screens.",
  "Press Esc to stop.": "Press Esc to stop.",
  "Harbor and the installer": "Harbor and the installer",
  "The Big Picture opener and the boat that builds itself while Harbor installs.":
    "The Big Picture opener and the boat that builds itself while Harbor installs.",
  "The General": "The General",
  "Anime upscalers": "Anime upscalers",
  "Screensaver style": "Screensaver style",
  "Cinematic drifts through backdrops from what's trending. Cat and boat plays a hand drawn illustration instead.":
    "Cinematic drifts through backdrops from what's trending. Cat and boat plays a hand drawn illustration instead.",
  "Cat and boat": "Cat and boat",
  "Desktop notifications": "Desktop notifications",
  "Get a system notification on this device when something you follow drops.":
    "Get a system notification on this device when something you follow drops.",
  "Notifications are blocked for Harbor. Enable them in your system settings, then turn this back on.":
    "Notifications are blocked for Harbor. Enable them in your system settings, then turn this back on.",
  "Add a Discord or Telegram destination, or turn on Desktop notifications, first. Rules need somewhere to send their alerts.":
    "Add a Discord or Telegram destination, or turn on Desktop notifications, first. Rules need somewhere to send their alerts.",
  "Show a system notification on this device.": "Show a system notification on this device.",
  "Turn on Desktop notifications on the Destinations tab first.":
    "Turn on Desktop notifications on the Destinations tab first.",
  "Harbor test message ({service}). If you can read this, it's wired up.":
    "Harbor test message ({service}). If you can read this, it's wired up.",
  "Connect Discord or Telegram, or turn on desktop notifications, and Harbor alerts you when something you follow is about to drop. Hit Send test to send yourself a sample first.":
    "Connect Discord or Telegram, or turn on desktop notifications, and Harbor alerts you when something you follow is about to drop. Hit Send test to send yourself a sample first.",
  "Manga sync": "Manga sync",
  "{title} · Chapter {chapter}": "{title} · Chapter {chapter}",
  "Reorder extensions": "Reorder extensions",
  "Reset order": "Reset order",
  "Filter sources...": "Filter sources...",
  Scanlator: "Scanlator",
  "Resolving pages": "Resolving pages",
  "Match manga": "Match manga",
  "Choose a match, or select None to skip": "Choose a match, or select None to skip",
  "Search title on {tracker}": "Search title on {tracker}",
  "Select this if you don't want to sync to {tracker}":
    "Select this if you don't want to sync to {tracker}",
  "No matches. Check the search box or try a different title.":
    "No matches. Check the search box or try a different title.",
  "★ {n}": "★ {n}",
  "Tip: press": "Tip: press",
  "to reopen this anytime": "to reopen this anytime",
  "Chapter progress": "Chapter progress",
  "Download current page": "Download current page",
  "Download page": "Download page",
  "Updating... ({n}/{total})": "Updating... ({n}/{total})",
  "Update all ({n})": "Update all ({n})",
  "The lists you created, full of saved manga": "The lists you created, full of saved manga",
  "Show cursor": "Show cursor",
  "When off, the right stick no longer shows a cursor on screen. Focus navigation still works.":
    "When off, the right stick no longer shows a cursor on screen. Focus navigation still works.",
  "Hide after idle": "Hide after idle",
  "The cursor fades away when you stop moving the stick. Move it again to bring it back.":
    "The cursor fades away when you stop moving the stick. Move it again to bring it back.",
  "{n} s": "{n} s",
  "In the manga reader.": "In the manga reader.",
  "Choose whether the content advisory appears in full color or a restrained monochrome tone. Also affects the Content Advisory section on detail pages.":
    "Choose whether the content advisory appears in full color or a restrained monochrome tone. Also affects the Content Advisory section on detail pages.",
  "Showing {shown} of {total} notes": "Showing {shown} of {total} notes",
  "Content advisory theme": "Content advisory theme",
  Monochrome: "Monochrome",
  "#": "#",
  "%": "%",
  "1 minute": "1 minute",
  "1 second": "1 second",
  "1280 × 720.": "1280 × 720.",
  "14s": "14s",
  "1920 × 1080. This is what the Watch Trailer button targets.":
    "1920 × 1080. This is what the Watch Trailer button targets.",
  "2 minutes": "2 minutes",
  "20s": "20s",
  "6-digit code": "6-digit code",
  "640 × 360. Fastest to start, softest picture.": "640 × 360. Fastest to start, softest picture.",
  "90 seconds": "90 seconds",
  "A Letterboxd list you added by address.": "A Letterboxd list you added by address.",
  "A list by {owner}, {n} films.": "A list by {owner}, {n} films.",
  "A list by {owner}.": "A list by {owner}.",
  "A pack file lists your images with names and sets. Point items at files next to the JSON, at http links, or inline them as data URIs. Hover a set you imported and press Export to write one out.":
    "A pack file lists your images with names and sets. Point items at files next to the JSON, at http links, or inline them as data URIs. Hover a set you imported and press Export to write one out.",
  "A pack swaps Harbor's built-in badge art, or adds whole new badges of its own.":
    "A pack swaps Harbor's built-in badge art, or adds whole new badges of its own.",
  "A regular expression Harbor tests against each stream title. Every stream that matches gets this badge.":
    "A regular expression Harbor tests against each stream title. Every stream that matches gets this badge.",
  "A rule watches for one kind of release and pings the channels you pick. Each rule fires on its own.":
    "A rule watches for one kind of release and pings the channels you pick. Each rule fires on its own.",
  "A short hand-picked list, plus a box for pasting any badges.json link you were sent.":
    "A short hand-picked list, plus a box for pasting any badges.json link you were sent.",
  "A stream row in the play picker": "A stream row in the play picker",
  "API-Sports": "API-Sports",
  "API-Sports key": "API-Sports key",
  "API-Sports · leagues ESPN does not carry": "API-Sports · leagues ESPN does not carry",
  Acknowledgements: "Acknowledgements",
  "Add a Discord or Telegram destination first. Rules need somewhere to send their alerts.":
    "Add a Discord or Telegram destination first. Rules need somewhere to send their alerts.",
  "Add a Discord webhook URL on the Destinations tab first.":
    "Add a Discord webhook URL on the Destinations tab first.",
  "Add a Telegram bot token on the Destinations tab first.":
    "Add a Telegram bot token on the Destinations tab first.",
  "Add a rule": "Add a rule",
  "Add an IPTV source": "Add an IPTV source",
  "Add another home server": "Add another home server",
  "Add people in the Custom calendar manager first, then come back to this rule.":
    "Add people in the Custom calendar manager first, then come back to this rule.",
  "Add teams": "Add teams",
  "Add to your teams": "Add to your teams",
  "Addons ({n})": "Addons ({n})",
  "Adds a comments section to movie, show, and episode pages. No Trakt account needed to read them.":
    "Adds a comments section to movie, show, and episode pages. No Trakt account needed to read them.",
  "Adds it to the top of your list, already switched on.":
    "Adds it to the top of your list, already switched on.",
  "Adds the New York Times bestseller lists to the eBook page, on the hero and as a row, with rank and weeks on the list. Free key at":
    "Adds the New York Times bestseller lists to the eBook page, on the hero and as a row, with rank and weeks on the list. Free key at",
  "Advanced: use an access token": "Advanced: use an access token",
  "Aggregator addons": "Aggregator addons",
  "All listed rules": "All listed rules",
  "All selected": "All selected",
  "Linking your Discord account also joins you to Harbor's Discord server, so the bot can send your Backup keys privately.":
    "Linking your Discord account also joins you to Harbor's Discord server, so the bot can send your Backup keys privately.",
  "Also joins Harbor's Discord server.": "Also joins Harbor's Discord server.",
  "Always use for {league}": "Always use for {league}",
  "An accent line down the side, with each line revealed as it arrives.":
    "An accent line down the side, with each line revealed as it arrives.",
  "Animated sidebar icons": "Animated sidebar icons",
  "Another shortcut in this list now uses the same key. Change one of them.":
    "Another shortcut in this list now uses the same key. Change one of them.",
  "Any badges.json address works: a raw gist, Pastebin, or a file in a repo. Broken JSON gets repaired automatically.":
    "Any badges.json address works: a raw gist, Pastebin, or a file in a repo. Broken JSON gets repaired automatically.",
  "Anything TMDB has not translated stays in English. Picking a new language reloads Harbor.":
    "Anything TMDB has not translated stays in English. Picking a new language reloads Harbor.",
  "Appears in the release notes. Use whatever name you want credit under.":
    "Appears in the release notes. Use whatever name you want credit under.",
  "Apply and reload": "Apply and reload",
  "Attach a channel": "Attach a channel",
  "Attach a stream": "Attach a stream",
  "Auto uses mpv when Harbor can reach it and falls back to the built in player. Pick one yourself if playback misbehaves.":
    "Auto uses mpv when Harbor can reach it and falls back to the built in player. Pick one yourself if playback misbehaves.",
  Automatic: "Automatic",
  Avatar: "Avatar",
  "Badge art packs you installed from the community store. Remove one to put its badges back to Harbor's default.":
    "Badge art packs you installed from the community store. Remove one to put its badges back to Harbor's default.",
  "Badges you have changed": "Badges you have changed",
  Bench: "Bench",
  "Both shows direct, debrid, and peer-to-peer results together. Direct/debrid keeps torrents out of the way unless nothing else is available. P2P puts torrents first.":
    "Both shows direct, debrid, and peer-to-peer results together. Direct/debrid keeps torrents out of the way unless nothing else is available. P2P puts torrents first.",
  "Bring your Letterboxd watchlist, diary, liked films and lists into Harbor through the Stremboxd bridge.":
    "Bring your Letterboxd watchlist, diary, liked films and lists into Harbor through the Stremboxd bridge.",
  "Browse community badge packs": "Browse community badge packs",
  "Build a pack in one of these tools, export the JSON, host it as a gist, then paste the raw link below.":
    "Build a pack in one of these tools, export the JSON, host it as a gist, then paste the raw link below.",
  "Built on": "Built on",
  "Built-in format chips first, then any of your rules that match.":
    "Built-in format chips first, then any of your rules that match.",
  "Buttons, states, and the things that live on a card.":
    "Buttons, states, and the things that live on a card.",
  "Cached stream files and the DHT cache are deleted. The next stream starts from scratch.":
    "Cached stream files and the DHT cache are deleted. The next stream starts from scratch.",
  "Came off": "Came off",
  "Came on": "Came on",
  "Caps how many score chips a poster shows. Extras drop off the end of the chip. You have {n} turned on.":
    "Caps how many score chips a poster shows. Extras drop off the end of the chip. You have {n} turned on.",
  "Caps what Harbor asks {name} to send. Original streams the file exactly as it is stored.":
    "Caps what Harbor asks {name} to send. Original streams the file exactly as it is stored.",
  Carousel: "Carousel",
  "Centered along the top edge, clear of the subtitles.":
    "Centered along the top edge, clear of the subtitles.",
  "Change the ratio while watching": "Change the ratio while watching",
  "Change the shortcut for {name}": "Change the shortcut for {name}",
  "Change your picture": "Change your picture",
  "Changing the metadata language reloads Harbor so the new language takes effect. Apply when you're done with the options above.":
    "Changing the metadata language reloads Harbor so the new language takes effect. Apply when you're done with the options above.",
  "Charity Navigator": "Charity Navigator",
  "Checks the username against Stremboxd and turns on the catalogs it finds.":
    "Checks the username against Stremboxd and turns on the catalogs it finds.",
  "Chips are off, so the row stays bare.": "Chips are off, so the row stays bare.",
  "Choose a file": "Choose a file",
  "Choose source": "Choose source",
  "Choose whether Play asks you, prefers this device, prefers online sources, or goes straight to one of your home servers.":
    "Choose whether Play asks you, prefers this device, prefers online sources, or goes straight to one of your home servers.",
  "Choose whether your operating system draws the title bar, or Harbor draws its own.":
    "Choose whether your operating system draws the title bar, or Harbor draws its own.",
  "Choose which services feed your Continue Watching row. Turn on as many as you like and Harbor merges them, keeping the most recent progress for each title. What you watch is still scrobbled to every connected service regardless of what you pick here.":
    "Choose which services feed your Continue Watching row. Turn on as many as you like and Harbor merges them, keeping the most recent progress for each title. What you watch is still scrobbled to every connected service regardless of what you pick here.",
  "Choose your username": "Choose your username",
  "Clear home team": "Clear home team",
  "Clearing these is always safe. Nothing you downloaded on purpose is removed.":
    "Clearing these is always safe. Nothing you downloaded on purpose is removed.",
  "Cloudflare is a single origin, so on a very fast line this can read lower than a multi-server test. Uses up to 150 MB, with a 90 second cooldown.":
    "Cloudflare is a single origin, so on a very fast line this can read lower than a multi-server test. Uses up to 150 MB, with a 90 second cooldown.",
  Colored: "Colored",
  "Colors your name, your cursor in Watch Together, and the ring around your avatar.":
    "Colors your name, your cursor in Watch Together, and the ring around your avatar.",
  "Comments and reviews posted by other Trakt members.":
    "Comments and reviews posted by other Trakt members.",
  Compatibility: "Compatibility",
  "Connect Discord or Telegram and Harbor posts a message when something you follow is about to drop. Hit Send test to send yourself a sample first.":
    "Connect Discord or Telegram and Harbor posts a message when something you follow is about to drop. Hit Send test to send yourself a sample first.",
  "Connect Jellyfin, Emby, and Plex libraries on this device. Credentials stay in native secret storage. Each server keeps its own refresh schedule, and cached titles stay available while a server is offline.":
    "Connect Jellyfin, Emby, and Plex libraries on this device. Credentials stay in native secret storage. Each server keeps its own refresh schedule, and cached titles stay available while a server is offline.",
  "Connected. {n} catalogs are available.": "Connected. {n} catalogs are available.",
  "Content Advisory": "Content Advisory",
  "Content advisory style": "Content advisory style",
  "Continue Watching on Home": "Continue Watching on Home",
  "Continue Watching sources": "Continue Watching sources",
  "Continue with Discord": "Continue with Discord",
  "Converts video to plain 8-bit before display for graphics cards that glitch on 10-bit or unusual formats. Fixes some visual artifacts, but turns off HDR. Leave off unless you need it.":
    "Converts video to plain 8-bit before display for graphics cards that glitch on 10-bit or unusual formats. Fixes some visual artifacts, but turns off HDR. Leave off unless you need it.",
  "Copies your badge art and rules to the clipboard as JSON, ready to paste into a gist and share.":
    "Copies your badge art and rules to the clipboard as JSON, ready to paste into a gist and share.",
  "Copy JSON": "Copy JSON",
  "Copy your Harbor watchlist over to Trakt, or pull your Trakt watchlist into Harbor.":
    "Copy your Harbor watchlist over to Trakt, or pull your Trakt watchlist into Harbor.",
  "Could not reach that page.": "Could not reach that page.",
  "Could not reach the extension list. Check your server connection and try again.":
    "Could not reach the extension list. Check your server connection and try again.",
  "Couldn't save the playlist. Free up storage space in Settings and try again.":
    "Couldn't save the playlist. Free up storage space in Settings and try again.",
  "Covers everything. The taskbar is hidden.": "Covers everything. The taskbar is hidden.",
  "Curated packs and link import": "Curated packs and link import",
  "Currently using {name}. Pick another preset or build your own.":
    "Currently using {name}. Pick another preset or build your own.",
  "Cursor speed": "Cursor speed",
  "Custom theme": "Custom theme",
  "Data copied from {name}": "Data copied from {name}",
  "Days to wait between automatic refreshes of this library.":
    "Days to wait between automatic refreshes of this library.",
  "Decide whether the genres below apply to movies or to series.":
    "Decide whether the genres below apply to movies or to series.",
  "Deep shadows keep their steps, so dark scenes stay readable.":
    "Deep shadows keep their steps, so dark scenes stay readable.",
  "Describe the result you were after.": "Describe the result you were after.",
  "Describe what Harbor did instead, including any message on screen.":
    "Describe what Harbor did instead, including any message on screen.",
  "Didn't get it? Send another code": "Didn't get it? Send another code",
  "Direct media link": "Direct media link",
  Direct3D: "Direct3D",
  "Directed by {names}": "Directed by {names}",
  "Discord confirmed. Pick a username and password to finish.":
    "Discord confirmed. Pick a username and password to finish.",
  "Discord linked": "Discord linked",
  Display: "Display",
  "Displays the raw release filename under each source in the condensed picker. Off keeps rows compact. The Stremio layout always shows it.":
    "Displays the raw release filename under each source in the condensed picker. Off keeps rows compact. The Stremio layout always shows it.",
  Donate: "Donate",
  "Download folder": "Download folder",
  "Downloaded and ready to use. Re-download to pick up a newer version from the author.":
    "Downloaded and ready to use. Re-download to pick up a newer version from the author.",
  Draws: "Draws",
  Drew: "Drew",
  "Each title gets its own folder holding its EPUB or PDF.":
    "Each title gets its own folder holding its EPUB or PDF.",
  "Egyptian, Qatari, Emirati and Korean football plus the KHL on the sports page.":
    "Egyptian, Qatari, Emirati and Korean football plus the KHL on the sports page.",
  "ElfHosted plans": "ElfHosted plans",
  Elsewhere: "Elsewhere",
  "Email address or Discord handle": "Email address or Discord handle",
  "Embedded player": "Embedded player",
  "Enable the Books API on your app. Lists refresh weekly.":
    "Enable the Books API on your app. Lists refresh weekly.",
  "Enter a full http:// or https:// address.": "Enter a full http:// or https:// address.",
  "Enter your code": "Enter your code",
  Essentials: "Essentials",
  Estimated: "Estimated",
  "Every change on this page shows up here first. The art you pick below rides on rows exactly like this one.":
    "Every change on this page shows up here first. The art you pick below rides on rows exactly like this one.",
  "Every format badge Harbor can show on streams. Pick one to swap its art, hide it, or put it back. Changes apply everywhere badges appear.":
    "Every format badge Harbor can show on streams. Pick one to swap its art, hide it, or put it back. Changes apply everywhere badges appear.",
  "Every saved frame goes. Press again to confirm, or wait to cancel.":
    "Every saved frame goes. Press again to confirm, or wait to cancel.",
  "Every source above follows one language order, and it lives on the Languages page.":
    "Every source above follows one language order, and it lives on the Languages page.",
  "Everything cached is removed. Anything you reopen downloads again from scratch.":
    "Everything cached is removed. Anything you reopen downloads again from scratch.",
  "Everything else that moves": "Everything else that moves",
  "Everything pulled toward the middle, so nothing jolts you late at night.":
    "Everything pulled toward the middle, so nothing jolts you late at night.",
  "Everything you pick is saved into one file. Restoring it later only touches what is in the file. Your Stremio sign-in is always left out.":
    "Everything you pick is saved into one file. Restoring it later only touches what is in the file. Your Stremio sign-in is always left out.",
  "Export again": "Export again",
  "Export failed: {error}": "Export failed: {error}",
  "Export log": "Export log",
  "Export pack": "Export pack",
  "Export your Harbor setup to a single file — pick exactly what goes in. Restore brings back only what the file contains. Your Stremio sign-in is always left out.":
    "Export your Harbor setup to a single file — pick exactly what goes in. Restore brings back only what the file contains. Your Stremio sign-in is always left out.",
  "Export your setup": "Export your setup",
  "Export {n} sections": "Export {n} sections",
  "Exporting…": "Exporting…",
  "Fade the text back if it sits too hard over bright scenes.":
    "Fade the text back if it sits too hard over bright scenes.",
  "Fallbacks for machines where the modern video path misbehaves. Leave these alone unless the picture is wrong or a file won't start.":
    "Fallbacks for machines where the modern video path misbehaves. Leave these alone unless the picture is wrong or a file won't start.",
  "Favorites ({n})": "Favorites ({n})",
  "Featured matches": "Featured matches",
  "Files land in a folder named after the movie or series instead of loose in the download folder.":
    "Files land in a folder named after the movie or series instead of loose in the download folder.",
  "Fills the screen, but the title bar and taskbar stay.":
    "Fills the screen, but the title bar and taskbar stay.",
  "Fills the sports page where ESPN has no feed: Egyptian Premier League, Qatar Stars League, UAE Pro League, K League and the KHL, with lineups and live minutes. Free key at":
    "Fills the sports page where ESPN has no feed: Egyptian Premier League, Qatar Stars League, UAE Pro League, K League and the KHL, with lineups and live minutes. Free key at",
  "Find a stream on a page": "Find a stream on a page",
  "Find a stream on a web page": "Find a stream on a web page",
  "Find streams": "Find streams",
  "Finish creating my account": "Finish creating my account",
  "Finish the setup on the configure page, then paste the manifest URL it hands back here.":
    "Finish the setup on the configure page, then paste the manifest URL it hands back here.",
  "Follow a club to pin its fixtures and results": "Follow a club to pin its fixtures and results",
  "Forces a compatibility present mode that removes a thin bright line some monitors show at the screen edge. Side effects: 4K playback can drop to a slideshow and HDR content looks dimmer, because this mode bypasses the HDR display path. Leave off unless you see that line. Restart playback to apply.":
    "Forces a compatibility present mode that removes a thin bright line some monitors show at the screen edge. Side effects: 4K playback can drop to a slideshow and HDR content looks dimmer, because this mode bypasses the HDR display path. Leave off unless you see that line. Restart playback to apply.",
  "Frosts the still image on each unwatched episode in the list.":
    "Frosts the still image on each unwatched episode in the list.",
  "Full mode is active, so diary, friends activity and your ratings all work.":
    "Full mode is active, so diary, friends activity and your ratings all work.",
  "Full mode signs in with your Letterboxd password so your diary, friends activity and personal ratings work too. The password goes only to Stremboxd to fetch a token, and Harbor never stores it.":
    "Full mode signs in with your Letterboxd password so your diary, friends activity and personal ratings work too. The password goes only to Stremboxd to fetch a token, and Harbor never stores it.",
  "Full pack format reference: docs/avatar-packs.md in the Harbor repository.":
    "Full pack format reference: docs/avatar-packs.md in the Harbor repository.",
  "Full time": "Full time",
  GB: "GB",
  GD: "GD",
  GP: "GP",
  "GPU (compatibility)": "GPU (compatibility)",
  "GPU next": "GPU next",
  Goals: "Goals",
  Graphics: "Graphics",
  "Groups Refresh beside Back at the start of the picker header. Off keeps it at the far end, across from Back.":
    "Groups Refresh beside Back at the start of the picker header. Off keeps it at the far end, across from Back.",
  "Harbor did not draw its own icons. Two people did, and they are worth hiring.":
    "Harbor did not draw its own icons. Two people did, and they are worth hiring.",
  "Harbor hosts no media and indexes no media. The sources and addons available to you are the ones you choose to configure, and their use is subject to the laws of your jurisdiction and the terms of the services concerned.":
    "Harbor hosts no media and indexes no media. The sources and addons available to you are the ones you choose to configure, and their use is subject to the laws of your jurisdiction and the terms of the services concerned.",
  "Harbor is an independent client. It is not affiliated with, endorsed by, or sponsored by Stremio, or by any company, addon author, or trademark holder referenced in this application. All trademarks are the property of their respective owners.":
    "Harbor is an independent client. It is not affiliated with, endorsed by, or sponsored by Stremio, or by any company, addon author, or trademark holder referenced in this application. All trademarks are the property of their respective owners.",
  "Harbor is authorized on this device and syncing with Simkl.":
    "Harbor is authorized on this device and syncing with Simkl.",
  "Harbor is free and open source software, released under the MIT License.":
    "Harbor is free and open source software, released under the MIT License.",
  "Harbor is signed in to your MyAnimeList account.":
    "Harbor is signed in to your MyAnimeList account.",
  "Harbor is using {used} of the {quota} this computer allows.":
    "Harbor is using {used} of the {quota} this computer allows.",
  "Harbor library": "Harbor library",
  "Harbor opens 4 parallel requests to speed.cloudflare.com, discards the first 1.2 seconds so TCP slow-start does not tank the result, then measures until it has 150 MB or 8 seconds of steady transfer.":
    "Harbor opens 4 parallel requests to speed.cloudflare.com, discards the first 1.2 seconds so TCP slow-start does not tank the result, then measures until it has 150 MB or 8 seconds of steady transfer.",
  "Harbor opens only the address you paste here and lists the media it finds in that page's own source. It does not search anywhere else.":
    "Harbor opens only the address you paste here and lists the media it finds in that page's own source. It does not search anywhere else.",
  "Harbor picks the best stream it can find and starts playing straight away.":
    "Harbor picks the best stream it can find and starts playing straight away.",
  "Harbor picks the size your connection can keep up with.":
    "Harbor picks the size your connection can keep up with.",
  "Harbor puts streams, audio tracks and subtitles in these languages first. Leave it empty to accept anything.":
    "Harbor puts streams, audio tracks and subtitles in these languages first. Leave it empty to accept anything.",
  "Harbor reads your display and lands between the two.":
    "Harbor reads your display and lands between the two.",
  "Harbor scales the prompt to the episode length, so a short episode does not ask this early. The bar shows the last three minutes.":
    "Harbor scales the prompt to the episode length, so a short episode does not ask this early. The bar shows the last three minutes.",
  "Harbor scrobbles your playback to Trakt and keeps your watchlist in sync.":
    "Harbor scrobbles your playback to Trakt and keeps your watchlist in sync.",
  "Harbor shows the full list of streams every time so you choose one yourself.":
    "Harbor shows the full list of streams every time so you choose one yourself.",
  "Harbor shows you a short code to type in at trakt.tv. Scrobbling and watchlist sync begin the moment you approve it.":
    "Harbor shows you a short code to type in at trakt.tv. Scrobbling and watchlist sync begin the moment you approve it.",
  "Harbor signs out and stops syncing. Your lists on Simkl are left exactly as they are.":
    "Harbor signs out and stops syncing. Your lists on Simkl are left exactly as they are.",
  "Harbor signs out and stops updating your progress. Your list on MyAnimeList is left as it is.":
    "Harbor signs out and stops updating your progress. Your list on MyAnimeList is left as it is.",
  "Harbor tries HTTP, HTTPS, reverse proxies, and the provider's default port. Credentials are stored separately.":
    "Harbor tries HTTP, HTTPS, reverse proxies, and the provider's default port. Credentials are stored separately.",
  "Harbor uses its own community server. You can point it at a server you run yourself.":
    "Harbor uses its own community server. You can point it at a server you run yourself.",
  "Head to head": "Head to head",
  "Heads-up time": "Heads-up time",
  "Hide email address": "Hide email address",
  "Hide the code editors": "Hide the code editors",
  "Hides the episode name, which often gives the twist away on its own.":
    "Hides the episode name, which often gives the twist away on its own.",
  "Hides the synopsis text under each unwatched episode.":
    "Hides the synopsis text under each unwatched episode.",
  "Hold Ctrl or Cmd and scroll to resize Harbor's interface smoothly. This one cannot be changed.":
    "Hold Ctrl or Cmd and scroll to resize Harbor's interface smoothly. This one cannot be changed.",
  "Home team": "Home team",
  "How Harbor draws its own interface. Leave this on Automatic unless the app itself stutters, flickers or tears while scrolling, which some G-SYNC and high refresh rate setups do. Switching backends usually settles it. This does not affect video playback.":
    "How Harbor draws its own interface. Leave this on Automatic unless the app itself stutters, flickers or tears while scrolling, which some G-SYNC and high refresh rate setups do. Switching backends usually settles it. This does not affect video playback.",
  "How big the handle sits on the timeline while you scrub.":
    "How big the handle sits on the timeline while you scrub.",
  "How dark the gradient behind the featured title on Home is. 100% is the classic look.":
    "How dark the gradient behind the featured title on Home is. 100% is the classic look.",
  "How far ahead of the start time Harbor pings you. It scans your playlist EPG every 30 minutes.":
    "How far ahead of the start time Harbor pings you. It scans your playlist EPG every 30 minutes.",
  "How heavy the stroke around each letter is.": "How heavy the stroke around each letter is.",
  "How large every poster card is drawn across Home and search.":
    "How large every poster card is drawn across Home and search.",
  "How large subtitles are drawn on the video, at any window size.":
    "How large subtitles are drawn on the video, at any window size.",
  "How long Harbor fills the buffer before the picture appears.":
    "How long Harbor fills the buffer before the picture appears.",
  "How long a poster takes to grow and settle as the pointer passes it.":
    "How long a poster takes to grow and settle as the pointer passes it.",
  "How many episodes auto-play back to back before Harbor pauses to ask.":
    "How many episodes auto-play back to back before Harbor pauses to ask.",
  "How much of the video Harbor downloads in front of where you are watching.":
    "How much of the video Harbor downloads in front of where you are watching.",
  "How often Harbor re-reads the library index from {name}. Manual only refreshes when you press Sync now.":
    "How often Harbor re-reads the library index from {name}. Manual only refreshes when you press Sync now.",
  "How quickly the Harbor cursor moves with the right stick.":
    "How quickly the Harbor cursor moves with the right stick.",
  "How rounded the corners of every poster card are.":
    "How rounded the corners of every poster card are.",
  "How solid the panel behind the text looks over the video.":
    "How solid the panel behind the text looks over the video.",
  "How strongly the buffered part stands out against the rest of the bar.":
    "How strongly the buffered part stands out against the rest of the bar.",
  "How subtitles are drawn over the picture. The still below updates as you change anything, so you can judge the size and the contrast before you start a film.":
    "How subtitles are drawn over the picture. The still below updates as you change anything, so you can judge the size and the contrast before you start a film.",
  "How the buttons map in each context. Xbox glyphs are listed first, PlayStation second. The layout is fixed and cannot be changed.":
    "How the buttons map in each context. Xbox glyphs are listed first, PlayStation second. The layout is fixed and cannot be changed.",
  "How the navigation icons behave.": "How the navigation icons behave.",
  "How thick the timeline sits at the bottom of the player.":
    "How thick the timeline sits at the bottom of the player.",
  Hue: "Hue",
  "If a stream or the video player misbehaves, the log usually names the cause.":
    "If a stream or the video player misbehaves, the log usually names the cause.",
  "If this account has Discord linked, we'll DM you a code to reset your password without the recovery key.":
    "If this account has Discord linked, we'll DM you a code to reset your password without the recovery key.",
  "Image address": "Image address",
  "Import data from {name}": "Import data from {name}",
  "Import from a file": "Import from a file",
  "Import from a link": "Import from a link",
  "Import or export a .json pack": "Import or export a .json pack",
  "Import pack (.json)": "Import pack (.json)",
  "Include anime episodes and seasons, even when TV is turned off.":
    "Include anime episodes and seasons, even when TV is turned off.",
  "Include film releases from every source you turned on above.":
    "Include film releases from every source you turned on above.",
  "Include series premieres and new episodes. Anime is counted separately.":
    "Include series premieres and new episodes. Anime is counted separately.",
  Independence: "Independence",
  "Instant playback preparation": "Instant playback preparation",
  "Instant starts the best-ranked stream straight away. Pick a source opens the stream list every time, so you choose the release, quality and provider yourself.":
    "Instant starts the best-ranked stream straight away. Pick a source opens the stream list every time, so you choose the release, quality and provider yourself.",
  "Jump to today": "Jump to today",
  "Keeps subtitles visible when the player shrinks into the small floating window. Turn off to hide them there.":
    "Keeps subtitles visible when the player shrinks into the small floating window. Turn off to hide them there.",
  "Keyboard size": "Keyboard size",
  L: "L",
  "Latest chapters": "Latest chapters",
  "Letterboxd asked for a second step. Enter the six digit code, then connect again.":
    "Letterboxd asked for a second step. Enter the six digit code, then connect again.",
  "Licence texts": "Licence texts",
  "Lift subtitles clear of a letterbox bar or a burned-in logo.":
    "Lift subtitles clear of a letterbox bar or a burned-in logo.",
  Lineups: "Lineups",
  "Link Discord": "Link Discord",
  "Linked as {username}": "Linked as {username}",
  "Linked to your Harbor account.": "Linked to your Harbor account.",
  "Live TV, {scope}, {minutes} min lead": "Live TV, {scope}, {minutes} min lead",
  "Live now": "Live now",
  "Live preview is on. Save keeps what you've picked as your Custom theme. Reset reverts the editor to the saved palette.":
    "Live preview is on. Save keeps what you've picked as your Custom theme. Reset reverts the editor to the saved palette.",
  "Loaders, boats, and the bits between screens.": "Loaders, boats, and the bits between screens.",
  "Loads a backup file and restores exactly what it contains, without touching the rest of your setup. Your Stremio sign-in on this device stays as is.":
    "Loads a backup file and restores exactly what it contains, without touching the rest of your setup. Your Stremio sign-in on this device stays as is.",
  "Look any of them up before you give, or find a cause of your own.":
    "Look any of them up before you give, or find a cause of your own.",
  Lost: "Lost",
  "Low end lifted, for weight on speakers that do not have it.":
    "Low end lifted, for weight on speakers that do not have it.",
  "Low end pulled back, kinder to small speakers and to the neighbours.":
    "Low end pulled back, kinder to small speakers and to the neighbours.",
  "Low is cosmetic. Normal is annoying. High means a feature is broken. Critical means Harbor is unusable.":
    "Low is cosmetic. Normal is annoying. High means a feature is broken. Critical means Harbor is unusable.",
  "Manage this rule": "Manage this rule",
  "Match details are not available yet.": "Match details are not available yet.",
  "Match preview": "Match preview",
  "Match report": "Match report",
  "Match stats": "Match stats",
  "Measure this connection": "Measure this connection",
  Meetings: "Meetings",
  "Mid range lifted, so dialogue sits forward of the music and effects.":
    "Mid range lifted, so dialogue sits forward of the music and effects.",
  "Modern renderer with higher-quality processing. The right choice for almost every machine.":
    "Modern renderer with higher-quality processing. The right choice for almost every machine.",
  "Monochrome (White)": "Monochrome (White)",
  Motion: "Motion",
  "MyAnimeList is a free site for tracking the anime you watch. Open it to read more or to make an account.":
    "MyAnimeList is a free site for tracking the anime you watch. Open it to read more or to make an account.",
  NR: "NR",
  NRR: "NRR",
  "Name of the badge": "Name of the badge",
  "Name or pattern": "Name or pattern",
  "Name what broke in one sentence. Maintainers read this line first.":
    "Name what broke in one sentence. Maintainers read this line first.",
  "Narrow the list below by rule name or by the pattern text.":
    "Narrow the list below by rule name or by the pattern text.",
  "Navigation animations": "Navigation animations",
  "Needs an API-Sports key. The free plan covers it.":
    "Needs an API-Sports key. The free plan covers it.",
  "New releases": "New releases",
  "Next match": "Next match",
  "No fixtures on this day.": "No fixtures on this day.",
  "No fixtures scheduled": "No fixtures scheduled",
  "No number": "No number",
  "No playable media was found in that page's source.":
    "No playable media was found in that page's source.",
  "No prompt. The episode plays out and stops.": "No prompt. The episode plays out and stops.",
  "No settings match that.": "No settings match that.",
  "No shaping. The track plays exactly as it was mixed.":
    "No shaping. The track plays exactly as it was mixed.",
  "No sports channels found in your playlists.": "No sports channels found in your playlists.",
  "No subtitle addons installed yet.": "No subtitle addons installed yet.",
  "No teams available for these competitions yet.":
    "No teams available for these competitions yet.",
  "No teams match that search.": "No teams match that search.",
  "None of the images in that pack could be loaded.":
    "None of the images in that pack could be loaded.",
  "None yet. This opens Streaming sources, where subtitle addons are installed.":
    "None yet. This opens Streaming sources, where subtitle addons are installed.",
  "Not verified on macOS yet. It needs the gpu-next renderer, which is reliable on Windows.":
    "Not verified on macOS yet. It needs the gpu-next renderer, which is reliable on Windows.",
  "Nothing in this title to badge.": "Nothing in this title to badge.",
  "Number every step from a fresh start. This is the single most useful thing in a report.":
    "Number every step from a fresh start. This is the single most useful thing in a report.",
  "Nvidia RTX GPUs only. Upconverts SDR video to HDR on the GPU (turn on RTX Video HDR in the Nvidia app; needs GPU decode). Experimental. Unavailable while SVP is active for the current video.":
    "Nvidia RTX GPUs only. Upconverts SDR video to HDR on the GPU (turn on RTX Video HDR in the Nvidia app; needs GPU decode). Experimental. Unavailable while SVP is active for the current video.",
  "Nvidia RTX GPUs only. Upscales SDR video with AI on the GPU (turn on RTX Video Super Resolution in the Nvidia app; needs GPU decode). Experimental. Unavailable while SVP is active for the current video.":
    "Nvidia RTX GPUs only. Upscales SDR video with AI on the GPU (turn on RTX Video Super Resolution in the Nvidia app; needs GPU decode). Experimental. Unavailable while SVP is active for the current video.",
  OTL: "OTL",
  "Off the row": "Off the row",
  "Older, simpler renderer. Use it only if the modern one shows a black screen, wrong colors, or won't start on your graphics card.":
    "Older, simpler renderer. Use it only if the modern one shows a black screen, wrong colors, or won't start on your graphics card.",
  "On shows titles in your metadata language (English by default). Off keeps titles in English.":
    "On shows titles in your metadata language (English by default). Off keeps titles in English.",
  "On the pad, hold {button} to stop.": "On the pad, hold {button} to stop.",
  "On the pitch": "On the pitch",
  "One account covers football and hockey. The free plan allows 100 requests a day and Harbor paces itself to stay inside it.":
    "One account covers football and hockey. The free plan allows 100 requests a day and Harbor paces itself to stay inside it.",
  "Only the card gets wider. The text stays the same size, so bigger cards mean bigger artwork and fewer of them on screen.":
    "Only the card gets wider. The text stays the same size, so bigger cards mean bigger artwork and fewer of them on screen.",
  "Open Harbor on desktop to link Discord.": "Open Harbor on desktop to link Discord.",
  "Open anilist.co": "Open anilist.co",
  "Open myanimelist.net": "Open myanimelist.net",
  "Open simkl.com": "Open simkl.com",
  "Open trakt.tv": "Open trakt.tv",
  OpenGL: "OpenGL",
  "Opens Stremio's donation page in your browser.":
    "Opens Stremio's donation page in your browser.",
  "Opens anilist.co in your browser, where you can read what AniList does and make a free account.":
    "Opens anilist.co in your browser, where you can read what AniList does and make a free account.",
  "Opens stremboxd.com, the community bridge that reads Letterboxd on Harbor's behalf.":
    "Opens stremboxd.com, the community bridge that reads Letterboxd on Harbor's behalf.",
  "Opens three editors for CSS, JavaScript, and an HTML overlay. Changes apply as you type.":
    "Opens three editors for CSS, JavaScript, and an HTML overlay. Changes apply as you type.",
  "Opens trakt.tv in your browser, where you can read what Trakt does and make a free account.":
    "Opens trakt.tv in your browser, where you can read what Trakt does and make a free account.",
  "Optional. Point at a png, webp, or svg to show a picture instead of a text badge.":
    "Optional. Point at a png, webp, or svg to show a picture instead of a text badge.",
  P: "P",
  PCT: "PCT",
  PD: "PD",
  PTS: "PTS",
  "Page metadata": "Page metadata",
  "Page source": "Page source",
  Pages: "Pages",
  "Paste a link to a png, webp, or svg. Harbor will use it for this badge everywhere streams show format chips.":
    "Paste a link to a png, webp, or svg. Harbor will use it for this badge everywhere streams show format chips.",
  "Paste a stream": "Paste a stream",
  "Paste from clipboard": "Paste from clipboard",
  "Paste the address of any public Letterboxd list to add it as its own row.":
    "Paste the address of any public Letterboxd list to add it as its own row.",
  "Paste the page address": "Paste the page address",
  "Pattern to match": "Pattern to match",
  "Peek at a title on hover": "Peek at a title on hover",
  "Pick a badges.json that is already saved on this computer.":
    "Pick a badges.json that is already saved on this computer.",
  "Pick as many as you like. With none picked, every genre counts.":
    "Pick as many as you like. With none picked, every genre counts.",
  "Pick the cap your connection can sustain. Streams that need more than this rank lower, so Harbor stops offering you files you cannot actually play.":
    "Pick the cap your connection can sustain. Streams that need more than this rank lower, so Harbor stops offering you files you cannot actually play.",
  "Pick the clubs you follow and their next fixture and last result stay pinned here.":
    "Pick the clubs you follow and their next fixture and last result stay pinned here.",
  "Pick the countries of origin you follow. With none picked, every country counts.":
    "Pick the countries of origin you follow. With none picked, every country counts.",
  "Pick the services you care about. With none picked, every service counts.":
    "Pick the services you care about. With none picked, every service counts.",
  "Pick what to save, then everything you choose lands in one file: theme, home layout, settings, addons, profiles, watchlist, player layouts, watch progress, and more. Your Stremio sign-in is left out on purpose.":
    "Pick what to save, then everything you choose lands in one file: theme, home layout, settings, addons, profiles, watchlist, player layouts, watch progress, and more. Your Stremio sign-in is left out on purpose.",
  "Pick which corner of the poster the bookmark sits in.":
    "Pick which corner of the poster the bookmark sits in.",
  "Pick which languages Harbor looks for first, and which ones it falls back to.":
    "Pick which languages Harbor looks for first, and which ones it falls back to.",
  "Pick who this rule watches. With nobody picked, everyone you track counts.":
    "Pick who this rule watches. With nobody picked, everyone you track counts.",
  Picked: "Picked",
  "Pin this competition": "Pin this competition",
  "Play opens the stream list so you pick the release yourself.":
    "Play opens the stream list so you pick the release yourself.",
  "Play starts the best-ranked stream straight away.":
    "Play starts the best-ranked stream straight away.",
  "Player config": "Player config",
  "Player screen lock": "Player screen lock",
  "Point Harbor at a hosted pack link, upload your own images, or import a .zip. Harbor stores the link, so the artwork stays with whoever made it.":
    "Point Harbor at a hosted pack link, upload your own images, or import a .zip. Harbor stores the link, so the artwork stays with whoever made it.",
  "Post the alert to the Discord channel set up on the Destinations tab.":
    "Post the alert to the Discord channel set up on the Destinations tab.",
  "Prefer these sources": "Prefer these sources",
  "Preview unavailable": "Preview unavailable",
  "Previous match": "Previous match",
  "Probes the server's settings endpoint from this device and reports what came back.":
    "Probes the server's settings endpoint from this device and reports what came back.",
  "Public mode reads your account with nothing but your username. You get your watchlist, liked films, popular this week and the Top 250, and no password is needed.":
    "Public mode reads your account with nothing but your username. You get your watchlist, liked films, popular this week and the Top 250, and no password is needed.",
  "Pull every title on your Trakt watchlist into Harbor. Anything already saved is left alone.":
    "Pull every title on your Trakt watchlist into Harbor. Anything already saved is left alone.",
  "Pulls what you have part-watched on Simkl into the row, marked with the Simkl logo. Requires a connected Simkl account.":
    "Pulls what you have part-watched on Simkl into the row, marked with the Simkl logo. Requires a connected Simkl account.",
  "Pulls what you have part-watched on Trakt into the row, marked with the Trakt logo. Requires a connected Trakt account.":
    "Pulls what you have part-watched on Trakt into the row, marked with the Trakt logo. Requires a connected Trakt account.",
  "Puts a small bookmark on posters you have already saved.":
    "Puts a small bookmark on posters you have already saved.",
  "Puts the current offset on screen while you nudge subtitle timing with Z or X, so you can see how far you have shifted them.":
    "Puts the current offset on screen while you nudge subtitle timing with Z or X, so you can see how far you have shifted them.",
  "Puts the score you gave a film in the corner of its poster, wherever Letterboxd has one for you.":
    "Puts the score you gave a film in the corner of its poster, wherever Letterboxd has one for you.",
  "Read the source, file an issue, or fork it and send a patch.":
    "Read the source, file an issue, or fork it and send a patch.",
  "Reading your environment details…": "Reading your environment details…",
  "Reading {host}...": "Reading {host}...",
  "Recommended: sign in with Plex": "Recommended: sign in with Plex",
  "Recover via Discord": "Recover via Discord",
  "Recover via a code sent to Discord": "Recover via a code sent to Discord",
  Red: "Red",
  "Red cards": "Red cards",
  "Refresh every": "Refresh every",
  "Refresh this library": "Refresh this library",
  "Relay update available": "Relay update available",
  "Remove comment": "Remove comment",
  "Remove from your teams": "Remove from your teams",
  "Remove this stream": "Remove this stream",
  Renderer: "Renderer",
  "Rendering backend": "Rendering backend",
  "Renders mpv inline so playback lives in Harbor itself. Turn off to open it in a separate window instead.":
    "Renders mpv inline so playback lives in Harbor itself. Turn off to open it in a separate window instead.",
  "Renders subtitles in a heavier weight. Turn off to use your font's normal weight.":
    "Renders subtitles in a heavier weight. Turn off to use your font's normal weight.",
  "Replace selected data?": "Replace selected data?",
  Required: "Required",
  "Reset size": "Reset size",
  "Resolved from {host}": "Resolved from {host}",
  "Rest the cursor on a poster to peek at the rating, story, and quick actions without opening it. Off by default.":
    "Rest the cursor on a poster to peek at the rating, story, and quick actions without opening it. Off by default.",
  "Right in the middle of the picture, hard to miss.":
    "Right in the middle of the picture, hard to miss.",
  Role: "Role",
  "Rule is active": "Rule is active",
  "Rule name": "Rule name",
  "Rulesets bring a full badge set with their own matching. Art remaps only swap the pictures on Harbor's built-in badges. Anything shared as a badges.json link imports here too.":
    "Rulesets bring a full badge set with their own matching. Art remaps only swap the pictures on Harbor's built-in badges. Anything shared as a badges.json link imports here too.",
  "Run your own relay": "Run your own relay",
  "Running version {version} of the Watch Together protocol.":
    "Running version {version} of the Watch Together protocol.",
  "Running version {version}. Harbor's public relay updates itself, so there is nothing for you to do.":
    "Running version {version}. Harbor's public relay updates itself, so there is nothing for you to do.",
  "Running version {version}. Redeploy to pick up the latest Watch Together fixes. The in-app banner clears once the new version is live.":
    "Running version {version}. Redeploy to pick up the latest Watch Together fixes. The in-app banner clears once the new version is live.",
  "Runs a short download test against Cloudflare and shows the result here, so you can pick a cap that matches your real line.":
    "Runs a short download test against Cloudflare and shows the result here, so you can pick a cap that matches your real line.",
  "SUBDL API key": "SUBDL API key",
  "SUBDL returns nothing until a key is saved here.":
    "SUBDL returns nothing until a key is saved here.",
  "Same coverage, but still a window, so alt-tab stays instant.":
    "Same coverage, but still a window, so alt-tab stays instant.",
  "Saturation and brightness": "Saturation and brightness",
  "Save as JSON": "Save as JSON",
  "Save as SVG": "Save as SVG",
  "Save the rule": "Save the rule",
  "Saved to Downloads as harbor-mpv-log.txt. Attach it above.":
    "Saved to Downloads as harbor-mpv-log.txt. Attach it above.",
  "Saved {when} from Harbor {app}. Your Stremio sign-in stays as is.":
    "Saved {when} from Harbor {app}. Your Stremio sign-in stays as is.",
  "Saved.": "Saved.",
  "Search channels": "Search channels",
  "Search rules": "Search rules",
  "Search teams": "Search teams",
  "Search your channels": "Search your channels",
  "Searching works without a key. Adding one lets Harbor line subtitles up with the audio on its own.":
    "Searching works without a key. Adding one lets Harbor line subtitles up with the audio on its own.",
  "See which fixes are already in review before you start on one.":
    "See which fixes are already in review before you start on one.",
  "Seek dot": "Seek dot",
  "Send code": "Send code",
  "Send every title in your Harbor watchlist up to Trakt. Safe to run again, Trakt skips anything it already has.":
    "Send every title in your Harbor watchlist up to Trakt. Safe to run again, Trakt skips anything it already has.",
  "Send the alert through the Telegram bot set up on the Destinations tab.":
    "Send the alert through the Telegram bot set up on the Destinations tab.",
  "Sent once to Stremboxd to obtain a sign-in token. Harbor never keeps it.":
    "Sent once to Stremboxd to obtain a sign-in token. Harbor never keeps it.",
  "Set as home team": "Set as home team",
  "Shader files": "Shader files",
  "Shadow strength": "Shadow strength",
  "Shots on target": "Shots on target",
  "Show a lock control in the player that blocks mouse, keyboard, remote, and media-key input until you unlock it.":
    "Show a lock control in the player that blocks mouse, keyboard, remote, and media-key input until you unlock it.",
  "Show a row of the anime on your Simkl plan-to-watch list.":
    "Show a row of the anime on your Simkl plan-to-watch list.",
  "Show a row of the anime you are part way through.":
    "Show a row of the anime you are part way through.",
  "Show a row of the movies on your Simkl plan-to-watch list.":
    "Show a row of the movies on your Simkl plan-to-watch list.",
  "Show a row of the shows on your Simkl plan-to-watch list.":
    "Show a row of the shows on your Simkl plan-to-watch list.",
  "Show a row of the shows you are part way through.":
    "Show a row of the shows you are part way through.",
  "Show email address": "Show email address",
  "Show the code editors": "Show the code editors",
  "Shows a lighter fill for how much is buffered or downloaded ahead. It hides itself once a stream is fully cached (green dot).":
    "Shows a lighter fill for how much is buffered or downloaded ahead. It hides itself once a stream is fully cached (green dot).",
  "Shows everything the addon sends in the Stremio picker layout instead of trimming it to a few lines. That matters for AIOStreams and other custom formats. Off gives shorter, tidier rows.":
    "Shows everything the addon sends in the Stremio picker layout instead of trimming it to a few lines. That matters for AIOStreams and other custom formats. Off gives shorter, tidier rows.",
  "Sidebar icons play a short animation when you hover them. Turn this off to keep them as plain static icons.":
    "Sidebar icons play a short animation when you hover them. Turn this off to keep them as plain static icons.",
  "Sign in at anilist.co and authorize Harbor. Your anime lists show up on the Anime page as soon as you are back.":
    "Sign in at anilist.co and authorize Harbor. Your anime lists show up on the Anime page as soon as you are back.",
  "Sign in once with MyAnimeList. Harbor then updates your episode count as you watch, and never lowers a count you already have.":
    "Sign in once with MyAnimeList. Harbor then updates your episode count as you watch, and never lowers a count you already have.",
  "Sign in once with a short device code. Harbor then marks what you finish as watched and keeps your plan-to-watch list in step.":
    "Sign in once with a short device code. Harbor then marks what you finish as watched and keeps your plan-to-watch list in step.",
  "Sign in to sync your library, add-ons and watch history with Stremio.":
    "Sign in to sync your library, add-ons and watch history with Stremio.",
  "Sign in with Discord": "Sign in with Discord",
  "Sign in with Full mode to use this catalog.": "Sign in with Full mode to use this catalog.",
  "Sign out of Stremio": "Sign out of Stremio",
  "Signed in": "Signed in",
  "Signed in as {email}. Your library, add-ons and watch history sync with Stremio.":
    "Signed in as {email}. Your library, add-ons and watch history sync with Stremio.",
  "Signed in. Enter your server address below.": "Signed in. Enter your server address below.",
  Collections: "Collections",
  Daily: "Daily",
  Minutes: "Minutes",
  Hours: "Hours",
  Days: "Days",
  Weeks: "Weeks",
  "Refresh interval": "Refresh interval",
  "Refresh unit": "Refresh unit",
  "No collections on these servers.": "No collections on these servers.",
  "Signs in to Letterboxd and unlocks your diary, friends activity and ratings.":
    "Signs in to Letterboxd and unlocks your diary, friends activity and ratings.",
  "Simkl is a free site for tracking the movies, shows, and anime you watch. Open it to read more or to make an account.":
    "Simkl is a free site for tracking the movies, shows, and anime you watch. Open it to read more or to make an account.",
  "Simkl progress": "Simkl progress",
  "Simkl rails are turned off, so none of the rows below appear on Home yet.":
    "Simkl rails are turned off, so none of the rows below appear on Home yet.",
  "Simple color mode": "Simple color mode",
  "Size of the controller on-screen keyboard.": "Size of the controller on-screen keyboard.",
  "Small outlined pills that slide in under the title.":
    "Small outlined pills that slide in under the title.",
  Software: "Software",
  "Source extension": "Source extension",
  "Space in use": "Space in use",
  Standings: "Standings",
  Starter: "Starter",
  "Starting soon": "Starting soon",
  "Still watching check-in": "Still watching check-in",
  "Stops syncing on this device. Your library stays safe in your Stremio account.":
    "Stops syncing on this device. Your library stays safe in your Stremio account.",
  "Streaming catalogs need a TMDB key": "Streaming catalogs need a TMDB key",
  "Structured data": "Structured data",
  "Subsource API key": "Subsource API key",
  "Subsource returns nothing until a key is saved here.":
    "Subsource returns nothing until a key is saved here.",
  "Swap the handle for a sticker, a cat, anything you like.":
    "Swap the handle for a sticker, a cat, anything you like.",
  "Switch every rule the list currently shows. With a search active this only touches the matches.":
    "Switch every rule the list currently shows. With a search active this only touches the matches.",
  "Switch relay": "Switch relay",
  "Switch to sharing? This profile will use {name}'s library, watchlist and addons. Its own data is kept but hidden until you switch back.":
    "Switch to sharing? This profile will use {name}'s library, watchlist and addons. Its own data is kept but hidden until you switch back.",
  T: "T",
  "TMDB, Fanart, TVDB, OMDb and RPDB supply posters, artwork and ratings. Adding your own free keys makes artwork load faster and more completely.":
    "TMDB, Fanart, TVDB, OMDb and RPDB supply posters, artwork and ratings. Adding your own free keys makes artwork load faster and more completely.",
  "Takes effect the next time Harbor starts.": "Takes effect the next time Harbor starts.",
  "Test a stream title": "Test a stream title",
  "That pack could not be imported.": "That pack could not be imported.",
  "That page answered {status} and sent nothing back.":
    "That page answered {status} and sent nothing back.",
  "That page answered {status}, so there was nothing to read.":
    "That page answered {status}, so there was nothing to read.",
  "That page sent back no readable content.": "That page sent back no readable content.",
  "The Last Stand has aired its last episode, so it drops off the row and comes back when a new one lands.":
    "The Last Stand has aired its last episode, so it drops off the row and comes back when a new one lands.",
  "The Last Stand stays on the row with an amber countdown to the next episode.":
    "The Last Stand stays on the row with an amber countdown to the next episode.",
  "The Up Next pill appears {lead} before the end. The bar shows the last three minutes.":
    "The Up Next pill appears {lead} before the end. The bar shows the last three minutes.",
  "The account identifier Stremio uses for your library and addon collection.":
    "The account identifier Stremio uses for your library and addon collection.",
  "The address of the streaming server, including its port.":
    "The address of the streaming server, including its port.",
  "The bar runs to {pct} percent. Everything past the mark is boost.":
    "The bar runs to {pct} percent. Everything past the mark is boost.",
  "The chrome abiyyu drew for the player: transport, subtitles, shaders, and the rest.":
    "The chrome abiyyu drew for the player: transport, subtitles, shaders, and the rest.",
  "The color of the panel behind the text.": "The color of the panel behind the text.",
  "The controller button glyphs elsewhere in Harbor are not ours. They come from Kenney's Input Prompts, released into the public domain under CC0.":
    "The controller button glyphs elsewhere in Harbor are not ours. They come from Kenney's Input Prompts, released into the public domain under CC0.",
  "The darkest steps flatten together, which is how an LCD really behaves.":
    "The darkest steps flatten together, which is how an LCD really behaves.",
  "The entries taking the most room right now. Most of them are caches that rebuild themselves, so this list changes as you browse.":
    "The entries taking the most room right now. Most of them are caches that rebuild themselves, so this list changes as you browse.",
  "The fill color of the subtitle letters themselves.":
    "The fill color of the subtitle letters themselves.",
  "The filled part of the timeline. Default follows your Harbor accent.":
    "The filled part of the timeline. Default follows your Harbor accent.",
  "The full text of every licence covering software distributed with Harbor. Select any entry to save a copy.":
    "The full text of every licence covering software distributed with Harbor. Select any entry to save a copy.",
  "The handle in your profile address, letterboxd.com/your-name.":
    "The handle in your profile address, letterboxd.com/your-name.",
  "The most memory the head start is allowed to take while a video plays.":
    "The most memory the head start is allowed to take while a video plays.",
  "The principal open source components Harbor is built from.":
    "The principal open source components Harbor is built from.",
  "The release Harbor watches for. Everything else on this page narrows it down.":
    "The release Harbor watches for. Everything else on this page narrows it down.",
  "The shadow is what keeps the title and buttons readable. Drop it too far and the text starts fighting the artwork.":
    "The shadow is what keeps the title and buttons readable. Drop it too far and the text starts fighting the artwork.",
  "The sidebar set. Click any one to save the SVG.":
    "The sidebar set. Click any one to save the SVG.",
  "The small on-screen readout that appears while you nudge subtitle timing with Z and X during playback. Automatic syncing lives in the Sync tab.":
    "The small on-screen readout that appears while you nudge subtitle timing with Z and X during playback. Automatic syncing lives in the Sync tab.",
  "The stroke or halo drawn behind the letters.": "The stroke or halo drawn behind the letters.",
  "The text Harbor prints on the badge, for example REMUX.":
    "The text Harbor prints on the badge, for example REMUX.",
  "The typeface subtitles are drawn in. Add your own TTF, OTF or WOFF file if none of these suit.":
    "The typeface subtitles are drawn in. Add your own TTF, OTF or WOFF file if none of these suit.",
  "The volume bar stops at 100 percent. No boost is available.":
    "The volume bar stops at 100 percent. No boost is available.",
  "Theme and appearance": "Theme and appearance",
  "Then notify": "Then notify",
  "These are Harbor's own, drawn for Harbor. Take them for a theme, a fork, a mockup, a personal project. Keep the credit on the artists and do not sell the set on its own.":
    "These are Harbor's own, drawn for Harbor. Take them for a theme, a fork, a mockup, a personal project. Keep the credit on the artists and do not sell the set on its own.",
  "These organisations provide their services to Harbor at no cost.":
    "These organisations provide their services to Harbor at no cost.",
  "These rows are switched on but hidden from your home page. Choose Show to bring one back.":
    "These rows are switched on but hidden from your home page. Choose Show to bring one back.",
  "This badge is hidden everywhere streams show format chips.":
    "This badge is hidden everywhere streams show format chips.",
  "This badge uses art you picked instead of Harbor's default.":
    "This badge uses art you picked instead of Harbor's default.",
  "This cannot be undone. You would need to deploy a new relay.":
    "This cannot be undone. You would need to deploy a new relay.",
  "This deletes those entries from your library. Playing them again re-adds them.":
    "This deletes those entries from your library. Playing them again re-adds them.",
  "This file restores its {n} saved entries and replaces only those parts of your setup. Anything it does not contain stays exactly as it is.":
    "This file restores its {n} saved entries and replaces only those parts of your setup. Anything it does not contain stays exactly as it is.",
  "Tile your own artwork across the timeline instead of a plain fill.":
    "Tile your own artwork across the timeline instead of a plain fill.",
  Timeline: "Timeline",
  "Titles you are part-way through in your local downloads, even offline.":
    "Titles you are part-way through in your local downloads, even offline.",
  "Torrentio 4K": "Torrentio 4K",
  "Trakt progress": "Trakt progress",
  Trigger: "Trigger",
  "Tucked into the upper corner, clear of the subtitles.":
    "Tucked into the upper corner, clear of the subtitles.",
  "Turn on AniList comments first.": "Turn on AniList comments first.",
  "Turn this off and the report ships with no name attached.":
    "Turn this off and the report ships with no name attached.",
  "Turn this off to keep the rule but stop it sending anything for now.":
    "Turn this off to keep the rule but stop it sending anything for now.",
  "Turn this on and Harbor watches just the Live TV channels you starred. Off means every channel in your playlists.":
    "Turn this on and Harbor watches just the Live TV channels you starred. Off means every channel in your playlists.",
  "Turning this on adds your Letterboxd catalogs to the home page and a Letterboxd panel to every film page.":
    "Turning this on adds your Letterboxd catalogs to the home page and a Letterboxd panel to every film page.",
  "Type any release name here to see what Harbor would badge it with.":
    "Type any release name here to see what Harbor would badge it with.",
  "Unavailable while Continue Watching is kept private to each profile, because Simkl progress is shared across every profile on this account.":
    "Unavailable while Continue Watching is kept private to each profile, because Simkl progress is shared across every profile on this account.",
  "Unavailable while Continue Watching is kept private to each profile, because Trakt progress is shared across every profile on this account.":
    "Unavailable while Continue Watching is kept private to each profile, because Trakt progress is shared across every profile on this account.",
  "Unavailable while Continue Watching is kept private to each profile.":
    "Unavailable while Continue Watching is kept private to each profile.",
  Unlink: "Unlink",
  "Unpin this competition": "Unpin this competition",
  "Up to 3840 × 2160 when the source has it. Takes a beat longer to start.":
    "Up to 3840 × 2160 when the source has it. Takes a beat longer to start.",
  "Upload a picture of your own, or pick one from the Harbor catalog.":
    "Upload a picture of your own, or pick one from the Harbor catalog.",
  "Uploads stay on this computer. Keep the file under 250 KB.":
    "Uploads stay on this computer. Keep the file under 250 KB.",
  "Use color to distinguish severity, or keep every advisory monochrome.":
    "Use color to distinguish severity, or keep every advisory monochrome.",
  "Use for this fixture": "Use for this fixture",
  "Used only if we need one more detail to reproduce the bug.":
    "Used only if we need one more detail to reproduce the bug.",
  "User-made packs from the community store, refreshed every week.":
    "User-made packs from the community store, refreshed every week.",
  "Using these": "Using these",
  "Video element": "Video element",
  "Volume {n}": "Volume {n}",
  Vulkan: "Vulkan",
  W: "W",
  "Warming up…": "Warming up…",
  "Watched history": "Watched history",
  "Watchlist ({n})": "Watchlist ({n})",
  "We sent a 6-digit code to your Discord DMs. It expires in 10 minutes.":
    "We sent a 6-digit code to your Discord DMs. It expires in 10 minutes.",
  "We tag this account on the issue so you see the fix land.":
    "We tag this account on the issue so you see the fix land.",
  "We'll show a one-time recovery key and send it to you on Discord. Save it: it's the only way back in if you forget your password.":
    "We'll show a one-time recovery key and send it to you on Discord. Save it: it's the only way back in if you forget your password.",
  "What should the backup include?": "What should the backup include?",
  "What the sidebar icons do when you land on them.":
    "What the sidebar icons do when you land on them.",
  "What this rule is called in your list. Leave it empty and Harbor names it after the trigger.":
    "What this rule is called in your list. Leave it empty and Harbor names it after the trigger.",
  "When a movie or episode starts, briefly show its Common Sense Media parental guide (violence, nudity, profanity, substances) with severity. Fades on its own.":
    "When a movie or episode starts, briefly show its Common Sense Media parental guide (violence, nudity, profanity, substances) with severity. Fades on its own.",
  "Where Play looks first": "Where Play looks first",
  "Where a subtitle line sits across the width of the video.":
    "Where a subtitle line sits across the width of the video.",
  "Where badges come from": "Where badges come from",
  "Where the laurel tab sits relative to the score chips on the poster.":
    "Where the laurel tab sits relative to the score chips on the poster.",
  "Which top corner of the poster the ribbon folds over.":
    "Which top corner of the poster the ribbon folds over.",
  "Who drew all this": "Who drew all this",
  "Writes the last playback session to your Downloads folder so you can attach it above.":
    "Writes the last playback session to your Downloads folder so you can attach it above.",
  "Yellow cards": "Yellow cards",
  "You have no automations yet. Create one and Harbor will message you the moment something matches.":
    "You have no automations yet. Create one and Harbor will message you the moment something matches.",
  "You have not added any favourites yet": "You have not added any favourites yet",
  "Your AniList account": "Your AniList account",
  "Your MyAnimeList account": "Your MyAnimeList account",
  "Your Simkl account": "Your Simkl account",
  "Your Trakt account": "Your Trakt account",
  "Your own Harbor account progress. The primary source for almost everyone.":
    "Your own Harbor account progress. The primary source for almost everyone.",
  "Your pick for this competition": "Your pick for this competition",
  "Your preferences, layout state, and small lookup caches. Clearing caches shrinks this.":
    "Your preferences, layout state, and small lookup caches. Clearing caches shrinks this.",
  "Your teams": "Your teams",
  at: "at",
  "contains login credentials": "contains login credentials",
  icons: "icons",
  "in 4d 6h": "in 4d 6h",
  "in {d}d": "in {d}d",
  "in {d}d {h}h": "in {d}d {h}h",
  "in {h}h": "in {h}h",
  "in {h}h {m}m": "in {h}h {m}m",
  "in {m}m": "in {m}m",
  "in {n}m": "in {n}m",
  "in {n}s": "in {n}s",
  "nowhere yet": "nowhere yet",
  username: "username",
  vs: "vs",
  "{count} installed. Their results are merged in with everything else.":
    "{count} installed. Their results are merged in with everything else.",
  "{ms} ms": "{ms} ms",
  "{m} of {n} on": "{m} of {n} on",
  "{n} badges use art you picked instead of Harbor's default.":
    "{n} badges use art you picked instead of Harbor's default.",
  "{n} badges, by {name}": "{n} badges, by {name}",
  "{n} films.": "{n} films.",
  "{n} followed": "{n} followed",
  "{n} found": "{n} found",
  "{n} images in that pack could not be loaded.": "{n} images in that pack could not be loaded.",
  "{n} of {total} chosen": "{n} of {total} chosen",
  "{n} px/s": "{n} px/s",
  "{n} seconds": "{n} seconds",
  "{n}x card width": "{n}x card width",
  "{trigger}. Sends to {channels}.": "{trigger}. Sends to {channels}.",
  "Harbor on Discord": "Harbor on Discord",
  "Release notes, help from other people using Harbor, and somewhere to send bugs.":
    "Release notes, help from other people using Harbor, and somewhere to send bugs.",
  "Player controls in Big Picture": "Player controls in Big Picture",
  "Ten-foot uses large controls built for a remote across the room. Desktop keeps the same player you use in the normal window, which is quicker with a mouse and keyboard.":
    "Ten-foot uses large controls built for a remote across the room. Desktop keeps the same player you use in the normal window, which is quicker with a mouse and keyboard.",
  "Ten-foot": "Ten-foot",
  Desktop: "Desktop",
  "Downloads the whole torrent into Harbor's stream cache in the background as you watch, even while paused, so big remuxes pre-load. P2P only: debrid and other HTTPS streams stay in memory and are never written to disk. Uses more disk and bandwidth; cleared when you switch or close.":
    "Downloads the whole torrent into Harbor's stream cache in the background as you watch, even while paused, so big remuxes pre-load. P2P only: debrid and other HTTPS streams stay in memory and are never written to disk. Uses more disk and bandwidth; cleared when you switch or close.",
  "Sizes the cache from this computer's memory: about 1/16 of RAM, between 256 MB and 1 GB, split 75% ahead and 25% behind. Recommended for most connections.":
    "Sizes the cache from this computer's memory: about 1/16 of RAM, between 256 MB and 1 GB, split 75% ahead and 25% behind. Recommended for most connections.",
  "Maximum memory used for buffered video, ahead and behind.":
    "Maximum memory used for buffered video, ahead and behind.",
  "Capped to {size} to protect memory.": "Capped to {size} to protect memory.",
  "Sign out of Nuvio": "Sign out of Nuvio",
  "Sign in to Nuvio": "Sign in to Nuvio",
  "Sign in to Nuvio to open your profile.": "Sign in to Nuvio to open your profile.",
  "Start reading": "Start reading",
  "Mark as unread": "Mark as unread",
  "Mark as read": "Mark as read",
  "Paused on PublicMetaDB": "Paused on PublicMetaDB",
  "Airing soon": "Airing soon",
  "in {days}d {hours}h": "in {days}d {hours}h",
  "in {hours}h {minutes}m": "in {hours}h {minutes}m",
  "in {minutes}m": "in {minutes}m",
  "Browse by Country": "Browse by Country",
  "The canon": "The canon",
  "Layout Style": "Layout Style",
  "In {n} days": "In {n} days",
  "In {d}d {h}h {m}m": "In {d}d {h}h {m}m",
  "In {h}h {m}m": "In {h}h {m}m",
  "In {n} min": "In {n} min",
  "My Groups": "My Groups",
  "Approve Harbor in your browser, then return here. If Harbor does not open automatically, use Open Harbor on the confirmation page or paste the code below.":
    "Approve Harbor in your browser, then return here. If Harbor does not open automatically, use Open Harbor on the confirmation page or paste the code below.",
  "music.connections.streaming": "music.connections.streaming",
  "music.connect.artistsBody": "music.connect.artistsBody",
  "music.connections.server": "music.connections.server",
  "music.billboard.rank": "music.billboard.rank",
  "music.spotifyBrowse.title": "music.spotifyBrowse.title",
  "music.spotifyBrowse.body": "music.spotifyBrowse.body",
  "music.spotifyBrowse.action": "music.spotifyBrowse.action",
  "music.spotifyDevices.title": "music.spotifyDevices.title",
  "music.spotifyDevices.body": "music.spotifyDevices.body",
  "music.spotifyDevices.refresh": "music.spotifyDevices.refresh",
  "music.spotifyDevices.harbor": "music.spotifyDevices.harbor",
  "music.spotifyDevices.empty": "music.spotifyDevices.empty",
  "music.spotifySetup.pairTitle": "music.spotifySetup.pairTitle",
  "music.spotifySetup.pairBody": "music.spotifySetup.pairBody",
  "music.spotifySetup.pairCodeLabel": "music.spotifySetup.pairCodeLabel",
  "music.spotifySetup.pairWaiting": "music.spotifySetup.pairWaiting",
  "music.spotifySetup.pairOpen": "music.spotifySetup.pairOpen",
  "music.spotifySetup.pairCopyFailed": "music.spotifySetup.pairCopyFailed",
  "music.spotifySetup.pairAction": "music.spotifySetup.pairAction",
  "music.spotifySetup.pairManual": "music.spotifySetup.pairManual",
  "music.spotifySetup.browseRecommended": "music.spotifySetup.browseRecommended",
  "music.spotifySetup.browseBody": "music.spotifySetup.browseBody",
  "music.lastfm.viewProfile": "music.lastfm.viewProfile",
  "music.lastfm.keyHelp": "music.lastfm.keyHelp",
  "music.lastfm.getKey": "music.lastfm.getKey",
  "music.lastfm.createAccount": "music.lastfm.createAccount",
  "Pick a preset above, or add a filter to start shaping the sound.":
    "Pick a preset above, or add a filter to start shaping the sound.",
  "music.playlist.duplicateWarning": "music.playlist.duplicateWarning",
  "music.playlist.addDuplicate": "music.playlist.addDuplicate",
  "music.playlist.editDetails": "music.playlist.editDetails",
  "music.playlist.edit": "music.playlist.edit",
  "music.quick.playlists": "music.quick.playlists",
  "music.quick.playlistsNote": "music.quick.playlistsNote",
  "music.quick.play": "music.quick.play",
  "music.quick.empty": "music.quick.empty",
  "music.quick.emptyNote": "music.quick.emptyNote",
  "music.card.openPlaying": "music.card.openPlaying",
  Nuvio: "Nuvio",
  "Waiting in browser...": "Waiting in browser...",
  "Sign in with Nuvio": "Sign in with Nuvio",
  "Opens nuvio.tv/link in your browser. Enter code or approve online.":
    "Opens nuvio.tv/link in your browser. Enter code or approve online.",
  "Show chapter marks on seekbar": "Show chapter marks on seekbar",
  "Remove profile PIN": "Remove profile PIN",
  "Confirm your current PIN to remove protection.":
    "Confirm your current PIN to remove protection.",
  "Enter PIN to delete": "Enter PIN to delete",
  "Nuvio account": "Nuvio account",
  "Use primary addons": "Use primary addons",
  "Inherit installed addons and providers configured by the primary profile.":
    "Inherit installed addons and providers configured by the primary profile.",
  "Use separate addons": "Use separate addons",
  "Install and configure independent addons and providers for this profile.":
    "Install and configure independent addons and providers for this profile.",
  "Pick a 4-digit PIN to lock this profile.": "Pick a 4-digit PIN to lock this profile.",
  "Enter the 4-digit PIN to edit this profile.": "Enter the 4-digit PIN to edit this profile.",
  "Set up Live TV to watch these events.": "Set up Live TV to watch these events.",
  "games.noResults": "games.noResults",
  "games.library.showMore": "games.library.showMore",
  "The Times: Best Books of the 21st Century": "The Times: Best Books of the 21st Century",
  "From the New York Times critics' list of the century so far":
    "From the New York Times critics' list of the century so far",
  "Read It Before You Watch It": "Read It Before You Watch It",
  "Books behind the films and series everyone knows":
    "Books behind the films and series everyone knows",
  "Banned and Challenged": "Banned and Challenged",
  "Books someone tried to pull from a shelf": "Books someone tried to pull from a shelf",
  "Nobel Laureates in Literature": "Nobel Laureates in Literature",
  "Signature works by winners of the Nobel Prize": "Signature works by winners of the Nobel Prize",
  "Twentieth century books that never left the shelf":
    "Twentieth century books that never left the shelf",
  Dystopias: "Dystopias",
  "Futures nobody would choose to live in": "Futures nobody would choose to live in",
  "Crime and Mystery Essentials": "Crime and Mystery Essentials",
  "The cases that set the genre": "The cases that set the genre",
  "Women's Prize for Fiction": "Women's Prize for Fiction",
  "Full length fiction by women writing in English":
    "Full length fiction by women writing in English",
  "National Book Award Winners": "National Book Award Winners",
  "The American award for the year's best writing":
    "The American award for the year's best writing",
  "mpv could not start": "mpv could not start",
  "Playing in your mpv": "Playing in your mpv",
  "Harbor keeps your progress in sync while it plays. Close mpv to come back here.":
    "Harbor keeps your progress in sync while it plays. Close mpv to come back here.",
  "This profile": "This profile",
  "Bringing your Nuvio library?": "Bringing your Nuvio library?",
  "Connect Nuvio to sync your profiles, watchlist, and addons.":
    "Connect Nuvio to sync your profiles, watchlist, and addons.",
  "Open Nuvio settings": "Open Nuvio settings",
  "Backdrop mosaic": "Backdrop mosaic",
  "Backdrop zoom": "Backdrop zoom",
  "games.savedEmpty": "games.savedEmpty",
  "Snapshot {date}": "Snapshot {date}",
  "Inducted {year}": "Inducted {year}",
  Credits: "Credits",
  "Essay by {name}": "Essay by {name}",
  "Essay from the Library": "Essay from the Library",
  "Showing {shown} of {total} from the last snapshot.":
    "Showing {shown} of {total} from the last snapshot.",
  "Spine {n}": "Spine {n}",
  "Film Registry": "Film Registry",
  "One other screen version": "One other screen version",
  "{n} other screen versions": "{n} other screen versions",
  "Read it": "Read it",
  Television: "Television",
  Private: "Private",
  "Remove {title} from {list} on PMDB": "Remove {title} from {list} on PMDB",
  "Add {title} to {list} on PMDB": "Add {title} to {list} on PMDB",
  "In PMDB": "In PMDB",
  "Add to PMDB": "Add to PMDB",
  "No Season": "No Season",
  "One episode · Apple Podcasts": "One episode · Apple Podcasts",
  "{n} episodes · Apple Podcasts": "{n} episodes · Apple Podcasts",
  "Open in Apple Podcasts": "Open in Apple Podcasts",
  "Based on": "Based on",
  Soundtrack: "Soundtrack",
  "Discussed on": "Discussed on",
  "Cinema release": "Cinema release",
  "Digital release": "Digital release",
  "Remove from {list} on PMDB": "Remove from {list} on PMDB",
  "Add to {list} on PMDB": "Add to {list} on PMDB",
  ShotOnWhat: "ShotOnWhat",
  Digital: "Digital",
  "Shot on": "Shot on",
  Camera: "Camera",
  Cameras: "Cameras",
  Lens: "Lens",
  Lenses: "Lenses",
  "Film stock": "Film stock",
  Finish: "Finish",
  "Shares crew with 1 other film": "Shares crew with 1 other film",
  "Shares crew with {n} other films": "Shares crew with {n} other films",
  "Shares crew with": "Shares crew with",
  "Three or more of the same crew": "Three or more of the same crew",
  "Same source": "Same source",
  "Shares {n} crew": "Shares {n} crew",
  "Synced to Nuvio Cloud": "Synced to Nuvio Cloud",
  Editions: "Editions",
  "{n} published": "{n} published",
  Readers: "Readers",
  "{n} ratings": "{n} ratings",
  "Want to read": "Want to read",
  "{n} readers": "{n} readers",
  Setting: "Setting",
  Period: "Period",
  "The series that carried {name} beyond its own borders":
    "The series that carried {name} beyond its own borders",
  "The films that carried {name} beyond its own borders":
    "The films that carried {name} beyond its own borders",
  "1 title from {name}": "1 title from {name}",
  "{n} titles from {name}": "{n} titles from {name}",
  "The country's biggest names, ranked across their whole careers":
    "The country's biggest names, ranked across their whole careers",
  "The directors from {name}, ranked across their whole careers":
    "The directors from {name}, ranked across their whole careers",
  "Top ten films of {year}": "Top ten films of {year}",
  "Classic layout": "Classic layout",
  "Grid layout": "Grid layout",
  "games.about": "games.about",
  "games.steam": "games.steam",
  "games.charts.loading": "games.charts.loading",
  "games.discovery.activeTitle": "games.discovery.activeTitle",
  "games.discovery.activeNote": "games.discovery.activeNote",
  "games.availability.": "games.availability.",
  "games.charts.error": "games.charts.error",
  "games.discovery.activeSource": "games.discovery.activeSource",
  "games.discovery.countsSource": "games.discovery.countsSource",
  "games.editorial.consoleTitle": "games.editorial.consoleTitle",
  "games.editorial.consoleNote": "games.editorial.consoleNote",
  "games.atlas.browseAll": "games.atlas.browseAll",
  "games.editorial.explorePlatform": "games.editorial.explorePlatform",
  "games.atlas.hacksNote": "games.atlas.hacksNote",
  "games.clear": "games.clear",
  "games.emulation.ownGames": "games.emulation.ownGames",
  "games.atlas.mod": "games.atlas.mod",
  "games.atlas.ratingNote": "games.atlas.ratingNote",
  "games.retryNote": "games.retryNote",
  "games.details.broadcast": "games.details.broadcast",
  "games.details.broadcastViewers": "games.details.broadcastViewers",
  "games.details.broadcastSource": "games.details.broadcastSource",
  "games.details.broadcastWatch": "games.details.broadcastWatch",
  "games.catalog.inTheMood": "games.catalog.inTheMood",
  "games.catalog.players": "games.catalog.players",
  "games.catalog.price": "games.catalog.price",
  "games.allPlatforms": "games.allPlatforms",
  "games.catalog.filters": "games.catalog.filters",
  "games.fullController": "games.fullController",
  "games.details.removeFeature": "games.details.removeFeature",
  "games.results": "games.results",
  "games.catalog.title": "games.catalog.title",
  "games.catalog.error": "games.catalog.error",
  "games.catalog.activeFilters": "games.catalog.activeFilters",
  "games.catalog.searching": "games.catalog.searching",
  "games.library.grid": "games.library.grid",
  "games.catalog.noResultsNote": "games.catalog.noResultsNote",
  "games.cloud.part": "games.cloud.part",
  "games.cloud.kicker": "games.cloud.kicker",
  "games.cloud.title": "games.cloud.title",
  "games.cloud.provider": "games.cloud.provider",
  "games.cloud.connected": "games.cloud.connected",
  "games.cloud.openSettings": "games.cloud.openSettings",
  "games.cloud.review": "games.cloud.review",
  "games.cloud.root": "games.cloud.root",
  "games.cloud.refresh": "games.cloud.refresh",
  "games.cloud.unknownSize": "games.cloud.unknownSize",
  "games.cloud.reviewNote": "games.cloud.reviewNote",
  "games.cloud.search": "games.cloud.search",
  "games.cloud.clearSearch": "games.cloud.clearSearch",
  "games.cloud.resolving": "games.cloud.resolving",
  "games.cloud.folder": "games.cloud.folder",
  "games.cloud.more": "games.cloud.more",
  "games.cloud.previousPage": "games.cloud.previousPage",
  "games.cloud.nextPage": "games.cloud.nextPage",
  "games.discovery.collections": "games.discovery.collections",
  "games.collectionNote": "games.collectionNote",
  "games.discovery.collectionPosition": "games.discovery.collectionPosition",
  "games.collection.search": "games.collection.search",
  "games.community.studio": "games.community.studio",
  "games.community.allUpdates": "games.community.allUpdates",
  "games.community.newsError": "games.community.newsError",
  "games.community.noUpdates": "games.community.noUpdates",
  "games.player.position": "games.player.position",
  "games.achievements": "games.achievements",
  "games.community.achievementsNote": "games.community.achievementsNote",
  "games.community.allAchievements": "games.community.allAchievements",
  "games.details.completionTimes": "games.details.completionTimes",
  "games.details.hours": "games.details.hours",
  "games.details.completionSamples": "games.details.completionSamples",
  "games.atlas.keepExploring": "games.atlas.keepExploring",
  "games.atlas.related": "games.atlas.related",
  "games.atlas.relatedNote": "games.atlas.relatedNote",
  "games.atlas.kind.mode": "games.atlas.kind.mode",
  "games.atlas.kind.perspective": "games.atlas.kind.perspective",
  "games.media.eyebrow": "games.media.eyebrow",
  "games.media.filter": "games.media.filter",
  "games.media.error": "games.media.error",
  "games.media.more": "games.media.more",
  "games.custom.artwork": "games.custom.artwork",
  "games.custom.resetArt": "games.custom.resetArt",
  "games.custom.title": "games.custom.title",
  "games.custom.add": "games.custom.add",
  "games.custom.desktopTitle": "games.custom.desktopTitle",
  "games.custom.desktopNote": "games.custom.desktopNote",
  "games.custom.visibility": "games.custom.visibility",
  "games.custom.visible": "games.custom.visible",
  "games.custom.hidden": "games.custom.hidden",
  "games.custom.running": "games.custom.running",
  "games.custom.pinned": "games.custom.pinned",
  "games.custom.localFile": "games.custom.localFile",
  "games.custom.manageNamed": "games.custom.manageNamed",
  "games.custom.executable": "games.custom.executable",
  "games.custom.useDefault": "games.custom.useDefault",
  "games.custom.name": "games.custom.name",
  "games.custom.nameHint": "games.custom.nameHint",
  "games.custom.compatibility": "games.custom.compatibility",
  "games.custom.native": "games.custom.native",
  "games.custom.compatNote": "games.custom.compatNote",
  "games.custom.advanced": "games.custom.advanced",
  "games.custom.arguments": "games.custom.arguments",
  "games.custom.argumentsNote": "games.custom.argumentsNote",
  "games.custom.detailsTitle": "games.custom.detailsTitle",
  "games.custom.lastLaunch": "games.custom.lastLaunch",
  "games.custom.historyNote": "games.custom.historyNote",
  "games.custom.removeNote": "games.custom.removeNote",
  "games.custom.remove": "games.custom.remove",
  "games.details.scan": "games.details.scan",
  "games.details.support": "games.details.support",
  "games.details.playOn": "games.details.playOn",
  "games.details.controllerPartial": "games.details.controllerPartial",
  "games.details.deckMore": "games.details.deckMore",
  "games.details.deck": "games.details.deck",
  "games.details.playersAt": "games.details.playersAt",
  "games.details.playingNow": "games.details.playingNow",
  "games.details.ratings": "games.details.ratings",
  "games.details.ratingCount": "games.details.ratingCount",
  "games.details.critics": "games.details.critics",
  "games.languages": "games.languages",
  "games.details.languageCount": "games.details.languageCount",
  "games.requirements": "games.requirements",
  "games.details.publicAchievements": "games.details.publicAchievements",
  "games.details.viewAchievements": "games.details.viewAchievements",
  "games.detailError": "games.detailError",
  "games.library.play": "games.library.play",
  "games.libraryPersonal.customize": "games.libraryPersonal.customize",
  "games.details.findSources": "games.details.findSources",
  "games.details.details": "games.details.details",
  "games.details.information": "games.details.information",
  "games.features": "games.features",
  "games.details.enrichmentError": "games.details.enrichmentError",
  "games.atlas.relationshipError": "games.atlas.relationshipError",
  "games.editorial.scoreNote": "games.editorial.scoreNote",
  "games.discovery.ratingsLoading": "games.discovery.ratingsLoading",
  "games.discovery.ratingCount": "games.discovery.ratingCount",
  "games.freshArrivals": "games.freshArrivals",
  "games.new_releases": "games.new_releases",
  "games.new_releasesNote": "games.new_releasesNote",
  "games.newRelease": "games.newRelease",
  "games.charts.title": "games.charts.title",
  "games.charts.note": "games.charts.note",
  "games.liveCatalog": "games.liveCatalog",
  "games.charts.search": "games.charts.search",
  "games.download.details": "games.download.details",
  "games.download.progress": "games.download.progress",
  "games.torrent.peers": "games.torrent.peers",
  "games.download.destination": "games.download.destination",
  "games.library.refresh": "games.library.refresh",
  "games.sources.manage": "games.sources.manage",
  "games.torrent.add": "games.torrent.add",
  "games.download.add": "games.download.add",
  "games.download.desktopTitle": "games.download.desktopTitle",
  "games.download.desktopNote": "games.download.desktopNote",
  "games.download.verified": "games.download.verified",
  "games.download.pauseShort": "games.download.pauseShort",
  "games.download.pause": "games.download.pause",
  "games.download.resume": "games.download.resume",
  "games.download.revealShort": "games.download.revealShort",
  "games.download.reveal": "games.download.reveal",
  "games.download.remove": "games.download.remove",
  "games.download.cancelShort": "games.download.cancelShort",
  "games.download.cancel": "games.download.cancel",
  "games.download.directNote": "games.download.directNote",
  "games.download.url": "games.download.url",
  "games.download.name": "games.download.name",
  "games.download.checksum": "games.download.checksum",
  "games.download.hashPlaceholder": "games.download.hashPlaceholder",
  "games.download.hashNote": "games.download.hashNote",
  "games.emulation.platform": "games.emulation.platform",
  "games.emulation.setup": "games.emulation.setup",
  "games.emulation.desktopTitle": "games.emulation.desktopTitle",
  "games.emulation.desktopNote": "games.emulation.desktopNote",
  "games.emulation.emulator": "games.emulation.emulator",
  "games.emulation.application": "games.emulation.application",
  "games.emulation.noApp": "games.emulation.noApp",
  "games.emulation.core": "games.emulation.core",
  "games.emulation.chooseCoreNote": "games.emulation.chooseCoreNote",
  "games.emulation.chooseCore": "games.emulation.chooseCore",
  "games.emulation.notDetected": "games.emulation.notDetected",
  "games.emulation.official": "games.emulation.official",
  "games.emulation.recent": "games.emulation.recent",
  "games.catalog.sort.Name_ASC": "games.catalog.sort.Name_ASC",
  "games.library.view": "games.library.view",
  "games.library.list": "games.library.list",
  "games.emulation.importing": "games.emulation.importing",
  "games.emulation.discs": "games.emulation.discs",
  "games.emulation.unavailableGame": "games.emulation.unavailableGame",
  "games.match.findFor": "games.match.findFor",
  "games.emulation.folders": "games.emulation.folders",
  "games.emulation.unavailableFolder": "games.emulation.unavailableFolder",
  "games.emulation.scanLimited": "games.emulation.scanLimited",
  "games.emulation.skipped": "games.emulation.skipped",
  "games.emulation.removeFolder": "games.emulation.removeFolder",
  "games.emulation.removeNote": "games.emulation.removeNote",
  "games.discovery.esportsTitle": "games.discovery.esportsTitle",
  "games.discovery.esportsEntry": "games.discovery.esportsEntry",
  "games.discovery.openSports": "games.discovery.openSports",
  "games.discovery.esportsNote": "games.discovery.esportsNote",
  "games.discovery.bestOf": "games.discovery.bestOf",
  "games.discovery.viewEvent": "games.discovery.viewEvent",
  "games.discovery.esportsCoverage": "games.discovery.esportsCoverage",
  "games.discovery.worldsTitle": "games.discovery.worldsTitle",
  "games.discovery.worldsNote": "games.discovery.worldsNote",
  "games.discovery.exploreWorld": "games.discovery.exploreWorld",
  "games.discovery.gameType.": "games.discovery.gameType.",
  "games.editorial.favorites": "games.editorial.favorites",
  "games.editorial.moreRated": "games.editorial.moreRated",
  "games.discovery.reviewCount": "games.discovery.reviewCount",
  "games.editorial.favoritesError": "games.editorial.favoritesError",
  "games.bundles.terms": "games.bundles.terms",
  "games.bundles.included": "games.bundles.included",
  "games.bundles.ends": "games.bundles.ends",
  "games.bundles.unavailable": "games.bundles.unavailable",
  "games.prices.title": "games.prices.title",
  "games.prices.find": "games.prices.find",
  "games.prices.from": "games.prices.from",
  "games.details.storeRegion": "games.details.storeRegion",
  "games.prices.steamSale": "games.prices.steamSale",
  "games.shops.back": "games.shops.back",
  "games.prices.lowest": "games.prices.lowest",
  "games.prices.noMatching": "games.prices.noMatching",
  "games.prices.market": "games.prices.market",
  "games.prices.region": "games.prices.region",
  "games.prices.keyshops": "games.prices.keyshops",
  "games.prices.keyshopsHint": "games.prices.keyshopsHint",
  "games.prices.activation": "games.prices.activation",
  "games.prices.steamOffers": "games.prices.steamOffers",
  "games.prices.allPc": "games.prices.allPc",
  "games.prices.seller": "games.prices.seller",
  "games.prices.allStores": "games.prices.allStores",
  "games.prices.refresh": "games.prices.refresh",
  "games.prices.offerCount": "games.prices.offerCount",
  "games.prices.priceOrder": "games.prices.priceOrder",
  "games.prices.viewAt": "games.prices.viewAt",
  "games.prices.view": "games.prices.view",
  "games.prices.coverage": "games.prices.coverage",
  "games.prices.partial": "games.prices.partial",
  "games.shops.footer": "games.shops.footer",
  "games.prices.source": "games.prices.source",
  "games.prices.checked": "games.prices.checked",
  "games.shops.shoppingFor": "games.shops.shoppingFor",
  "games.shops.copyError": "games.shops.copyError",
  "games.shops.search": "games.shops.search",
  "games.shops.type": "games.shops.type",
  "games.shops.note": "games.shops.note",
  "games.shops.empty": "games.shops.empty",
  "music.quick.search": "music.quick.search",
  "music.quick.saved": "music.quick.saved",
  "games.library.playGame": "games.library.playGame",
  "games.libraryPersonal.manage": "games.libraryPersonal.manage",
  "games.libraryPersonal.yourLibrary": "games.libraryPersonal.yourLibrary",
  "games.libraryPersonal.chooseCover": "games.libraryPersonal.chooseCover",
  "games.libraryPersonal.originalCover": "games.libraryPersonal.originalCover",
  "games.libraryPersonal.coverNote": "games.libraryPersonal.coverNote",
  "games.libraryPersonal.pin": "games.libraryPersonal.pin",
  "games.libraryPersonal.pinNote": "games.libraryPersonal.pinNote",
  "games.libraryPersonal.hide": "games.libraryPersonal.hide",
  "games.libraryPersonal.hideNote": "games.libraryPersonal.hideNote",
  "games.libraryPersonal.localNote": "games.libraryPersonal.localNote",
  "games.mods.nav": "games.mods.nav",
  "games.library.yourSpace": "games.library.yourSpace",
  "games.library.desktopTitle": "games.library.desktopTitle",
  "games.library.desktopNote": "games.library.desktopNote",
  "games.library.findInstalls": "games.library.findInstalls",
  "games.library.launchSteam": "games.library.launchSteam",
  "games.library.scanning": "games.library.scanning",
  "games.account.installedView": "games.account.installedView",
  "games.account.ownedView": "games.account.ownedView",
  "games.library.scanError": "games.library.scanError",
  "games.library.noSteam": "games.library.noSteam",
  "games.library.noSteamNote": "games.library.noSteamNote",
  "games.library.recentPick": "games.library.recentPick",
  "games.library.installed": "games.library.installed",
  "games.library.details": "games.library.details",
  "games.library.offline": "games.library.offline",
  "games.library.partialNote": "games.library.partialNote",
  "games.library.count": "games.library.count",
  "games.library.status": "games.library.status",
  "games.library.all": "games.library.all",
  "games.library.gameDetails": "games.library.gameDetails",
  "games.loadError": "games.loadError",
  "games.emulation.chooseCopy": "games.emulation.chooseCopy",
  "games.screenshot": "games.screenshot",
  "games.gallery": "games.gallery",
  "games.player.previous": "games.player.previous",
  "games.player.next": "games.player.next",
  "games.player.trailerNamed": "games.player.trailerNamed",
  "games.mods.chooseFolder": "games.mods.chooseFolder",
  "games.mods.kicker": "games.mods.kicker",
  "games.mods.title": "games.mods.title",
  "games.mods.gameVersion": "games.mods.gameVersion",
  "games.mods.loader": "games.mods.loader",
  "games.mods.workspace": "games.mods.workspace",
  "games.mods.selectFolder": "games.mods.selectFolder",
  "games.mods.view": "games.mods.view",
  "games.mods.sort": "games.mods.sort",
  "common.refresh": "common.refresh",
  "games.mods.added": "games.mods.added",
  "games.mods.empty": "games.mods.empty",
  "games.mods.emptyNote": "games.mods.emptyNote",
  "games.mods.results": "games.mods.results",
  "games.mods.projectPage": "games.mods.projectPage",
  "games.mods.ready": "games.mods.ready",
  "games.mods.verifiedNote": "games.mods.verifiedNote",
  "games.mods.optionalNote": "games.mods.optionalNote",
  "games.mods.version": "games.mods.version",
  "games.mods.noVersion": "games.mods.noVersion",
  "games.mods.resolving": "games.mods.resolving",
  "games.mods.installing": "games.mods.installing",
  "games.feed.title": "games.feed.title",
  "games.feed.note": "games.feed.note",
  "games.feed.refresh": "games.feed.refresh",
  "games.feed.refreshing": "games.feed.refreshing",
  "games.publisher": "games.publisher",
  "games.feed.error": "games.feed.error",
  "games.feed.empty": "games.feed.empty",
  "games.feed.source": "games.feed.source",
  "games.free": "games.free",
  "games.library.sort.name": "games.library.sort.name",
  "games.story.error": "games.story.error",
  "games.details.achievementNote": "games.details.achievementNote",
  "games.details.achievementError": "games.details.achievementError",
  "games.details.achievementHidden": "games.details.achievementHidden",
  "games.details.achievementRate": "games.details.achievementRate",
  "games.details.achievementSource": "games.details.achievementSource",
  "games.community.hoursAtReview": "games.community.hoursAtReview",
  "games.community.playedOnDeck": "games.community.playedOnDeck",
  "games.community.receivedFree": "games.community.receivedFree",
  "games.community.earlyAccess": "games.community.earlyAccess",
  "games.community.refunded": "games.community.refunded",
  "games.community.developerResponse": "games.community.developerResponse",
  "games.community.helpfulCount": "games.community.helpfulCount",
  "games.community.original": "games.community.original",
  "games.community.players": "games.community.players",
  "games.community.community": "games.community.community",
  "games.community.recommend": "games.community.recommend",
  "games.community.ratingCount": "games.community.ratingCount",
  "games.community.sort": "games.community.sort",
  "games.community.sentiment": "games.community.sentiment",
  "games.community.filters": "games.community.filters",
  "games.community.language": "games.community.language",
  "games.community.playtime": "games.community.playtime",
  "games.community.purchase": "games.community.purchase",
  "games.community.deckOnly": "games.community.deckOnly",
  "games.community.resetFilters": "games.community.resetFilters",
  "games.community.minimumHours": "games.community.minimumHours",
  "games.community.noReviews": "games.community.noReviews",
  "games.community.reviewError": "games.community.reviewError",
  "games.community.matches": "games.community.matches",
  "games.featuredSelection": "games.featuredSelection",
  "games.details.recommended": "games.details.recommended",
  "games.romShowcase.eyebrow": "games.romShowcase.eyebrow",
  "games.romShowcase.title": "games.romShowcase.title",
  "games.romShowcase.note": "games.romShowcase.note",
  "games.romShowcase.browse": "games.romShowcase.browse",
  "games.exploreGame": "games.exploreGame",
  "games.romShowcase.empty": "games.romShowcase.empty",
  "games.season.error": "games.season.error",
  "games.controller": "games.controller",
  "games.details.showMore": "games.details.showMore",
  "games.sources.platform.": "games.sources.platform.",
  "games.sources.copyError": "games.sources.copyError",
  "games.sources.public.state.": "games.sources.public.state.",
  "games.sources.public.": "games.sources.public.",
  "games.sources.eyebrow": "games.sources.eyebrow",
  "games.sources.releases": "games.sources.releases",
  "games.sources.cachedNote": "games.sources.cachedNote",
  "games.sources.titleNote": "games.sources.titleNote",
  "games.sources.cachedRelease": "games.sources.cachedRelease",
  "games.sources.openLink": "games.sources.openLink",
  "games.sources.copyMagnet": "games.sources.copyMagnet",
  "games.sources.checked": "games.sources.checked",
  "games.sources.enable": "games.sources.enable",
  "games.sources.refresh": "games.sources.refresh",
  "games.sources.remove": "games.sources.remove",
  "games.sources.retained": "games.sources.retained",
  "games.sources.skipped": "games.sources.skipped",
  "games.sources.chooseNote": "games.sources.chooseNote",
  "games.sources.empty": "games.sources.empty",
  "games.sources.emptyNote": "games.sources.emptyNote",
  "games.sources.search": "games.sources.search",
  "games.sources.checking": "games.sources.checking",
  "games.sources.profileNote": "games.sources.profileNote",
  "games.sources.add": "games.sources.add",
  "games.details.speedruns": "games.details.speedruns",
  "games.details.speedrunCategory": "games.details.speedrunCategory",
  "games.details.speedrunError": "games.details.speedrunError",
  "games.details.speedrunEmpty": "games.details.speedrunEmpty",
  "games.details.fastestVerified": "games.details.fastestVerified",
  "games.details.runDetails": "games.details.runDetails",
  "games.details.runDate": "games.details.runDate",
  "games.details.speedrunScope": "games.details.speedrunScope",
  "games.account.connectHint": "games.account.connectHint",
  "games.account.connectTitle": "games.account.connectTitle",
  "games.account.manage": "games.account.manage",
  "games.account.connect": "games.account.connect",
  "games.account.refresh": "games.account.refresh",
  "games.account.intro": "games.account.intro",
  "games.account.disconnect": "games.account.disconnect",
  "games.account.disconnectNote": "games.account.disconnectNote",
  "games.account.confirmDisconnect": "games.account.confirmDisconnect",
  "games.account.profile": "games.account.profile",
  "games.account.key": "games.account.key",
  "games.account.getKey": "games.account.getKey",
  "games.account.remember": "games.account.remember",
  "games.account.privacy": "games.account.privacy",
  "games.account.visibilityNote": "games.account.visibilityNote",
  "games.account.localOnly": "games.account.localOnly",
  "games.account.privateTitle": "games.account.privateTitle",
  "games.account.privateNote": "games.account.privateNote",
  "games.account.privacySettings": "games.account.privacySettings",
  "games.account.hours": "games.account.hours",
  "games.account.unplayed": "games.account.unplayed",
  "games.account.installNamed": "games.account.installNamed",
  "games.account.ownedNote": "games.account.ownedNote",
  "games.account.achievements": "games.account.achievements",
  "games.account.unlocked": "games.account.unlocked",
  "games.account.searchAchievements": "games.account.searchAchievements",
  "games.account.achievementFilter": "games.account.achievementFilter",
  "games.discovery.sale.checked": "games.discovery.sale.checked",
  "games.discovery.sale.dateRange": "games.discovery.sale.dateRange",
  "games.discovery.sale.calendar": "games.discovery.sale.calendar",
  "games.discovery.sale.error": "games.discovery.sale.error",
  "games.discovery.sale.title": "games.discovery.sale.title",
  "games.discovery.sale.unannounced": "games.discovery.sale.unannounced",
  "games.steamStatus.details": "games.steamStatus.details",
  "games.onTheHorizon": "games.onTheHorizon",
  "games.coming_soon": "games.coming_soon",
  "games.coming_soonNote": "games.coming_soonNote",
  "games.media.evidence": "games.media.evidence",
  "games.editorial.connected": "games.editorial.connected",
  "games.story.title": "games.story.title",
  "games.story.entryNote": "games.story.entryNote",
  "games.story.note": "games.story.note",
  "games.story.current": "games.story.current",
  "games.story.original": "games.story.original",
  "games.story.scope": "games.story.scope",
  "games.story.source": "games.story.source",
  "games.discovery.studioRange": "games.discovery.studioRange",
  "games.discovery.studioPrevious": "games.discovery.studioPrevious",
  "games.discovery.studioNext": "games.discovery.studioNext",
  "games.discovery.studioLoading": "games.discovery.studioLoading",
  "games.studios.error": "games.studios.error",
  "games.studios.related": "games.studios.related",
  "games.studios.partOf": "games.studios.partOf",
  "games.studios.title": "games.studios.title",
  "games.studios.note": "games.studios.note",
  "games.studios.search": "games.studios.search",
  "games.studios.empty": "games.studios.empty",
  "games.studios.featured": "games.studios.featured",
  "games.studios.previous": "games.studios.previous",
  "games.studios.next": "games.studios.next",
  "games.studios.choose": "games.studios.choose",
  "games.studios.explore": "games.studios.explore",
  "games.studios.source": "games.studios.source",
  "games.atlas.kind.company": "games.atlas.kind.company",
  "games.studios.catalogNote": "games.studios.catalogNote",
  "games.torrent.destination": "games.torrent.destination",
  "games.torrent.folderName": "games.torrent.folderName",
  "games.torrent.source": "games.torrent.source",
  "games.torrent.chooseFile": "games.torrent.chooseFile",
  "games.torrent.resolvingNote": "games.torrent.resolvingNote",
  "games.torrent.inventory": "games.torrent.inventory",
  "games.torrent.change": "games.torrent.change",
  "games.torrent.downloadLimit": "games.torrent.downloadLimit",
  "games.torrent.unlimited": "games.torrent.unlimited",
  "games.torrent.uploadLimit": "games.torrent.uploadLimit",
  "games.torrent.sharingNote": "games.torrent.sharingNote",
  "games.torrent.identity": "games.torrent.identity",
  "games.torrent.private": "games.torrent.private",
  "games.torrent.selection": "games.torrent.selection",
  "games.torrent.reviewNote": "games.torrent.reviewNote",
  "games.torrent.fileList": "games.torrent.fileList",
  "games.torrent.searchFiles": "games.torrent.searchFiles",
  "games.torrent.moreFiles": "games.torrent.moreFiles",
  "games.torrent.fileCount": "games.torrent.fileCount",
  "games.torrent.verified": "games.torrent.verified",
  "games.torrent.bandwidth": "games.torrent.bandwidth",
  "games.torrent.bandwidthValue": "games.torrent.bandwidthValue",
  "games.torrent.keepNote": "games.torrent.keepNote",
  "games.torrent.remove": "games.torrent.remove",
  "games.player.unmute": "games.player.unmute",
  "games.player.buffering": "games.player.buffering",
  "games.player.error": "games.player.error",
  "games.player.retry": "games.player.retry",
  "games.player.seek": "games.player.seek",
  "games.player.volume": "games.player.volume",
  "games.player.wheel": "games.player.wheel",
  "games.media.movie": "games.media.movie",
  "games.storeSource": "games.storeSource",
  "games.updatedAt": "games.updatedAt",
  "games.emulation.librarySource": "games.emulation.librarySource",
  "games.library.launchError": "games.library.launchError",
  "games.saveError": "games.saveError",
  "Share something with {group}. Type # to quote a rating.":
    "Share something with {group}. Type # to quote a rating.",
  "Sign in to your Nuvio account to sync continue watching and watch history.":
    "Sign in to your Nuvio account to sync continue watching and watch history.",
  "Tap the heart on any movie, show, or character to save it here. Manga lives in the manga Library.":
    "Tap the heart on any movie, show, or character to save it here. Manga lives in the manga Library.",
  "Back to My Groups": "Back to My Groups",
  "Edit group": "Edit group",
  "Add to Home": "Add to Home",
  "Delete this group? The original lists on MDBList and Trakt will not be changed.":
    "Delete this group? The original lists on MDBList and Trakt will not be changed.",
  "Enter an MDBList or Trakt list URL.": "Enter an MDBList or Trakt list URL.",
  "This list is already in this group.": "This list is already in this group.",
  "MDBList or Trakt list URL": "MDBList or Trakt list URL",
  "Add an MDBList or Trakt list to start filling this group.":
    "Add an MDBList or Trakt list to start filling this group.",
  "Edit list": "Edit list",
  "Choose a PNG, JPEG, or WebP image under 10 MB.":
    "Choose a PNG, JPEG, or WebP image under 10 MB.",
  "Could not read this image.": "Could not read this image.",
  "This image is too large. Choose a smaller image.":
    "This image is too large. Choose a smaller image.",
  "New group": "New group",
  "Use an HTTPS image URL or upload an image.": "Use an HTTPS image URL or upload an image.",
  "Group name": "Group name",
  "Group artwork": "Group artwork",
  "Group artwork preview": "Group artwork preview",
  "Leave the image empty to use the Harbor logo.": "Leave the image empty to use the Harbor logo.",
  "Could not load this list.": "Could not load this list.",
  "Back to group": "Back to group",
  "This list is empty.": "This list is empty.",
  "Added 1 new title from your folders": "Added 1 new title from your folders",
  "Added {n} new titles from your folders": "Added {n} new titles from your folders",
  "Create a group, choose its artwork, and organize MDBList and Trakt lists inside it.":
    "Create a group, choose its artwork, and organize MDBList and Trakt lists inside it.",
  "{n} lists": "{n} lists",
  "Unavailable list": "Unavailable list",
  "PublicMetaDB list": "PublicMetaDB list",
  "Default list": "Default list",
  "Set as default": "Set as default",
  "Refresh PublicMetaDB lists": "Refresh PublicMetaDB lists",
  "Your default PublicMetaDB list is unavailable. Select a list and set it as default.":
    "Your default PublicMetaDB list is unavailable. Select a list and set it as default.",
  '"Add to PMDB" saves to your default list. Browsing another list does not change it.':
    '"Add to PMDB" saves to your default list. Browsing another list does not change it.',
  'Your first "Add to PMDB" will create a private watchlist.':
    'Your first "Add to PMDB" will create a private watchlist.',
  "This PublicMetaDB list is empty.": "This PublicMetaDB list is empty.",
  "{n} in your Nuvio library": "{n} in your Nuvio library",
  "Release to place": "Release to place",
  "{label} · Up Next": "{label} · Up Next",
  "Show more chapters ({n} remaining)": "Show more chapters ({n} remaining)",
  "Star any manga and it takes over this screen.": "Star any manga and it takes over this screen.",
  "Create your first manga list": "Create your first manga list",
  "Group the manga you love. Reading now, backlog, all-time favorites.":
    "Group the manga you love. Reading now, backlog, all-time favorites.",
  "Scan with your phone camera, or type the address below.":
    "Scan with your phone camera, or type the address below.",
  "Chapter hidden": "Chapter hidden",
  "Reading on phone": "Reading on phone",
  "Your favorites and manga lists": "Your favorites and manga lists",
  "Horizontal strip": "Horizontal strip",
  "Reading direction": "Reading direction",
  "Hide pages": "Hide pages",
  "Swipe sideways": "Swipe sideways",
  "Tap sides to turn": "Tap sides to turn",
  "Control layout": "Control layout",
  "Changes apply to your computer instantly, and stay in sync both ways.":
    "Changes apply to your computer instantly, and stay in sync both ways.",
  "Strip preview": "Strip preview",
  "Hidden strips scroll numbered pages with the same sync.":
    "Hidden strips scroll numbered pages with the same sync.",
  "music.habit.onRepeat": "music.habit.onRepeat",
  "music.habit.onRepeat.subtitle": "music.habit.onRepeat.subtitle",
  "music.habit.forgotten": "music.habit.forgotten",
  "music.habit.forgotten.subtitle": "music.habit.forgotten.subtitle",
  "music.explore.fans": "music.explore.fans",
  "music.explore.deepTitle": "music.explore.deepTitle",
  "music.explore.deepSubtitle": "music.explore.deepSubtitle",
  "music.explore.deepEmpty": "music.explore.deepEmpty",
  "music.jumpBackIn.title": "music.jumpBackIn.title",
  "music.newRelease.title": "music.newRelease.title",
  "music.newRelease.subtitle": "music.newRelease.subtitle",
  "music.newRelease.listen": "music.newRelease.listen",
  "music.newRelease.eyebrow": "music.newRelease.eyebrow",
  "music.newRelease.outNow": "music.newRelease.outNow",
  "music.newRelease.action": "music.newRelease.action",
  "music.pinned.title": "music.pinned.title",
  "music.xxl.title": "music.xxl.title",
  "music.xxl.subtitle": "music.xxl.subtitle",
  "Harbor could not reach your music sources while searching for {query}.":
    "Harbor could not reach your music sources while searching for {query}.",
  "No connected music source has {query}. Harbor also searched {alternatives} and found nothing.":
    "No connected music source has {query}. Harbor also searched {alternatives} and found nothing.",
  "No connected music source has {query}.": "No connected music source has {query}.",
  "No source has {query}. Showing results for {fallback}.":
    "No source has {query}. Showing results for {fallback}.",
  "Born today": "Born today",
  "Seen all {total} films": "Seen all {total} films",
  "Seen {n} of {total} films": "Seen {n} of {total} films",
  Editing: "Editing",
  "Production Design": "Production Design",
  "Costume Design": "Costume Design",
  "Searching streams": "Searching streams",
  "Sources unavailable": "Sources unavailable",
  "The service refused the request, so there was nothing for the plugin to return.":
    "The service refused the request, so there was nothing for the plugin to return.",
  "No synopsis yet.": "No synopsis yet.",
  "Return to playback": "Return to playback",
  "You just finished": "You just finished",
  "Closing in {n}s": "Closing in {n}s",
  "Arrange the plugin tab": "Arrange the plugin tab",
  "This arranges the All plugins page. A single plugin still lists its own rows as it reports them.":
    "This arranges the All plugins page. A single plugin still lists its own rows as it reports them.",
  "No plugin has any rows to arrange.": "No plugin has any rows to arrange.",
  "All plugins": "All plugins",
  "Filter plugins...": "Filter plugins...",
  "Results for {q}": "Results for {q}",
  "Search the plugins for a title": "Search the plugins for a title",
  "No plugin has anything for that title.": "No plugin has anything for that title.",
  "Every row is hidden. Use Arrange to bring one back.":
    "Every row is hidden. Use Arrange to bring one back.",
  "No plugin catalogs yet": "No plugin catalogs yet",
  "Install a plugin that offers rows of its own and they show up here as poster rails.":
    "Install a plugin that offers rows of its own and they show up here as poster rails.",
  "Manage plugins": "Manage plugins",
  "Leave a comment. No links. Type # to quote a rating.":
    "Leave a comment. No links. Type # to quote a rating.",
  "{label} needs a hex colour like #1a2b3c.": "{label} needs a hex colour like #1a2b3c.",
  "Cards, accents and text are built from these four colours.":
    "Cards, accents and text are built from these four colours.",
  "Apply colours": "Apply colours",
  "Could not save your theme. Try again.": "Could not save your theme. Try again.",
  "Profile theme": "Profile theme",
  "Colours visitors see on your profile. The rest of the app keeps their own theme.":
    "Colours visitors see on your profile. The rest of the app keeps their own theme.",
  "Transparent cards": "Transparent cards",
  "Gradient wash": "Gradient wash",
  "Your theme is published to visitors either way. Your custom HTML and CSS stay hidden until Custom Profile is on in Customize.":
    "Your theme is published to visitors either way. Your custom HTML and CSS stay hidden until Custom Profile is on in Customize.",
  "Loading rating…": "Loading rating…",
  "The review could not be loaded. Retry": "The review could not be loaded. Retry",
  "Find someone whose rating to quote": "Find someone whose rating to quote",
  "People you can quote": "People you can quote",
  "No one here has ratings to quote.": "No one here has ratings to quote.",
  Anyone: "Anyone",
  Selected: "Selected",
  "Ratings you can quote": "Ratings you can quote",
  "Loading ratings…": "Loading ratings…",
  "No ratings to quote from this person.": "No ratings to quote from this person.",
  "Some ratings could not be loaded.": "Some ratings could not be loaded.",
  "Quote a rating from anyone": "Quote a rating from anyone",
  "Commenting on @{handle}'s rating": "Commenting on @{handle}'s rating",
  "Remove quoted rating": "Remove quoted rating",
  "Search ratings": "Search ratings",
  "With review": "With review",
  "Highest rated first": "Highest rated first",
  "Lowest rated first": "Lowest rated first",
  "Loading all ratings": "Loading all ratings",
  "No ratings match your search": "No ratings match your search",
  "Could not load all ratings. Results may be incomplete.":
    "Could not load all ratings. Results may be incomplete.",
  "Change rating": "Change rating",
  "Could not save this rating. Your changes are still here; try again.":
    "Could not save this rating. Your changes are still here; try again.",
  "Comment on it": "Comment on it",
  "Account Provider": "Account Provider",
  "Choose which streaming service powers your active identity, profiles, watch progress, and addons.":
    "Choose which streaming service powers your active identity, profiles, watch progress, and addons.",
  "Connected as {email}": "Connected as {email}",
  "Use Stremio's cloud backend. Your library, installed streaming addons, and official watch history stay synced with your Stremio account.":
    "Use Stremio's cloud backend. Your library, installed streaming addons, and official watch history stay synced with your Stremio account.",
  "Single cloud account": "Single cloud account",
  "Stremio Addon Protocol": "Stremio Addon Protocol",
  "Harbor local profiles": "Harbor local profiles",
  "Connect Stremio": "Connect Stremio",
  "Select Stremio": "Select Stremio",
  "Use Nuvio's cloud backend. Sync up to 6 cloud profiles, server-side PIN locks, per-profile continue watching, and inherited primary addons.":
    "Use Nuvio's cloud backend. Sync up to 6 cloud profiles, server-side PIN locks, per-profile continue watching, and inherited primary addons.",
  "6 cloud profiles": "6 cloud profiles",
  "Cloud PIN protection": "Cloud PIN protection",
  "Isolated continue watching": "Isolated continue watching",
  "Connect Nuvio": "Connect Nuvio",
  "Select Nuvio": "Select Nuvio",
  "How Account Provider works:": "How Account Provider works:",
  "Selecting a provider shifts your profiles, watch history, and addons into that provider's ecosystem. Both accounts remain authenticated so you can switch between them at any time without losing data.":
    "Selecting a provider shifts your profiles, watch history, and addons into that provider's ecosystem. Both accounts remain authenticated so you can switch between them at any time without losing data.",
  "Profile name is synced directly with your Nuvio account.":
    "Profile name is synced directly with your Nuvio account.",
  "Reset to Nuvio avatar": "Reset to Nuvio avatar",
  "Sign in or link via nuvio.tv/link to sync profiles, watchlist, and addons.":
    "Sign in or link via nuvio.tv/link to sync profiles, watchlist, and addons.",
  "Connected to Nuvio": "Connected to Nuvio",
  "Nuvio Account ID": "Nuvio Account ID",
  "Unique identifier for your Nuvio cloud account.":
    "Unique identifier for your Nuvio cloud account.",
  "Stops syncing with your Nuvio account on this device.":
    "Stops syncing with your Nuvio account on this device.",
  "Sync with Nuvio Profile": "Sync with Nuvio Profile",
  "Link this Harbor profile ({name}) to a specific Nuvio cloud profile slot. Watch progress and Continue Watching will remain isolated to this profile.":
    "Link this Harbor profile ({name}) to a specific Nuvio cloud profile slot. Watch progress and Continue Watching will remain isolated to this profile.",
  "Nuvio supports up to 6 cloud profiles with isolated continue watching, synced addons, and PIN locks.":
    "Nuvio supports up to 6 cloud profiles with isolated continue watching, synced addons, and PIN locks.",
  "Connect Nuvio account": "Connect Nuvio account",
  "Choose a profile to switch. You can edit your own profile's details and settings.":
    "Choose a profile to switch. You can edit your own profile's details and settings.",
  "Sync profiles now": "Sync profiles now",
  "Syncing...": "Syncing...",
  "Nuvio collection": "Nuvio collection",
  "Connect your Nuvio account first. Your installed addons sync from there.":
    "Connect your Nuvio account first. Your installed addons sync from there.",
  "Pulled from your Nuvio account.": "Pulled from your Nuvio account.",
  "Addon collection mode": "Addon collection mode",
  "Choose whether Nuvio operates with its own isolated addons or merges with your Stremio library.":
    "Choose whether Nuvio operates with its own isolated addons or merges with your Stremio library.",
  "Maintain separate addons": "Maintain separate addons",
  Isolated: "Isolated",
  "Maintain an independent addon roster for Nuvio. Stremio addons are kept separate and will not leach into Nuvio pages or playback stream sources.":
    "Maintain an independent addon roster for Nuvio. Stremio addons are kept separate and will not leach into Nuvio pages or playback stream sources.",
  "Display combined addons": "Display combined addons",
  "With tags": "With tags",
  "Show both Nuvio and Stremio addons together in your library, with [Nuvio] and [Stremio] origin tags across the Addons manager and streaming sources.":
    "Show both Nuvio and Stremio addons together in your library, with [Nuvio] and [Stremio] origin tags across the Addons manager and streaming sources.",
  "Privileges for secondary profiles": "Privileges for secondary profiles",
  "By default, secondary profiles can only customize their own profile and preferences. You can grant secondary profiles permission to perform administrative actions below.":
    "By default, secondary profiles can only customize their own profile and preferences. You can grant secondary profiles permission to perform administrative actions below.",
  "Allow adding new profiles": "Allow adding new profiles",
  "Displays the '+ Add profile' button in Settings and 'Who's watching' for secondary profiles.":
    "Displays the '+ Add profile' button in Settings and 'Who's watching' for secondary profiles.",
  "Allow configuring startup defaults & background":
    "Allow configuring startup defaults & background",
  "Allows secondary profiles to configure the default startup profile ('Start as'), prompt interval, and Who's watching background.":
    "Allows secondary profiles to configure the default startup profile ('Start as'), prompt interval, and Who's watching background.",
  "Allow switching account provider": "Allow switching account provider",
  "Allows secondary profiles to access the Account Provider tab and switch between Stremio and Nuvio modes.":
    "Allows secondary profiles to access the Account Provider tab and switch between Stremio and Nuvio modes.",
  "Allow managing Harbor account": "Allow managing Harbor account",
  "Allows secondary profiles to access the Harbor account tab to view sync status and manage cloud credentials.":
    "Allows secondary profiles to access the Harbor account tab to view sync status and manage cloud credentials.",
  "Allow managing Stremio & Nuvio account": "Allow managing Stremio & Nuvio account",
  "Allows secondary profiles to access the Stremio or Nuvio account tab to view credentials, profile mapping, install links, and synced addons.":
    "Allows secondary profiles to access the Stremio or Nuvio account tab to view credentials, profile mapping, install links, and synced addons.",
  "Allow signing out of Stremio & Nuvio from menu":
    "Allow signing out of Stremio & Nuvio from menu",
  "Allows secondary profiles to disconnect or log out of the root Stremio or Nuvio account from the top-right profile dropdown.":
    "Allows secondary profiles to disconnect or log out of the root Stremio or Nuvio account from the top-right profile dropdown.",
  "Account provider": "Account provider",
  "Accessible for primary profile": "Accessible for primary profile",
  "Account provider settings allow switching between Stremio and Nuvio. This action is restricted to the primary profile.":
    "Account provider settings allow switching between Stremio and Nuvio. This action is restricted to the primary profile.",
  "Harbor master cloud account management is restricted to the primary profile.":
    "Harbor master cloud account management is restricted to the primary profile.",
  "Nuvio account credentials, profile slot mapping, and cloud addons are restricted to the primary profile.":
    "Nuvio account credentials, profile slot mapping, and cloud addons are restricted to the primary profile.",
  "Stremio account credentials, install links, and synced addons are restricted to the primary profile.":
    "Stremio account credentials, install links, and synced addons are restricted to the primary profile.",
  "To access administrative account settings, switch to the primary profile or have the primary profile enable permissions in Settings > Profiles > Privileges for secondary profiles.":
    "To access administrative account settings, switch to the primary profile or have the primary profile enable permissions in Settings > Profiles > Privileges for secondary profiles.",
  "Connect your Nuvio account to sync watch progress, profile slots, and addons.":
    "Connect your Nuvio account to sync watch progress, profile slots, and addons.",
  "Harbor pulls addons configured in your Nuvio profile.":
    "Harbor pulls addons configured in your Nuvio profile.",
  "Hide music after pausing": "Hide music after pausing",
  "Clear the music presence a few seconds after pausing instead of leaving 'Paused' visible. It comes back when playback resumes.":
    "Clear the music presence a few seconds after pausing instead of leaving 'Paused' visible. It comes back when playback resumes.",
  "The update service has no installer available right now. Try again later.":
    "The update service has no installer available right now. Try again later.",
  "Harbor Setup {version} is already on this PC from your last update. Open it to change which features are installed; nothing changes unless you finish the installer.":
    "Harbor Setup {version} is already on this PC from your last update. Open it to change which features are installed; nothing changes unless you finish the installer.",
  "Harbor Setup isn't on this PC. Continuing downloads the full installer again and opens it, where you can change which features are installed.":
    "Harbor Setup isn't on this PC. Continuing downloads the full installer again and opens it, where you can change which features are installed.",
  "Add or remove optional features — extensions, games, and the Music, eBook and Manga tabs. Changing them opens Harbor Setup.":
    "Add or remove optional features — extensions, games, and the Music, eBook and Manga tabs. Changing them opens Harbor Setup.",
  "Modify installation": "Modify installation",
  "Verifying the download…": "Verifying the download…",
  "Open Harbor Setup": "Open Harbor Setup",
  "Download and open": "Download and open",
  "Smoothed frame rate": "Smoothed frame rate",
  "Doubling is the cleanest: a 24fps film becomes an exact 48, so every frame is evenly spaced. Fixed 60 divides 24 unevenly and is the usual cause of shimmering or torn motion.":
    "Doubling is the cleanest: a 24fps film becomes an exact 48, so every frame is evenly spaced. Fixed 60 divides 24 unevenly and is the usual cause of shimmering or torn motion.",
  "Turn on SVP above to choose the frame rate.": "Turn on SVP above to choose the frame rate.",
  "48 fps": "48 fps",
  "60 fps": "60 fps",
  "Match display": "Match display",
  "Autoplay trailer resolution": "Autoplay trailer resolution",
  "Resolution for trailers that play automatically on Home and detail pages. Higher resolutions may take longer to start.":
    "Resolution for trailers that play automatically on Home and detail pages. Higher resolutions may take longer to start.",
  "Preferred language for anime titles shown on cards, in the picker, and in your Discord presence.":
    "Preferred language for anime titles shown on cards, in the picker, and in your Discord presence.",
  "Nuvio library": "Nuvio library",
  "Your own Nuvio account progress. The primary source for almost everyone.":
    "Your own Nuvio account progress. The primary source for almost everyone.",
  "PublicMetaDB progress": "PublicMetaDB progress",
  "Pulls what you have part-watched on PublicMetaDB into the row, marked with the PublicMetaDB logo. Requires a connected PublicMetaDB account.":
    "Pulls what you have part-watched on PublicMetaDB into the row, marked with the PublicMetaDB logo. Requires a connected PublicMetaDB account.",
  "Keep folders up to date": "Keep folders up to date",
  "Checks the folders already in your library when you open it and adds anything new it finds. Titles you already have are left alone, including any you corrected with Identify.":
    "Checks the folders already in your library when you open it and adds anything new it finds. Titles you already have are left alone, including any you corrected with Identify.",
  "mpv window": "mpv window",
  "External player": "External player",
  "Play in my own mpv": "Play in my own mpv",
  "Opens videos in your installed mpv with your own mpv.conf, scripts and keys. Harbor follows it to save your progress and mark episodes watched.":
    "Opens videos in your installed mpv with your own mpv.conf, scripts and keys. Harbor follows it to save your progress and mark episodes watched.",
  "mpv location": "mpv location",
  "The mpv program to open. Leave empty to use mpv from your PATH.":
    "The mpv program to open. Leave empty to use mpv from your PATH.",
  "mpv options": "mpv options",
  "Extra command line options passed to mpv. Optional.":
    "Extra command line options passed to mpv. Optional.",
  "Picture in picture": "Picture in picture",
  "Picture in picture style": "Picture in picture style",
  "Resize shrinks the Harbor window itself, so the app goes with it. Detached moves the video into its own floating window and hands Harbor back to you, so you can keep browsing while it plays.":
    "Resize shrinks the Harbor window itself, so the app goes with it. Detached moves the video into its own floating window and hands Harbor back to you, so you can keep browsing while it plays.",
  Resize: "Resize",
  Detached: "Detached",
  "Harbor could not start the runtime that Android extensions need. Reinstall Harbor, or install Java 17 or newer, then try again.":
    "Harbor could not start the runtime that Android extensions need. Reinstall Harbor, or install Java 17 or newer, then try again.",
  "Plugins are disabled for this installation. Use Modify installation in Settings to enable them.":
    "Plugins are disabled for this installation. Use Modify installation in Settings to enable them.",
  "This does not look like a plugin repository. Harbor reads its own plugin manifests, provider-script manifests and Android extension repositories.":
    "This does not look like a plugin repository. Harbor reads its own plugin manifests, provider-script manifests and Android extension repositories.",
  "That is an app link, not a web address. Open the repository in a browser and paste the https link to its JSON file.":
    "That is an app link, not a web address. Open the repository in a browser and paste the https link to its JSON file.",
  "This kind of extension can only be installed in the desktop app.":
    "This kind of extension can only be installed in the desktop app.",
  "Could not install: {error}": "Could not install: {error}",
  "Stopped after {n} failures.": "Stopped after {n} failures.",
  "Plugins look for streams on sites Harbor does not know about. Everything here was installed by you, from repositories you chose.":
    "Plugins look for streams on sites Harbor does not know about. Everything here was installed by you, from repositories you chose.",
  "Pause or resume every plugin at once, without removing anything. The switch below decides where they are asked.":
    "Pause or resume every plugin at once, without removing anything. The switch below decides where they are asked.",
  "Use plugins outside the Plugins page": "Use plugins outside the Plugins page",
  "Let Android extensions, which stand up rows of their own, be asked from Home, Discover, Catalogs, search and the Play button too. A plugin with no rows of its own has nowhere else to be found, so it is asked either way.":
    "Let Android extensions, which stand up rows of their own, be asked from Home, Discover, Catalogs, search and the Play button too. A plugin with no rows of its own has nowhere else to be found, so it is asked either way.",
  "Let auto-download and the next-episode prefetch ask plugins too. Off keeps plugins out of background work.":
    "Let auto-download and the next-episode prefetch ask plugins too. Off keeps plugins out of background work.",
  "Show languages on plugin posters": "Show languages on plugin posters",
  "Some plugins name a listing after everything it carries, so its languages are in the title. Harbor reads them back out and badges the poster. Shown only when the plugin provides it.":
    "Some plugins name a listing after everything it carries, so its languages are in the title. Harbor reads them back out and badges the poster. Shown only when the plugin provides it.",
  "Show quality on plugin posters": "Show quality on plugin posters",
  "Badge the resolutions a plugin's listing names, best first, and count the rest. Shown only when the plugin provides it.":
    "Badge the resolutions a plugin's listing names, best first, and count the rest. Shown only when the plugin provides it.",
  "Refresh all": "Refresh all",
  "Runs every plugin Harbor stood down. One that answers comes back; the others stay paused.":
    "Runs every plugin Harbor stood down. One that answers comes back; the others stay paused.",
  Android: "Android",
  "Paste the manifest link of a repository you trust. Harbor reads its own plugin repositories, provider-script repositories and Android extension repositories as they are, and installs nothing until you choose to.":
    "Paste the manifest link of a repository you trust. Harbor reads its own plugin repositories, provider-script repositories and Android extension repositories as they are, and installs nothing until you choose to.",
  "Reopen playing broadcasts after changing this setting.":
    "Reopen playing broadcasts after changing this setting.",
  "Please enter your PublicMetaDB API key": "Please enter your PublicMetaDB API key",
  "Invalid API key or unable to reach PublicMetaDB":
    "Invalid API key or unable to reach PublicMetaDB",
  "Connection failed. Check your network or API key":
    "Connection failed. Check your network or API key",
  "Connection verified": "Connection verified",
  "Connection failed": "Connection failed",
  "Track your watch history and sync playback resume points with PublicMetaDB. Generate an API key from your PublicMetaDB profile settings to connect.":
    "Track your watch history and sync playback resume points with PublicMetaDB. Generate an API key from your PublicMetaDB profile settings to connect.",
  "Username (optional)": "Username (optional)",
  "e.g. username": "e.g. username",
  "API Key": "API Key",
  "Hide key": "Hide key",
  "Show key": "Show key",
  "Connect PublicMetaDB": "Connect PublicMetaDB",
  "Get an API key": "Get an API key",
  "Harbor will scrobble your playback progress and sync watch history with PublicMetaDB.":
    "Harbor will scrobble your playback progress and sync watch history with PublicMetaDB.",
  "Tracking & Scrobble": "Tracking & Scrobble",
  "Scrobble playback progress": "Scrobble playback progress",
  "Automatically save resume points and mark completed items in PublicMetaDB as you watch.":
    "Automatically save resume points and mark completed items in PublicMetaDB as you watch.",
  "Show in Continue Watching": "Show in Continue Watching",
  "Include PublicMetaDB resume points on Harbor's Home Continue Watching rail.":
    "Include PublicMetaDB resume points on Harbor's Home Continue Watching rail.",
  "Account & Connection": "Account & Connection",
  "PublicMetaDB username": "PublicMetaDB username",
  "Profile linked to publicmetadb.com/u/{username}":
    "Profile linked to publicmetadb.com/u/{username}",
  "Set your username to link directly to your public profile.":
    "Set your username to link directly to your public profile.",
  "Set username": "Set username",
  "Verify connection": "Verify connection",
  "Test that your stored API key is still valid and reachable.":
    "Test that your stored API key is still valid and reachable.",
  "Testing...": "Testing...",
  "Test Connection": "Test Connection",
  "Disconnect PublicMetaDB?": "Disconnect PublicMetaDB?",
  "Playback scrobbling and resume point sync with PublicMetaDB will stop for this profile.":
    "Playback scrobbling and resume point sync with PublicMetaDB will stop for this profile.",
  "Choose trailer playback quality.": "Choose trailer playback quality.",
  Seconds: "Seconds",
  sec: "sec",
  "More like this at the end": "More like this at the end",
  "Show recommendations when a movie, series finale or anime film finishes. At the end the card fills the screen; before the end the film shrinks to a corner and keeps playing behind it.":
    "Show recommendations when a movie, series finale or anime film finishes. At the end the card fills the screen; before the end the film shrinks to a corner and keeps playing behind it.",
  "Custom lead time": "Custom lead time",
  "Type an exact time up to 30 minutes. Minutes alone count as 00 seconds; seconds alone count as 0 minutes.":
    "Type an exact time up to 30 minutes. Minutes alone count as 00 seconds; seconds alone count as 0 minutes.",
  Countdown: "Countdown",
  "Act automatically if nothing is chosen before time runs out.":
    "Act automatically if nothing is chosen before time runs out.",
  "Countdown length": "Countdown length",
  "How long Harbor waits before acting on the countdown.":
    "How long Harbor waits before acting on the countdown.",
  "{n}s": "{n}s",
  "When the countdown ends": "When the countdown ends",
  "Close the player, or start whichever recommendation is focused.":
    "Close the player, or start whichever recommendation is focused.",
  "Play focused": "Play focused",
  "Episode and season metadata": "Episode and season metadata",
  "Cached episode lists, season details and artwork references. Rebuilds as you browse.":
    "Cached episode lists, season details and artwork references. Rebuilds as you browse.",
  "{n} entries": "{n} entries",
  "{n} cache hits": "{n} cache hits",
  "{n} cache misses": "{n} cache misses",
  "Poster thumbnails": "Poster thumbnails",
  "Episode thumbnails and posters, kept up to 30 days within a 2 GB limit. Rebuilds as you browse.":
    "Episode thumbnails and posters, kept up to 30 days within a 2 GB limit. Rebuilds as you browse.",
  "{size} across {n} files": "{size} across {n} files",
  "How often Harbor re-reads this library automatically.":
    "How often Harbor re-reads this library automatically.",
  "If you were going to send something, send it to Stremio above, or to one of the charities below. They all do more good with it.":
    "If you were going to send something, send it to Stremio above, or to one of the charities below. They all do more good with it.",
  "Support Stremio, or give to any charity below, and the badge lands on your profile.":
    "Support Stremio, or give to any charity below, and the badge lands on your profile.",
  Halloween: "Halloween",
  "Temporary seasonal settings for Spooktober.": "Temporary seasonal settings for Spooktober.",
  "Spooktober banner": "Spooktober banner",
  "Hide the banner, keep it small in the top-right corner of the hero, or show the full banner below the hero.":
    "Hide the banner, keep it small in the top-right corner of the hero, or show the full banner below the hero.",
  "Small - Top Right": "Small - Top Right",
  "Below hero": "Below hero",
  "Resize row headings, titles under poster cards, and the player title independently. You can also lead the player title with the series name instead of the episode.":
    "Resize row headings, titles under poster cards, and the player title independently. You can also lead the player title with the series name instead of the episode.",
  "Card title size": "Card title size",
  "Movie and TV show titles beneath poster cards.":
    "Movie and TV show titles beneath poster cards.",
  "Card title preview": "Card title preview",
  "The Lord of the Rings: The Fellowship of the Ring":
    "The Lord of the Rings: The Fellowship of the Ring",
  "Use the album art as the app icon while music plays":
    "Use the album art as the app icon while music plays",
  "The taskbar button becomes the cover of the track you are listening to, and goes back to your Harbor icon when music stops. The thumbnail preview always shows the cover either way.":
    "The taskbar button becomes the cover of the track you are listening to, and goes back to your Harbor icon when music stops. The thumbnail preview always shows the cover either way.",
  "Sign in to Nuvio first so Harbor knows which watchlist to sync.":
    "Sign in to Nuvio first so Harbor knows which watchlist to sync.",
  "Prize pool": "Prize pool",
  "Match list only; bracket structure is not available for this title.":
    "Match list only; bracket structure is not available for this title.",
  "Race time": "Race time",
  "Average speed (mph)": "Average speed (mph)",
  Leader: "Leader",
  "Full score": "Full score",
  "Could not copy to the clipboard.": "Could not copy to the clipboard.",
  "Open my profile": "Open my profile",
  "Sign in to Harbor to open your profile.": "Sign in to Harbor to open your profile.",
  "Go to": "Go to",
  "Page actions": "Page actions",
  "Open collection": "Open collection",
  "Could not load image.": "Could not load image.",
  "Image viewer": "Image viewer",
  "Copy image": "Copy image",
  "Image copied": "Image copied",
  "Could not copy image.": "Could not copy image.",
  "Save image": "Save image",
  "Image saved": "Image saved",
  "Could not save image.": "Could not save image.",
  "Loading image…": "Loading image…",
  "This image could not be decoded.": "This image could not be decoded.",
  "Could not complete this action.": "Could not complete this action.",
  "The action could not be completed.": "The action could not be completed.",
  "Search destinations": "Search destinations",
  "No destinations found": "No destinations found",
  "Copy selected text": "Copy selected text",
  "Open link": "Open link",
  "View image": "View image",
  "Save image…": "Save image…",
  "Copy image link": "Copy image link",
  "Open image link": "Open image link",
  "Local video": "Local video",
  "Continue last watched": "Continue last watched",
  "Playback finished": "Playback finished",
  "Play this same video from the beginning?": "Play this same video from the beginning?",
  "Play from beginning": "Play from beginning",
  "Opening playback…": "Opening playback…",
  "Enabled for newly released episodes": "Enabled for newly released episodes",
  "Choose an episode or season, then choose a source.":
    "Choose an episode or season, then choose a source.",
  "Choose a source to download this movie.": "Choose a source to download this movie.",
  "Could not save automatic download settings. Your previous settings were kept.":
    "Could not save automatic download settings. Your previous settings were kept.",
  "Checking file…": "Checking file…",
  "In downloads": "In downloads",
  "Loading episodes…": "Loading episodes…",
  "Could not load episodes. Try again.": "Could not load episodes. Try again.",
  "No episodes available from this title’s providers.":
    "No episodes available from this title’s providers.",
  "Not released": "Not released",
  "File unavailable": "File unavailable",
  "Downloading {pct} percent": "Downloading {pct} percent",
  "The active profile changed. Open the menu again.":
    "The active profile changed. Open the menu again.",
  "Copy magnet": "Copy magnet",
  "Checking watched status…": "Checking watched status…",
  "Watched status unavailable": "Watched status unavailable",
  "{watched} of {total} released episodes known watched":
    "{watched} of {total} released episodes known watched",
  "Could not check watched status: {providers}": "Could not check watched status: {providers}",
  "Mark episode as watched": "Mark episode as watched",
  "Mark episode as unwatched": "Mark episode as unwatched",
  "Mark released episodes as watched": "Mark released episodes as watched",
  "Mark released episodes as unwatched": "Mark released episodes as unwatched",
  "Removed on this device. Stremio synchronization is pending.":
    "Removed on this device. Stremio synchronization is pending.",
  "Remove from downloads": "Remove from downloads",
  "Mark {count} episodes up to here": "Mark {count} episodes up to here",
  "Episode information is unavailable.": "Episode information is unavailable.",
  "Episode actions": "Episode actions",
  "Open list": "Open list",
  "Choose source for this episode": "Choose source for this episode",
  "Choose version to download": "Choose version to download",
  "Manage home servers": "Manage home servers",
  "{n} versions on home servers": "{n} versions on home servers",
  "Playback is unavailable.": "Playback is unavailable.",
  "Download is unavailable.": "Download is unavailable.",
  "Download this version": "Download this version",
  "Play this version": "Play this version",
  "Open related title": "Open related title",
  "Play channel": "Play channel",
  "This Continue Watching entry is no longer available.":
    "This Continue Watching entry is no longer available.",
  "This action is already running.": "This action is already running.",
  "This episode has not aired yet.": "This episode has not aired yet.",
  "This action is no longer available.": "This action is no longer available.",
  "Cancel {count} downloads? Partial files are kept.\n\n{scope}":
    "Cancel {count} downloads? Partial files are kept.\n\n{scope}",
  "Remove {count} PDF print records from Downloads? Harbor did not save these PDF files.":
    "Remove {count} PDF print records from Downloads? Harbor did not save these PDF files.",
  "Remove {count} downloads and delete their saved or partial files? Folders are kept.\n\n{details}":
    "Remove {count} downloads and delete their saved or partial files? Folders are kept.\n\n{details}",
  "Delete file": "Delete file",
  "Delete files ({count})": "Delete files ({count})",
  "{count} downloads. Partial files are kept.": "{count} downloads. Partial files are kept.",
  "{count} print records; no saved PDF files.": "{count} print records; no saved PDF files.",
  "{count} files · {scope}": "{count} files · {scope}",
  "Confirm cancellation": "Confirm cancellation",
  "Cancelling…": "Cancelling…",
  "Download chapters": "Download chapters",
  "This destination is full.": "This destination is full.",
  "Add to": "Add to",
  'Remove from "{name}"': 'Remove from "{name}"',
  source: "source",
  "Read chapter": "Read chapter",
  "Could not save the change. Check available storage and try again.":
    "Could not save the change. Check available storage and try again.",
  "Manga download failed": "Manga download failed",
  "Could not delete collection.": "Could not delete collection.",
  "Open author profile": "Open author profile",
  "Add to page": "Add to page",
  "Delete collection": "Delete collection",
  "Only your saved copy is deleted. The original remains available.":
    "Only your saved copy is deleted. The original remains available.",
  "Local-only deletion removes this collection from this device. Any copy in your Harbor account remains unchanged; its current status has not been verified.":
    "Local-only deletion removes this collection from this device. Any copy in your Harbor account remains unchanged; its current status has not been verified.",
  "Harbor will check your account and remove this collection there if it exists, then remove the local collection. Other account collections are preserved.":
    "Harbor will check your account and remove this collection there if it exists, then remove the local collection. Other account collections are preserved.",
  "Retry account check": "Retry account check",
  "Deleting…": "Deleting…",
  "Delete local copy only": "Delete local copy only",
  "Copy share link": "Copy share link",
  "Could not copy the link.": "Could not copy the link.",
  "Could not copy. Select and copy the text manually.":
    "Could not copy. Select and copy the text manually.",
  "Sign in and reopen the share dialog.": "Sign in and reopen the share dialog.",
  "Could not publish the collection.": "Could not publish the collection.",
  "View person": "View person",
  "Automatic downloads enabled": "Automatic downloads enabled",
  "Disable automatic downloads for {title}": "Disable automatic downloads for {title}",
  "Disable automatic downloads": "Disable automatic downloads",
  "No downloads are currently eligible for this action.":
    "No downloads are currently eligible for this action.",
  "{done} completed, {failed} failed, {skipped} changed or unavailable.":
    "{done} completed, {failed} failed, {skipped} changed or unavailable.",
  "This download is a book, not a video.": "This download is a book, not a video.",
  "Resume playback": "Resume playback",
  "Choose a download source again; this item's source cannot be recovered.":
    "Choose a download source again; this item's source cannot be recovered.",
  "Deletion is in progress.": "Deletion is in progress.",
  "Pause {count} downloads": "Pause {count} downloads",
  "Resume {count} downloads": "Resume {count} downloads",
  "Cancel {count} downloads": "Cancel {count} downloads",
  "Retry {count} downloads": "Retry {count} downloads",
  "All {count} downloads for this series": "All {count} downloads for this series",
  "Visible downloads ({visible} of {all})": "Visible downloads ({visible} of {all})",
  "{visible} visible downloads of {all} total": "{visible} visible downloads of {all} total",
  "Download actions for {title}": "Download actions for {title}",
  "{visible} visible of {all} downloads": "{visible} visible of {all} downloads",
  "An update is already in progress.": "An update is already in progress.",
  "The post deletion could not be confirmed. Refresh its current state.":
    "The post deletion could not be confirmed. Refresh its current state.",
  "Copy Text": "Copy Text",
  Unlike: "Unlike",
  Like: "Like",
  "Edit post": "Edit post",
  "Delete post…": "Delete post…",
  "Delete this post from the group?": "Delete this post from the group?",
  "Delete post": "Delete post",
  "Post deleted": "Post deleted",
  "Open episode": "Open episode",
  "Clear Stremio watch history for this title…": "Clear Stremio watch history for this title…",
  "Could not clear watch history.": "Could not clear watch history.",
  "Clear Stremio watch history for this title?": "Clear Stremio watch history for this title?",
  "This clears playback progress and watched status for all of “{title}” in Stremio, including every episode. Your watchlist membership and Trakt history are preserved.":
    "This clears playback progress and watched status for all of “{title}” in Stremio, including every episode. Your watchlist membership and Trakt history are preserved.",
  "Clear title history": "Clear title history",
  "Shared copies on your profile are preserved.": "Shared copies on your profile are preserved.",
  "Choose version": "Choose version",
  "Play this file": "Play this file",
  "Remove from library; keep file": "Remove from library; keep file",
  "Remove {count} entries from library; keep files":
    "Remove {count} entries from library; keep files",
  "Remove {count} entries from the local library? Files on disk are kept.\n\n{title}":
    "Remove {count} entries from the local library? Files on disk are kept.\n\n{title}",
  "Choose episode": "Choose episode",
  "This server connection is no longer available.":
    "This server connection is no longer available.",
  "This server item is no longer available.": "This server item is no longer available.",
  "This server episode is no longer available.": "This server episode is no longer available.",
  "Pin channel": "Pin channel",
  "View program details": "View program details",
  "Visible pages": "Visible pages",
  "View page {number}": "View page {number}",
  "Page {number}": "Page {number}",
  "Manga page": "Manga page",
  "Delete the comment by @{handle}? This cannot be undone.":
    "Delete the comment by @{handle}? This cannot be undone.",
  "Comment deleted": "Comment deleted",
  "You no longer have permission to delete this comment.":
    "You no longer have permission to delete this comment.",
  Comment: "Comment",
  "Remove friend…": "Remove friend…",
  "Friend removed": "Friend removed",
  "The relationship changed. Open the menu again.":
    "The relationship changed. Open the menu again.",
  "The friend request is no longer available.": "The friend request is no longer available.",
  "The relationship update could not be confirmed. Refresh its current state.":
    "The relationship update could not be confirmed. Refresh its current state.",
  "Copy username": "Copy username",
  "Copy profile link": "Copy profile link",
  "Open game page": "Open game page",
  "Open page": "Open page",
  "Already in my profile": "Already in my profile",
  "Add to my profile": "Add to my profile",
  "Sign in to Harbor to add items to your profile.":
    "Sign in to Harbor to add items to your profile.",
  "Copy game link": "Copy game link",
  "This comment cannot be deleted.": "This comment cannot be deleted.",
  "Could not copy comment text.": "Could not copy comment text.",
  "Delete this comment? This cannot be undone.": "Delete this comment? This cannot be undone.",
  "The account or theme changed. Reopen the comment menu.":
    "The account or theme changed. Reopen the comment menu.",
  "Search audio language": "Search audio language",
  "No audio track in that language.": "No audio track in that language.",
  "games.pokemon.openSave": "games.pokemon.openSave",
  "games.pokemon.importPokemon": "games.pokemon.importPokemon",
  "games.pokemon.exportPokemon": "games.pokemon.exportPokemon",
  "games.pokemon.engineMissing": "games.pokemon.engineMissing",
  "games.pokemon.bankError": "games.pokemon.bankError",
  "games.pokemon.error.generic": "games.pokemon.error.generic",
  "games.pokemon.bankUnreadable": "games.pokemon.bankUnreadable",
  "games.pokemon.bankTruncated": "games.pokemon.bankTruncated",
  "games.pokemon.showBankFolder": "games.pokemon.showBankFolder",
  "games.pokemon.bankBrowse": "games.pokemon.bankBrowse",
  "games.pokemon.gameSave": "games.pokemon.gameSave",
  "games.pokemon.myBank": "games.pokemon.myBank",
  "games.pokemon.readOnly": "games.pokemon.readOnly",
  "games.pokemon.box": "games.pokemon.box",
  "games.pokemon.party": "games.pokemon.party",
  "games.pokemon.slot": "games.pokemon.slot",
  "games.pokemon.emptySlot": "games.pokemon.emptySlot",
  "games.pokemon.level": "games.pokemon.level",
  "games.pokemon.created": "games.pokemon.created",
  "games.pokemon.deposit": "games.pokemon.deposit",
  "games.pokemon.error.pokemon_hack_export": "games.pokemon.error.pokemon_hack_export",
  "games.pokemon.edited": "games.pokemon.edited",
  "games.pokemon.released": "games.pokemon.released",
  "games.pokemon.release": "games.pokemon.release",
  "games.pokemon.chooseSlot": "games.pokemon.chooseSlot",
  "games.pokemon.allBoxes": "games.pokemon.allBoxes",
  "games.pokemon.boxNumber": "games.pokemon.boxNumber",
  "games.pokemon.moveToBox": "games.pokemon.moveToBox",
  "games.pokemon.searchBank": "games.pokemon.searchBank",
  "games.pokemon.bankCopies": "games.pokemon.bankCopies",
  "games.pokemon.loadMore": "games.pokemon.loadMore",
  "games.pokemon.emptyBank": "games.pokemon.emptyBank",
  "games.pokemon.removeFromBank": "games.pokemon.removeFromBank",
  "games.pokemon.transferHint": "games.pokemon.transferHint",
  "games.pokemon.imported": "games.pokemon.imported",
  "games.pokemon.previewTransfer": "games.pokemon.previewTransfer",
  "games.pokemon.undoRemove": "games.pokemon.undoRemove",
  "games.pokemon.backupHistory": "games.pokemon.backupHistory",
  "games.pokemon.restoreChange": "games.pokemon.restoreChange",
  "games.pokemon.review": "games.pokemon.review",
  "games.pokemon.reviewNote": "games.pokemon.reviewNote",
  "games.pokemon.conversion": "games.pokemon.conversion",
  "games.pokemon.discard": "games.pokemon.discard",
  "games.pokemon.commit": "games.pokemon.commit",
  "games.pokemon.savedBackup": "games.pokemon.savedBackup",
  "games.pokemon.restore": "games.pokemon.restore",
  "games.pokemon.draftKept": "games.pokemon.draftKept",
  "games.pokemon.engineSources": "games.pokemon.engineSources",
  "games.pokemon.localEngine": "games.pokemon.localEngine",
  "games.pokemon.create": "games.pokemon.create",
  "games.pokemon.searchPokemon": "games.pokemon.searchPokemon",
  "games.pokemon.levelLabel": "games.pokemon.levelLabel",
  "games.pokemon.shiny": "games.pokemon.shiny",
  "games.pokemon.createNote": "games.pokemon.createNote",
  "games.pokemon.previewCreate": "games.pokemon.previewCreate",
  "games.pokemon.showdown": "games.pokemon.showdown",
  "games.pokemon.nickname": "games.pokemon.nickname",
  "games.pokemon.move": "games.pokemon.move",
  "games.pokemon.training": "games.pokemon.training",
  "games.pokemon.previewEdits": "games.pokemon.previewEdits",
  "games.pokemon.movePokemon": "games.pokemon.movePokemon",
  "games.pokemon.destinationSlot": "games.pokemon.destinationSlot",
  "games.pokemon.swapHint": "games.pokemon.swapHint",
  "games.pokemon.previewMove": "games.pokemon.previewMove",
  "games.pokemon.noChoices": "games.pokemon.noChoices",
  "games.pokemon.browse": "games.pokemon.browse",
  "games.pokemon.sources": "games.pokemon.sources",
  "games.pokemon.maps": "games.pokemon.maps",
  "games.pokemon.levelRange": "games.pokemon.levelRange",
  "games.pokemon.noEncounters": "games.pokemon.noEncounters",
  "games.pokemon.backDex": "games.pokemon.backDex",
  "games.pokemon.pokemonDetails": "games.pokemon.pokemonDetails",
  "games.pokemon.evolutionScope": "games.pokemon.evolutionScope",
  "games.pokemon.currentStats": "games.pokemon.currentStats",
  "games.pokemon.dex": "games.pokemon.dex",
  "games.pokemon.dexScope": "games.pokemon.dexScope",
  "games.pokemon.mapScope": "games.pokemon.mapScope",
  "games.pokemon.searchMaps": "games.pokemon.searchMaps",
  "games.pokemon.moreMaps": "games.pokemon.moreMaps",
  "games.pokemon.editionMoves": "games.pokemon.editionMoves",
  "games.pokemon.noMoves": "games.pokemon.noMoves",
  "games.pokemon.detectedSaves": "games.pokemon.detectedSaves",
  "games.pokemon.refreshSaves": "games.pokemon.refreshSaves",
  "games.pokemon.discoverFailed": "games.pokemon.discoverFailed",
  "games.pokemon.noDetectedSaves": "games.pokemon.noDetectedSaves",
  "games.pokemon.unavailable": "games.pokemon.unavailable",
  "games.pokemon.walkthrough": "games.pokemon.walkthrough",
  "games.pokemon.encounters": "games.pokemon.encounters",
  "games.pokemon.locationScope": "games.pokemon.locationScope",
  "games.pokemon.searchLocation": "games.pokemon.searchLocation",
  "games.pokemon.noLocations": "games.pokemon.noLocations",
  "games.pokemon.videos": "games.pokemon.videos",
  "games.pokemon.searchVideos": "games.pokemon.searchVideos",
  "No guide source for this playlist. Add an EPG URL to see program listings.":
    "No guide source for this playlist. Add an EPG URL to see program listings.",
  "Guide unavailable. Check the EPG source or refresh the playlist.":
    "Guide unavailable. Check the EPG source or refresh the playlist.",
  "Move subtitles above player controls": "Move subtitles above player controls",
  "Lifts subtitles while the player controls are showing so the controls never cover them. Subtitles you have already placed higher stay where they are.":
    "Lifts subtitles while the player controls are showing so the controls never cover them. Subtitles you have already placed higher stay where they are.",
  "Seekr · preview thumbnails": "Seekr · preview thumbnails",
  "sk_live_…": "sk_live_…",
  "Optional. Paste your own free Seekr API key to show Seekr's preview thumbnails first and fall back to local FFmpeg trickplay when Seekr has no match. Leave it blank to use local previews only.":
    "Optional. Paste your own free Seekr API key to show Seekr's preview thumbnails first and fall back to local FFmpeg trickplay when Seekr has no match. Leave it blank to use local previews only.",
  "Get a key at seekr.tv": "Get a key at seekr.tv",
  "Seekr preview thumbnails": "Seekr preview thumbnails",
};

export default uiFallback;
