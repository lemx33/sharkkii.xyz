// AI chat page. Talks to the Cloudflare Worker in worker/worker.js, which
// holds the Groq API key. Nothing secret lives in this file.
(function () {
  var API_URL = "https://sharkkii-chat.uwufurry702.workers.dev/";

  var log = document.getElementById("log");
  var empty = document.getElementById("empty");
  var form = document.getElementById("form");
  var input = document.getElementById("input");
  var send = document.getElementById("send");
  var clear = document.getElementById("clear");
  var searchBtn = document.getElementById("search");

  var history = [];
  var busy = null; // AbortController while a reply is streaming

  var searchOn = true;
  try { searchOn = localStorage.getItem("chat-search") !== "off"; } catch (e) {}

  function h(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function safeUrl(u) {
    return typeof u === "string" && /^https?:\/\/[^\s]+$/i.test(u) ? u : null;
  }

  function host(u) {
    try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return u; }
  }

  function link(url, text, cls) {
    var a = h("a", cls, text);
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer nofollow";
    return a;
  }

  // ---- web search bookkeeping (per reply) ----
  // Groq's browser tool numbers each page it looks at (a "cursor"); answers
  // cite them like 【1†L4-L7】. We map cursors to URLs and number sources.
  function newCtx() {
    return { cursors: {}, titles: {}, opened: [], found: [], numbers: {}, order: [] };
  }

  function sourceNumber(ctx, url) {
    if (!ctx.numbers[url]) { ctx.order.push(url); ctx.numbers[url] = ctx.order.length; }
    return ctx.numbers[url];
  }

  function noteTools(ctx, tools, status) {
    tools.forEach(function (t) {
      if (!t || typeof t !== "object") return;
      var name = String(t.name || "");
      (Array.isArray(t.results) ? t.results : []).forEach(function (r) {
        var u = safeUrl(r && r.url);
        if (!u) return;
        // first title wins: search results have real page titles
        if (r.title && !ctx.titles[u]) ctx.titles[u] = String(r.title);
        if (ctx.found.indexOf(u) === -1) ctx.found.push(u);
      });
      var page = safeUrl(t.url);
      if (/open/.test(name) && page) {
        if (typeof t.index === "number") ctx.cursors[t.index] = page;
        if (ctx.opened.indexOf(page) === -1) ctx.opened.push(page);
      }
      if (!t.done) {
        if (/search/.test(name) && t.query) status("searching: " + t.query);
        else if (/open/.test(name)) status("reading a page…");
      } else if (/open/.test(name) && page) {
        status("reading " + host(page) + "…");
      }
    });
  }

  // ---- minimal, safe Markdown (DOM nodes only, never innerHTML) ----
  var CITE = /【(\d+)†[^】]*】/g;

  function inline(parent, line, ctx) {
    line.split(/(【\d+†[^】]*】|`[^`\n]+`|\*\*[^*\n]+\*\*)/g).forEach(function (part) {
      if (!part) return;
      var cite = /^【(\d+)†[^】]*】$/.exec(part);
      if (cite) {
        var url = ctx && ctx.cursors[+cite[1]];
        if (url) {
          var c = link(url, String(sourceNumber(ctx, url)), "cite");
          c.setAttribute("aria-label", "source " + c.textContent);
          parent.append(c);
        }
        return; // unknown citations are dropped
      }
      if (part[0] === "`" && part.length > 2 && part[part.length - 1] === "`") {
        parent.append(h("code", null, part.slice(1, -1)));
      } else if (part.indexOf("**") === 0 && part.length > 4 && part.slice(-2) === "**") {
        var b = h("strong");
        inline(b, part.slice(2, -2), ctx);
        parent.append(b);
      } else {
        parent.append(part);
      }
    });
  }

  function renderMd(el, text, ctx) {
    el.replaceChildren();
    if (ctx) { ctx.numbers = {}; ctx.order = []; }
    text.split("```").forEach(function (chunk, i) {
      if (i % 2 === 1) {
        var nl = chunk.indexOf("\n");
        var code = nl === -1 ? "" : chunk.slice(nl + 1);
        var pre = h("pre");
        pre.append(h("code", null, code.replace(/\n$/, "").replace(CITE, "")));
        el.append(pre);
        return;
      }
      var lines = chunk.replace(/^\n+|\n+$/g, "").split("\n");
      lines.forEach(function (line, j) {
        if (j) el.append("\n");
        var head = /^#{1,6}\s+(.*)$/.exec(line);
        if (head) { var s = h("strong"); inline(s, head[1], ctx); el.append(s); return; }
        var bullet = /^(\s*)[-*]\s+(.*)$/.exec(line);
        if (bullet) { el.append(bullet[1] + "• "); inline(el, bullet[2], ctx); return; }
        inline(el, line, ctx);
      });
    });
    if (ctx) renderSources(el, ctx);
  }

  function renderSources(el, ctx) {
    // cited pages first (in citation order), then other pages it read;
    // if it read none, fall back to the top search results
    var list = ctx.order.slice();
    ctx.opened.forEach(function (u) { if (list.indexOf(u) === -1) list.push(u); });
    if (!list.length) list = ctx.found.slice(0, 3);
    if (!list.length) return;
    var box = h("div", "sources");
    box.append(h("span", "sources-label", "sources"));
    list.slice(0, 6).forEach(function (u) {
      var n = ctx.numbers[u];
      var a = link(u, (n ? n + " · " : "") + host(u), "source");
      a.title = ctx.titles[u] || u;
      box.append(a);
    });
    el.append(box);
  }

  // ---- chat UI ----
  function nearBottom() {
    return log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  }

  function scrollDown(force) {
    if (force || nearBottom()) log.scrollTop = log.scrollHeight;
  }

  function bubble(role, text) {
    empty.hidden = true;
    clear.hidden = false;
    var b = h("div", "msg " + role);
    if (text != null) b.textContent = text;
    log.append(b);
    scrollDown(true);
    return b;
  }

  function setBusy(ctrl) {
    busy = ctrl;
    send.textContent = ctrl ? "stop" : "send";
    send.classList.toggle("stop", !!ctrl);
    input.disabled = !!ctrl;
    if (!ctrl) input.focus();
  }

  function grow() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 200) + "px";
  }

  function paintSearch() {
    searchBtn.setAttribute("aria-pressed", String(searchOn));
    searchBtn.textContent = searchOn ? "web search: on" : "web search: off";
  }

  async function ask(text) {
    history.push({ role: "user", content: text });
    bubble("user", text);
    var out = bubble("ai");
    var ctx = newCtx();
    var statusEl = null;
    var reply = "";

    function typing(label) {
      out.replaceChildren();
      out.classList.add("typing");
      var dots = h("span", "dots");
      dots.append(h("span"), h("span"), h("span"));
      out.append(dots);
      if (label) { statusEl = h("span", "tool-status", label); out.append(statusEl); }
    }
    function status(label) {
      if (reply) return;
      if (statusEl) statusEl.textContent = label;
      else typing(label);
      scrollDown(false);
    }
    typing();

    var ctrl = new AbortController();
    setBusy(ctrl);

    function fail(msg) {
      out.classList.remove("typing");
      out.classList.add("error");
      out.textContent = msg;
      if (!reply) {
        history.pop();
        if (!input.value) { input.value = text; grow(); }
      }
    }

    try {
      var res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, search: searchOn }),
        signal: ctrl.signal
      });
      if (!res.ok || !res.body) {
        var err = null;
        try { err = (await res.json()).error; } catch (e) {}
        fail(err || "something went wrong (" + res.status + ")");
        return;
      }

      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buf = "";
      var done = false;
      while (!done) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buf += decoder.decode(chunk.value, { stream: true });
        var lines = buf.split("\n");
        buf = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (line.indexOf("data:") !== 0) continue;
          var data = line.slice(5).trim();
          if (data === "[DONE]") { done = true; break; }
          var evt;
          try { evt = JSON.parse(data); } catch (e) { continue; }
          if (evt.error) { fail("the AI had a problem, try again"); return; }
          var delta = (evt.choices && evt.choices[0] && evt.choices[0].delta) || {};
          if (Array.isArray(delta.executed_tools)) noteTools(ctx, delta.executed_tools, status);
          if (delta.content) {
            if (!reply) out.classList.remove("typing");
            reply += delta.content;
            var stick = nearBottom();
            renderMd(out, reply, ctx);
            if (stick) scrollDown(true);
          }
        }
      }
      if (!reply) fail("the AI didn't say anything, try again");
    } catch (e) {
      if (e && e.name === "AbortError") {
        if (!reply) fail("stopped");
      } else {
        fail("couldn't reach the chat, check your connection");
      }
    } finally {
      // history keeps plain text: no citation markers
      if (reply) history.push({ role: "assistant", content: reply.replace(CITE, "") });
      setBusy(null);
    }
  }

  if (!/^https:\/\//.test(API_URL)) {
    empty.textContent = "the chat isn't connected yet, check back soon ♡";
    input.disabled = true;
    send.disabled = true;
    searchBtn.hidden = true;
    return;
  }

  paintSearch();
  searchBtn.addEventListener("click", function () {
    searchOn = !searchOn;
    try { localStorage.setItem("chat-search", searchOn ? "on" : "off"); } catch (e) {}
    paintSearch();
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (busy) { busy.abort(); return; }
    var text = input.value.trim();
    if (!text) return;
    input.value = "";
    grow();
    ask(text);
  });

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  input.addEventListener("input", grow);

  clear.addEventListener("click", function () {
    if (busy) busy.abort();
    history = [];
    log.replaceChildren(empty);
    empty.hidden = false;
    clear.hidden = true;
    input.focus();
  });
})();
