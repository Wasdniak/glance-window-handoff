const NS = "http://www.w3.org/1999/xhtml";

// Motion borrowed from Zia (c) 2026 z1nk, MIT; see ZIA-LICENSE.txt. Values
// match Zia's chrome.css (zia-glance-rise / zia-glance-sink) and zia.uc.js
// (GLANCE_THUMB_SINK_MS, GLANCE_THUMB_UNTIP_MS, the Essentials SUCK_MS/OUT_MS).
const ZIA = Object.freeze({
  riseMs: 1100,
  sinkMs: 300,
  untipMs: 450,
  tipEasing: "cubic-bezier(.16,1,.3,1)",
  filterMs: 150,
  springMs: 400,
  springEasing: "cubic-bezier(.3,1.4,.5,1)",
  suckMs: 220,
  suckEasing: "cubic-bezier(.55,0,.8,.2)",
  suckFadeMs: 100,
});
// CSS animation-timing-function applies per keyframe interval, so each
// keyframe carries Zia's ease-in-out to reproduce its @keyframes exactly.
const step = (transform, offset) => ({ transform, offset, easing: "ease-in-out" });
const RISE = [
  step("translateY(34px) rotate(4deg)", 0), step("translateY(-4px)", .27), step("translateY(1.5px)", .46),
  step("translateY(-1px)", .65), step("translateY(.4px)", .83), step("none", 1),
];
const SINK = [step("none", 0), step("translateY(-3px)", .32), step("translateY(34px) rotate(4deg)", 1)];
const ESSENTIAL_TUCKED = { translate: "-26px 0", scale: .12, rotate: "0deg" };

// Zen's own Glance close: its duration pref, ease-out, a 1-(1-t)^6 progress
// curve and an arc of up to 30px (ZenGlanceManager #createGlanceArcSequence).
const ZEN_ARC = Object.freeze({ steps: 30, maxHeight: 30, ratio: .4 });
function zenGlanceDuration() {
  try { return Services.prefs.getIntPref("zen.glance.animation-duration", 350); }
  catch { return 350; }
}

function reducedMotion(win) {
  return win.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function isEssential(card) {
  return !!card.closest(".tabbrowser-tab[zen-essential]");
}

function zenArcFrames(win, start, end, endRotate) {
  const dx = end.left - start.left;
  const dy = end.top - start.top;
  const distance = Math.hypot(dx, dy);
  const top = Math.min(start.top, end.top);
  const bottom = win.innerHeight - Math.max(start.top, end.top);
  const down = bottom > top;
  const height = Math.min(distance * ZEN_ARC.ratio, ZEN_ARC.maxHeight, (down ? bottom : top) * .6);
  const sx = end.width / start.width;
  const sy = end.height / start.height;
  const frames = [];
  for (let i = 0; i <= ZEN_ARC.steps; i++) {
    const t = i / ZEN_ARC.steps;
    const e = 1 - (1 - t) ** 6;
    const y = dy * e + (down ? 1 : -1) * height * (1 - (2 * e - 1) ** 2);
    // Same fade as before: mostly visible until it nears the card.
    const opacity = t < .55 ? .9 - (.35 * t / .55) : .55 * (1 - (t - .55) / .45);
    frames.push({
      transform: `translate(${dx * e}px, ${y}px) rotate(${endRotate * e}deg) scale(${1 + (sx - 1) * e}, ${1 + (sy - 1) * e})`,
      opacity,
    });
  }
  return frames;
}

// Hide the real replica immediately; animate an inert visual stand-in only.
// No cloned browser tabs, native tab attributes, or page contents are moved.
export function hideWithMorph(tab, entry) {
  const win = tab.ownerDocument.defaultView;
  const background = tab.querySelector(":scope > .tab-stack > .tab-background") || tab;
  const start = background.getBoundingClientRect();
  const style = win.getComputedStyle(tab);
  const canAnimate = entry?.badge.isConnected && !win.closed && !reducedMotion(win) &&
    win.windowState !== win.STATE_MINIMIZED && style.visibility === "visible" &&
    start.width > 0 && start.height > 0 && start.bottom > 0 && start.top < win.innerHeight;
  tab.setAttribute("gwh-hidden-preview", "true");
  if (!canAnimate) return null;

  const end = entry.badge.getBoundingClientRect();
  if (!end.width || !end.height || end.bottom <= 0 || end.top >= win.innerHeight) return null;
  const essential = isEssential(entry.card);
  const endRotate = parseFloat(win.getComputedStyle(entry.card).rotate) || (essential ? 6 : -8);
  const ghost = win.document.createElementNS(NS, "div");
  ghost.className = "gwh-morph-ghost";
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  Object.assign(ghost.style, {
    left: `${start.left}px`, top: `${start.top}px`, width: `${start.width}px`, height: `${start.height}px`,
    color: style.color, font: style.font,
    borderRadius: win.getComputedStyle(background).borderRadius,
  });
  const icon = win.document.createElementNS(NS, "img");
  icon.alt = "";
  const image = entry.sourceTab?.getAttribute("image") || tab.getAttribute("image");
  if (image) { icon.src = image; ghost.append(icon); }
  const title = win.document.createElementNS(NS, "span");
  title.textContent = entry.sourceTab?.label || tab.label || "Glance";
  ghost.append(title);
  win.document.documentElement.append(ghost);

  const animations = [];
  let cancelled = false;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    for (const animation of animations) animation.cancel();
    ghost.remove();
  };
  try {
    // Replace the card's CSS rise only for this newly morphing card; the same
    // rise is replayed below, timed to the ghost. Keep the marker for the
    // card's lifetime so that removing it doesn't replay CSS.
    entry.badge.setAttribute("gwh-morph-card", "true");
    const duration = zenGlanceDuration();
    animations.push(ghost.animate(zenArcFrames(win, start, end, endRotate),
      { duration, easing: "ease-out", fill: "forwards" }));
    // The card comes up out of the tab as the ghost reaches it, just as Zia's
    // card does when a Glance opens.
    const delay = Math.round(duration * .4);
    animations.push(essential
      ? entry.card.animate([
          { ...ESSENTIAL_TUCKED, opacity: 0 },
          { opacity: 1, offset: .2 },
          { translate: "0 0", scale: 1, rotate: `${endRotate}deg`, opacity: 1 },
        ], { duration: ZIA.springMs, delay, easing: ZIA.springEasing, fill: "backwards" })
      : entry.card.animate(RISE, { duration: ZIA.riseMs, delay, fill: "backwards" }));
    const finished = Promise.all(animations.map(animation => animation.finished.catch(() => {})))
      .then(cancel);
    return { win, tab, entry, cancel, finished };
  } catch {
    cancel();
    return null;
  }
}

