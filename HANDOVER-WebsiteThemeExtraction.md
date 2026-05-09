# HANDOVER — `v5.5.8` Website Theme Extraction (Batch D)

**Drafted:** 9 May 2026 afternoon, by Number One.
**Target agent:** Mr. Data (Codex).
**Repo scope:** `BunHead/IRLid-TestEnvironment` only. Live-repo deploy is a later step (v5.9 port chapter).
**Priority:** Substantial chapter — likely a one-day-ish [L] PR. Spec is mature (`PROTOCOL.md §14.16`), so most decisions are pre-made.

---

## Context (read this first)

When a lead_admin or developer creates an organisation via `/user/create-org` and supplies a `website_url`, IRLid offers to auto-extract the venue's existing branding (logo + theme colour) so their IRLid surfaces match without manual color-picker fiddling. Two-stage extraction:

- **Stage 1 (Worker, server-side):** scrape the website's HTML for `<meta theme-color>`, favicon links, `og:image`, `<title>`. Returns logo candidates + suggested theme colour.
- **Stage 2 (browser, client-side):** load the highest-resolution logo into a hidden `<canvas>`, sample ~256 pixels, return the dominant non-background colour.

UI then presents two colour candidates per scraped site (`theme_color` from `<meta>` + canvas-derived `dominant_logo_color`) with "Use this" buttons; user picks (or stays with IRLid defaults).

**Read these sections of `PROTOCOL.md` BEFORE touching code:**

- **§14.16 entire section** — the canonical spec. All endpoint shapes, fetch settings, caveats, threat model deltas, storage shape are spelled out.
- **§14.13 reference implementation phasing** — the original Batch D framing.
- **§XI.11, §XI.12** — threat model deltas for SSRF and tracking pixel concerns.
- **PROTOCOL.md §1.1 Version History** — for v5.5 context.

---

## Goal

Implement the four pieces of §14.16 end-to-end on the test environment:

1. **Worker scrape endpoint** at `POST /user/orgs/:org_id/scrape-theme` using Cloudflare `HTMLRewriter`.
2. **Worker image proxy** at `GET /util/image-proxy?url=...` with SSRF protection, allowing the client-side canvas sampler to load logos that don't set CORS headers.
3. **Client-side canvas pixel sampler** that picks a logo, loads it into hidden `<canvas>`, returns dominant non-background colour as `#RRGGBB`.
4. **UI surface** in the org-create / settings flow: input field for `website_url`, "Extract theme" button, results card showing both colour candidates + logo candidates with "Use this" buttons that wire into the existing theme `primary` / `accent` / `logoUrl` fields.

---

## Files to modify

### `IRLid-TestEnvironment/irlid-api/src/index.js`

#### 1. New POST endpoint — `/user/orgs/:org_id/scrape-theme`

Auth: caller must be lead_admin or developer for `org_id` (use existing Bearer session validation pattern; reject with `403 {error: "tier_insufficient", required: "lead_admin"}` otherwise).

Body: `{}` — `org_id` is in path; `website_url` already lives in `org.settings_json.website_url` (added during org create).

Logic:

