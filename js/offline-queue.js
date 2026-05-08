// IRLid offline write queue - Tier 2 of PROTOCOL.md section 16.
// Stores pending Worker writes in IndexedDB while offline; replays them
// in order when connectivity returns. Pure client-side; zero Worker
// dependency. The Worker accepts duplicate writes per spec section 16.3.
(function () {
  const DB_NAME = "irlid-offline";
  const DB_VERSION = 1;
  const STORE = "pending_ops";

  let dbPromise = null;
  let replaying = false;

  function randomId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return String(Date.now()) + "-" + Math.random().toString(36).slice(2);
  }

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (ev) => {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
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

  async function enqueue(op) {
    const target = await store("readwrite");
    const idempotencyKey = op.idempotency_key || randomId();
    const queuedAt = Date.now();
    const record = Object.assign({}, op, {
      queued_at: queuedAt,
      idempotency_key: idempotencyKey
    });
    return new Promise((resolve, reject) => {
      const req = target.add(record);
      req.onsuccess = () => resolve({
        id: req.result,
        idempotency_key: idempotencyKey,
        queued_at: queuedAt
      });
      req.onerror = () => reject(req.error);
    });
  }

  async function listAll() {
    const target = await store("readonly");
    return new Promise((resolve, reject) => {
      const req = target.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function remove(id) {
    const target = await store("readwrite");
    return new Promise((resolve, reject) => {
      const req = target.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function count() {
    const target = await store("readonly");
    return new Promise((resolve, reject) => {
      const req = target.count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => reject(req.error);
    });
  }

  function notifyQueueChanged() {
    window.dispatchEvent(new CustomEvent("irlid:queue-changed"));
  }

  // Replay drains the queue in insertion order. Each op is fired against
  // the Worker; on 2xx the op is removed; on non-2xx it stays queued and
  // replay halts (subsequent ops may depend on this one - e.g. checkin
  // before checkout).
  async function replay() {
    if (replaying) return { halted: false, drained: 0 };
    replaying = true;
    let drained = 0;
    let halted = false;
    try {
      const ops = await listAll();
      for (const op of ops) {
        try {
          const response = await fetch(op.url, {
            method: op.method,
            headers: op.headers,
            body: op.body
          });
          if (!response.ok) {
            console.warn("[offline-queue] replay HTTP", response.status, op.url);
            halted = true;
            break;
          }
          await remove(op.id);
          drained += 1;
          notifyQueueChanged();
        } catch (err) {
          console.warn("[offline-queue] replay network error", err);
          halted = true;
          break;
        }
      }
    } finally {
      replaying = false;
    }
    return { halted, drained };
  }

  window.IRLidOfflineQueue = { enqueue, listAll, remove, count, replay };

  // Replay opportunistically when connectivity returns or page becomes
  // visible. Background Sync API is a later Tier 2 extension; this covers
  // same-tab reconnects and next page load.
  window.addEventListener("online", () => { replay(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && navigator.onLine) replay();
  });
  if (navigator.onLine) {
    setTimeout(() => replay(), 1500);
  }
})();