export function fadeCard(tab, entry) {
  const win = tab.ownerDocument.defaultView;
  if (!entry.badge.isConnected || win.closed || reducedMotion(win) ||
      win.windowState === win.STATE_MINIMIZED) return null;
  const rect = entry.badge.getBoundingClientRect();
  if (!rect.width || !rect.height || rect.bottom <= 0 || rect.top >= win.innerHeight) return null;
  const essential = isEssential(entry.card);
  const fromHover = !essential && tab.matches(":hover");
  // This contains only our HTML card, image and canvas, never a real tab.
  const ghost = entry.badge.cloneNode(true);
  ghost.className = "gwh-exit-card";
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  Object.assign(ghost.style, {
    left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
    // The badge's cut at the tab edge, so the card sinks out through it.
    clipPath: win.getComputedStyle(entry.badge).clipPath,
  });
  const card = ghost.querySelector(".gwh-card");
  const style = win.getComputedStyle(entry.card);
  for (const name of ["width", "height", "rotate", "translate", "borderRadius", "cornerShape", "background", "boxShadow"]) {
    card.style[name] = style[name];
  }
  card.style.animation = "none";
  card.style.transition = "none";
  const canvas = ghost.querySelector(".gwh-card-thumb");
  if (!entry.canvas.hidden) {
    canvas.getContext("2d").drawImage(entry.canvas, 0, 0);
    canvas.style.filter = win.getComputedStyle(entry.canvas).filter;
    canvas.style.transition = "none";
  }
  win.document.documentElement.append(ghost);
  const animations = [];
  let cancelled = false;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    for (const animation of animations) animation.cancel();
    ghost.remove();
  };
  try {
    if (essential) {
      // Zia's Essentials close: the card is drawn back in toward the icon.
      animations.push(card.animate([
        { translate: style.translate === "none" ? "0 0" : style.translate, scale: 1, rotate: style.rotate },
        ESSENTIAL_TUCKED,
      ], { duration: ZIA.suckMs, easing: ZIA.suckEasing, fill: "forwards" }));
      animations.push(card.animate([{ opacity: 1 }, { opacity: 0 }],
        { duration: ZIA.suckFadeMs, delay: ZIA.suckMs - ZIA.suckFadeMs, fill: "forwards" }));
    } else {
      // Zia's tab-card close: a hovered card tips back first, then the card
      // lifts slightly and sinks through the tab's bottom edge.
      let delay = 0;
      if (fromHover) {
        delay = ZIA.untipMs;
        animations.push(card.animate([{ rotate: style.rotate }, { rotate: "-8deg" }],
          { duration: ZIA.untipMs, easing: ZIA.tipEasing, fill: "forwards" }));
        if (!entry.canvas.hidden) {
          animations.push(canvas.animate([{ filter: canvas.style.filter || "none" }, { filter: "none" }],
            { duration: ZIA.filterMs, easing: "ease", fill: "forwards" }));
        }
      }
      animations.push(card.animate(SINK, { duration: ZIA.sinkMs, delay, fill: "both" }));
    }
    const finished = Promise.all(animations.map(animation => animation.finished.catch(() => {})))
      .then(cancel);
    return { win, tab, entry, cancel, finished };
  } catch {
    cancel();
    return null;
  }
}
