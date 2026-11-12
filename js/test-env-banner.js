// Copyright 2025 Spencer Austin. All rights reserved.
// Licensed under Apache 2.0 with Commons Clause. See LICENSE.
//
// js/test-env-banner.js — 12 Nov 2026.
// This is the OLD TEST SITE (Worker irlid-api-test, database irlid-db-test).
// A person added here ended up on a live organisation's dashboard, because
// the orange staff QR opened live irlid.co.uk/scan.html. That is fixed in
// org-entry.html, and every page now shows this striped bar so the old test
// site can never be mistaken for live (a theme picture such as the dragons
// can be set on live orgs too, so it is not a guide).
//
// The replacement test copy is the staging setup in BunHead/IRLid
// (docs/test-environment.md). Use that once it exists.
(function () {
  "use strict";
  var TEXT = "OLD TEST SITE \u2014 RETIRED \u2014 NOT LIVE. Test database only. Do not add real people here.";
  function put() {
    if (!document.body || document.getElementById("irlid-old-test-bar")) return;
    var bar = document.createElement("div");
    bar.id = "irlid-old-test-bar";
    bar.setAttribute("role", "alert");
    bar.textContent = TEXT;
    bar.style.cssText = [
      "position:fixed", "top:0", "left:0", "right:0", "z-index:2147483647", "box-sizing:border-box",
      "padding:10px 14px", "font:700 16px/1.35 system-ui,-apple-system,Segoe UI,Arial,sans-serif",
      "color:#fff", "text-align:center", "letter-spacing:.02em",
      "background:repeating-linear-gradient(45deg,#b00020 0 18px,#7a0016 18px 36px)",
      "border-bottom:4px solid #111"
    ].join(";");
    document.body.insertBefore(bar, document.body.firstChild);
    try { document.body.style.paddingTop = (bar.offsetHeight || 44) + "px"; } catch (_) {}
    if (!/^\[OLD TEST\]/.test(document.title || "")) document.title = "[OLD TEST] " + (document.title || "IRLid");
  }
  document.documentElement.setAttribute("data-irlid-env", "old-test");
  if (document.readyState !== "loading") put();
  else document.addEventListener("DOMContentLoaded", put);
})();