```javascript
async function userOrgsScrapeTheme(request, env, orgId) {
  // 1. Auth (Bearer + lead_admin/developer membership check)
  // 2. Load org by id, extract settings_json.website_url
  if (!websiteUrl) return json({ error: "no_website_url" }, 404);

  // 3. Check 24h cache in settings_json.theme_scrape — return cached if fresh
  if (cached && (Date.now() - cached.scraped_at) < 24 * 60 * 60 * 1000) {
    return json({ ...cached, from_cache: true }, 200);
  }

  // 4. Fetch website with HTMLRewriter
  const result = { logo_candidates: [], theme_color: null, title: null, scraped_at: Date.now() };
  try {
    const response = await fetch(websiteUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; IRLid-themescrape/1.0; +https://irlid.co.uk/)" },
      signal: AbortSignal.timeout(5000),
      redirect: "follow",  // max 3 hops — Cloudflare's default cap
    });
    if (!response.ok) return json({ error: "site_unreachable" }, 502);

    const baseUrl = new URL(response.url);  // post-redirect URL for resolving relatives

    const rewriter = new HTMLRewriter()
      .on('meta[name="theme-color"]', {
        element(el) { result.theme_color = el.getAttribute("content"); }
      })
      .on('link[rel="icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]', {
        element(el) {
          const href = el.getAttribute("href");
          const rel = el.getAttribute("rel");
          if (href) {
            result.logo_candidates.push({
              href: new URL(href, baseUrl).toString(),
              rel,
              type: rel
            });
          }
        }
      })
      .on('meta[property="og:image"]', {
        element(el) {
          const href = el.getAttribute("content");
          if (href) {
            result.logo_candidates.push({
              href: new URL(href, baseUrl).toString(),
              rel: "og:image",
              type: "og:image"
            });
          }
        }
      })
      .on('title', {
        text(t) { result.title = (result.title || '') + t.text; }
      });

    await rewriter.transform(response).text();  // consume to drive HTMLRewriter
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") return json({ error: "site_timeout" }, 504);
    return json({ error: "scrape_failed", detail: String(err.message || err) }, 502);
  }

  result.title = (result.title || '').trim().slice(0, 200);

  // 5. Cache in settings_json.theme_scrape (24h TTL)
  await env.DB.prepare(
    "UPDATE organisations SET settings_json = json_set(settings_json, '$.theme_scrape', ?), updated_at=? WHERE id=?"
  ).bind(JSON.stringify(result), Date.now(), orgId).run();

  return json(result, 200);
}
```

**Error codes per spec:** `404 no_website_url`, `502 site_unreachable / scrape_failed`, `504 site_timeout`.

#### 2. New GET endpoint — `/util/image-proxy?url=<encoded_https_url>`

