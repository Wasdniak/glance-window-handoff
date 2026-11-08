import { ZenWindowSync } from "resource:///modules/zen/ZenWindowSync.sys.mjs";
import { PrivateBrowsingUtils } from "resource://gre/modules/PrivateBrowsingUtils.sys.mjs";
import { setTimeout, clearTimeout } from "resource://gre/modules/Timer.sys.mjs";
import { createHandoff } from "./handoff.sys.mjs";
import { hideWithMorph, fadeCard } from "./morph.sys.mjs";

const windows = new Map();
const decorated = new Map();
const hiddenPreviews = new Set();
const hiddenOrigins = new Map();
const closingPreviews = new Set();
const morphs = new Set();
let controller = null;
let scheduled = null;
const NS = "http://www.w3.org/1999/xhtml";
const EVENTS = ["pointerdown", "mousedown", "mouseup", "click", "dblclick", "auxclick", "dragstart"];
const REFRESH_EVENTS = ["GlanceOpen", "GlanceClose", "TabOpen", "TabClose", "TabSelect", "SSTabRestored"];
const TOOLTIP = "Glance preview — click to expand and open here";
const RETURN_TOOLTIP = "Glance open in another window — click to return to it";
const MODE_PREF = "sine.glance-window-handoff.mode";
// Set to true in about:config to log handoff decisions to the Browser Console.
const DEBUG_PREF = "sine.glance-window-handoff.debug";
let disabledReason = null;

function debug(...args) {
  if (Services.prefs.getBoolPref(DEBUG_PREF, false)) console.log("[Glance Window Handoff]", ...args);
}

// Firefox's own choice of tab to show when a tab goes away.
function fallbackTab(win, current, exclude) {
  try {
    return win.gBrowser._findTabToBlurTo?.(current, exclude) || null;
  } catch {
    return null;
  }
}

function mode() {
  return Services.prefs.getStringPref(MODE_PREF, "return") === "expand" ? "expand" : "return";
}

function eligible(win) {
  return !!win && !win.closed && !!win.gBrowser &&
    win.gZenWindowSync === ZenWindowSync &&
    Services.prefs.getBoolPref("zen.window-sync.enabled", true) &&
    !win.document.documentElement.hasAttribute("zen-unsynced-window") &&
    !win.gZenWorkspaces?.privateWindowOrDisabled &&
    !PrivateBrowsingUtils.isWindowPrivate(win);
}

function glances(win) {
  return [...win.document.querySelectorAll('.tabbrowser-tab[zen-glance-tab][id]')].flatMap(tab => {
    const parent = tab.parentElement?.closest(".tabbrowser-tab");
    return parent && tab.getAttribute("glance-id") === parent.getAttribute("glance-id") ? [{ tab, parent }] : [];
  });
}

function isClosingPreview(tab) {
  if (!tab) return false;
  if (!tab.isConnected || tab.closing || closingPreviews.has(tab.id)) return true;
  const manager = tab.ownerDocument.defaultView?.gZenGlanceManager;
  // Zen first pulls the Glance out of its parent to animate it closed.
  // Its zen-glance-tab marker is still present during that interval.
  return !!manager?.closingGlance && manager.getFocusedTab(1) === tab;
}

function clearDecoration(tab, entry, animateExit = false) {
  for (const effect of morphs) {
    if (effect.entry === entry) { effect.cancel(); morphs.delete(effect); }
  }
  if (animateExit && tab.isConnected) {
    try {
      const effect = fadeCard(tab, entry);
      if (effect) { morphs.add(effect); effect.finished.then(() => morphs.delete(effect)); }
    } catch (error) { console.warn("Glance Window Handoff: close animation skipped", error); }
  }
  entry.badge.remove();
  if (entry.close?.isConnected) {
    for (const [name, value] of Object.entries(entry.closeOriginal)) {
      if (entry.close.getAttribute(name) !== "Close Glance") continue;
      if (value === null) entry.close.removeAttribute(name);
      else entry.close.setAttribute(name, value);
    }
  }
  for (const name of ["gwh-preview", "gwh-return-parent", "gwh-expanding"]) tab.removeAttribute(name);
  if (tab.getAttribute("aria-description") === entry.hint) {
    if (entry.description === null) tab.removeAttribute("aria-description");
    else tab.setAttribute("aria-description", entry.description);
  }
  if (tab.getAttribute("tooltiptext") === entry.hint) {
    if (entry.tooltip === null) tab.removeAttribute("tooltiptext");
    else tab.setAttribute("tooltiptext", entry.tooltip);
  }
  decorated.delete(tab);
}

