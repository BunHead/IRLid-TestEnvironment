// Universal double-tap / double-click fullscreen QR helper for the test environment.
(function () {
  "use strict";

  const SELECTOR = "[data-qr-fullscreen-payload]";
  let overlay = null;
  let holder = null;
  let active = false;
  let activeOptions = null;
  let refreshTimer = null;
  let lastTapAt = 0;
  let closing = false;

  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.className = "irlid-qr-fullscreen";
    overlay.innerHTML = `
      <button class="irlid-qr-fullscreen-close" type="button" aria-label="Close QR">&times;</button>
      <div class="irlid-qr-fullscreen-inner">
        <img class="irlid-qr-fullscreen-logo" data-qr-logo alt="">
        <div class="irlid-qr-fullscreen-fallback" data-qr-fallback>IRL</div>
        <div class="irlid-qr-fullscreen-title" data-qr-title></div>
        <div class="irlid-qr-fullscreen-holder" id="irlidQrFullscreenHolder"></div>
        <div class="irlid-qr-fullscreen-subtitle" data-qr-subtitle></div>
      </div>`;
    const refresh = document.createElement("div");
    refresh.className = "irlid-qr-fullscreen-refresh";
    refresh.setAttribute("data-qr-refresh", "");
    overlay.appendChild(refresh);
    document.body.appendChild(overlay);
    holder = overlay.querySelector(".irlid-qr-fullscreen-holder");
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });
    overlay.querySelector(".irlid-qr-fullscreen-close").addEventListener("click", close);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && active) close();
    });
    document.addEventListener("fullscreenchange", () => {
      if (active && !closing && document.fullscreenElement !== overlay) close(false);
    });
  }

  function injectStyles() {
    if (document.getElementById("irlidQrFullscreenStyles")) return;
    const style = document.createElement("style");
    style.id = "irlidQrFullscreenStyles";
    style.textContent = `
      .irlid-qr-fullscreen{display:none;position:fixed;inset:0;z-index:100000;background:#05070c;color:#fff;align-items:center;justify-content:center;padding:clamp(10px,2vmin,28px);box-sizing:border-box;overflow:hidden;}
      .irlid-qr-fullscreen.active{display:flex;}
      .irlid-qr-fullscreen-inner{width:min(100%,900px);display:grid;justify-items:center;gap:clamp(8px,1.5vmin,18px);text-align:center;}
      .irlid-qr-fullscreen-logo{display:none;width:min(28vmin,170px);max-width:48vw;max-height:min(18vmin,150px);object-fit:contain;filter:drop-shadow(0 12px 28px rgba(0,0,0,0.34));}
      .irlid-qr-fullscreen-fallback{display:none;min-width:min(20vmin,92px);min-height:min(15vmin,70px);align-items:center;justify-content:center;border-radius:14px;background:#f8fbff;color:#08101d;font:800 clamp(20px,5vmin,30px)/1 "Segoe UI",system-ui,sans-serif;letter-spacing:.03em;}
      .irlid-qr-fullscreen-title{min-height:1.2em;font:800 clamp(22px,4vmin,48px)/1.05 "Segoe UI",system-ui,sans-serif;}
      .irlid-qr-fullscreen-subtitle{min-height:1.2em;color:rgba(255,255,255,0.72);font:600 clamp(12px,1.6vmin,16px)/1.35 "Segoe UI",system-ui,sans-serif;}
      .irlid-qr-fullscreen-holder{width:min(78vmin,calc(100dvh - 180px),720px);aspect-ratio:1;display:grid;place-items:center;padding:clamp(10px,1.8vmin,18px);box-sizing:border-box;background:#fff;border-radius:clamp(12px,2vmin,22px);box-shadow:0 28px 90px rgba(0,0,0,0.54);}
      .irlid-qr-fullscreen-holder canvas,.irlid-qr-fullscreen-holder img{display:block;width:100%!important;height:100%!important;max-width:100%!important;max-height:100%!important;object-fit:contain;}
      .irlid-qr-fullscreen-close{position:fixed;top:18px;right:18px;width:42px;height:42px;border:0;border-radius:999px;background:rgba(255,255,255,0.12);color:#fff;font-size:24px;line-height:1;cursor:pointer;}
      .irlid-qr-fullscreen-refresh{position:fixed;right:16px;bottom:12px;color:rgba(255,255,255,0.26);font:600 11px/1.2 "Segoe UI",system-ui,sans-serif;letter-spacing:0.01em;pointer-events:none;user-select:none;}
      @media (max-width:760px),(max-height:760px){.irlid-qr-fullscreen-logo,.irlid-qr-fullscreen-subtitle{display:none!important;}.irlid-qr-fullscreen-holder{width:min(88vmin,calc(100dvh - 70px),680px);}.irlid-qr-fullscreen-inner{gap:8px;}}
    `;
    document.head.appendChild(style);
  }

  function normalize(target) {
    target.querySelectorAll("canvas, img").forEach((node) => {
      const hiddenCanvas = node.tagName === "CANVAS" && getComputedStyle(node).display === "none";
      if (hiddenCanvas) return;
      node.style.width = "100%";
      node.style.height = "100%";
      node.style.maxWidth = "100%";
      node.style.maxHeight = "100%";
      node.style.display = "block";
    });
  }

  // Batch 6.5d — resolve the QR's dark colour at render time. Priority:
  //   1) explicit colorDark passed via IRLidQrFullscreen.open({colorDark})
  //   2) global window.IRLID_THEME_QR_FG (set by OrgCheckin theme apply)
  //   3) fallback "#000000"
  function resolveDark(opt) {
    const candidate = (opt && typeof opt === "string") ? opt
      : (typeof window.IRLID_THEME_QR_FG === "string" ? window.IRLID_THEME_QR_FG : null);
    if (candidate && /^#[0-9a-fA-F]{6}$/.test(candidate)) return candidate;
    return "#000000";
  }

  function renderWithQrcodeJs(target, payload, size, colorDark) {
    target.innerHTML = "";
    new QRCode(target, {
      text: payload,
      width: size,
      height: size,
      colorDark: resolveDark(colorDark),
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel ? QRCode.CorrectLevel.M : undefined
    });
    normalize(target);
    requestAnimationFrame(() => normalize(target));
  }

  async function render(target, payload, colorDark) {
    target.innerHTML = "";
    const size = Math.floor(Math.min(window.innerWidth || 720, window.innerHeight || 720) * 0.82);
    if (typeof window.makeQR === "function") {
      // makeQR reads window.IRLID_THEME_QR_FG itself (Batch 6.5d). If the caller passed
      // an explicit override, temporarily set the global so makeQR picks it up.
      const prev = window.IRLID_THEME_QR_FG;
      if (colorDark) window.IRLID_THEME_QR_FG = colorDark;
      try {
        await window.makeQR(target.id, payload, size);
      } finally {
        window.IRLID_THEME_QR_FG = prev;
      }
      normalize(target);
      return;
    }
    if (typeof window.QRCode === "function") {
      renderWithQrcodeJs(target, payload, Math.max(360, size), colorDark);
      return;
    }
    const img = document.createElement("img");
    img.alt = "QR";
    img.src = "https://api.qrserver.com/v1/create-qr-code/?ecc=L&margin=10&size=720x720&data=" + encodeURIComponent(payload);
    target.appendChild(img);
    normalize(target);
  }

  function setRefreshText(text) {
    const node = overlay && overlay.querySelector("[data-qr-refresh]");
    if (node) node.textContent = text || "";
  }

  function defaultRefreshText() {
    return "Last Refreshed: " + new Date().toLocaleTimeString("en-GB", { minute: "2-digit", second: "2-digit" });
  }

  function clearRefreshTimer() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  function nextMinuteDelay() {
    const now = new Date();
    return Math.max(1200, (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 1200);
  }

  function scheduleRefresh() {
    clearRefreshTimer();
    if (!active || !activeOptions || typeof activeOptions.refreshPayload !== "function") return;
    refreshTimer = setTimeout(refreshPayload, nextMinuteDelay());
  }

  async function refreshPayload() {
    if (!active || !activeOptions || typeof activeOptions.refreshPayload !== "function") return;
    try {
      const next = await activeOptions.refreshPayload(activeOptions);
      const payload = typeof next === "string" ? next : next && next.payload;
      if (payload) {
        activeOptions.payload = payload;
        await render(holder, payload, activeOptions && activeOptions.colorDark);
      }
      setRefreshText((next && next.lastRefreshedText) || defaultRefreshText());
    } catch {
      setRefreshText("Last Refreshed: retry pending");
    } finally {
      scheduleRefresh();
    }
  }

  async function openFromElement(el) {
    const payload = el.dataset.qrFullscreenPayload;
    if (!payload) return;
    await open({
      payload,
      title: el.dataset.qrFullscreenTitle || "IRLid QR",
      subtitle: el.dataset.qrFullscreenSubtitle || "Tap outside the QR or press Escape to close",
      logoUrl: el.dataset.qrFullscreenLogoUrl || "",
      logoAlt: el.dataset.qrFullscreenLogoAlt || el.dataset.qrFullscreenTitle || "IRLid logo",
      showTitle: el.dataset.qrFullscreenShowTitle !== "false"
    });
  }

  async function open(options) {
    const payload = options && options.payload;
    if (!payload) return;
    injectStyles();
    ensureOverlay();
    active = true;
    activeOptions = { ...options };
    const title = overlay.querySelector("[data-qr-title]");
    const logo = overlay.querySelector("[data-qr-logo]");
    const fallback = overlay.querySelector("[data-qr-fallback]");
    const logoUrl = (options.logoUrl || "").trim();
    if (logoUrl) {
      logo.src = logoUrl;
      logo.alt = options.logoAlt || options.title || "IRLid logo";
      logo.style.display = "block";
      fallback.style.display = "none";
      logo.onerror = () => {
        logo.style.display = "none";
        fallback.style.display = "flex";
      };
      title.textContent = options.showTitle === false ? "" : (options.title || "");
    } else {
      logo.removeAttribute("src");
      logo.style.display = "none";
      fallback.style.display = "flex";
      title.textContent = options.title || "IRLid QR";
    }
    overlay.querySelector("[data-qr-subtitle]").textContent = options.subtitle || "";
    setRefreshText(options.lastRefreshedText || (options.refreshPayload ? defaultRefreshText() : ""));
    overlay.classList.add("active");
    document.body.style.overflow = "hidden";
    if (options.browserFullscreen !== false && overlay.requestFullscreen && document.fullscreenElement !== overlay) {
      overlay.requestFullscreen().catch(() => {});
    }
    await render(holder, payload, options.colorDark);
    scheduleRefresh();
  }

  function close(exitFullscreen = true) {
    if (!overlay) return;
    closing = true;
    active = false;
    activeOptions = null;
    clearRefreshTimer();
    overlay.classList.remove("active");
    document.body.style.overflow = "";
    if (holder) holder.innerHTML = "";
    setRefreshText("");
    if (exitFullscreen && document.fullscreenElement === overlay && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
    setTimeout(() => { closing = false; }, 0);
  }

  function payloadElementFromEvent(event) {
    const target = event.target && event.target.closest ? event.target.closest(SELECTOR) : null;
    if (!target || target.dataset.qrFullscreenDisabled === "true") return null;
    return target;
  }

  document.addEventListener("pointerup", (event) => {
    const el = payloadElementFromEvent(event);
    if (!el) return;
    const now = Date.now();
    if (now - lastTapAt < 360) {
      event.preventDefault();
      openFromElement(el);
      lastTapAt = 0;
    } else {
      lastTapAt = now;
    }
  });

  document.addEventListener("dblclick", (event) => {
    const el = payloadElementFromEvent(event);
    if (!el) return;
    event.preventDefault();
    openFromElement(el);
  });

  window.IRLidQrFullscreen = { open, close, normalize };
})();
