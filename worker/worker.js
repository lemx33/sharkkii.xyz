// Cloudflare Worker: relays chat messages from sharkkii.xyz/chat to Groq.
//
// The Groq API key never reaches the browser or this repo. Set it in the
// Cloudflare dashboard (Worker > Settings > Variables and Secrets):
//   GROQ_API_KEY  (type: Secret)   required
//   MODEL         (type: Text)     optional, defaults to DEFAULT_MODEL
//
// Abuse limits below are best-effort: the per-IP counter lives in one
// Worker instance's memory, and the Origin check stops other websites,
// not scripts. Groq's own account limits are the hard ceiling.

const ALLOWED_ORIGINS = ["https://sharkkii.xyz", "https://www.sharkkii.xyz"];
const DEFAULT_MODEL = "openai/gpt-oss-20b";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const MAX_MESSAGES = 20;          // conversation turns kept
const MAX_CHARS_PER_MESSAGE = 2000;
const MAX_TOTAL_CHARS = 16000;
const MAX_COMPLETION_TOKENS = 2048; // gpt-oss reasoning likely counts toward this
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 8;               // requests per IP per window

const SYSTEM_PROMPT = [
  "You are a friendly, helpful general-purpose AI assistant on sharkkii.xyz, Naomi's personal website.",
  "Answer clearly and concisely. Use Markdown sparingly: short paragraphs, simple lists, fenced code blocks for code.",
  "You are an AI model running through Groq. You are not Naomi: never claim to be Naomi or speak on Naomi's behalf.",
  "Do not ask visitors for personal information.",
].join(" ");

const hits = new Map();

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(status, body, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...(origin ? corsHeaders(origin) : {}) },
  });
}

function rateLimited(ip, now) {
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (now - v.start > RATE_WINDOW_MS) hits.delete(k);
  }
  const entry = hits.get(ip);
  if (!entry || now - entry.start > RATE_WINDOW_MS) {
    hits.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count++;
  return entry.count > RATE_MAX;
}

function cleanMessages(input) {
  if (!Array.isArray(input) || input.length === 0) return null;
  const msgs = input.slice(-MAX_MESSAGES);
  let total = 0;
  const out = [];
  for (const m of msgs) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") return null;
    const content = m.content.trim();
    if (!content || content.length > MAX_CHARS_PER_MESSAGE) return null;
    total += content.length;
    out.push({ role: m.role, content });
  }
  if (total > MAX_TOTAL_CHARS || out[out.length - 1].role !== "user") return null;
  return out;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = ALLOWED_ORIGINS.includes(origin);

    if (request.method === "OPTIONS") {
      return allowed ? new Response(null, { status: 204, headers: corsHeaders(origin) }) : new Response(null, { status: 403 });
    }
    if (!allowed) return json(403, { error: "forbidden" });
    if (request.method !== "POST") return json(405, { error: "method not allowed" }, origin);
    if (!env.GROQ_API_KEY) return json(500, { error: "the chat isn't configured yet" }, origin);

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (rateLimited(ip, Date.now())) {
      return json(429, { error: "slow down a little, try again in a minute" }, origin);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json(400, { error: "bad request" }, origin);
    }
    const messages = cleanMessages(body && body.messages);
    if (!messages) {
      return json(400, { error: `messages must be under ${MAX_CHARS_PER_MESSAGE} characters each` }, origin);
    }

    let upstream;
    try {
      upstream = await fetch(GROQ_URL, {
        method: "POST",
        headers: { "Authorization": `Bearer ${env.GROQ_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: env.MODEL || DEFAULT_MODEL,
          messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
          max_completion_tokens: MAX_COMPLETION_TOKENS,
          temperature: 0.7,
          stream: true,
          // gpt-oss models only: think briefly, and don't send the reasoning to visitors
          ...(String(env.MODEL || DEFAULT_MODEL).startsWith("openai/gpt-oss")
            ? { reasoning_effort: "low", include_reasoning: false }
            : {}),
        }),
      });
    } catch {
      return json(502, { error: "couldn't reach the AI right now" }, origin);
    }

    if (!upstream.ok || !upstream.body) {
      // Details go to the Worker logs only; visitors just see the status code.
      console.error("groq error", upstream.status, (await upstream.text().catch(() => "")).slice(0, 500));
      if (upstream.status === 429) {
        return json(429, { error: "the AI is out of breath (rate limit), try again soon" }, origin);
      }
      if (upstream.status === 401 || upstream.status === 403) {
        return json(502, { error: `the chat's API key was rejected (groq ${upstream.status})` }, origin);
      }
      return json(502, { error: `the AI had a problem (groq ${upstream.status}), try again` }, origin);
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        ...corsHeaders(origin),
      },
    });
  },
};
