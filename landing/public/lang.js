// Which language the page speaks: the visitor's last choice, else Japanese
// for a Japanese browser and English for any other. It runs in <head>, before
// the body is drawn, so the other language never flashes on screen.
(function () {
  var root = document.documentElement;
  root.className += " js"; // the switch is drawn only where it works

  function saved() {
    try {
      var v = localStorage.getItem("lang");
      return v === "ja" || v === "en" ? v : null;
    } catch (e) {
      return null;
    }
  }

  function apply(lang) {
    root.lang = lang;
    var buttons = document.querySelectorAll("[data-set-lang]");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute("aria-pressed", String(buttons[i].getAttribute("data-set-lang") === lang));
    }
  }

  var browser = (navigator.language || "").toLowerCase().indexOf("ja") === 0 ? "ja" : "en";
  apply(saved() || browser);

  document.addEventListener("DOMContentLoaded", function () {
    apply(root.lang);
    document.addEventListener("click", function (event) {
      var button = event.target.closest && event.target.closest("[data-set-lang]");
      if (!button) return;
      var lang = button.getAttribute("data-set-lang");
      apply(lang);
      try {
        localStorage.setItem("lang", lang);
      } catch (e) {
        // A private window: the choice lasts for this page only.
      }
    });
  });
})();
