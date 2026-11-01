# Theme Studio

Open Settings → Themes. Choose one of eight palettes or Restore original.
Edit a copy opens eight semantic colors and controls for gradient intensity,
blur, corner radius and reduced motion. Changes preview on the music page;
Apply saves them, Cancel restores the saved selection. Closing settings also
cancels the preview. The saved custom design survives choosing another preset.
Reset restores the source preset values. Export writes standalone CSS through
a native save dialog.

## Imported and linked CSS

Import CSS accepts UTF-8 `.css` files up to 1 MiB. Imports are copied to
`userData/themes/<SHA-256>.css`, deduplicated by content and listed with editable
names. Removing a library entry preserves both the original and managed copy.
Imports are independent themes. Linked CSS in Appearance remains an optional
override, applied after the selected theme and watched for file changes.
Restore original disables that override without deleting its path or file.

CSS must be self-contained: `@import`, `url()` (including data URLs),
`image-set()` and legacy executable constructs are rejected. Missing files and
invalid input produce errors in the panel. This resource policy also applies
to legacy linked files; older CSS using resources must be adapted.

## Implementation

`src/shared/themes/deep-indigo.css` preserves the supplied Deep Indigo v6.3
source. `model.ts` defines palettes and validates persisted selections;
`css.ts` derives secondary colors from eight tokens and generates CSS.
`CustomCSS` owns injection, managed imports and authenticated settings IPC.
`CSSLayers` serializes replacement and removes previous insertion keys.
The v2.1 Integration lifecycle obtains ConfigStore, YTMViewManager and the
Settings window through the service host. View recreation and status events
rebind the current WebContents; disabling cleans up listeners and file watches.
An empty initial AppView defers injection until its load event, avoiding
an unresolved Electron insertion holding the settings action queue.
No CSS is executed as JavaScript and the settings renderer has no Node access.

## Developer verification

```sh
node --test scripts/tests/*.test.cjs
pnpm lint
pnpm typecheck
pnpm package
```

Tests cover all palettes, validation, migration, separate saved custom state,
rapid asynchronous insertion, replacement views, imports, source preservation,
export, preview/cancel and IPC sender checks. Electron is mocked in service
tests; those tests alone do not establish real-world visual correctness.

Manual acceptance: inspect gallery/editor at normal and narrow window widths;
apply every palette; edit/apply/cancel; reload and restart; import two files,
rename/remove/export; check artwork, menus, search, scrolling and mini-player
on live YouTube Music. Upstream DOM changes may require selector updates.

This feature targets YTMD 2.1.0 (Electron 45, pnpm 12.8.1). The previous
miniplayer/startup patches and their tests have been removed: upstream v2.1
owns player initialization and recovery. Theme tests focus on CSS management.