function paintCard(entry, pair) {
  entry.sourceTab = pair.tab;
  // Reuse Zia's existing, already-painted thumbnail in memory. This does not
  // move its DOM, capture another page, or save any page image to disk.
  const picture = !pair.tab.ownerDocument.documentElement.hasAttribute("zia-glance-thumb-off") &&
    !pair.parent.hasAttribute("zen-essential") && pair.tab.hasAttribute("zia-glance-thumb") &&
    pair.tab.querySelector(":scope > .tab-stack > .zia-glance-thumb");
  const icon = pair.tab.getAttribute("image") || "";
  if (entry.icon.getAttribute("src") !== icon) {
    if (icon) entry.icon.setAttribute("src", icon);
    else entry.icon.removeAttribute("src");
  }
  entry.icon.hidden = !icon;
  if (picture?.width && picture?.height) {
    try {
      if (entry.canvas.width !== picture.width) entry.canvas.width = picture.width;
      if (entry.canvas.height !== picture.height) entry.canvas.height = picture.height;
      const context = entry.canvas.getContext("2d");
      context.clearRect(0, 0, entry.canvas.width, entry.canvas.height);
      context.drawImage(picture, 0, 0);
      entry.canvas.hidden = false;
      entry.card.setAttribute("gwh-has-picture", "true");
      return;
    } catch { /* Keep the favicon card until Zia has a usable picture. */ }
  }
  entry.canvas.hidden = true;
  entry.card.removeAttribute("gwh-has-picture");
}

function cutCard(tab, entry) {
  if (tab.hasAttribute("zen-essential")) return;
  const background = tab.querySelector(":scope > .tab-stack > .tab-background");
  if (!background || !entry.badge.isConnected) return;
  const card = entry.badge.getBoundingClientRect();
  const host = background.getBoundingClientRect();
  const values = { top: host.top - card.top, right: card.right - host.right, bottom: card.bottom - host.bottom };
  for (const [edge, value] of Object.entries(values)) {
    entry.badge.style.setProperty(`--gwh-cut-${edge}`, `${Math.round(value * 2) / 2}px`);
  }
}

