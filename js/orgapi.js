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

  window.IRLidOrgApi = {
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

    createCheckin(orgKey, body) {
      return request("/org/checkin", {
        method: "POST",
        orgKey,
        body
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

    recognize(orgKey, devicePub) {
      return request(`/org/recognize?org=${encodeURIComponent(orgKey)}&device_pub=${encodeURIComponent(devicePub)}`);
    },

    listExpected(orgKey) {
      return request("/org/expected", {
        orgKey
      });
    },

    createExpected(orgKey, body) {
      return request("/org/expected", {
        method: "POST",
        orgKey,
        body
      });
    },

    deleteExpected(orgKey, id) {
      return request(`/org/expected/${encodeURIComponent(id)}`, {
        method: "DELETE",
        orgKey
      });
    },

    updateExpected(orgKey, id, body) {
      return request(`/org/expected/${encodeURIComponent(id)}`, {
        method: "PATCH",
        orgKey,
        body
      });
    },

    resolveConflict(orgKey, id, resolution) {
      return request(`/org/conflicts/${encodeURIComponent(id)}/resolve`, {
        method: "POST",
        orgKey,
        body: { resolution }
      });
    }
  };
})();
