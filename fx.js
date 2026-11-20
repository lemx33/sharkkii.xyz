// Eye candy: card spotlight that follows the pointer, and rising bubbles.
// Everything here is decorative and skipped with prefers-reduced-motion.
(function () {
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;

  // spotlight on the card (mouse/pen only)
  var panel = document.querySelector(".panel");
  if (panel && window.matchMedia("(hover: hover)").matches) {
    var raf = 0, mx = 0, my = 0;
    panel.addEventListener("pointermove", function (e) {
      var r = panel.getBoundingClientRect();
      mx = e.clientX - r.left;
      my = e.clientY - r.top;
      if (!raf) {
        raf = requestAnimationFrame(function () {
          raf = 0;
          panel.style.setProperty("--mx", mx + "px");
          panel.style.setProperty("--my", my + "px");
        });
      }
      panel.classList.add("lit");
    });
    panel.addEventListener("pointerleave", function () { panel.classList.remove("lit"); });
  }

  // rising bubbles. Same seed on every page, with phases tied to the clock,
  // so they don't jump when moving between pages.
  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6d2b79f5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  var rand = rng(1297);
  var count = window.innerWidth < 600 ? 7 : 14;
  var now = Date.now() / 1000;
  var layer = document.createElement("div");
  layer.className = "bubbles";
  layer.setAttribute("aria-hidden", "true");
  for (var i = 0; i < count; i++) {
    var b = document.createElement("span");
    var dur = 16 + rand() * 18;
    var phase = rand() * dur;
    b.style.setProperty("--x", (rand() * 100).toFixed(2) + "%");
    b.style.setProperty("--s", (6 + rand() * 16).toFixed(1) + "px");
    b.style.setProperty("--d", dur.toFixed(2) + "s");
    b.style.setProperty("--sway", ((rand() - 0.5) * 70).toFixed(1) + "px");
    b.style.setProperty("--delay", (-((now + phase) % dur)).toFixed(2) + "s");
    layer.append(b);
  }
  document.body.prepend(layer);
})();
