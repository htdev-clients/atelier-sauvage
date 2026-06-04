/* Cookie consent + Meta Pixel loader.
 *
 * GDPR (Belgium/EU): the Meta Pixel sets cookies and sends data to Meta, so it must
 * NOT load until the visitor explicitly accepts. This script:
 *   - shows the banner when no prior choice is stored;
 *   - on Accept  -> stores the choice and loads the Pixel (PageView + catalogue event);
 *   - on Reject  -> stores the choice and loads nothing;
 *   - lets the visitor reopen the banner from any [data-cookie-reopen] control
 *     (footer "Cookies" link, legal page) to change their mind.
 *
 * The Pixel ID comes from window.AS_CONSENT.pixelId (set in _includes/cookie-consent.html
 * from _config.yml -> meta_pixel_id). While that is still the placeholder, we skip loading.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "as_cookie_consent"; // values: "accepted" | "rejected"
  var cfg = window.AS_CONSENT || {};
  var pixelId = cfg.pixelId || "";
  var pixelLoaded = false;

  function getChoice() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return null; // privacy mode / storage blocked -> treat as undecided
    }
  }

  function setChoice(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch (e) {
      /* ignore */
    }
  }

  function pixelConfigured() {
    // Guard against the placeholder so we never call Meta with a bogus ID.
    return /^\d{10,20}$/.test(pixelId);
  }

  function onCataloguePage() {
    return /(^|\/)catalogue\/?$/.test(window.location.pathname);
  }

  function loadPixel() {
    if (pixelLoaded || !pixelConfigured()) return;
    pixelLoaded = true;

    /* Standard Meta Pixel bootstrap snippet. */
    !(function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n;
      n.loaded = !0;
      n.version = "2.0";
      n.queue = [];
      t = b.createElement(e);
      t.async = !0;
      t.src = v;
      s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");

    window.fbq("init", pixelId);
    window.fbq("track", "PageView");
    if (onCataloguePage()) {
      window.fbq("track", "ViewContent", { content_category: "catalogue" });
    }
  }

  var banner = document.getElementById("cookie-consent");

  function showBanner() {
    if (banner) banner.classList.remove("hidden");
  }

  function hideBanner() {
    if (banner) banner.classList.add("hidden");
  }

  function accept() {
    setChoice("accepted");
    hideBanner();
    loadPixel();
  }

  function reject() {
    setChoice("rejected");
    hideBanner();
    // Nothing loads. If the visitor previously accepted in this session, the Pixel
    // stays in memory but receives no further events; the choice is honoured on reload.
  }

  // Wire up banner buttons.
  if (banner) {
    var acceptBtn = banner.querySelector("[data-cookie-accept]");
    var rejectBtn = banner.querySelector("[data-cookie-reject]");
    if (acceptBtn) acceptBtn.addEventListener("click", accept);
    if (rejectBtn) rejectBtn.addEventListener("click", reject);
  }

  // "Cookies" reopen controls anywhere on the page.
  document.querySelectorAll("[data-cookie-reopen]").forEach(function (el) {
    el.addEventListener("click", function (e) {
      e.preventDefault();
      showBanner();
    });
  });

  // Initial state.
  var choice = getChoice();
  if (choice === "accepted") {
    loadPixel();
  } else if (choice !== "rejected") {
    showBanner(); // undecided
  }
})();
