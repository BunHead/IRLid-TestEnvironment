// IRLid offline org snapshot - Tier 3 of PROTOCOL.md section 16.
// Caches the active org's full read-side state in IndexedDB so offline
// reads serve from snapshot instead of failing.
(function () {
  const DB_NAME = "irlid-offline-snapshot";
  const DB_VERSION = 1;
  const STORE = "org_snapshots";

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (ev) => {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "org_code" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function store(mode) {
    const db = await openDB();
    return db.transaction(STORE, mode).objectStore(STORE);
  }

  async function save(orgCode, data) {
    if (!orgCode) throw new Error("save: org_code required");
    const target = await store("readwrite");
    const record = {
      org_code: orgCode,
      synced_at: Date.now(),
      expected: data.expected || [],
      attendance: data.attendance || [],
      attendance_stats: data.attendance_stats || null,
      settings: data.settings || null,
      theme: data.theme || null
    };
    return new Promise((resolve, reject) => {
      const req = target.put(record);
      req.onsuccess = () => resolve(record);
      req.onerror = () => reject(req.error);
    });
  }

  async function load(orgCode) {
    if (!orgCode) return null;
    const target = await store("readonly");
    return new Promise((resolve, reject) => {
      const req = target.get(orgCode);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function listOrgs() {
    const target = await store("readonly");
    return new Promise((resolve, reject) => {
      const req = target.getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function clear(orgCode) {
    const target = await store("readwrite");
    return new Promise((resolve, reject) => {
      const req = target.delete(orgCode);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  function rowHasDeviceFp(row, fp) {
    const value = String(fp || "").trim();
    if (!value || !row) return false;
    const fps = Array.isArray(row.device_key_fps) ? row.device_key_fps : [];
    return row.device_key_fp === value || fps.includes(value);
  }

  async function findExpectedByDeviceFp(orgCode, fp) {
    const snap = await load(orgCode);
    if (!snap || !Array.isArray(snap.expected)) return null;
    return snap.expected.find(row => rowHasDeviceFp(row, fp)) || null;
  }

  window.IRLidOfflineSnapshot = {
    save,
    load,
    listOrgs,
    clear,
    findExpectedByDeviceFp,
    rowHasDeviceFp
  };
})();
