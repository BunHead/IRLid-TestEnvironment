// Copyright 2025 Spencer Austin. All rights reserved.
// Licensed under Apache 2.0 with Commons Clause. See LICENSE.
// /js/qr.js — Deploy 63
// Robust QR rendering for GitHub Pages:
// - Tries to load QR library from multiple CDNs (no local qrcode.min.js required)
// - Uses QRCode.toCanvas when available
// - Falls back to remote PNG QR image if library is unavailable or render fails
// - Renders crisp on HiDPI to avoid “vibrate but no link” decode failures
//
// Exposes:
//   window.makeQR(elId, data, sizePx)
//   window.scanQR(targetElId)  (unchanged; requires Html5Qrcode elsewhere)

(function () {
  "use strict";

  function elById(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error("qr.js: element not found: " + id);
    return el;
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = url;
      s.async = true;
      s.onload = () => resolve(url);
      s.onerror = () => reject(new Error("Failed to load: " + url));
      document.head.appendChild(s);
    });
  }

  async function ensureQrLib() {
    if (window.QRCode && typeof window.QRCode.toCanvas === "function") return true;

    const cdns = [
      "https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js",
      "https://unpkg.com/qrcode@1.5.3/build/qrcode.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/qrcode/1.5.3/qrcode.min.js"
    ];

    for (const url of cdns) {
      try {
        await loadScript(url);
        if (window.QRCode && typeof window.QRCode.toCanvas === "function") return true;
      } catch (_) {
        // try next
      }
    }
    return false;
  }

  function makeRemoteImg(data, sizeCssPx) {
    // Keep your original remote fallback idea, but make it bigger and with margin.
    // NOTE: If your network blocks this domain, we still attempt it as a last resort.
    const px = Math.max(240, Math.floor(sizeCssPx));
    const url =
      "https://api.qrserver.com/v1/create-qr-code/" +
      "?ecc=L&margin=10&size=" + px + "x" + px +
      "&data=" + encodeURIComponent(String(data));

    const img = document.createElement("img");
    img.alt = "QR";
    img.src = url;
    img.style.width = px + "px";
    img.style.height = px + "px";
    img.style.maxWidth = "100%";
    img.style.height = "auto";
    img.style.imageRendering = "pixelated";
    img.decoding = "async";
    img.loading = "eager";
    return img;
  }

  function clampQrCssSize(requestedCssPx) {
    const req = Math.max(180, Math.floor(Number(requestedCssPx) || 0));
    // Keep a safe margin for padding and avoid overlapping UI on mobile.
    const vw = Math.max(320, (window.innerWidth || 360));
    const vh = Math.max(480, (window.innerHeight || 640));

    // Conservative clamp: fit within viewport width, and also not exceed ~55% of height.
    const maxByW = Math.max(180, vw - 64);
    const maxByH = Math.max(180, Math.floor(vh * 0.55));
    const max = Math.min(maxByW, maxByH, 520);
    return Math.max(180, Math.min(req, max));
  }

  function makeCanvasHiDpi(sizeCssPx) {
    // IMPORTANT: Keep HiDPI crispness but clamp CSS display size to viewport.
    const css = clampQrCssSize(sizeCssPx);
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const px = Math.floor(css * dpr);

    const canvas = document.createElement("canvas");
    canvas.width = px;
    canvas.height = px;

    canvas.style.width = css + "px";
    canvas.style.height = css + "px";
    canvas.style.imageRendering = "pixelated";
    canvas.style.display = "block";
    canvas.style.margin = "0 auto";

    return { canvas, css, px, dpr };
  }

  window.makeQR = async function makeQR(elId, data, size = 320) {
    const el = elById(elId);
    clear(el);
    el.dataset.qrFullscreenPayload = String(data);
    if (!el.dataset.qrFullscreenTitle) el.dataset.qrFullscreenTitle = "IRLid QR";
    if (!el.dataset.qrFullscreenSubtitle) el.dataset.qrFullscreenSubtitle = "Double-tap to view fullscreen";

    // Fit on screen: prefer clamping rather than forcing horizontal scroll.
    el.style.overflowX = "hidden";
    el.style.maxWidth = "100%";

    const ok = await ensureQrLib();

    if (ok && window.QRCode && typeof window.QRCode.toCanvas === "function") {
      const { canvas, px, css } = makeCanvasHiDpi(size);

      // Lowest density + generous quiet zone
      const opts = {
        errorCorrectionLevel: "L",
        margin: 10,
        width: px,
        color: { dark: "#000000", light: "#ffffff" }
      };

      try {
        window.QRCode.toCanvas(canvas, String(data), opts, (err) => {
          if (err) {
            clear(el);
            el.appendChild(makeRemoteImg(data, size));
            return;
          }
          // Ensure the canvas display size stays clamped (some browsers can mutate styles).
          canvas.style.width = css + "px";
          canvas.style.height = css + "px";
          canvas.style.maxWidth = "100%";
          el.appendChild(canvas);
        });
        return;
      } catch (_) {
        // fall through to remote
      }
    }

    // Final fallback
    el.appendChild(makeRemoteImg(data, clampQrCssSize(size)));
  };

  // Keep existing scan helper (unchanged)
  window.scanQR = function scanQR(targetElId) {
    return new Promise((resolve, reject) => {
      if (typeof Html5Qrcode === "undefined") {
        reject(new Error("Html5Qrcode not loaded."));
        return;
      }

      const qr = new Html5Qrcode(targetElId);

      qr.start(
        { facingMode: "environment" },
        {
          fps: 12,
          qrbox: { width: 320, height: 320 },
          disableFlip: false,
          videoConstraints: {
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 }
          }
        },
        async (text) => {
          try { await qr.stop(); } catch {}
          try { await qr.clear(); } catch {}
          resolve(text);
        },
        () => {}
      ).catch(err => reject(err));
    });
  };
})();
