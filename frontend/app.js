
"use strict";

const API_BASE = "/api";

const MODULE_META = {
  mentor: { icon: "✎", color: "Education" },
  duka: { icon: "▣", color: "Retail POS" },
  tiba: { icon: "✚", color: "Healthcare" },
  soko: { icon: "♧", color: "Farming" },
  sheria: { icon: "⚖", color: "Legal" },
  kazi: { icon: "↗", color: "Gigs" },
  pesa: { icon: "◎", color: "Savings" },
  mtaa: { icon: "⌖", color: "Community" },
  safiri: { icon: "✦", color: "Advertising" }
};

const state = {
  mode: "demo",
  serverConfig: {
    demo_mode: true,
    real_payments_enabled: false
  },
  user: null,
  stats: null,
  products: [],
  ads: [],
  modules: [],
  activeProduct: null,
  activeModule: null,
  activeTab: "home",
  busy: false,
  previousFocus: null
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function money(amount, currency = "ZAR") {
  try {
    return new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency,
      maximumFractionDigits: 2
    }).format(Number(amount) || 0);
  } catch {
    return `R${(Number(amount) || 0).toFixed(2)}`;
  }
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-ZA").format(Number(value) || 0);
}

async function api(path, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {})
  };

  let response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      credentials: "omit"
    });
  } catch {
    throw new Error(
      "Cannot reach the Jibu API. Check the deployment and try again."
    );
  }

  const contentType = response.headers.get("content-type") || "";
  let data = {};

  if (contentType.includes("application/json")) {
    try {
      data = await response.json();
    } catch {
      data = {};
    }
  }

  if (!response.ok) {
    const detail = typeof data.detail === "string"
      ? data.detail
      : `Request failed (${response.status}).`;

    throw new Error(detail);
  }

  return data;
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("visible");

  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    element.classList.remove("visible");
  }, 3200);
}

function setFeedback(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle("error", isError);
}

function setButtonBusy(button, busy, busyText = "Please wait...") {
  if (!button.dataset.originalText) {
    button.dataset.originalText = button.textContent.trim();
  }

  button.disabled = busy;
  button.textContent = busy
    ? busyText
    : button.dataset.originalText;
}

function setMode(mode, persist = true) {
  state.mode = mode === "real" ? "real" : "demo";

  if (persist) {
    try {
      localStorage.setItem("jibu-mode", state.mode);
    } catch {
      // App remains usable if browser storage is unavailable.
    }
  }

  const isReal = state.mode === "real";
  const toggle = $("#modeToggle");

  $("#modeLabel").textContent = isReal ? "Real" : "Demo";
  toggle.classList.toggle("real-mode", isReal);
  toggle.setAttribute("aria-pressed", String(isReal));
  toggle.title = isReal
    ? "Real mode requested; server approval is required"
    : "Demo mode: no real payments";

  $("#checkoutModeNote").textContent = isReal
    ? "Real mode requested. Live payments work only when the server is configured and the selected provider is implemented."
    : "Demo checkout — no money will be charged.";

  $("#checkoutModeNote").classList.toggle("real-warning", isReal);

  if (isReal && !state.serverConfig.real_payments_enabled) {
    $("#checkoutModeNote").textContent =
      "Real payments are disabled on the server. Checkout will be rejected until an administrator enables a supported live integration.";
  }
}

async function loadConfig() {
  try {
    state.serverConfig = await api("/config");
  } catch (error) {
    console.warn("Jibu configuration unavailable:", error.message);
    state.serverConfig = {
      demo_mode: true,
      real_payments_enabled: false
    };
  }

  let savedMode = "demo";

  try {
    savedMode = localStorage.getItem("jibu-mode") || "demo";
  } catch {
    // Use safe default.
  }

  // Never automatically submit a payment based on a stored preference.
  setMode(savedMode, false);
}

async function loadDashboard() {
  const results = await Promise.allSettled([
    api("/stats"),
    api("/users/u1"),
    api("/products"),
    api("/ads"),
    api("/modules")
  ]);

  const [stats, user, products, ads, modules] = results;

  if (stats.status === "fulfilled") {
    state.stats = stats.value;
    renderStats();
  }

  if (user.status === "fulfilled") {
    state.user = user.value;
    $("#userScore").textContent = formatNumber(user.value.score);
  }

  if (products.status === "fulfilled") {
    state.products = products.value.items || [];
    renderProducts();
  }

  if (ads.status === "fulfilled") {
    state.ads = ads.value.items || [];
    renderAds();
  }

  if (modules.status === "fulfilled") {
    state.modules = modules.value.items || [];
    renderModules();
  }

  const failures = results.filter((result) => result.status === "rejected");

  if (failures.length) {
    toast("Some data could not load. Check the API deployment.");
  }
}

