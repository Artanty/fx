const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const SEARCH_URL = "https://www.ultimate-guitar.com/search.php";
const TAB_URL_RE = /^https:\/\/tabs\.ultimate-guitar\.com\/tab\//;

const MIN_INTERVAL_MS = 2000;
let lastRequestAt = 0;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttle() {
  const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastRequestAt));
  if (wait) await delay(wait);
  lastRequestAt = Date.now();
}

async function fetchPage(url) {
  await throttle();
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
  });
  if (res.status === 403 || res.status === 429 || res.status === 202) {
    throw new Error(
      `ultimate-guitar.com rejected the request (HTTP ${res.status}). Cloudflare/rate-limit; try again later.`
    );
  }
  if (!res.ok) throw new Error(`ultimate-guitar.com request failed: HTTP ${res.status}`);
  return res.text();
}

function decodeHtml(s) {
  return String(s)
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function parseDataContent(html) {
  const m = html.match(/data-content="([\s\S]*?)"/);
  if (!m) throw new Error("Unexpected UG page format (no data-content found)");
  return JSON.parse(decodeHtml(m[1]));
}

async function searchUg(query, page = 1) {
  const q = String(query || "").trim();
  if (!q) return { items: [], page: 1, totalPages: 1 };
  const p = Math.max(1, parseInt(page, 10) || 1);
  const url = `${SEARCH_URL}?search_type=title&value=${encodeURIComponent(q)}&page=${p}`;
  const html = await fetchPage(url);
  const store = parseDataContent(html);
  const data = (store && store.store && store.store.page && store.store.page.data) || {};
  const results = data.results || [];
  const current = (data.pagination && data.pagination.current) || p;
  const totalPages = (data.pagination && data.pagination.total) || 1;
  return {
    page: current,
    totalPages,
    items: results
      .filter((r) => r.tab_url && TAB_URL_RE.test(r.tab_url))
      .filter((r) => r.tab_access_type === "public")
      .filter((r) => (r.type || "").toLowerCase() !== "pro")
      .map((r) => ({
        id: r.id,
        url: r.tab_url,
        artist: r.artist_name || "Unknown Artist",
        song: r.song_name || "Untitled",
        type: r.type || "Tabs",
        version: r.version || 1,
        votes: r.votes || 0,
        rating: r.rating || 0,
        difficulty: r.ug_difficulty || r.difficulty || null,
        date: r.date ? Number(r.date) * 1000 : null,
      })),
  };
}

function cleanContent(content) {
  return String(content || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\[tab\]/g, "")
    .replace(/\[\/tab\]/g, "")
    .replace(/\[ch\]/g, "")
    .replace(/\[\/ch\]/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fetchUgTab(url) {
  const html = await fetchPage(url);
  const store = parseDataContent(html);
  const data = store && store.store && store.store.page && store.store.page.data;
  if (!data || !data.tab) throw new Error("UG tab not found");
  const tab = data.tab;
  if (tab.tab_access_type !== "public") {
    throw new Error("This UG tab requires Pro/subscription access");
  }
  const wiki = (data.tab_view && data.tab_view.wiki_tab) || {};
  if (!wiki.content) throw new Error("UG tab has no text content");
  return {
    id: tab.id,
    url,
    artist: tab.artist_name || "Unknown Artist",
    song: tab.song_name || "Untitled",
    title: [tab.song_name, tab.part, tab.version ? "v" + tab.version : ""].filter(Boolean).join(" ") || null,
    type: tab.type || "Tabs",
    version: tab.version || 1,
    votes: tab.votes || 0,
    rating: tab.rating || 0,
    difficulty: tab.ug_difficulty || tab.difficulty || null,
    date: tab.date ? Number(tab.date) * 1000 : null,
    content: cleanContent(wiki.content),
  };
}

module.exports = { searchUg, fetchUgTab, cleanContent };
