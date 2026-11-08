# Glance Window Handoff

> **Personal project.** Built for my own setup (Zen + Sine + Zia, several synced windows). Shared as-is: no support, and it may break when Zen updates. Issues and PRs may not get a response.

A Sine mod for Zen, tested with 1.23.4b and 1.24b, with two ways to handle Glance across synced windows. It does not reopen the URL or reload the page.

## Choose a mode

In Sine's settings for **Glance Window Handoff**, use **Clicking a Glance tab in another window**. Changes take effect immediately; do not enable a second copy of the mod.

- **Return to Glance in its original window** (default): hide the extra preview row in secondary windows. Its parent tab uses Zia's normal Glance-card appearance, with no extra label or row height. Clicking the card or parent focuses the original window and its intact Glance overlay, restoring a minimized window if needed. Keyboard selection of a remote copy also returns to the original, restoring the secondary window's previous selection when available. Neither live page is moved or expanded.
- **Expand Glance in this window**: the preview copy stays visible with its Glance card. Clicking it expands the original Glance, returns the source window to the parent page underneath, and lets native window sync bring the existing preview page into the clicked window as a regular tab.

The card mirrors Zia's existing miniature of the Glance page, using the same 36px card and tilt. It falls back to a translucent favicon card while the picture is loading, when Zia's thumbnails are disabled/unavailable, and on Essentials (matching Zia's compact favicon card). Mirroring happens in memory; the mod does not capture another page or save thumbnail files. Zia-derived styling is credited under its MIT license in ZIA-LICENSE.txt.

The card uses Zia's placement beneath the close button, cropped at the tab edge, opening animation, hover tilt, and dimming. The close button appears on hover and dismisses Glance first, keeping its parent open. Native unsaved-change confirmation is preserved and brought into view if needed. Tooltips and screen-reader descriptions retain the cross-window action explanation without permanent status text.

In **Return to Glance** mode, a newly hidden preview shrinks and fades toward the parent's card along Zen's own Glance arc and timing (`zen.glance.animation-duration`, 350 ms by default). The card then rises out of the tab with Zia's bounce, or springs out on Essentials. The actual replica is hidden immediately; only a temporary non-interactive visual moves. It runs once per hide, skips reduced-motion/minimized/off-screen cases, and cancels cleanly if the mode changes, Glance closes, or the mod unloads. Enabling reduced motion during the transition cancels it immediately. The transition replaces the card's longer rise for that appearance only; handoff actions do not wait for it.

When Glance closes, its card leaves the way Zia's does: it lifts slightly and sinks through the tab's bottom edge over 300 ms, first tipping back if the tab is hovered. On Essentials it is drawn back into the icon over 220 ms. The mod keeps the closing replica hidden through Zen's detach/close sequence, so it does not briefly reappear as a normal row. This applies to both modes, preserves the parent, and skips the visual effect under reduced motion.

Tab height, background, and selection glow are left to Zia. Hidden copies use only a mod-specific display marker; native hide/close state is not changed or synced to the original.

## Install

This is a JavaScript mod and needs the [Sine](https://github.com/CosmoCreeper/Sine) mod manager. The Glance cards are designed around the Zia mod; without it the mod still works but the cards look plainer.

1. In Zen, open **Settings → Sine Mods**, click the gear (**Open settings**) and turn on **Enable installing JS from unofficial sources**.
2. Under the Marketplace, in the **add your own locally from a GitHub repo** box, enter `Wasdniak/glance-window-handoff` and click **Install**.
3. Go to `about:support`, click **Clear startup cache**, and restart Zen.

Sine checks this repo for updates on its own (unless auto-updates are off for Sine or for this mod).

## Try it

1. Open two normal, synced Zen windows. Window sync must include the tabs involved; the mod does not change your sync settings.
2. In the first window, open a Glance. In **Return to Glance** mode, the second window should show only its parent with a return badge; the separate preview row is hidden.
3. Click that parent. The first window should come forward with the Glance overlay intact. Switch to **Expand Glance in this window** and repeat: the marked preview should appear in the second window, and clicking it should expand/move the page there while the first window returns to its parent. Check scroll position, back history, and any form input.
4. Repeat with a pinned/Essential parent. Also check closing Glance normally, expanding with Zen's own button, a third synced window, and ordinary tab switching.

While Glance remains open, simply focusing a window already showing its parent does not transfer the parent's contents out of the original overlay. Deliberately selecting/clicking that parent returns to the original overlay in **Return to Glance** mode, or expands Glance before selecting the parent in **Expand** mode. This guards both pieces of the pair. Modified clicks and dragging the remote pair are ignored while Glance is active. The close button dismisses Glance first; audio controls keep their normal actions.

If the expected native API is unavailable or expansion fails, the mod stops the handoff and reports an error. If you switch to a different tab/window during expansion, it does not steal your later selection. Private/unsynced windows are excluded.

## Roll back

Disable **Glance Window Handoff** in Sine and restart Zen. You may then remove it through Sine. Its markers and synchronization hooks are removed on unload; a restart also ends any in-flight operation. The mode is stored in the mod's own preference, `sine.glance-window-handoff.mode`. No unrelated preferences or browser application files are edited.
## Limits

This is a workaround for Glance/window-sync integration, not full cross-window Glance support. It uses internal Zen APIs and may need revision after a browser update. See VALIDATION.md for what has actually been checked. User testing in the real profile remains necessary.

Zen may omit the preview replica when creating a new window while Glance is already open. Open your synced windows first, then open Glance. This mod does not create tabs that Zen failed to mirror.

On Zen 1.24b, an automated test that closes a Glance and then expands a new one into another window can leave the expanded tab blank. This reproduced in the disposable profile with both 1.2.1 and 1.2.2, including a local HTTP page; it was not introduced by this animation update. Return mode passed. Everyday-profile reproduction and a separate compatibility fix are still pending.

## Releasing an update

Sine only installs an update when `updatedAt` in `theme.json` is newer than the installed copy's. For every release, bump `version`, set `updatedAt` to the current UTC time, then commit and push to `main`.

## License

MIT, see [LICENSE](LICENSE). The Glance-card styling and animation timings are adapted from Zia (c) 2026 z1nk, also MIT; see [ZIA-LICENSE.txt](ZIA-LICENSE.txt).

## Changelog

### 1.3.2 (2026-11-06)
- Animations now match Zia and Zen instead of using their own timing:
  - The hidden preview flies to the card on Zen's Glance arc, timing and ease-out.
  - The card arrives with Zia's 1.1 s rise, or Zia's 400 ms spring on Essentials.
  - The card leaves with Zia's 300 ms sink, after a 450 ms un-tip if the tab is hovered, or Zia's 220 ms suck on Essentials.
- Tested on the test bench, Zen Twilight, with the new `scenarios\gwh-animations.js`. It records each animation's timing and curve for normal, hovered and Essential parents, compared with 1.3.1. blank-tab has 0 failures, return passes 10/10 and expand 11/11.

### 1.3.1 (2026-11-06)
- Fix a regression in 1.3.0: when you keyboard-select a Glance's copy in another window, return mode once again goes back to the parent tab's copy if that copy holds its page. 1.3.0 always skipped it and could land on an empty tab. Tested live on Zen Twilight (Firefox 158) with a local test bench. The blank-tab scenario has 0 failures, the return suite passes 10/10 and the expand suite 11/11, the same as 1.2.2.
- Note: on Zen 1.24b, blank "New Tab" tabs after switching windows come from a Zen bug (gh-16272, fixed upstream in f1df133 and not yet released), not from this mod. They happen with no mods installed.

### 1.3.0 (2026-11-06)
- Fix: a window could be left showing a blank "New Tab" after switching windows while a Glance was open. Zen keeps a tab's live page in only one window and swaps it in when you look at that window. The mod holds some of those swaps back so it doesn't steal a page out from under a Glance, and it could leave the window on an empty copy. It now moves to another tab while the Glance is open elsewhere, and hands the tab back to Zen once it isn't.
- Return mode no longer falls back to the parent tab's empty copy.
- If a Zen update changes the window-sync internals this mod hooks into, it shows one warning and stays off. Before, every tab switch could throw.
- Skips its full scan when no Glance is open anywhere.
- Debugging: set `sine.glance-window-handoff.debug` to true in about:config to log handoff decisions to the Browser Console (Ctrl+Shift+J).
