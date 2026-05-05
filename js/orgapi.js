// IRLid organisation portal API client for the test Worker.
(function () {
  const DEFAULT_BASE_URL = "https://irlid-api-test.irlid-bunhead.workers.dev";

  function getBaseUrl() {
    return (window.IRLID_ORG_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  async function request(path, options) {
    const opts = options || {};
    const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    if (opts.orgKey) headers["X-Org-Key"] = opts.orgKey;
    // Batch C — Bearer session token for user-level endpoints (/user/*). The api_key
    // and the session token coexist during v5.5: api_key for org-scoped service ops,
    // Bearer for user-identity ops. Send whichever the caller has supplied.
    if (opts.sessionToken) headers["Authorization"] = "Bearer " + opts.sessionToken;

    const response = await fetch(getBaseUrl() + path, {
      method: opts.method || "GET",
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });

    let data = null;
    try { data = await response.json(); } catch {}

    if (!response.ok) {
      const message = data && data.error ? data.error : `Request failed with status ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  }

  // Public helper — exposes the resolved Worker base URL so callers can encode it
  // into the login QR (the phone POSTs back to it) and rendering paths can
  // distinguish prod vs test endpoints without hardcoding.
  function publicBaseUrl() { return getBaseUrl(); }

  window.IRLidOrgApi = {
    // PROTOCOL.md §14 — Identity-bound sessions (Batch B).
    loginInit() {
      return request("/org/login/init", { method: "POST" });
    },
    loginPoll(nonce) {
      return request("/org/login/poll?nonce=" + encodeURIComponent(nonce));
    },
    workerBaseUrl() { return publicBaseUrl(); },

    // PROTOCOL.md §14 — Batch C user-level endpoints, Bearer session token auth.
    listMyOrgs(sessionToken) {
      return request("/user/orgs", { sessionToken });
    },
    createOrg(sessionToken, payload) {
      return request("/user/create-org", {
        method: "POST",
        sessionToken,
        body: payload
      });
    },

    registerOrganisation(name) {
      return request("/org/register", {
        method: "POST",
        body: { name }
      });
    },

    listAttendance(orgKey) {
      return request("/org/attendance", {
        orgKey
      });
    },

    // Batch C polish 9 — accepts an optional sessionToken so the Worker can
    // identify Developer / Lead Admin users authorised to clear non-DEV orgs.
    // Existing DEV-key callers keep working without the token (worker's
    // isDebugOrg path).
    clearTestAttendance(orgKey, includeExpected, sessionToken) {
      return request("/org/debug/clear-attendance", {
        method: "POST",
        orgKey,
        sessionToken,
        body: { include_expected: !!includeExpected }
      });
    },

    createCheckin(orgKey, body, sessionToken) {
      return request("/org/checkin", {
        method: "POST",
        orgKey,
        body,
        sessionToken
      });
    },

    authenticateStaff(orgKey, hello) {
      return request("/org/staff/auth", {
        method: "POST",
        orgKey,
        body: { hello }
      });
    },

    checkout(orgKey, body) {
      return request("/org/checkout", {
        method: "POST",
        orgKey,
        body
      });
    },

    checkoutLegacy(orgKey, body) {
      return request("/org/checkout?checkout_method=legacy", {
        method: "POST",
        orgKey,
        body
      });
    },

    createCheckoutToken(orgKey, checkinId) {
      return request("/org/checkout-token", {
        method: "POST",
        orgKey,
        body: { checkin_id: checkinId }
      });
    },

    resolveCheckoutToken(token) {
      return request(`/org/checkout-token/${encodeURIComponent(token)}`);
    },

    recognize(orgKey, devicePub) {
      return request(`/org/recognize?org=${encodeURIComponent(orgKey)}&device_pub=${encodeURIComponent(devicePub)}`);
    },

    listExpected(orgKey) {
      return request("/org/expected", {
        orgKey
      });
    },

    createExpected(orgKey, body, sessionToken) {
      return request("/org/expected", {
        method: "POST",
        orgKey,
        body,
        sessionToken
      });
    },

    deleteExpected(orgKey, id, sessionToken) {
      return request(`/org/expected/${encodeURIComponent(id)}`, {
        method: "DELETE",
        orgKey,
        sessionToken
      });
    },

    updateExpected(orgKey, id, body) {
      return request(`/org/expected/${encodeURIComponent(id)}`, {
        method: "PATCH",
        orgKey,
        body
      });
    },

    rebindExpected(orgKey, id, body) {
      return request(`/org/expected/${encodeURIComponent(id)}/rebind`, {
        method: "POST",
        orgKey,
        body
      });
    },

    bindAdditionalKey(orgKey, id, body, sessionToken) {
      return request(`/org/expected/${encodeURIComponent(id)}/bind-additional-key`, {
        method: "POST",
        orgKey,
        body,
        sessionToken
      });
    },

    createAndBindExpected(orgKey, body, sessionToken) {
      return request("/org/expected/create-and-bind", {
        method: "POST",
        orgKey,
        body,
        sessionToken
      });
    },

    claimExpected(orgKey, id, devicePubFp) {
      return request(`/org/expected/${encodeURIComponent(id)}/claim`, {
        method: "POST",
        orgKey,
        body: { device_pub_fp: devicePubFp }
      });
    },

    resolveConflict(orgKey, id, resolution) {
      return request(`/org/conflicts/${encodeURIComponent(id)}/resolve`, {
        method: "POST",
        orgKey,
        body: { resolution }
      });
    },

    // --- Settings persistence (Batch 6.5, 3 May 2026) ---
    // Read the org-level settings_json from the Worker. Used by the OrgCheckin
    // Settings panel on open to load the saved state (theme, palette, branding,
    // policy toggles). Returns { id, name, slug, settings }.
    getOrgSettings(orgKey) {
      return request("/org/settings", {
        orgKey
      });
    },

    // Persist a partial settings update server-side. Body keys outside the
    // Worker's allowlist are silently dropped; theme is validated server-side
    // (hex shape, contrast against white, palette length cap). Returns
    // { settings } with the merged current state on success.
    updateOrgSettings(orgKey, partial) {
      return request("/org/settings", {
        method: "POST",
        orgKey,
        body: partial
      });
    }
  };
})();
