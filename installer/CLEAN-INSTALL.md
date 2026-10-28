# Clean install

Select **Clean install** on Shipyard's components screen to reset Harbor before
installing the bundled version. This option is off by default and also works
when Shipyard would normally offer Repair, Update, or Downgrade.

It closes Harbor, deletes the current user's `%APPDATA%\app.harbor` and
`%LOCALAPPDATA%\app.harbor` folders (including settings, sign-ins, local library,
add-ons, game saves stored there, and WebView storage), clears Harbor's named
temporary caches, and removes the selected installation and detected previous
installation. Shortcuts and uninstall registration are recreated by installation.
The component selections on the screen apply to the fresh installation.

Files in external media, download, or game folders and remote account data are
not deleted. Other Windows users' profiles are not reset.

Cleanup errors stop installation and are displayed in Shipyard. If Shipyard is
running from inside the installation folder, run it from Downloads instead.
