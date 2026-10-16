// When this page is shown inside the SOC Toolkit, hide its own top bar and footer (the toolkit
// shows them once around it) and point links to other tools at the toolkit instead of the frame.
// Display only: nothing is stored or sent.
(function () {
  "use strict";
  var framed;
  try { framed = window.top !== window.self; } catch (e) { framed = true; }
  if (!framed) return;
  document.documentElement.classList.add("embedded");
  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("a[data-shell]").forEach(function (a) {
      a.href = a.getAttribute("data-shell-base") + "#" + a.getAttribute("data-shell");
      a.target = "_top";
    });
  });
})();
