// Copyright 2025 Spencer Austin. All rights reserved.
// Licensed under Apache 2.0 with Commons Clause. See LICENSE.
// /js/backend.js — Deploy 115
// API client for IRLid backend (Cloudflare Workers + D1).

(function () {
  "use strict";

  var BACKEND_URL =
    window.IRLID_BACKEND_URL ||
    "https://irlid-api-test.irlid-bunhead.workers.dev";
  var LS_TOKEN = "irlid_session_token";
  var LS_USER_ID = "irlid_user_id";
  var LS_DISPLAY_NAME = "irlid_display_name";

  function getToken() {
    try { return localStorage.getItem(LS_TOKEN) || null; } catch { return null; }
  }

  function setToken(t) {
    try {
      if (t) localStorage.setItem(LS_TOKEN, t);
      else localStorage.removeItem(LS_TOKEN);
    } catch {}
  }

  function setUserInfo(userId, displayName) {
    try {
      if (userId) localStorage.setItem(LS_USER_ID, userId);
      else localStorage.removeItem(LS_USER_ID);
      if (displayName) localStorage.setItem(LS_DISPLAY_NAME, displayName);
      else localStorage.removeItem(LS_DISPLAY_NAME);
    } catch {}
  }

  async function api(method, path, body) {
    var headers = { "Content-Type": "application/json" };
    var token = getToken();
    if (token) headers["Authorization"] = "Bearer " + token;

    try {
      var opts = { method: method, headers: headers };
      if (body && method !== "GET") opts.body = JSON.stringify(body);
      var resp = await fetch(BACKEND_URL + path, opts);
      var data = await resp.json();
      if (!resp.ok) return { ok: false, status: resp.status, error: data.error || resp.statusText, data: data };
      return { ok: true, status: resp.status, data: data };
    } catch (e) {
      return { ok: false, error: "network", message: String(e), data: null };
    }
  }

  window.IRLBackend = {

    hasSession: function () { return !!getToken(); },

    getDisplayName: function () {
      try { return localStorage.getItem(LS_DISPLAY_NAME) || null; } catch { return null; }
    },

    // ===== Auth =====

    register: async function (displayName) {
      if (typeof getPublicJwk !== "function") return { ok: false, error: "sign.js not loaded" };
      var pub = await getPublicJwk();
      var result = await api("POST", "/auth/register", { display_name: displayName || null, pub_jwk: pub });
      if (result.ok && result.data && result.data.session_token) {
        setToken(result.data.session_token);
        setUserInfo(result.data.user_id, displayName || null);
      }
      return result;
    },

    googleLogin: async function (idToken, pubJwk) {
      var result = await api("POST", "/auth/google", { id_token: idToken, pub_jwk: pubJwk || null });
      if (result.ok && result.data && result.data.session_token) {
        setToken(result.data.session_token);
        setUserInfo(result.data.user_id, result.data.display_name || null);
      }
      return result;
    },

    me: async function () {
      var result = await api("GET", "/auth/me");
      if (result.ok && result.data) {
        if (result.data.logged_in && result.data.user) {
          setUserInfo(result.data.user.id, result.data.user.display_name);
        }
        if (!result.data.logged_in) { setToken(null); setUserInfo(null, null); }
      }
      return result;
    },

    logout: async function () {
      await api("POST", "/auth/logout");
      setToken(null);
      setUserInfo(null, null);
    },

    // ===== Profile =====

    updateProfile: async function (fields) {
      if (!getToken()) return { ok: false, error: "not_logged_in" };
      var result = await api("POST", "/auth/profile", fields);
      if (result.ok && fields.display_name) {
        try { localStorage.setItem(LS_DISPLAY_NAME, fields.display_name); } catch {}
      }
      return result;
    },

    // ===== Device linking =====

    createLinkCode: async function () {
      if (!getToken()) return { ok: false, error: "not_logged_in" };
      return await api("POST", "/auth/link/create");
    },

    claimLinkCode: async function (code, pubJwk) {
      if (!pubJwk && typeof getPublicJwk === "function") pubJwk = await getPublicJwk();
      if (!pubJwk) return { ok: false, error: "No public key available" };
      var result = await api("POST", "/auth/link/claim", { code: code, pub_jwk: pubJwk });
      if (result.ok && result.data && result.data.session_token) {
        setToken(result.data.session_token);
        setUserInfo(result.data.user_id, result.data.display_name || null);
      }
      return result;
    },

    // ===== Device management =====

    renameDevice: async function (deviceId, label) {
      if (!getToken()) return { ok: false, error: "not_logged_in" };
      return await api("POST", "/auth/device/rename", { device_id: deviceId, label: label });
    },

    revokeDevice: async function (deviceId) {
      if (!getToken()) return { ok: false, error: "not_logged_in" };
      return await api("POST", "/auth/device/revoke", { device_id: deviceId });
    },

    // ===== Receipts =====

    uploadReceipt: async function (combinedObj) {
      // No login required — anonymous uploads are allowed (uploader_id stored as null)
      return await api("POST", "/receipts", { combined: combinedObj });
    },

    listReceipts: async function (page) {
      if (!getToken()) return { ok: false, error: "not_logged_in" };
      return await api("GET", "/receipts?page=" + (page || 1));
    },

    getReceipt: async function (hash) {
      return await api("GET", "/receipts/" + encodeURIComponent(hash));
    },

    // ===== User Lookup =====

    lookupByKey: async function (pubKeyId) {
      return await api("GET", "/users/by-key/" + encodeURIComponent(pubKeyId));
    }
  };
})();
