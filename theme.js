// light / dark / auto theme switch (choice saved in localStorage)
(function () {
  var root = document.documentElement;
  var buttons = document.querySelectorAll("[data-theme-set]");
  var metas = document.querySelectorAll('meta[name="theme-color"]');
  var colors = { light: "#efebfc", dark: "#1b1329" };

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
    return mode;
  }

  buttons.forEach(function (b) {
    b.addEventListener("click", function () {
      var mode = apply(b.dataset.themeSet);
      try {
        if (mode === "auto") localStorage.removeItem("theme");
        else localStorage.setItem("theme", mode);
      } catch (e) {}
    });
  });

  apply(root.dataset.theme || "auto");
})();
