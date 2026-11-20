// light / dark / auto theme switch (choice saved in localStorage)
(function () {
  var root = document.documentElement;
  var group = document.querySelector(".theme");
  var buttons = document.querySelectorAll("[data-theme-set]");
  var metas = document.querySelectorAll('meta[name="theme-color"]');
  var colors = { light: "#efebfc", dark: "#1b1329" };
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  var current = "auto"; // the theme we're showing or switching to

  // slide the highlight pill under the pressed button
  function moveIndicator() {
    if (!group) return;
    var on = group.querySelector('[aria-pressed="true"]');
    if (!on || !on.offsetWidth) return;
    group.style.setProperty("--ind-x", on.offsetLeft + "px");
    group.style.setProperty("--ind-w", on.offsetWidth + "px");
    if (!group.classList.contains("has-ind")) {
      group.classList.add("has-ind");
      // enable the slide only after the first placement
      requestAnimationFrame(function () { group.classList.add("ind-ready"); });
    }
  }

  function apply(mode) {
    if (mode === "light" || mode === "dark") root.dataset.theme = mode;
    else { mode = "auto"; delete root.dataset.theme; }
    buttons.forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.themeSet === mode));
    });
    metas.forEach(function (m) {
      var own = m.media.indexOf("dark") !== -1 ? "dark" : "light";
      m.content = colors[mode === "auto" ? own : mode];
    });
    moveIndicator();
    return mode;
  }

  function save(mode) {
    try {
      if (mode === "auto") localStorage.removeItem("theme");
      else localStorage.setItem("theme", mode);
    } catch (e) {}
  }

  // new theme spreads out in a circle from the button
  function switchTo(mode, x, y) {
    current = mode;
    if (!document.startViewTransition || reduce.matches) { save(apply(mode)); return; }
    root.classList.add("theme-vt");
    var t = document.startViewTransition(function () { save(apply(mode)); });
    t.ready.then(function () {
      var r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
      root.animate(
        { clipPath: ["circle(0px at " + x + "px " + y + "px)", "circle(" + r + "px at " + x + "px " + y + "px)"] },
        { duration: 650, easing: "cubic-bezier(.3,.7,.2,1)", pseudoElement: "::view-transition-new(root)" }
      );
    }).catch(function () {});
    t.finished.finally(function () { root.classList.remove("theme-vt"); });
  }

  buttons.forEach(function (b) {
    b.addEventListener("click", function (e) {
      if (b.dataset.themeSet === current) return;
      var x = e.clientX, y = e.clientY;
      if (!x && !y) { // keyboard: use the button's centre
        var r = b.getBoundingClientRect();
        x = r.left + r.width / 2; y = r.top + r.height / 2;
      }
      switchTo(b.dataset.themeSet, x, y);
    });
  });

  current = apply(root.dataset.theme || "auto");
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(moveIndicator);
  window.addEventListener("resize", moveIndicator);
})();
