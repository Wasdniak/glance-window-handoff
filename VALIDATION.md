# Validation

Target: installed Zen 1.23.4b, build 20261020090730, with Sine and Zia (initially 2.111.1; alternate mode tested with installed 2.112.0).

Status: automated logic checks and disposable-profile live checks passed. Everyday-profile testing is pending.

The original Glance code creates a tab, then marks/nests it with `zen-glance-tab` and `glance-id`. Window sync creates a regular replica without those relationships. This mod identifies replicas by shared tab IDs and calls `gZenGlanceManager.fullyOpenGlance()` in the owning window before allowing native `on_TabSelect` / `on_focus` synchronization.

Acceptance: two-window selection preserves the original page state/history, removes the indicator after expansion, and leaves ordinary tabs, closing Glance, and private/unsynced windows behaving normally. Rollback: disable the mod in Sine and restart.

## Completed checks (2026-10-28)

- Thirteen state-machine tests passed, covering expansion-before-sync ordering, source-parent fallback, failure without contents transfer, repeated clicks, background bookkeeping reselection, parent focus, parent selection, a closing parent, normal tab passthrough, exclusion of ineligible windows, later focus/selection changes, and cleanup during an in-flight operation.
- JavaScript syntax checks passed. The PowerShell installer parsed and passed an isolated registry fixture: an unrelated mod entry remained unchanged, the new mod was enabled, and the original registry backup matched exactly.
- Launched the installed Zen 1.23.4b in fresh disposable profiles containing Sine and the installed Zia 2.111.1 code, using a local automation connection. No personal session, cookies, or browsing data was copied.
- Badge/subtitle appeared on the replica; computed badge size was 26 x 26 pixels and the row was 46 pixels high. A browser screenshot was inspected. Headless rendering does not establish the final appearance on the user's GPU/theme settings.
- A synthetic chrome click expanded the source and selected the replica, removed its indicator, and preserved the exact live browsing-context ID. This verifies transfer of the same live page rather than loading a new copy. Form edits, scroll position, navigation history, media, and real website behavior still deserve manual checking.
- Native Glance close removed the replica; native expand removed its marker. With three windows already open, a new Glance was marked in the third and programmatic selection triggered the same successful transfer. Normal tab switching still worked.
- A pinned-parent case passed: background reselection did not expand Glance; merely focusing the parent's other-window copy left Glance open; clicking the preview expanded it and transferred the same live browsing context.
- Sine's actual `removeUnloadListeners` path restored both native sync methods.

## Version 1.0.1: source-window fallback

When transferring a preview, the source window selects its original parent after expansion succeeds and immediately before native sync transfers the preview. If the parent has closed, or the user changed focus/selection while expanding, the mod does not force that fallback. Native expansion in the same window keeps its existing behavior.

Live checks in a fresh disposable Sine/Zia profile passed for both ordinary and pinned parents: the destination retained the preview's exact browsing-context ID, and the source selected the original parent with its original URL. Existing close/expand behavior, three-window handoff, normal selection, and unloading also passed. The upgrade installer fixture preserved the unrelated mod entry and backed up the previous mod files.

## Known native limitation

A window created while Glance is already active may not receive that preview replica (or the parent) from Zen's initial window restoration. This mod decorates/protects existing replicas only and does not manufacture missing ones. Open the synced windows before opening the Glance for the initial manual test.

## Version 1.1.0: alternate return mode

Version 1.1.1 changes the indicator's appearance; the handoff state machine is unchanged.

Adds a Sine dropdown with **Return to Glance in its original window** (default for trying the original design) and the existing **Expand Glance in this window** behavior. Preference changes refresh decorations without restart. Return mode hides only the preview replica, decorates the parent, and focuses/reselects the original native overlay without expanding or transferring either page.

Sixteen state-machine checks passed, including return without expansion, keyboard restoration of the secondary selection, and ignoring background parent reselection. In fresh headless profiles with current Sine/Zia code, the same live checks passed with both ordinary and pinned parents: hidden preview/parent badge, parent click returning to the native overlay, both original browsing-context IDs preserved, keyboard return and previous-selection restoration, reopening a background Glance as an overlay, switching to Expand without restart, the existing expand/source-parent-fallback behavior, native close cleanup, and Sine unload restoring the hidden copy and native handlers. Everyday-profile confirmation and final GPU appearance remain pending.

## Version 1.1.1: mirrored Zia Glance cards (2026-10-29)

Replaces the arrow badge with Zia's tilted page-card appearance and shortens both mode subtitles to **Glance Open**. The adapter copies pixels from the original Glance's existing `.zia-glance-thumb` canvas into its own canvas, without moving Zia's DOM or creating files. Favicon cards cover loading/unavailable pictures and Essentials. Zia's MIT copyright/license is included in ZIA-LICENSE.txt. Native Glance attributes and the handoff state machine are unchanged.