No auth required (rate-limited per-IP via Cloudflare's standard rate limiting; no extra logic needed in Worker).

```javascript
async function utilImageProxy(request, env) {
  const url = new URL(request.url);
  const target = url.searchParams.get("url");
  if (!target) return new Response("missing url", { status: 400 });

  // SSRF defence per §XI.11 — strict allowlist
  const SSRF_BLOCK_REGEX = /^https?:\/\/(localhost|127\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.|169\.254\.|0\.|::1|fe80:|fc00:|fd[0-9a-f]{2}:)/i;
  const ALLOW_REGEX = /^https?:\/\/[a-z0-9-.]+\.[a-z]{2,}\//i;
  if (!ALLOW_REGEX.test(target) || SSRF_BLOCK_REGEX.test(target)) {
    return new Response("forbidden_url", { status: 403 });
  }

  let response;
  try {
    response = await fetch(target, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; IRLid-themescrape/1.0; +https://irlid.co.uk/)" },
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    return new Response("fetch_failed", { status: 502 });
  }
  if (!response.ok) return new Response("upstream_error", { status: 502 });

  // Image content-type only
  const ct = (response.headers.get("content-type") || "").toLowerCase();
  if (!ct.startsWith("image/")) return new Response("not_image", { status: 415 });

  // 2 MB cap
  const cl = parseInt(response.headers.get("content-length") || "0", 10);
  if (cl > 2 * 1024 * 1024) return new Response("too_large", { status: 413 });

  // Return with permissive CORS + cache headers
  const body = await response.arrayBuffer();
  if (body.byteLength > 2 * 1024 * 1024) return new Response("too_large", { status: 413 });

  return new Response(body, {
    headers: {
      "Content-Type": ct,
      "Access-Control-Allow-Origin": "https://bunhead.github.io",  // or env.CORS_ORIGIN
      "Cache-Control": "public, max-age=86400",
    }
  });
}
```

#### 3. Route table additions

In the `fetch()` handler dispatch (around line ~2350):

```javascript
else if (method === "POST" && (m = path.match(/^\/user\/orgs\/(\d+)\/scrape-theme$/))) {
  response = await userOrgsScrapeTheme(request, env, Number(m[1]));
}
else if (method === "GET" && path === "/util/image-proxy") {
  response = await utilImageProxy(request, env);
}
```

#### 4. Optional: schema column

Per spec, EITHER `ALTER TABLE organisations ADD COLUMN theme_scrape_json TEXT;` OR store inside existing `settings_json.theme_scrape`. **Pick the latter — no migration needed, simpler.** The endpoint above already uses `json_set(settings_json, '$.theme_scrape', ...)`.

### `IRLid-TestEnvironment/OrgCheckin.html`

#### 1. New "Extract theme from website" UI

Place in the Settings → Branding section near the existing `Logo image URL` / `website_url` input. Two parts:

**(a) The trigger:**

```html
<div class="theme-scrape-row">
  <label for="websiteUrlInput">Website URL</label>
  <input type="url" id="websiteUrlInput" placeholder="https://example.com" />
  <button type="button" class="btn btn-secondary" id="extractThemeBtn">Extract theme from website</button>
  <div class="theme-scrape-status" id="themeScrapeStatus"></div>
</div>
```

**(b) The results card (revealed after scrape returns):**

```html
<div class="theme-scrape-results" id="themeScrapeResults" hidden>
  <h4>Suggested theme</h4>
  <p>From <strong id="scrapeResultTitle"></strong> at <span id="scrapeResultUrl"></span></p>

  <div class="scrape-colour-options">
    <div class="scrape-colour-card" data-source="meta">
      <div class="scrape-swatch" id="scrapeMetaSwatch"></div>
      <div class="scrape-label">Site theme-color (<code id="scrapeMetaHex"></code>)</div>
      <button type="button" class="btn btn-sm" data-apply-colour="meta">Use this colour</button>
    </div>
    <div class="scrape-colour-card" data-source="logo">
      <div class="scrape-swatch" id="scrapeLogoSwatch"></div>
      <div class="scrape-label">Dominant logo colour (<code id="scrapeLogoHex"></code>)</div>
      <button type="button" class="btn btn-sm" data-apply-colour="logo">Use this colour</button>
    </div>
  </div>

  <div class="scrape-logo-options">
    <h5>Logo candidates</h5>
    <div id="scrapeLogoList"></div>
  </div>
</div>

<canvas id="themeScrapeCanvas" hidden></canvas>
```

#### 2. Client-side scrape + sampler logic

```javascript
async function extractThemeFromWebsite() {
  const urlInput = document.getElementById('websiteUrlInput');
  const websiteUrl = (urlInput?.value || '').trim();
  if (!websiteUrl) { setThemeScrapeStatus('Enter a website URL first.', 'error'); return; }

  setThemeScrapeStatus('Scraping site...', 'info');
  try {
    // Persist website_url into settings first (so Worker can read it)
    await IRLidOrgApi.updateOrgSettings(currentOrg.api_key, { website_url: websiteUrl });

    // Stage 1 — Worker scrape
    const r = await fetch(getOrgApiBase() + `/user/orgs/${currentOrg.id}/scrape-theme`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (qrLoginSession?.session_token || ''),
      },
      body: JSON.stringify({}),
    });
    const data = await r.json();
    if (!r.ok) {
      setThemeScrapeStatus(scrapeErrorMessage(r.status, data), 'error');
      return;
    }

    // Stage 2 — client-side canvas pixel sample
    let dominantColor = null;
    if (data.logo_candidates && data.logo_candidates.length) {
      // Highest-priority candidate first
      const ordered = orderLogoCandidatesByPriority(data.logo_candidates);
      for (const candidate of ordered) {
        try {
          dominantColor = await sampleDominantColourFromImage(candidate.href);
          if (dominantColor) break;
        } catch (e) { /* try next candidate */ }
      }
    }

    renderThemeScrapeResults({
      ...data,
      dominant_logo_color: dominantColor,
      website_url: websiteUrl,
    });
    setThemeScrapeStatus('Done.', 'ok');
  } catch (err) {
    setThemeScrapeStatus('Extraction failed: ' + (err.message || 'unknown'), 'error');
  }
}

function orderLogoCandidatesByPriority(candidates) {
  // apple-touch-icon-precomposed > apple-touch-icon > og:image > favicon
  const priority = {
    'apple-touch-icon-precomposed': 1,
    'apple-touch-icon': 2,
    'og:image': 3,
    'icon': 4,
  };
  return candidates.slice().sort((a, b) =>
    (priority[a.type] || 5) - (priority[b.type] || 5)
  );
}

async function sampleDominantColourFromImage(imageUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    let triedProxy = false;
    img.onload = () => {
      try {
        const canvas = document.getElementById('themeScrapeCanvas');
        const ctx = canvas.getContext('2d');
        const size = 64; // sample 64x64 = 4096 pixels, plenty
        canvas.width = size; canvas.height = size;
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        resolve(pickDominantNonBackgroundColour(data));
      } catch (err) {
        reject(err); // CORS taint or canvas error
      }
    };
    img.onerror = () => {
      if (!triedProxy) {
        triedProxy = true;
        img.src = getOrgApiBase() + '/util/image-proxy?url=' + encodeURIComponent(imageUrl);
      } else {
        reject(new Error('image_load_failed'));
      }
    };
    img.src = imageUrl;
  });
}

function pickDominantNonBackgroundColour(rgba) {
  // Bin pixels into 12-bucket HSL hue×saturation×lightness space.
  // Score = saturation × frequency. Returns hex of winning bucket centre.
  const buckets = new Map();
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i], g = rgba[i+1], b = rgba[i+2], a = rgba[i+3];
    if (a < 128) continue; // skip transparent pixels
    const [h, s, l] = rgbToHsl(r, g, b);
    if (l < 0.05 || l > 0.95) continue; // skip near-black and near-white
    if (s < 0.15) continue; // skip greys
    const bucketKey = `${Math.round(h*12)}_${Math.round(s*4)}_${Math.round(l*4)}`;
    const cur = buckets.get(bucketKey) || { count: 0, r: 0, g: 0, b: 0, sat: s };
    cur.count++; cur.r += r; cur.g += g; cur.b += b;
    buckets.set(bucketKey, cur);
  }
  let best = null, bestScore = 0;
  for (const v of buckets.values()) {
    const score = v.sat * v.count;
    if (score > bestScore) { bestScore = score; best = v; }
  }
  if (!best) return null;
  const r = Math.round(best.r / best.count);
  const g = Math.round(best.g / best.count);
  const b = Math.round(best.b / best.count);
  return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = ((b - r) / d + 2); break;
      case b: h = ((r - g) / d + 4); break;
    }
    h /= 6;
  }
  return [h, s, l];
}

function scrapeErrorMessage(status, data) {
  switch (status) {
    case 404: return 'No website URL stored on this org. Save settings first.';
    case 502: return 'Could not reach the website. Check the URL and try again.';
    case 504: return 'Website took too long to respond. Try again or use a faster site.';
    case 403: return 'Only Lead Admin or Developer can extract themes.';
    default: return data?.error || 'Extraction failed.';
  }
}
```

#### 3. Wire up the "Use this" buttons

```javascript
function renderThemeScrapeResults(scrape) {
  const card = document.getElementById('themeScrapeResults');
  document.getElementById('scrapeResultTitle').textContent = scrape.title || '(no title)';
  document.getElementById('scrapeResultUrl').textContent = scrape.website_url;

  if (scrape.theme_color) {
    document.getElementById('scrapeMetaSwatch').style.background = scrape.theme_color;
    document.getElementById('scrapeMetaHex').textContent = scrape.theme_color;
  }
  if (scrape.dominant_logo_color) {
    document.getElementById('scrapeLogoSwatch').style.background = scrape.dominant_logo_color;
    document.getElementById('scrapeLogoHex').textContent = scrape.dominant_logo_color;
  }

  // Logo candidate list with "Use as logo" buttons
  const list = document.getElementById('scrapeLogoList');
  list.innerHTML = (scrape.logo_candidates || []).map(c =>
    `<div class="scrape-logo-row">
      <img src="${escapeHtml(c.href)}" alt="${escapeHtml(c.type)}" loading="lazy" />
      <span>${escapeHtml(c.type)}</span>
      <button type="button" class="btn btn-sm" data-use-logo="${escapeHtml(c.href)}">Use as logo</button>
    </div>`
  ).join('');

  card.hidden = false;

  // Event delegation for the colour + logo apply buttons
  card.addEventListener('click', (event) => {
    const colourBtn = event.target.closest('[data-apply-colour]');
    if (colourBtn) {
      const source = colourBtn.dataset.applyColour;
      const colour = source === 'meta' ? scrape.theme_color : scrape.dominant_logo_color;
      if (colour) applyScrapedColour(colour);
      return;
    }
    const logoBtn = event.target.closest('[data-use-logo]');
    if (logoBtn) applyScrapedLogo(logoBtn.dataset.useLogo);
  });
}

function applyScrapedColour(hex) {
  // Apply to activeTheme.primary, update color wheel + hex input, save.
  activeTheme.primary = hex;
  applyThemeVars(activeTheme);
  populateSettingsFromTheme();
  setThemeScrapeStatus(`Applied ${hex} as primary colour. Don't forget to Save.`, 'ok');
}

