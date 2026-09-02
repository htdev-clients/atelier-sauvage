/* Atelier Sauvage shop — cart, availability, checkout hand-off.
 *
 * The cart lives in localStorage as a list of item snapshots. Nothing here is
 * trusted by the server: /api/checkout re-reads prices and sellability from
 * the build's catalogue.json and claims the items in D1 before Stripe is ever
 * involved. This script only makes the shop pleasant to use.
 */
(function () {
  "use strict";

  var cfg = window.AS_SHOP || { lang: "fr", prefix: "", t: {} };
  var T = cfg.t || {};
  var CART_KEY = "as_cart";
  var PENDING_KEY = "as_pending_order";
  var MAX_ITEMS = 10;

  // ── storage ──────────────────────────────────────────────────────────────
  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function writeJSON(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* storage blocked: the cart simply does not persist */ }
  }
  function getCart() {
    var cart = readJSON(CART_KEY, []);
    return Array.isArray(cart) ? cart.filter(function (i) { return i && typeof i.number === "string"; }) : [];
  }
  function setCart(cart) {
    writeJSON(CART_KEY, cart);
    updateBadges();
  }
  function inCart(number) {
    return getCart().some(function (i) { return i.number === number; });
  }

  // ── helpers ──────────────────────────────────────────────────────────────
  function fmtPrice(euros) {
    try {
      return new Intl.NumberFormat(cfg.lang + "-BE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(euros);
    } catch (e) {
      return euros + " €";
    }
  }
  function fmtCents(cents) { return fmtPrice(Math.round(cents) / 100); }
  function productUrl(number) { return cfg.prefix + "/catalogue/" + encodeURIComponent(number) + "/"; }
  function imgUrl(number, size) { return "/assets/img/catalog/" + size + "/" + number + "-" + size + ".webp"; }
  function track(event, params) {
    if (typeof window.fbq === "function") {
      try { window.fbq("track", event, params || {}); } catch (e) { /* ignore */ }
    }
  }
  function badge(text, colorClasses) {
    var span = document.createElement("span");
    span.className = colorClasses + " text-white border border-white/50 text-[10px] sm:text-xs font-bold px-3 py-1 uppercase tracking-widest rounded-full shadow-md";
    span.textContent = text;
    return span;
  }

  // ── badges (every page) ──────────────────────────────────────────────────
  function updateBadges() {
    var n = getCart().length;
    document.querySelectorAll("[data-cart-count]").forEach(function (el) {
      el.textContent = String(n);
      el.classList.toggle("hidden", n === 0);
    });
  }

  // ── availability (catalogue grids + product page) ────────────────────────
  var availabilityPromise = null;
  function fetchAvailability() {
    if (!availabilityPromise) {
      availabilityPromise = fetch("/api/availability", { headers: { Accept: "application/json" } })
        .then(function (r) { return r.ok ? r.json() : { sold: [], held: [] }; })
        .catch(function () { return { sold: [], held: [] }; });
    }
    return availabilityPromise;
  }

  function applyAvailabilityToGrids(av) {
    var sold = new Set(av.sold || []);
    var held = new Set(av.held || []);
    document.querySelectorAll(".gallery-item-wrapper[data-item]").forEach(function (card) {
      var number = card.getAttribute("data-item");
      var slot = card.querySelector("[data-status-badge]");
      if (!slot || slot.children.length) return; // already marked sold at build time
      if (sold.has(number)) {
        slot.appendChild(badge(T.sold || "Vendu", "bg-red-700"));
        var price = card.querySelector("[data-price]");
        if (price) price.classList.add("hidden");
      } else if (held.has(number)) {
        slot.appendChild(badge(T.reserved || "Réservé", "bg-amber-600"));
      }
    });
  }

  // ── product page ─────────────────────────────────────────────────────────
  function initProductPage() {
    var article = document.querySelector("article[data-product]");
    if (!article) return;
    var number = article.getAttribute("data-product");
    var button = article.querySelector("[data-add-to-cart]");
    var viewCart = article.querySelector("[data-view-cart]");
    var reservedNote = article.querySelector("[data-reserved-note]");
    var soldNote = article.querySelector("[data-sold-note]");
    var product = window.AS_PRODUCT || {};

    function reflect() {
      if (!button) return;
      var has = inCart(number);
      button.querySelector("[data-label-add]").classList.toggle("hidden", has);
      button.querySelector("[data-label-in-cart]").classList.toggle("hidden", !has);
      if (viewCart) viewCart.classList.toggle("hidden", !has);
    }

    if (button) {
      button.addEventListener("click", function () {
        var cart = getCart();
        if (inCart(number)) {
          window.location.href = cfg.prefix + "/panier/";
          return;
        }
        if (cart.length >= MAX_ITEMS) return;
        cart.push({
          number: number,
          description: product.description || "",
          price: Number(product.price) || 0,
          category: product.category || ""
        });
        setCart(cart);
        reflect();
        track("AddToCart", {
          content_type: "product",
          content_ids: [number],
          content_name: product.description,
          value: Number(product.price) || 0,
          currency: "EUR"
        });
      });
      reflect();

      fetchAvailability().then(function (av) {
        if ((av.sold || []).indexOf(number) !== -1) {
          button.classList.add("hidden");
          if (soldNote) soldNote.classList.remove("hidden");
          // Drop it from the cart too; the server would refuse it anyway.
          setCart(getCart().filter(function (i) { return i.number !== number; }));
        } else if ((av.held || []).indexOf(number) !== -1 && !inCart(number)) {
          button.disabled = true;
          if (reservedNote) reservedNote.classList.remove("hidden");
        }
      });
    }
  }

  // ── cart page ────────────────────────────────────────────────────────────
  function initCartPage() {
    var page = document.querySelector("[data-cart-page]");
    if (!page) return;

    var itemsEl = page.querySelector("[data-cart-items]");
    var emptyEl = page.querySelector("[data-cart-empty]");
    var contentEl = page.querySelector("[data-cart-content]");
    var noticeEl = page.querySelector("[data-cart-notice]");
    var errorEl = page.querySelector("[data-cart-error]");
    var subtotalEl = page.querySelector("[data-subtotal]");
    var terms = page.querySelector("#accept-terms");
    var payBtn = page.querySelector("[data-checkout]");
    var template = page.querySelector("#cart-item-template");

    function notice(text, items) {
      if (!text) { noticeEl.classList.add("hidden"); noticeEl.textContent = ""; return; }
      noticeEl.textContent = text + (items && items.length ? " " + items.join(", ") : "");
      noticeEl.classList.remove("hidden");
    }
    function error(text) {
      errorEl.textContent = text || "";
      errorEl.classList.toggle("hidden", !text);
    }

    function render() {
      var cart = getCart();
      itemsEl.innerHTML = "";
      emptyEl.classList.toggle("hidden", cart.length > 0);
      contentEl.classList.toggle("hidden", cart.length === 0);
      var subtotal = 0;
      cart.forEach(function (item) {
        subtotal += Number(item.price) || 0;
        var node = template.content.cloneNode(true);
        node.querySelectorAll("[data-link]").forEach(function (a) { a.href = productUrl(item.number); });
        var img = node.querySelector("[data-img]");
        img.src = imgUrl(item.number, 480);
        img.alt = item.description || item.number;
        node.querySelector("[data-title]").textContent = item.description || item.number;
        node.querySelector("[data-meta]").textContent = "Réf. " + item.number;
        node.querySelector("[data-price]").textContent = fmtPrice(Number(item.price) || 0);
        node.querySelector("[data-remove]").addEventListener("click", function () {
          setCart(getCart().filter(function (i) { return i.number !== item.number; }));
          render();
        });
        itemsEl.appendChild(node);
      });
      subtotalEl.textContent = fmtPrice(subtotal);
    }

    // Refresh snapshots against the current build: prices may have moved, and
    // items may have become unbuyable (sold in the shop, band removed).
    function refreshFromBuild() {
      var cart = getCart();
      if (!cart.length) return Promise.resolve();
      return fetch("/catalogue.json", { headers: { Accept: "application/json" } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (!data || !data.items) return;
          var removed = [];
          var next = [];
          cart.forEach(function (item) {
            var live = data.items[item.number];
            if (!live || !live.buyable) { removed.push(item.number); return; }
            next.push({
              number: item.number,
              description: live.description,
              price: live.price_cents / 100,
              category: live.category
            });
          });
          if (removed.length) notice(T.removedUnavailable, removed);
          setCart(next);
          render();
        })
        .catch(function () { /* offline: keep the snapshot */ });
    }

    function dropUnavailable(numbers) {
      setCart(getCart().filter(function (i) { return numbers.indexOf(i.number) === -1; }));
      notice(T.removedUnavailable, numbers);
      render();
    }

    function releasePending() {
      var pending = readJSON(PENDING_KEY, null);
      writeJSON(PENDING_KEY, null);
      if (!pending || !pending.order_id) return Promise.resolve();
      return fetch("/api/release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: pending.order_id, token: pending.token })
      }).catch(function () { /* the hold expires on its own */ });
    }

    function checkout() {
      error("");
      if (!terms.checked) { error(T.errorTerms); return; }
      var cart = getCart();
      if (!cart.length) return;
      payBtn.disabled = true;
      var label = payBtn.textContent;
      payBtn.textContent = T.processing || "…";
      track("InitiateCheckout", {
        content_type: "product",
        content_ids: cart.map(function (i) { return i.number; }),
        num_items: cart.length,
        value: cart.reduce(function (s, i) { return s + (Number(i.price) || 0); }, 0),
        currency: "EUR"
      });
      fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          items: cart.map(function (i) { return i.number; }),
          lang: cfg.lang,
          accept_terms: true
        })
      })
        .then(function (r) { return r.json().then(function (body) { return { status: r.status, body: body }; }); })
        .then(function (res) {
          if (res.status === 200 && res.body && res.body.url) {
            writeJSON(PENDING_KEY, { order_id: res.body.order_id, token: res.body.cancel_token });
            window.location.href = res.body.url;
            return;
          }
          if (res.status === 409 && res.body && Array.isArray(res.body.unavailable)) {
            dropUnavailable(res.body.unavailable);
          } else {
            error(T.errorGeneric);
          }
          payBtn.disabled = false;
          payBtn.textContent = label;
        })
        .catch(function () {
          error(T.errorGeneric);
          payBtn.disabled = false;
          payBtn.textContent = label;
        });
    }

    payBtn.addEventListener("click", checkout);

    var params = new URLSearchParams(window.location.search);
    var cancelled = params.get("cancelled") === "1";
    render();
    (cancelled ? releasePending() : Promise.resolve())
      .then(function () {
        if (cancelled) {
          notice(T.cancelled);
          history.replaceState(null, "", window.location.pathname);
        }
        return refreshFromBuild();
      })
      .then(function () {
        // Anything held by someone else cannot be bought right now; say so early
        // rather than at the claim.
        return fetchAvailability().then(function (av) {
          var blocked = getCart().map(function (i) { return i.number; })
            .filter(function (n) { return (av.sold || []).indexOf(n) !== -1; });
          if (blocked.length) dropUnavailable(blocked);
        });
      });
  }

  // ── thank-you page ───────────────────────────────────────────────────────
  function initThanksPage() {
    var page = document.querySelector("[data-thanks-page]");
    if (!page) return;
    var states = {};
    page.querySelectorAll("[data-state]").forEach(function (el) { states[el.getAttribute("data-state")] = el; });
    function show(name) {
      Object.keys(states).forEach(function (k) { states[k].classList.toggle("hidden", k !== name); });
    }
    var sessionId = new URLSearchParams(window.location.search).get("session_id");
    if (!sessionId) { show("notfound"); return; }

    var attempts = 0;
    function poll() {
      attempts += 1;
      fetch("/api/order?session_id=" + encodeURIComponent(sessionId), { headers: { Accept: "application/json" } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (order) {
          if (!order) { show("notfound"); return; }
          if (order.status === "paid") { renderPaid(order); return; }
          show("pending");
          if (attempts < 20) setTimeout(poll, 3000);
        })
        .catch(function () { show(attempts < 20 ? "pending" : "notfound"); if (attempts < 20) setTimeout(poll, 3000); });
    }

    function renderPaid(order) {
      page.querySelector("[data-order-ref]").textContent = order.id;
      page.querySelector("[data-order-total]").textContent = fmtCents(order.amount_total || 0);
      page.querySelector("[data-order-shipping]").textContent =
        order.shipping_option === "pickup" ? (T.pickup || "Retrait") : (T.delivery || "Livraison");
      var list = page.querySelector("[data-order-items]");
      list.innerHTML = "";
      (order.items || []).forEach(function (item) {
        var li = document.createElement("li");
        li.className = "py-3 flex justify-between gap-4";
        var left = document.createElement("span");
        left.textContent = item.description + " (réf. " + item.number + ")";
        var right = document.createElement("span");
        right.className = "font-bold whitespace-nowrap";
        right.textContent = fmtCents(item.price_cents || 0);
        li.appendChild(left); li.appendChild(right);
        list.appendChild(li);
      });
      show("paid");
      setCart([]);
      writeJSON(PENDING_KEY, null);
      // Fire Purchase once per order, even if the page is reloaded.
      var key = "as_purchase_" + order.id;
      if (!readJSON(key, false)) {
        writeJSON(key, true);
        track("Purchase", {
          content_type: "product",
          content_ids: (order.items || []).map(function (i) { return i.number; }),
          num_items: (order.items || []).length,
          value: (order.amount_total || 0) / 100,
          currency: "EUR"
        });
      }
    }
    poll();
  }

  // ── boot ─────────────────────────────────────────────────────────────────
  updateBadges();
  initProductPage();
  initCartPage();
  initThanksPage();
  if (document.querySelector(".gallery-item-wrapper[data-item]")) {
    fetchAvailability().then(applyAvailabilityToGrids);
  }
  window.addEventListener("storage", function (e) { if (e.key === CART_KEY) updateBadges(); });
})();
