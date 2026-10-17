/* Light / dark theme for header-lens.
 * In-memory only: the choice is held in a variable and never persisted anywhere, so a
 * reload returns to the default (light) and the "nothing is stored" guarantee holds.
 * Sets data-theme on the document root; the labeled toggle shows the current theme name.
 */
(function () {
  "use strict";
  // Default is light; an explicit data-theme="dark" on <html> (or a toggle) overrides it.
  var current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";

  function apply(t) {
    current = (t === "dark") ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", current);
    document.querySelectorAll("[data-theme-toggle]").forEach(function (b) { paint(b, current); });
  }
  function paint(b, state) {
    b.setAttribute("data-theme-state", state);
    b.setAttribute("aria-pressed", String(state === "dark"));
    b.setAttribute("aria-label", state === "light" ? "Switch to dark theme" : "Switch to light theme");
    var lab = b.querySelector(".tt-label"); if (lab) lab.textContent = state === "light" ? "Light" : "Dark";
  }
  function toggle() { apply(current === "light" ? "dark" : "light"); return current; }

  window.SOCTheme = { get: function () { return current; }, set: apply, toggle: toggle, paint: paint };

  function wire() {
    document.querySelectorAll("[data-theme-toggle]").forEach(function (b) {
      b.addEventListener("click", function () { toggle(); });
    });
    apply(current);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();
