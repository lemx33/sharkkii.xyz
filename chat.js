// AI chat page. Talks to the Cloudflare Worker in worker/worker.js, which
// holds the Groq API key. Nothing secret lives in this file.
(function () {
  var API_URL = "";

  var log = document.getElementById("log");
  var empty = document.getElementById("empty");
  var form = document.getElementById("form");
  var input = document.getElementById("input");
  var send = document.getElementById("send");
  var clear = document.getElementById("clear");

  var history = [];
  var busy = null; // AbortController while a reply is streaming

  function h(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // Minimal, safe Markdown: fenced code, inline code, **bold**, headings,
  // bullets. Builds DOM nodes only; never uses innerHTML.
  function inline(parent, line) {
    line.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).forEach(function (part) {
      if (!part) return;
      if (part[0] === "`" && part.length > 2 && part[part.length - 1] === "`") {
        parent.append(h("code", null, part.slice(1, -1)));
      } else if (part.indexOf("**") === 0 && part.length > 4 && part.slice(-2) === "**") {
        parent.append(h("strong", null, part.slice(2, -2)));
      } else {
        parent.append(part);
      }
    });
  }

  function renderMd(el, text) {
    el.replaceChildren();
    text.split("```").forEach(function (chunk, i) {
      if (i % 2 === 1) {
        var nl = chunk.indexOf("\n");
        var code = nl === -1 ? "" : chunk.slice(nl + 1);
        var pre = h("pre");
        pre.append(h("code", null, code.replace(/\n$/, "")));
        el.append(pre);
        return;
      }
      var lines = chunk.replace(/^\n+|\n+$/g, i === 0 ? "" : "").split("\n");
      lines.forEach(function (line, j) {
        if (j) el.append("\n");
        var head = /^#{1,6}\s+(.*)$/.exec(line);
        if (head) { var s = h("strong"); inline(s, head[1]); el.append(s); return; }
        var bullet = /^(\s*)[-*]\s+(.*)$/.exec(line);
        if (bullet) { el.append(bullet[1] + "• "); inline(el, bullet[2]); return; }
        inline(el, line);
      });
    });
  }

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
    if (text != null) {
      if (role === "ai") renderMd(b, text);
      else b.textContent = text;
    }
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

  async function ask(text) {
    history.push({ role: "user", content: text });
    bubble("user", text);
    var out = bubble("ai");
    out.classList.add("typing");
    out.append(h("span"), h("span"), h("span"));

    var ctrl = new AbortController();
    setBusy(ctrl);
    var reply = "";

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
        body: JSON.stringify({ messages: history }),
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
          var delta = evt.choices && evt.choices[0] && evt.choices[0].delta && evt.choices[0].delta.content;
          if (delta) {
            if (!reply) out.classList.remove("typing");
            reply += delta;
            var stick = nearBottom();
            renderMd(out, reply);
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
      if (reply) history.push({ role: "assistant", content: reply });
      setBusy(null);
    }
  }

  if (!/^https:\/\//.test(API_URL)) {
    empty.textContent = "the chat isn't connected yet, check back soon ♡";
    input.disabled = true;
    send.disabled = true;
    return;
  }

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

  // Hooks for local testing.
  window.__chat = { renderMd: renderMd, setApi: function (u) { API_URL = u; } };
})();