In the installed Zen 1.23.4b with a disposable profile containing Zia 2.112.4, the live check found the original thumbnail ready, its secondary mirror visible with identical pixel data, a 36px card with -8-degree tilt, the old arrow absent, the subtitle exactly `Glance Open`, and the duplicate preview still hidden. A browser screenshot was inspected. Returning preserved the overlay and browsing context; switching modes showed the card on the preview, expansion preserved the same context/source fallback, and both cards were removed after expansion. The Essentials version also passed return/keyboard/mode-switch/native-close/unload regression checks. Final appearance on the user's actual GPU and profile remains pending.

## Version 1.2.0: native-style Glance feedback (2026-10-29)

Removes the subtitle, custom minimum row heights, and preview-row background/shadow. Normal tabs use Zia's native card/close-button ordering and margins, tab-edge cropping, rise animation, hover tilt (-16 degrees), and picture dimming. A resize observer keeps cropping aligned. The close button calls the owning window's native Glance close action; it does not close either parent. It preserves before-unload checks and brings the source forward if closing is refused or confirmation remains outstanding. Tooltips and accessible action descriptions remain.

Eighteen state-machine checks passed, including native close and close refusal. In a fresh headless Zen/Sine/Zia profile, the native and remote rows both measured 38px, the card and close-button rectangles and margins matched Zia's native counterparts, the source and mirrored thumbnail pixels matched, and no subtitle or arrow existed. Firefox's inspector hover lock resolved the expected close opacity 1, card tilt -16deg, and brightness(0.4); a physical mouse hover in the everyday profile remains for user confirmation. A screenshot was inspected. Return preserved the overlay/context; remote close removed the preview and its replica/card while retaining both parents and restoring close-button accessibility labels; Expand still preserved the live page and source-parent fallback.

## Version 1.2.1: hide-to-card transition (2026-10-31)

Adds a 220 ms shrink/fade of an inert title/favicon stand-in toward the parent card, with a card crossfade in the final 120 ms. The actual duplicate is hidden immediately, without touching Zen's native hide state or delaying handoff logic. The temporary element is pointer-transparent, inert, and aria-hidden. A failure falls back to immediate hiding. Reduced motion skips the effect; mid-effect preference changes, mode changes, Glance cleanup, window unload, and Sine disable cancel/remove it. The card's usual rise is suppressed for that one appearance to prevent double motion. The installed handoff state machine was not changed.

Tests used fresh disposable profiles with installed Zen 1.24b (build 20261029123729), Sine, and Zia 2.114.1 code. Ordinary and pinned-parent checks observed exactly one 220 ms animation, a hidden real duplicate, pointer-events:none and aria-hidden:true on the stand-in, and removal after completion. Returning retained the original native Glance and browsing-context ID. Reduced motion produced no new stand-in, Expand behavior remained intact, and switching modes during the effect restored the visible replica and removed the stand-in. Enabling reduced motion or unloading the mod mid-effect also cleaned up correctly; unload restored the original native sync handler. A paused-midway browser screenshot was inspected. Headless checks do not establish the exact perceived timing on the user's normal display; that remains for manual feedback.

## Version 1.2.2: slower opening and close continuity (2026-10-31)

Opening now takes 320 ms (card crossfade: 180 ms after a 140 ms delay). Closing retains an inert copy of the rendered card for a 240 ms downward shrink/fade. Zen reparents its Glance tab at close start, before clearing the Glance marker: the adapter now recognizes the owning manager's closing state and keeps closing replicas hidden until their native close removes them. In Expand mode a closing decorated replica also hides immediately after its card is copied for the exit. This prevents the regular-row flash. Mode changes, reduced motion, and unload cancel effects; native page close/confirmation logic is unchanged.

A disposable-profile A/B test delayed native TabClose replication by 180 ms. Version 1.2.1 exposed the regular row; 1.2.2 kept it hidden across more than 60 samples in each mode, created one 240 ms exit with copied thumbnail pixels, removed the exit afterward, and kept both parents. Reduced-motion closing produced no exit element and still removed the replica. The opening/cancellation check observed one 320 ms effect, no stand-in under reduced motion, intact Return-mode page/context, and clean cancellation on mode changes, reduced motion changes, and unload.

Known separate test failure: on installed Zen 1.24b, expanding a new Glance after a prior close produced a blank target in both the old 1.2.1 and new 1.2.2 disposable builds. The result was reproduced with a local HTTP page, not just data URLs. Selection/visibility completed but the source document did not transfer. Return, remote close, native geometry, and thumbnail mirroring passed. The handoff state machine is byte-identical to 1.2.1; this compatibility issue is documented separately and is not claimed fixed here. Everyday-profile reproduction is pending.