function applyScrapedLogo(url) {
  // Apply to portalState.logoUrl, update sidebar logo, save.
  portalState.logoUrl = url;
  document.getElementById('portalLogoUrlInput').value = url;
  updateChromeLogo();
  setThemeScrapeStatus(`Applied logo from ${url}. Don't forget to Save.`, 'ok');
}

function setThemeScrapeStatus(text, kind) {
  const el = document.getElementById('themeScrapeStatus');
  if (!el) return;
  el.textContent = text;
  el.className = 'theme-scrape-status ' + (kind || '');
}

document.getElementById('extractThemeBtn')?.addEventListener('click', extractThemeFromWebsite);
```

#### 4. CSS — minimal styling for the new UI

```css
.theme-scrape-row { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: end; margin-bottom: 14px; }
.theme-scrape-row label { grid-column: 1 / 2; }
.theme-scrape-row input { grid-column: 1 / 2; }
.theme-scrape-row button { grid-column: 2 / 3; align-self: end; }
.theme-scrape-status { grid-column: 1 / -1; min-height: 18px; font-size: 12px; color: var(--muted); }
.theme-scrape-status.error { color: var(--red); }
.theme-scrape-status.ok { color: var(--green); }
.theme-scrape-results { border: 1px solid var(--line); border-radius: 8px; padding: 14px; margin-top: 12px; background: rgba(13,17,23,0.4); }
.scrape-colour-options { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 12px 0; }
.scrape-colour-card { border: 1px solid var(--line); border-radius: 6px; padding: 10px; text-align: center; }
.scrape-swatch { width: 100%; height: 56px; border-radius: 4px; margin-bottom: 8px; }
.scrape-logo-options { margin-top: 12px; }
.scrape-logo-row { display: grid; grid-template-columns: 64px 1fr auto; gap: 12px; align-items: center; padding: 6px 0; border-top: 1px solid var(--line); }
.scrape-logo-row img { width: 64px; height: 64px; object-fit: contain; background: rgba(255,255,255,0.05); border-radius: 4px; }
@media (max-width: 640px) {
  .theme-scrape-row { grid-template-columns: 1fr; }
  .theme-scrape-row button { grid-column: 1 / -1; min-height: 44px; }
  .scrape-colour-options { grid-template-columns: 1fr; }
  .scrape-logo-row { grid-template-columns: 48px 1fr auto; }
  .scrape-logo-row img { width: 48px; height: 48px; }
  .scrape-logo-row button { min-height: 44px; min-width: 44px; }
}
```

---

## Acceptance checklist

- [ ] Worker `/user/orgs/:org_id/scrape-theme` endpoint live in test env (verify via direct curl after wrangler deploy).
- [ ] Calling it without auth returns 401; without lead_admin/developer role returns 403; without stored website_url returns 404.
- [ ] Calling it with valid auth + a real website URL (e.g., your own portfolio) returns 200 with theme_color, logo_candidates, title, scraped_at.
- [ ] Second call within 24h returns from cache (with `from_cache: true`).
- [ ] Worker `/util/image-proxy?url=https://example.com/logo.png` returns the image with CORS headers.
- [ ] Image proxy refuses `localhost`, `127.0.0.1`, `10.0.0.1`, `192.168.x.x`, `169.254.x.x`, `data:image/...`, non-image content-types — all with appropriate 4xx errors.
- [ ] Image proxy refuses responses larger than 2 MB.
- [ ] In OrgCheckin.html → Settings → Branding: new "Website URL" input + "Extract theme from website" button visible.
- [ ] Entering a real URL + clicking Extract: status text updates ("Scraping site..." → "Done."), results card appears.
- [ ] Results card shows both colour options (meta theme-color + dominant logo colour) with swatches and "Use this colour" buttons.
- [ ] Results card shows logo candidates list with "Use as logo" buttons.
- [ ] Clicking "Use this colour" updates `activeTheme.primary` and refreshes the colour wheel.
- [ ] Clicking "Use as logo" updates `portalState.logoUrl` and refreshes the sidebar logo.
- [ ] On a CORS-blocked logo (most small-business sites), the canvas sampler falls back to `/util/image-proxy` automatically (no user action needed).
- [ ] On a JS-rendered SPA with no server-rendered meta tags: scrape returns empty `theme_color` and `logo_candidates: []` — UI shows "no theme found" gracefully (no JS crash).
- [ ] On mobile (≤640px viewport): all new UI elements ≥44px tap targets, scrape-results card single-column.
- [ ] No regression on existing theme picker (manual color wheel still works).
- [ ] No regression on existing settings save / load.

