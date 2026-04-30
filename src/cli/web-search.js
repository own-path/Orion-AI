import { config } from "../../services/shared/config.js";

const HTML_ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

function cleanText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, (e) => HTML_ENTITIES[e] || "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  return cleanText(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length > 2 && ![
      "the", "and", "for", "with", "from", "that", "this", "are", "was",
      "were", "you", "your", "into", "about", "what", "who", "why", "how",
      "when", "where", "does", "doesnt", "dont", "not", "can", "will"
    ].includes(token));
}

function computeConsensus(results) {
  if (!Array.isArray(results) || results.length < 3) {
    return { consensus: false, confidence: 0, sharedTerms: [] };
  }
  const tokenSets = results.map((r) => new Set(tokenize(`${r.title} ${r.snippet}`)));
  const sharedTerms = [...tokenSets.reduce((acc, set) => {
    if (!acc) return new Set(set);
    return new Set([...acc].filter((t) => set.has(t)));
  }, null)].slice(0, 12);
  const union = new Set(tokenSets.flatMap((s) => [...s]));
  const overlapRatio = union.size === 0 ? 0 : sharedTerms.length / union.size;
  const coverage = tokenSets.filter((s) => sharedTerms.some((t) => s.has(t))).length / tokenSets.length;
  const confidence = Number((coverage * 0.7 + overlapRatio * 0.3).toFixed(2));
  return {
    consensus: confidence >= 0.45 && coverage === 1 && sharedTerms.length >= 2,
    confidence,
    sharedTerms
  };
}

async function searchGoogle(query, limit) {
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("q", query);
  url.searchParams.set("key", config.googleApiKey);
  url.searchParams.set("cx", config.googleCseId);
  url.searchParams.set("num", String(Math.max(3, Math.min(limit, 10))));

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Google Search API error: ${response.status}`);
  }
  const data = await response.json();
  return (data.items || []).slice(0, limit).map((item) => ({
    title: cleanText(item.title),
    url: item.link,
    snippet: cleanText(item.snippet)
  }));
}

function extractDuckDuckGoResults(html, limit) {
  const results = [];
  const pattern = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let match;
  while ((match = pattern.exec(html)) && results.length < limit) {
    const href = match[1];
    let url = href;
    try {
      const u = new URL(href, "https://duckduckgo.com");
      const uddg = u.searchParams.get("uddg");
      url = uddg ? decodeURIComponent(uddg) : href;
    } catch {}
    results.push({ title: cleanText(match[2]), url, snippet: cleanText(match[3]) });
  }
  return results;
}

async function searchDuckDuckGo(query, limit) {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);
  const response = await fetch(url, { headers: { accept: "text/html,application/xhtml+xml" } });
  if (!response.ok) throw new Error(`DuckDuckGo search failed: ${response.status}`);
  const html = await response.text();
  return extractDuckDuckGoResults(html, limit);
}

export async function searchWeb(query, { limit = 5 } = {}) {
  const n = Math.max(3, Math.min(Number(limit) || 5, 10));
  const useGoogle = Boolean(config.googleApiKey && config.googleCseId);
  const results = useGoogle
    ? await searchGoogle(query, n)
    : await searchDuckDuckGo(query, n);
  return { query, engine: useGoogle ? "google" : "duckduckgo", results, consensus: computeConsensus(results) };
}