function refresh() {
  scheduled = null;
  if (!controller) return;
  // Nothing to decorate or undo: skip the full scan on unrelated UI changes.
  if (!decorated.size && !hiddenPreviews.size && !closingPreviews.size &&
      ![...windows.keys()].some(win => !win.closed && win.document.querySelector(".tabbrowser-tab[zen-glance-tab][id]"))) return;
  const wanted = new Map();
  const hiddenWanted = new Set();
  const hideTargets = new Map();
  const returning = mode() === "return";
  for (const win of windows.keys()) {
    if (!eligible(win)) continue;
    for (const source of windows.keys()) {
      if (source === win || !eligible(source)) continue;
      for (const pair of glances(source)) {
        const previewCopy = win.document.getElementById(pair.tab.id);
        if (returning && previewCopy?.classList.contains("tabbrowser-tab") &&
            !previewCopy.hasAttribute("zen-glance-tab") && !previewCopy.closing) {
          hiddenWanted.add(previewCopy);
          hiddenOrigins.set(previewCopy, pair.tab);
        }
        const tab = returning ? win.document.getElementById(pair.parent.id) : previewCopy;
        if (!tab?.classList.contains("tabbrowser-tab") || tab.closing || tab.hasAttribute("zen-glance-tab")) continue;
        const kind = returning ? "gwh-return-parent" : "gwh-preview";
        const hint = returning ? RETURN_TOOLTIP : TOOLTIP;
        if (returning && previewCopy) hideTargets.set(previewCopy, tab);
        wanted.set(tab, kind);
        if (decorated.has(tab)) {
          const existing = decorated.get(tab);
          if (existing.badge.isConnected && existing.kind === kind) {
            paintCard(existing, pair);
            cutCard(tab, existing);
            continue;
          }
          clearDecoration(tab, existing);
        }
        const content = tab.querySelector(".tab-content");
        if (!content) continue;
        const badge = win.document.createElementNS(NS, "span");
        badge.className = "gwh-badge";
        badge.setAttribute("aria-hidden", "true");
        badge.setAttribute("tooltiptext", hint);
        const card = win.document.createElementNS(NS, "span");
        card.className = "gwh-card";
        const canvas = win.document.createElementNS(NS, "canvas");
        canvas.className = "gwh-card-thumb";
        canvas.hidden = true;
        const icon = win.document.createElementNS(NS, "img");
        icon.className = "gwh-card-icon";
        icon.setAttribute("alt", "");
        icon.hidden = true;
        card.append(icon, canvas);
        badge.append(card);
        const close = content.querySelector(".tab-close-button");
        // As in Zia, the card sits after the close button, pulled back under it.
        content.append(badge);
        const closeOriginal = close ? { tooltiptext: close.getAttribute("tooltiptext"), "aria-label": close.getAttribute("aria-label") } : {};
        close?.setAttribute("tooltiptext", "Close Glance");
        close?.setAttribute("aria-label", "Close Glance");
        const entry = { badge, card, canvas, icon, close, closeOriginal, kind, hint, description: tab.getAttribute("aria-description"), tooltip: tab.getAttribute("tooltiptext") };
        decorated.set(tab, entry);
        paintCard(entry, pair);
        tab.setAttribute(kind, "true");
        tab.setAttribute("aria-description", hint);
        tab.setAttribute("tooltiptext", hint);
        cutCard(tab, entry);
      }
    }
  }
  for (const [tab, entry] of decorated) {
    if (!wanted.has(tab) || !tab.isConnected) {
      const closing = isClosingPreview(entry.sourceTab);
      const sourceGone = closing ||
        !entry.sourceTab.hasAttribute("zen-glance-tab");
      clearDecoration(tab, entry, sourceGone);
      if (closing && entry.kind === "gwh-preview" && tab.isConnected) {
        tab.setAttribute("gwh-hidden-preview", "true");
        hiddenPreviews.add(tab);
        hiddenOrigins.set(tab, entry.sourceTab);
      }
    }
  }
  for (const tab of hiddenPreviews) {
    if (!hiddenWanted.has(tab) || !tab.isConnected) {
      const source = hiddenOrigins.get(tab);
      // A closing Glance loses its marker before its replicas finish closing.
      // Do not reveal that dying copy as a regular row in between.
      const closing = isClosingPreview(source);
      if (closing && tab.isConnected && eligible(tab.ownerDocument.defaultView)) continue;
      tab.removeAttribute("gwh-hidden-preview");
      hiddenPreviews.delete(tab);
      hiddenOrigins.delete(tab);
      for (const effect of morphs) {
        if (effect.tab === tab) { effect.cancel(); morphs.delete(effect); }
      }
    }
  }
  for (const tab of hiddenWanted) {
    if (!hiddenPreviews.has(tab)) {
      let effect = null;
      try { effect = hideWithMorph(tab, decorated.get(hideTargets.get(tab))); }
      catch (error) {
        // A visual failure must never leave a live replica unprotected.
        tab.setAttribute("gwh-hidden-preview", "true");
        console.warn("Glance Window Handoff: animation skipped", error);
      }
      hiddenPreviews.add(tab);
      if (effect) {
        morphs.add(effect);
        effect.finished.then(() => morphs.delete(effect));
      }
    }
  }
  for (const id of closingPreviews) {
    if (![...hiddenOrigins.values()].some(source => source.id === id)) closingPreviews.delete(id);
  }
}

function onGlanceClose(event) {
  if (event.target?.id) closingPreviews.add(event.target.id);
  schedule();
}

function schedule() {
  if (scheduled === null && controller) scheduled = setTimeout(refresh, 0);
}

function report(error, win) {
  console.error("Glance Window Handoff:", error);
  try {
    const box = win.gBrowser.getNotificationBox(win.gBrowser.selectedBrowser);
    box.appendNotification("glance-window-handoff-error", {
      label: `Glance handoff stopped: ${error.message}`,
      priority: box.PRIORITY_WARNING_MEDIUM,
    });
  } catch { /* A closing window may no longer have its notification box. */ }
}