---

## Branch & PR shape

- **Branch:** `codex/v5.5.8-website-theme-extraction`
- **PR title:** `[codex] [L] v5.5.8 — website theme extraction (Batch D)`
- **Expected PR scope:** Large (~400-600 lines: Worker endpoint + image proxy + route additions + client-side canvas sampler + UI markup + CSS + event wiring).
- **Single PR. Stop and raise if scope expands.**
- **Build pill bump:** include current pill letter → next free letter (likely `v5.7.1w → v5.7.1x`, but check the current state of `OrgCheckin.html` line ~2279 first since the pill has been drifting forward as inline patches landed in parallel).

---

## Out of scope (deferred per Captain — keep in design, not implemented now)

- **AI-based logo classification** (text-vs-pictorial, brand recognition). Spec'd as v8+ if it ever earns its weight.
- **Theme inheritance from parent venues**. Spec'd for v6+ alongside the multi-org model.
- **Auto-update on website re-scan when site changes**. Spec'd for v5.6+ via a scheduled Worker.
- **Worker-side image processing** (pixel sampling on the server). Workers don't have native image libraries; client-side canvas is the right call.
- Anything outside the four pieces in §14.16.

---

## Why this matters

When a venue lead admin sets up an org for the first time today, they manually pick primary/accent colours from a colour wheel. That's 5-15 minutes of fiddling per setup, and it usually still doesn't quite match their brand because human colour-picking from memory is unreliable. Website scraping turns that into one click: paste your existing site's URL, get two suggested colours and your favicons as logo options, pick what looks right. Setup goes from "fiddle for ten minutes" to "twenty seconds, looks like our website".

This is the kind of polish that makes IRLid feel like a real product instead of a tool with a configuration screen. It's the last spec'd-but-unimplemented v5.5 feature; closing it brings test env to v5.5 feature-complete in time for the v5.9 live port.

---

— Number One, drafted for Mr. Data, 9 May 2026 afternoon.
