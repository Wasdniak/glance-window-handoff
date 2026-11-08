// The state machine is independent of browser globals so ordering and failure
// paths can be checked without simulating a successful browser contents swap.
export function createHandoff(env) {
  const sync = env.sync;
  // Zen renamed or removed these: stay inactive instead of breaking every tab switch.
  if (typeof sync?.on_TabSelect !== "function" || typeof sync?.on_focus !== "function") {
    throw new Error("This Zen version changed its window sync; the mod is inactive.");
  }
  const originalSelect = sync.on_TabSelect;
  const originalFocus = sync.on_focus;
  const log = (...args) => env.log?.(...args);
  const pending = new Map();
  const busy = new Set();
  let stopped = false;
  let tail = Promise.resolve();

  function remoteFor(win, tab, includeParent = true) {
    if (stopped || !env.eligible(win) || !tab?.id || tab.closing) return null;
    for (const source of env.windows()) {
      if (source === win || !env.eligible(source)) continue;
      for (const pair of env.glances(source)) {
        if (pair.tab?.closing || !pair.tab?.isConnected || !pair.parent?.isConnected) continue;
        if (pair.tab.id === tab.id || (includeParent && pair.parent.id === tab.id)) {
          return { ...pair, source };
        }
      }
    }
    return null;
  }

  // Zen marks the one window copy that holds a tab's live page with
  // _zenContentsVisible. Any other copy is an empty about:blank placeholder.
  const holdsContents = tab => !!tab?._zenContentsVisible;
  const inPair = (tab, pair) => !!tab && (tab.id === pair.tab.id || tab.id === pair.parent.id);

  // A copy of the Glance or its parent is only unsafe to show when it is empty.
  // The parent's copy often does hold its page here (verified on Zen 1.23/158).
  const unsafe = (tab, pair) => inPair(tab, pair) && !holdsContents(tab);

  // Pick a tab in win to show instead: the previous tab when it is safe,
  // otherwise Firefox's usual neighbour choice, skipping empty Glance copies.
  function fallbackFor(win, pair, previousTab) {
    if (previousTab?.isConnected && !previousTab.closing && !unsafe(previousTab, pair) &&
        previousTab.documentGlobal === win) return previousTab;
    const current = win.gBrowser.selectedTab;
    const exclude = [...(win.gBrowser.tabs || [])].filter(tab => unsafe(tab, pair));
    const tab = env.fallbackTab?.(win, current, exclude);
    return tab && !unsafe(tab, pair) && !tab.closing ? tab : null;
  }

  // Native sync was held back while the job ran. If that left this window on
  // an empty copy of the Glance or its parent, repair it: show another tab
  // while the Glance is still open elsewhere, or let native sync pull the
  // page in once it isn't. Without this the tab reads "New Tab" and is blank.
  function rescue(win, pair, previousTab) {
    if (stopped || win.closed || env.activeWindow() !== win) return;
    const tab = win.gBrowser.selectedTab;
    if (!inPair(tab, pair) || holdsContents(tab) || tab.closing) return;
    if (remoteFor(win, tab)) {
      const fallback = fallbackFor(win, pair, previousTab);
      log("rescue: leaving empty copy", tab.id, "for", fallback?.id);
      if (fallback) win.gBrowser.selectedTab = fallback;
    } else {
      log("rescue: asking native sync to load", tab.id);
      originalSelect.call(sync, { target: tab, detail: { previousTab: null } });
    }
  }

  async function until(test, message) {
    for (let i = 0; i < 100; i++) {
      if (stopped) throw new Error("Mod disabled during handoff.");
      if (test()) return;
      await env.delay(30);
    }
    throw new Error(message);
  }

  function handoff(win, target, previousTab = win.gBrowser.selectedTab) {
    const pair = remoteFor(win, target);
    if (!pair) return Promise.resolve(false);
    if (pending.has(pair.tab.id)) return pending.get(pair.tab.id);
    const selectedAtStart = win.gBrowser.selectedTab;
    const id = pair.tab.id;
    // Hold both IDs immediately, before the queued job or any native focus event.
    busy.add(id);
    busy.add(pair.parent.id);
    const job = tail.then(async () => {
      const current = remoteFor(win, target);
      if (!current || current.tab !== pair.tab || stopped) return false;
      const manager = pair.source.gZenGlanceManager;
      if (typeof manager?.fullyOpenGlance !== "function" ||
          typeof manager?.getFocusedTab !== "function") {
        throw new Error("This Zen version does not expose the expected Glance expand action.");
      }
      await until(() => !manager.animatingOpen && !manager._animating &&
        !manager.closingGlance && !manager.animatingFullOpen,
        "Glance is still animating; handoff cancelled.");
      if (pair.source.closed || pair.tab.closing || !pair.tab.isConnected) return false;

      // A background selection restores the correct native Glance context.
      // The two IDs remain guarded against native contents swaps until expansion ends.
      pair.source.gBrowser.selectedTab = pair.tab;
      if (manager.getFocusedTab(1) !== pair.tab || manager.getFocusedTab(-1) !== pair.parent) {
        throw new Error("Zen could not activate the original Glance; its contents were left in place.");
      }
      await until(() => !manager.animatingOpen && !manager._animating,
        "Glance did not finish reopening; handoff cancelled.");
      if (env.mode?.() === "return") {
        // Keep both live pages and the native overlay in their owning window.
        // Focus it before undoing a keyboard selection in the other window,
        // so that background bookkeeping cannot move the contents away.
        if (env.activeWindow() !== win || stopped || win.closed) return false;
        if (typeof pair.source.STATE_MINIMIZED === "number" &&
            pair.source.windowState === pair.source.STATE_MINIMIZED) pair.source.restore?.();
        pair.source.focus();
        pair.tab.linkedBrowser?.focus?.();
        // Fall back to the previous tab, but never to an empty Glance copy.
        busy.delete(id);
        busy.delete(pair.parent.id);
        if (win.gBrowser.selectedTab === target && !holdsContents(target)) {
          const fallback = fallbackFor(win, pair, previousTab);
          if (fallback) win.gBrowser.selectedTab = fallback;
        }
        originalFocus.call(sync, { target: pair.source });
        env.changed();
        return true;
      }
      await manager.fullyOpenGlance();
      if (pair.tab.hasAttribute("zen-glance-tab") || manager.animatingFullOpen) {
        throw new Error("Glance expansion did not finish; no contents transfer was requested.");
      }
      // Let the native TabMove replication finish before selecting its copy.
      await env.delay(0);
      if (stopped || win.closed || target.closing || !target.isConnected) return false;
      // Do not steal a later click or a focus change while the animation ran.
      if (env.activeWindow() !== win ||
          (win.gBrowser.selectedTab !== selectedAtStart && win.gBrowser.selectedTab !== target)) return false;
      // Leave the source on the page that was underneath the preview. Keep
      // both IDs guarded until this background selection has completed; the
      // destination's native sync can then return the parent's contents there.
      if (target.id === id && !pair.source.closed &&
          pair.parent.isConnected && !pair.parent.closing &&
          pair.source.gBrowser.selectedTab === pair.tab) {
        pair.source.gBrowser.selectedTab = pair.parent;
      }
      busy.delete(id);
      busy.delete(pair.parent.id);
      win.gBrowser.selectedTab = target;
      originalSelect.call(sync, { target, detail: { previousTab } });
      originalFocus.call(sync, { target: win });
      env.changed();
      return true;
    }).catch(error => {
      env.report(error, win);
      return false;
    }).finally(() => {
      pending.delete(id);
      busy.delete(id);
      busy.delete(pair.parent.id);
      try { rescue(win, pair, previousTab); } catch (error) { console.error("Glance Window Handoff: rescue failed", error); }
      env.changed();
    });
    pending.set(id, job);
    tail = job;
    return job;
  }

  function guardedSelect(event) {
    const tab = event.target;
    const win = tab.documentGlobal;
    if (busy.has(tab.id)) { log("held native select", tab.id); return; }
    if (remoteFor(win, tab)) {
      // Pin/workspace bookkeeping can reselect replicas in background windows.
      // Native sync ignores those windows too; this is not a user handoff.
      if (env.activeWindow() !== win) return;
      return handoff(win, tab, event.detail?.previousTab);
    }
    return originalSelect.call(this, event);
  }

  function dismiss(win, target) {
    const pair = remoteFor(win, target);
    if (!pair) return Promise.resolve(false);
    const id = pair.tab.id;
    if (pending.has(id)) return pending.get(id);
    busy.add(id);
    busy.add(pair.parent.id);
    const job = tail.then(async () => {
      if (stopped || !remoteFor(win, target) || pair.source.closed) return false;
      const manager = pair.source.gZenGlanceManager;
      if (typeof manager?.closeGlance !== "function") throw new Error("Zen's native Glance close action is unavailable.");
      await until(() => !manager.animatingOpen && !manager._animating && !manager.animatingFullOpen,
        "Glance is still animating; close cancelled.");
      const previous = pair.source.gBrowser.selectedTab;
      pair.source.gBrowser.selectedTab = pair.tab;
      if (manager.getFocusedTab(1) !== pair.tab) throw new Error("The original Glance could not be selected for closing.");
      // Keep native before-unload/unsaved-change confirmation intact.
      await manager.closeGlance({ onTabClose: true });
      if (pair.tab.isConnected && pair.tab.hasAttribute("zen-glance-tab")) {
        pair.source.focus();
        pair.tab.linkedBrowser?.focus?.();
        return false;
      }
      if (previous !== pair.tab && previous !== pair.parent && previous?.isConnected && !previous.closing) {
        pair.source.gBrowser.selectedTab = previous;
      }
      return true;
    }).catch(error => {
      env.report(error, win);
      return false;
    }).finally(() => {
      pending.delete(id);
      busy.delete(id);
      busy.delete(pair.parent.id);
      try { rescue(win, pair, null); } catch (error) { console.error("Glance Window Handoff: rescue failed", error); }
      env.changed();
    });
    pending.set(id, job);
    tail = job;
    return job;
  }

  function guardedFocus(event) {
    const win = env.activeWindow();
    const tab = win?.gBrowser?.selectedTab;
    if (tab && busy.has(tab.id)) { log("held native focus", tab.id); return; }
    const pair = remoteFor(win, tab);
    if (pair) {
      if (pair.tab.id === tab.id) return handoff(win, tab);
      // Focusing a window that shows the parent must not expand the Glance
      // elsewhere or pull its page away. But this copy is usually empty, so
      // move to another tab rather than leave the window blank.
      if (!holdsContents(tab)) {
        const fallback = fallbackFor(win, pair, null);
        log("focus on empty parent copy", tab.id, "->", fallback?.id);
        if (fallback) {
          win.gBrowser.selectedTab = fallback;
          return originalFocus.call(this, event);
        }
      }
      return;
    }
    return originalFocus.call(this, event);
  }

  sync.on_TabSelect = guardedSelect;
  sync.on_focus = guardedFocus;
  return {
    remoteFor, handoff, dismiss,
    stop() {
      stopped = true;
      if (sync.on_TabSelect === guardedSelect) sync.on_TabSelect = originalSelect;
      if (sync.on_focus === guardedFocus) sync.on_focus = originalFocus;
    },
  };
}
