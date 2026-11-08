(() => {
  const { acquire } = ChromeUtils.importESModule("chrome://sine/content/glance-window-handoff/controller.sys.mjs");
  const release = acquire(window);
  window.addUnloadListener(release, "chrome://sine/content/glance-window-handoff/glance-window-handoff.uc.js");
  window.addEventListener("unload", release, { once: true });
})();