function renderStats() {
  const stats = state.stats;
  if (!stats) return;

  const cards = [
    {
      icon: "◉",
      label: "Ad impressions",
      value: formatNumber(stats.impressions),
      note: "Across demo campaigns"
    },
    {
      icon: "↗",
      label: "Click-through rate",
      value: `${Number(stats.ctr).toFixed(2)}%`,
      note: "Clicks / impressions"
    },
    {
      icon: "◎",
      label: "Conversions",
      value: formatNumber(stats.conversions),
      note: "Simulated results"
    },
    {
      icon: "⌁",
      label: "Bounce rate",
      value: `${Number(stats.bounce_rate).toFixed(1)}%`,
      note: "Illustrative metric"
    }
  ];

  $("#statsGrid").innerHTML = cards.map((card) => `
    <article class="stat-card">
      <span class="stat-icon">${card.icon}</span>
      <span class="stat-label">${escapeHTML(card.label)}</span>
      <strong class="stat-value">${escapeHTML(card.value)}</strong>
      <span class="stat-note">${escapeHTML(card.note)}</span>
    </article>
  `).join("");
}

function moduleCard(module) {
  const meta = MODULE_META[module.id] || { icon: "✦" };

  return `
    <button class="module-card" type="button"
      data-module="${escapeHTML(module.id)}"
      aria-label="Open ${escapeHTML(module.name)} module">
      <span class="module-icon">${meta.icon}</span>
      <strong>${escapeHTML(module.name)}</strong>
      <p>${escapeHTML(module.description)}</p>
      <span class="module-arrow">Explore →</span>
    </button>
  `;
}

function renderModules() {
  const modules = state.modules;

  $("#modulesGrid").innerHTML = modules.length
    ? modules.map(moduleCard).join("")
    : '<p class="empty-state">Modules are temporarily unavailable.</p>';

  $("#homeModules").innerHTML = modules.length
    ? modules.slice(0, 4).map(moduleCard).join("")
    : '<p class="empty-state">Modules are temporarily unavailable.</p>';

  filterModules();
}

function filterModules() {
  const query = ($("#moduleSearch")?.value || "").trim().toLowerCase();

  $$(".module-card", $("#modulesGrid")).forEach((card) => {
    card.hidden = !card.textContent.toLowerCase().includes(query);
  });
}

function renderProducts() {
  const query = ($("#productSearch")?.value || "").trim().toLowerCase();

  const filtered = state.products.filter((product) => {
    const text = [
      product.name,
      product.description,
      product.category
    ].join(" ").toLowerCase();

    return text.includes(query);
  });

  $("#productCount").textContent =
    `${filtered.length} product${filtered.length === 1 ? "" : "s"}`;

  $("#productsGrid").innerHTML = filtered.length
    ? filtered.map((product) => `
      <article class="product-card">
        <div class="product-art" aria-hidden="true">✦</div>
        <div class="product-content">
          <span class="category-chip">${escapeHTML(product.category)}</span>
          <h3>${escapeHTML(product.name)}</h3>
          <p>${escapeHTML(product.description)}</p>
          <strong class="product-price">
            ${escapeHTML(money(product.price, product.currency))}
          </strong>
          <button class="button button-primary" type="button"
            data-buy="${escapeHTML(product.id)}"
            ${Number(product.stock) <= 0 ? "disabled" : ""}>
            ${Number(product.stock) <= 0 ? "Out of stock" : "Buy Now"}
          </button>
        </div>
      </article>
    `).join("")
    : '<p class="empty-state">No matching products found.</p>';
}

