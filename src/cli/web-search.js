function decodeDuckDuckGoUrl(href) {
  try {
    const url = new URL(href, "https://duckduckgo.com");
    const encoded = url.searchParams.get("uddg");
    return encoded ? decodeURIComponent(encoded) : href;
  } catch {
    return href;
  }
}

function cleanText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  return cleanText(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length > 2 && ![
      "the",
      "and",
      "for",
      "with",
      "from",
      "that",
      "this",
      "are",
      "was",
      "were",
      "you",
      "your",
      "into",
      "about",
      "what",
      "who",
      "why",
      "how",
      "when",
      "where",
      "does",
      "doesnt",
      "dont",
      "not",
      "can",
      "will"
    ].includes(token));
}

function computeConsensus(results) {
  if (!Array.isArray(results) || results.length < 3) {
    return {
      consensus: false,
      confidence: 0,
      sharedTerms: []
    };
  }

  const tokenSets = results.map((result) => new Set(tokenize(`${result.title} ${result.snippet}`)));
  const sharedTerms = [...tokenSets.reduce((acc, set) => {
    if (!acc) return new Set(set);
    return new Set([...acc].filter((term) => set.has(term)));
  }, null)].slice(0, 12);

  const union = new Set();
  for (const set of tokenSets) {
    for (const token of set) {
      union.add(token);
    }
  }

  const overlapRatio = union.size === 0 ? 0 : sharedTerms.length / union.size;
  const coverage = tokenSets.length === 0 ? 0 : tokenSets.filter((set) => sharedTerms.some((term) => set.has(term))).length / tokenSets.length;
  const confidence = Number((coverage * 0.7 + overlapRatio * 0.3).toFixed(2));

  return {
    consensus: confidence >= 0.45 && coverage === 1 && sharedTerms.length >= 2,
    confidence,
    sharedTerms
  };
}

function extractDuckDuckGoResults(html, limit = 5) {
  const results = [];
  const pattern = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let match;
  while ((match = pattern.exec(html)) && results.length < limit) {
    results.push({
      title: cleanText(match[2]),
      url: decodeDuckDuckGoUrl(match[1]),
      snippet: cleanText(match[3])
    });
  }
  return results;
}

export async function searchWeb(query, { limit = 5 } = {}) {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);

  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml"
    }
  });

  if (!response.ok) {
    throw new Error(`Web search failed: ${response.status}`);
  }

  const html = await response.text();
  const results = extractDuckDuckGoResults(html, Math.max(3, Math.min(Number(limit) || 5, 5)));
  const consensus = computeConsensus(results);
  return {
    query,
    results,
    consensus
  };
}