function onPointer(event) {
  const tab = event.target.closest?.(".tabbrowser-tab");
  const win = event.currentTarget;
  if (!controller || !controller.remoteFor(win, tab)) return;
  const close = event.target.closest?.(".tab-close-button");
  if (close && event.button === 0) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === "click") controller.dismiss(win, tab);
    return;
  }
  // Other native controls retain their regular actions. Middle/right/modified clicks
  // and drags are blocked while this is a remote preview, to avoid operating
  // on only one piece of a live Glance.
  if (event.target.closest?.(".tab-close-button, .tab-audio-button, .tab-icon-overlay, .tab-reset-button")) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.type === "click" && event.button === 0 &&
      !event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) {
    tab.setAttribute("gwh-expanding", "true");
    controller.handoff(win, tab).finally(() => tab.removeAttribute("gwh-expanding"));
  }
}

export function acquire(win) {
  if (windows.has(win) || disabledReason) return () => {};
  if (!controller) {
    try {
      controller = createHandoff({
        sync: ZenWindowSync, windows: () => [...windows.keys()], eligible, glances,
        mode, fallbackTab, log: debug,
        activeWindow: () => Services.focus.activeWindow,
        delay: ms => new Promise(resolve => setTimeout(resolve, ms)),
        changed: schedule, report,
      });
    } catch (error) {
      disabledReason = error;
      report(error, win);
      return () => {};
    }
  }
  const observer = new win.MutationObserver(schedule);
  const resizeObserver = new win.ResizeObserver(schedule);
  if (win.gBrowser?.tabContainer) resizeObserver.observe(win.gBrowser.tabContainer);
  observer.observe(win.document.documentElement, {
    subtree: true, childList: true, attributes: true,
    attributeFilter: ["zen-glance-tab", "glance-id", "id", "zia-glance-thumb", "zia-glance-thumb-off", "zen-essential", "image"],
  });
  windows.set(win, observer);
  for (const type of EVENTS) win.addEventListener(type, onPointer, true);
  for (const type of REFRESH_EVENTS) win.addEventListener(type, type === "GlanceClose" ? onGlanceClose : schedule, true);
  const preferenceObserver = { observe(_subject, _topic, name) {
    if (name === MODE_PREF) {
      for (const effect of morphs) effect.cancel();
      morphs.clear();
    }
    schedule();
  } };
  const reducedMotion = win.matchMedia("(prefers-reduced-motion: reduce)");
  const onMotionChange = () => {
    if (!reducedMotion.matches) return;
    for (const effect of morphs) {
      if (effect.win === win) { effect.cancel(); morphs.delete(effect); }
    }
  };
  reducedMotion.addEventListener("change", onMotionChange);
  Services.prefs.addObserver("zen.window-sync.enabled", preferenceObserver);
  Services.prefs.addObserver(MODE_PREF, preferenceObserver);
  schedule();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    observer.disconnect();
    resizeObserver.disconnect();
    reducedMotion.removeEventListener("change", onMotionChange);
    for (const effect of morphs) {
      if (effect.win === win) { effect.cancel(); morphs.delete(effect); }
    }
    Services.prefs.removeObserver("zen.window-sync.enabled", preferenceObserver);
    Services.prefs.removeObserver(MODE_PREF, preferenceObserver);
    windows.delete(win);
    for (const type of EVENTS) win.removeEventListener(type, onPointer, true);
    for (const type of REFRESH_EVENTS) win.removeEventListener(type, type === "GlanceClose" ? onGlanceClose : schedule, true);
    for (const [tab, entry] of decorated) {
      if (tab.ownerGlobal === win || tab.ownerDocument === win.document) clearDecoration(tab, entry);
    }
    for (const tab of hiddenPreviews) {
      if (tab.ownerDocument === win.document) {
        tab.removeAttribute("gwh-hidden-preview");
        hiddenPreviews.delete(tab);
        hiddenOrigins.delete(tab);
      }
    }
    if (!windows.size) {
      controller.stop();
      controller = null;
      if (scheduled !== null) clearTimeout(scheduled);
      scheduled = null;
      hiddenOrigins.clear();
      closingPreviews.clear();
    } else schedule();
  };
}