function renderAds() {
  $("#adsList").innerHTML = state.ads.length
    ? state.ads.map((ad) => `
      <article class="ad-card">
        <div class="ad-topline">
          <span class="category-chip">${escapeHTML(ad.category)}</span>
          <span class="muted-text">${escapeHTML(ad.advertiser)}</span>
        </div>
        <h3>${escapeHTML(ad.title)}</h3>
        <p>${escapeHTML(ad.description)}</p>
        <div class="ad-metrics">
          <div>
            <strong>${formatNumber(ad.impressions)}</strong>
            <span>Impressions</span>
          </div>
          <div>
            <strong>${formatNumber(ad.clicks)}</strong>
            <span>Clicks</span>
          </div>
          <div>
            <strong>${Number(ad.ctr).toFixed(2)}%</strong>
            <span>CTR</span>
          </div>
        </div>
        <div class="ad-footer">
          <small>${formatNumber(ad.conversions)} demo conversions</small>
          <button class="button button-primary" type="button"
            data-ad="${escapeHTML(ad.id)}">${escapeHTML(ad.cta)} →</button>
        </div>
      </article>
    `).join("")
    : '<p class="empty-state">No campaigns are available.</p>';
}

function switchTab(tab) {
  const validTabs = ["home", "safiri", "market", "modules"];
  if (!validTabs.includes(tab)) return;

  state.activeTab = tab;

  $$(".tab-panel").forEach((panel) => panel.classList.remove("active"));
  $(`#${tab}Tab`).classList.add("active");

  $$(".nav-item").forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle("active", active);

    if (active) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openModal(modal) {
  state.previousFocus = document.activeElement;
  $("#modalBackdrop").hidden = false;
  $("#checkoutModal").hidden = modal !== "checkout";
  $("#moduleModal").hidden = modal !== "module";
  document.body.style.overflow = "hidden";

  const target = modal === "checkout"
    ? $("#paymentProvider")
    : $("#modulePrompt");

  requestAnimationFrame(() => target.focus());
}

function closeModal() {
  $("#modalBackdrop").hidden = true;
  $("#checkoutModal").hidden = true;
  $("#moduleModal").hidden = true;
  document.body.style.overflow = "";

  if (state.previousFocus && typeof state.previousFocus.focus === "function") {
    state.previousFocus.focus();
  }
}

function openCheckout(productId) {
  const product = state.products.find((item) => item.id === productId);

  if (!product) {
    toast("That product is no longer available.");
    return;
  }

  state.activeProduct = product;

  $("#checkoutProduct").textContent =
    `${product.name} · ${product.category}`;
  $("#checkoutPrice").textContent = money(
    product.price,
    product.currency
  );
  $("#checkoutMessage").textContent = "";
  $("#checkoutMessage").classList.remove("error");
  $("#confirmCheckout").textContent = "Buy Now";
  $("#confirmCheckout").disabled = false;

  setMode(state.mode, false);
  openModal("checkout");
}

function openModule(moduleId) {
  const module = state.modules.find((item) => item.id === moduleId);

  if (!module) {
    toast("That module is currently unavailable.");
    return;
  }

  state.activeModule = module;

  $("#moduleModalTitle").textContent = module.name;
  $("#moduleCategory").textContent = module.category;
  $("#moduleDescription").textContent = module.description;
  $("#modulePrompt").value = "";
  $("#moduleResponse").textContent = "";
  $("#moduleDisclaimer").textContent = "";
  $("#moduleResult").hidden = true;
  $("#moduleError").textContent = "";
  $("#moduleError").classList.remove("error");

  $("#runModule").textContent = "Run demo assistant →";
  $("#runModule").disabled = false;

  openModal("module");
}

async function submitModule(event) {
  event.preventDefault();

  if (!state.activeModule || state.busy) return;

  const prompt = $("#modulePrompt").value.trim();
  if (!prompt) {
    setFeedback($("#moduleError"), "Enter a question first.", true);
    return;
  }

  state.busy = true;
  setButtonBusy($("#runModule"), true, "Thinking...");

  try {
    const result = await api(
      `/module/${encodeURIComponent(state.activeModule.id)}`,
      {
        method: "POST",
        body: JSON.stringify({ prompt })
      }
    );

    $("#moduleResponse").textContent = result.response;
    $("#moduleDisclaimer").textContent = result.disclaimer;
    $("#moduleResult").hidden = false;
    setFeedback($("#moduleError"), "Demo response generated.");
  } catch (error) {
    setFeedback($("#moduleError"), error.message, true);
  } finally {
    state.busy = false;
    setButtonBusy($("#runModule"), false);
  }
}

async function submitCheckout() {
  const product = state.activeProduct;
  if (!product || state.busy) return;

  const button = $("#confirmCheckout");
  const feedback = $("#checkoutMessage");
  const provider = $("#paymentProvider").value;

  state.busy = true;
  setFeedback(feedback, "");
  setButtonBusy(button, true, "Processing...");

  try {
    const payload = {
      provider,
      product_id: product.id,
      mode: state.mode,
      success_url: `${window.location.origin}/?checkout=success`,
      cancel_url: `${window.location.origin}/?checkout=cancel`
    };

    const result = await api("/checkout", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    if (result.mode === "demo" && result.success) {
      closeModal();

      // Explicitly confirm that no real payment was taken.
      window.alert(
        `Jibu demo checkout successful!\n\n` +
        `Order: ${result.order_reference}\n` +
        `Product: ${result.product}\n` +
        `Total: ${money(result.amount, result.currency)}\n\n` +
        `No payment gateway was contacted. No money was charged.`
      );

      toast("Demo order completed. No money was charged.");
      return;
    }

    if (result.mode === "real" && result.checkout_url) {
      // Redirect only to an HTTPS checkout URL.
      const checkoutUrl = new URL(result.checkout_url);

      if (checkoutUrl.protocol !== "https:") {
        throw new Error("The payment provider returned an unsafe URL.");
      }

      window.location.assign(checkoutUrl.href);
      return;
    }

    throw new Error(
      result.message || "The payment provider did not return a checkout URL."
    );
  } catch (error) {
    setFeedback(feedback, error.message, true);
    toast("Checkout could not be completed.");
  } finally {
    state.busy = false;
    setButtonBusy(button, false);
  }
}

function handleAdClick(adId) {
  const ad = state.ads.find((item) => item.id === adId);
  if (!ad) return;

  if (ad.destination) {
    try {
      const destination = new URL(ad.destination, window.location.origin);
      if (destination.protocol === "https:" ||
          destination.origin === window.location.origin) {
        window.location.assign(destination.href);
        return;
      }
    } catch {
      // Show the safe fallback below.
    }
  }

  toast(`${ad.title}: this demo campaign has no live destination.`);
}

function bindEvents() {
  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  $$("[data-tab-link]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      switchTab(button.dataset.tabLink);
    });
  });

  $("#modeToggle").addEventListener("click", () => {
    const next = state.mode === "demo" ? "real" : "demo";
    setMode(next);

    if (next === "real") {
      toast(state.serverConfig.real_payments_enabled
        ? "Real mode selected. Live checkout still depends on provider configuration."
        : "Real mode selected, but the server has real payments disabled.");
    } else {
      toast("Demo mode enabled. No money will be charged.");
    }
  });

  $("#productSearch").addEventListener("input", renderProducts);
  $("#moduleSearch").addEventListener("input", filterModules);
  $("#moduleForm").addEventListener("submit", submitModule);
  $("#confirmCheckout").addEventListener("click", submitCheckout);

  document.addEventListener("click", (event) => {
    const moduleButton = event.target.closest("[data-module]");
    if (moduleButton) {
      openModule(moduleButton.dataset.module);
      return;
    }

    const buyButton = event.target.closest("[data-buy]");
    if (buyButton) {
      openCheckout(buyButton.dataset.buy);
      return;
    }

    const adButton = event.target.closest("[data-ad]");
    if (adButton) {
      handleAdClick(adButton.dataset.ad);
      return;
    }

    if (event.target.closest("[data-close-modal]")) {
      closeModal();
    }
  });

  $("#modalBackdrop").addEventListener("click", closeModal);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("#modalBackdrop").hidden) {
      closeModal();
    }
  });

  // Handle return query parameters without trusting them as payment proof.
  const params = new URLSearchParams(window.location.search);

  if (params.get("checkout") === "success") {
    toast("Returned from checkout. Verify payment with the server before fulfilling an order.");
    window.history.replaceState({}, "", window.location.pathname);
  } else if (params.get("checkout") === "cancel") {
    toast("Checkout was cancelled.");
    window.history.replaceState({}, "", window.location.pathname);
  }
}

async function init() {
  bindEvents();
  await loadConfig();
  await loadDashboard();

  // Render the initial view even if the API is temporarily unavailable.
  renderStats();
  renderProducts();
  renderAds();
  renderModules();
  switchTab("home");
}

document.addEventListener("DOMContentLoaded", init);
