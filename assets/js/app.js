import {
  Product,
  PRODUCTS,
  PRODUCT_PRICE,
  PRODUCT_META,
} from "./products.js";

import {
  SupabaseApi,
  isSupabaseConfigured,
} from "./supabase-api.js";

// ============================================================
// AURA & ESSENCE FRONTEND
// SAFE PERFORMANCE OPTIMIZED VERSION
// ============================================================

const reviewStats = {};

// Latest approved reviews, kept so the star ratings can be
// recalculated once the product list from the database arrives
// (products like "Clinique Happy" only exist after that).
let lastReviews = [];

// ============================================================
// OOP CORE SERVICES
// ============================================================

class ProductCatalog {
  constructor(products, meta = {}) {
    this.products = products.map(
      (product) =>
        new Product({
          ...product,
          ...(meta[product.id] || {}),
        }),
    );

    this.meta = meta;

    // Fast product lookup while keeping original array structure.
    this.index = new Map();

    this.products.forEach((product) => {
      this.index.set(String(product.id), product);
    });
  }

  all() {
    return this.products;
  }

  find(id) {
    return this.index.get(String(id));
  }

  upsert(data) {
    const id = String(data.id);

    const existing = this.index.get(id);

    if (existing) {
      Object.assign(existing, data);

      this.invalidateCache(id);

      return existing;
    }

    const product = new Product(data);

    this.products.push(product);

    this.index.set(id, product);

    this.invalidateCache(id);

    return product;
  }

  remove(id) {
    const key = String(id);

    this.products = this.products.filter(
      (product) => String(product.id) !== key,
    );

    this.index.delete(key);

    this.invalidateCache(key);
  }

  invalidateCache(id) {
    if (typeof productSearchCache !== "undefined") {
      productSearchCache.delete(String(id));
    }
  }
}

// ============================================================
// CART MANAGER
// ============================================================

class CartManager {
  constructor(storageKey = "aeCart") {
    this.storageKey = storageKey;

    try {
      const saved = JSON.parse(
        localStorage.getItem(storageKey) || "[]",
      );

      this.items = Array.isArray(saved) ? saved : [];
    } catch {
      this.items = [];
    }
  }

  save() {
    localStorage.setItem(
      this.storageKey,
      JSON.stringify(this.items),
    );
  }

  find(id) {
    return this.items.find(
      (item) => String(item.id) === String(id),
    );
  }

  clear() {
    this.items = [];

    this.save();
  }

  add(product, qty = 1) {
    if (
      !product ||
      product.active === false ||
      product.stock === 0
    ) {
      return false;
    }

    const existing = this.find(product.id);

    const nextQty =
      (existing?.qty || 0) + qty;

    if (
      product.stock != null &&
      nextQty > Number(product.stock)
    ) {
      return false;
    }

    if (existing) {
      existing.qty = nextQty;
    } else {
      this.items.push({
        id: product.id,
        qty,
      });
    }

    this.save();

    return true;
  }

  change(product, delta) {
    const item = this.find(product?.id);

    if (!item || !product) {
      return;
    }

    item.qty = Math.max(
      0,
      Number(item.qty || 0) + delta,
    );

    if (product.stock != null) {
      item.qty = Math.min(
        item.qty,
        Number(product.stock),
      );
    }

    if (item.qty === 0) {
      this.remove(product.id);

      return;
    }

    this.save();
  }

  remove(id) {
    this.items = this.items.filter(
      (item) =>
        String(item.id) !== String(id),
    );

    this.save();
  }

  total(catalog) {
    let total = 0;

    for (const item of this.items) {
      const product = catalog.find(item.id);

      if (product) {
        total +=
          Number(product.priceValue || product.price || 0) *
          Number(item.qty || 0);
      }
    }

    return total;
  }
}

// ============================================================
// WISHLIST MANAGER
// ============================================================

class WishlistManager {
  constructor(storageKey = "aeFavorites") {
    this.storageKey = storageKey;

    try {
      const saved = JSON.parse(
        localStorage.getItem(storageKey) || "[]",
      );

      this.items = Array.isArray(saved)
        ? saved
        : [];
    } catch {
      this.items = [];
    }
  }

  has(id) {
    return this.items.includes(id);
  }

  toggle(id) {
    this.items = this.has(id)
      ? this.items.filter(
          (item) => item !== id,
        )
      : [...this.items, id];

    localStorage.setItem(
      this.storageKey,
      JSON.stringify(this.items),
    );

    return this.items;
  }
}

// ============================================================
// API CLIENT
// ============================================================

// The backend client now lives in supabase-api.js.

// ============================================================
// GLOBAL SERVICES
// ============================================================

const catalog = new ProductCatalog(
  PRODUCTS,
  PRODUCT_META,
);

const cartManager =
  new CartManager();

const wishlistManager =
  new WishlistManager();

let apiClient;

let favorites =
  wishlistManager.items;

let cart =
  cartManager.items;

// ============================================================
// PRODUCT SEARCH CACHE
//
// Stores normalized search/profile information.
// This avoids rebuilding strings every time
// the user types in the search box.
// ============================================================

const productSearchCache =
  new Map();

function getProductSearchData(product) {
  const id = String(product.id);

  const cached =
    productSearchCache.get(id);

  if (cached) {
    return cached;
  }

  const meta =
    PRODUCT_META[product.id] || {};

  let profiles = [];

  if (Array.isArray(meta.profiles)) {
    profiles =
      meta.profiles
        .map((profile) =>
          String(profile)
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean);
  } else if (
    typeof meta.profiles ===
    "string"
  ) {
    profiles =
      meta.profiles
        .split(",")
        .map((profile) =>
          String(profile)
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean);
  }

  const searchable = [
    product.name,
    product.desc,
    ...(product.topNotes || []),
    ...(product.heartNotes || []),
    ...(product.baseNotes || []),
    ...profiles,
  ]
    .join(" ")
    .toLowerCase();

  const result = {
    profiles,
    searchable,
  };

  productSearchCache.set(
    id,
    result,
  );

  return result;
}

// ============================================================
// BASIC HELPERS
// ============================================================

function getProductById(id) {
  return catalog.find(id);
}

let activePromotions = [];

function getCartSubtotal() {
  return cartManager.total(
    catalog,
  );
}

function getCartQuantity() {
  return cart.reduce(
    (sum, item) =>
      sum + Number(item.qty || 0),
    0,
  );
}

function getApplicablePromotion(quantity = getCartQuantity()) {
  if (!quantity || !activePromotions.length) {
    return null;
  }

  return activePromotions
    .filter((promotion) => {
      const minQty = Number(
        promotion.minQty || 0,
      );

      if (
        !promotion.active ||
        quantity < minQty
      ) {
        return false;
      }

      if (promotion.type === "fixed_total") {
        return quantity === minQty;
      }

      if (promotion.type === "percent") {
        return true;
      }

      return false;
    })
    .sort(
      (a, b) =>
        Number(b.minQty || 0) -
        Number(a.minQty || 0),
    )[0] || null;
}

function calculatePromotionDiscount(
  subtotal,
  quantity = getCartQuantity(),
) {
  const promotion =
    getApplicablePromotion(quantity);

  if (!promotion) {
    return {
      discount: 0,
      total: subtotal,
      promotion: null,
    };
  }

  if (promotion.type === "fixed_total") {
    const fixedTotal = Number(
      promotion.fixedTotal || 0,
    );

    if (
      fixedTotal > 0 &&
      fixedTotal < subtotal
    ) {
      return {
        discount: subtotal - fixedTotal,
        total: fixedTotal,
        promotion,
      };
    }
  }

  if (promotion.type === "percent") {
    const percent = Math.min(
      100,
      Math.max(
        0,
        Number(
          promotion.percentOff || 0,
        ),
      ),
    );

    const discount = Number(
      (subtotal * (percent / 100)).toFixed(2),
    );

    return {
      discount,
      total: Math.max(
        0,
        Number(
          (subtotal - discount).toFixed(2),
        ),
      ),
      promotion,
    };
  }

  return {
    discount: 0,
    total: subtotal,
    promotion: null,
  };
}

function getCartTotal() {
  return calculatePromotionDiscount(
    getCartSubtotal(),
  ).total;
}

async function loadActivePromotions() {
  if (
    !isSupabaseConfigured()
  ) {
    return;
  }

  try {
    const result =
      await apiClient.get({
        action: "promotions",
      });

    if (
      !result.success ||
      !Array.isArray(
        result.promotions,
      )
    ) {
      activePromotions = [];
      return;
    }

    activePromotions =
      result.promotions.filter(
        (promotion) =>
          promotion.active === true ||
          String(
            promotion.active,
                    ).toLowerCase() === "true",
      );

    renderCart();
    syncQuantity();
    renderPromoBar();
    renderDuo();
  } catch (error) {
    console.warn(
      "Promotions unavailable; using regular prices.",
      error,
    );
    activePromotions = [];
  }
}

function saveCart() {
  cartManager.items = cart;

  cartManager.save();

  renderCart();
}

function addToCart(id, qty = 1) {
  const product =
    getProductById(id);

  if (!product) {
    return;
  }

  const existing =
    cartManager.find(id);

  const next =
    (existing?.qty || 0) + qty;

    if (
    product.stock != null &&
    next > Number(product.stock)
  ) {
    showToast(
      Number(product.stock) === 0
        ? `${escapeHTML(product.name)} is sold out.`
        : `Only ${Number(product.stock)} bottle(s) of ${escapeHTML(product.name)} available.`,
      { warn: true },
    );

    return false;
  }

  if (
    !cartManager.add(
      product,
      qty,
    )
  ) {
    return false;
  }

  cart =
    cartManager.items;

  renderCart();

  showToast(
    `Added <b>${escapeHTML(product.name)}</b> to your cart ✓`,
    { link: true },
  );
  bumpCart();

  return true;
}

function changeCartQty(
  id,
  delta,
) {
  const product =
    getProductById(id);

  if (!product) {
    return;
  }

  cartManager.change(
    product,
    delta,
  );

  cart =
    cartManager.items;

  renderCart();
}

function removeFromCart(id) {
  cartManager.remove(id);

  cart =
    cartManager.items;

  renderCart();
}

// ============================================================
// DOM REFERENCES
// ============================================================

const carousel =
  document.getElementById(
    "carousel",
  );

const carouselPrev =
  document.getElementById(
    "carouselPrev",
  );

const carouselNext =
  document.getElementById(
    "carouselNext",
  );

const scentSelect =
  document.getElementById(
    "scent",
  );

const tabs =
  document.querySelectorAll(
    ".tab",
  );

let activeCat = "men";

const productSearch =
  document.getElementById(
    "productSearch",
  );

const profileFilter =
  document.getElementById(
    "profileFilter",
  );

const wishlistToggle =
  document.getElementById(
    "wishlistToggle",
  );

const wishlistPanel =
  document.getElementById(
    "wishlistPanel",
  );

const wishlistItems =
  document.getElementById(
    "wishlistItems",
  );

const wishlistEmpty =
  document.getElementById(
    "wishlistEmpty",
  );

// ============================================================
// CART DOM
// ============================================================

const cartItemsElement =
  document.getElementById(
    "cartItems",
  );

const cartCountElement =
  document.getElementById(
    "cartCount",
  );

const cartTotalElement =
  document.getElementById(
    "cartTotal",
  );

// ============================================================
// CART RENDER
// ============================================================

function renderCart() {
  updateHeaderCart();
  scheduleVoucherRefresh();
  renderCheckoutExtras();

  const wrap =
    cartItemsElement;

  const count =
    cartCountElement;

  const total =
    cartTotalElement;

  if (!wrap) {
    return;
  }

  const valid =
    cart.filter((item) =>
      getProductById(item.id),
    );

  if (
    valid.length !==
    cart.length
  ) {
    cart = valid;

    cartManager.items =
      cart;

    cartManager.save();
  }

  const totalQty =
    cart.reduce(
      (sum, item) =>
        sum +
        Number(item.qty || 0),
      0,
    );

  if (count) {
    count.textContent =
      `${totalQty} ${
        totalQty === 1
          ? "item"
          : "items"
      }`;
  }

  if (total) {
    total.textContent =
      `₱${getCartTotal().toLocaleString()}`;
  }

  if (!cart.length) {
    wrap.innerHTML =
      '<div class="cart-empty">Your cart is empty. Add one or more fragrances above.</div>';

    return;
  }

  const html = [];

  for (const item of cart) {
    const p =
      getProductById(
        item.id,
      );

    if (!p) {
      continue;
    }

    html.push(`
      <div class="cart-item">

        ${p.img
          ? `<img
          src="${escapeHTML(p.img)}"
          alt="${escapeHTML(p.name)}"
          decoding="async"
          onerror="this.onerror=null;this.outerHTML='<div class=&quot;img-ph&quot; aria-hidden=&quot;true&quot;>A&amp;E</div>'"
        >`
          : `<div class="img-ph" aria-hidden="true">A&amp;E</div>`}

        <div>

          <div class="cart-item-name">
            ${p.name}
          </div>

          <div class="cart-item-price">
            ₱${Number(
              p.price ||
                PRODUCT_PRICE,
            ).toLocaleString()}
            each
          </div>

        </div>

        <div class="cart-controls">

          <button
            type="button"
            data-cart-minus="${p.id}"
          >
            −
          </button>

          <span>
            ${item.qty}
          </span>

          <button
            type="button"
            data-cart-plus="${p.id}"
          >
            +
          </button>

          <button
            type="button"
            class="cart-remove"
            data-cart-remove="${p.id}"
            aria-label="Remove ${p.name}"
          >
            ×
          </button>

        </div>

      </div>
    `);
  }

  wrap.innerHTML =
    html.join("");
}

// ============================================================
// CART EVENTS
// ============================================================

cartItemsElement?.addEventListener(
  "click",
  (e) => {
    const minus =
      e.target.closest(
        "[data-cart-minus]",
      );

    const plus =
      e.target.closest(
        "[data-cart-plus]",
      );

    const remove =
      e.target.closest(
        "[data-cart-remove]",
      );

    if (minus) {
      changeCartQty(
        minus.dataset
          .cartMinus,
        -1,
      );
    }

    if (plus) {
      changeCartQty(
        plus.dataset
          .cartPlus,
        1,
      );
    }

    if (remove) {
      removeFromCart(
        remove.dataset
          .cartRemove,
      );
    }
  },
);

document
  .getElementById(
    "addSelectedToCart",
  )
  ?.addEventListener(
    "click",
    () => {
      if (
        scentSelect?.value
      ) {
        addToCart(
          scentSelect.value,
          1,
        );
      }
    },
  );

// ============================================================
// PRODUCT FILTER
// ============================================================

function getVisibleProducts(cat) {
  const query = (
    productSearch?.value ||
    ""
  )
    .trim()
    .toLowerCase();

  const selectedProfile =
    String(
      profileFilter?.value ||
        "all",
    )
      .trim()
      .toLowerCase();

  return catalog
    .all()
    .filter((p) => {
      if (
        p.active === false
      ) {
        return false;
      }

      // IMPORTANT:
      // Product category is p.cat
      if (p.cat !== cat) {
        return false;
      }

      const searchData =
        getProductSearchData(
          p,
        );

      if (
        query &&
        !searchData.searchable.includes(
          query,
        )
      ) {
        return false;
      }

      if (
        selectedProfile !==
          "all" &&
        !searchData.profiles.includes(
          selectedProfile,
        )
      ) {
        return false;
      }

      return true;
    })
    .sort(
      (a, b) =>
        Number(
          a.sortOrder || 0,
        ) -
        Number(
          b.sortOrder || 0,
        ),
    );
}

// ============================================================
// PRODUCT CAROUSEL
// ============================================================

function buildProductCard(p) {
  const card =
    document.createElement(
      "div",
    );

  const stock =
    p.stock == null || p.stock === ""
      ? null
      : Number(p.stock);

  const soldOut = stock === 0;

  card.className =
    "pcard" + (soldOut ? " is-sold-out" : "");

  const meta =
    PRODUCT_META[p.id] ||
    {};

  const stats =
    reviewStats[p.id] || {
      avg: 0,
      count: 0,
    };

  // Stars only when there are reviews (no "No reviews yet")
  const ratingText =
    stats.count
      ? `★ ${stats.avg.toFixed(1)} <span>(${stats.count})</span>`
      : "";

  const badges = (
    meta.badges || []
  )
    .map(
      (b) =>
        `<span class="product-badge">${escapeHTML(b)}</span>`,
    )
    .join("");

  const saved =
    favorites.includes(
      p.id,
    );

  const stockNote =
    stock === null
      ? ""
      : soldOut
        ? `<span class="stock-note out">SOLD OUT</span>`
        : stock <= 2
          ? `<span class="stock-note low">Only ${stock} left!</span>`
          : `<span class="stock-note">In stock</span>`;

  const id = escapeHTML(p.id);
  const name = escapeHTML(p.name);

  card.innerHTML = `
    <div class="pimg">
      <div class="product-badges">
        ${badges}
      </div>
      <button
        type="button"
        class="wishlist-btn ${saved ? "active" : ""}"
        data-wishlist-id="${id}"
        aria-label="${saved ? "Remove" : "Add"} ${name} ${saved ? "from" : "to"} favorites"
      >
        ${saved ? "♥" : "♡"}
      </button>
      <img
        src="${escapeHTML(p.img || "")}"
        alt="${name}"
        loading="lazy"
        decoding="async"
        onerror="this.onerror=null;this.closest('.pimg').classList.add('noimg');this.remove();"
      >
    </div>
    <div class="pbody">
      <span class="ptag">
        ${p.cat === "women" ? "FOR HER" : p.cat === "unisex" ? "UNISEX" : "FOR HIM"}
      </span>
      <h4>
        ${name}
      </h4>
      <p>
        ${escapeHTML(p.desc || "")}
      </p>
      <div class="product-rating">${ratingText}</div>
      <div class="pfoot">
        <span class="pprice">
          &#8369;${Number(p.price || PRODUCT_PRICE).toLocaleString()}
        </span>
        <div class="pactions">
          <button
            type="button"
            class="pdetails"
            data-details-id="${id}"
          >
            Details
          </button>
          <button
            type="button"
            class="porder"
            data-id="${id}"
            ${soldOut ? "disabled" : ""}
          >
            ${soldOut ? "Sold Out" : "Add"}
          </button>
        </div>
      </div>
      ${stockNote}
    </div>
  `;

  return card;
}

function renderCarousel(cat) {
  if (!carousel) {
    return;
  }

  if (!isCatalogReady()) {
    carousel.innerHTML = Array.from({ length: 4 }, () =>
      '<div class="pcard skeleton" aria-hidden="true"><div class="pimg"></div><div class="pbody"><i></i><i></i><i class="short"></i></div></div>').join("");
    return;
  }

  carousel.innerHTML =
    "";

  const products =
    getVisibleProducts(
      cat,
    );

  const fragment =
    document.createDocumentFragment();

  products.forEach((p) => {
    fragment.appendChild(
      buildProductCard(p),
    );
  });

  if (!products.length) {
    carousel.innerHTML =
      '<div class="summary-empty" style="min-width:100%">No fragrances match your search or filter.</div>';
  } else {
    carousel.appendChild(
      fragment,
    );
  }

  // Featured rows use the same cards (stars, stock, favorites)
  if (typeof renderFeaturedRows === "function") {
    renderFeaturedRows();
  }

  requestAnimationFrame(
    updateCarouselArrows,
  );
}


// ============================================================
// CAROUSEL CONTROLS
// ============================================================

function updateCarouselArrows() {
  if (
    !carousel ||
    !carouselPrev ||
    !carouselNext
  ) {
    return;
  }

  const maxScroll =
    carousel.scrollWidth -
    carousel.clientWidth;

  const hasOverflow =
    maxScroll > 2;

  carouselPrev.disabled =
    !hasOverflow ||
    carousel.scrollLeft <= 2;

  carouselNext.disabled =
    !hasOverflow ||
    carousel.scrollLeft >=
      maxScroll - 2;
}

function scrollCarousel(
  direction,
) {
  if (!carousel) {
    return;
  }

  const card =
    carousel.querySelector(
      ".pcard",
    );

  const gap = 18;

  const amount = card
    ? card.getBoundingClientRect()
        .width + gap
    : 248;

  carousel.scrollBy({
    left:
      direction * amount,
    behavior: "smooth",
  });
}

// ============================================================
// WISHLIST
// ============================================================

function updateWishlistPanel() {
  // The favorites drawer (see FAVORITES DRAWER at the end of this file)
  renderFavorites();
}

function toggleFavorite(id) {
  favorites =
    wishlistManager.toggle(
      id,
    );

  onFavoritesChanged(id);
  updateWishlistPanel();

  renderCarousel(
    activeCat,
  );
}

// ============================================================
// CAROUSEL LISTENERS
// ============================================================

carouselPrev?.addEventListener(
  "click",
  () => scrollCarousel(-1),
);

carouselNext?.addEventListener(
  "click",
  () => scrollCarousel(1),
);

carousel?.addEventListener(
  "scroll",
  updateCarouselArrows,
  {
    passive: true,
  },
);

// ============================================================
// RESIZE OPTIMIZATION
// ============================================================

let resizeTimer = null;

window.addEventListener(
  "resize",
  () => {
    clearTimeout(
      resizeTimer,
    );

    resizeTimer = setTimeout(
      updateCarouselArrows,
      100,
    );
  },
  {
    passive: true,
  },
);

// ============================================================
// SEARCH DEBOUNCE
// ============================================================

let searchTimer = null;

productSearch?.addEventListener(
  "input",
  () => {
    clearTimeout(
      searchTimer,
    );

    searchTimer = setTimeout(
      () => {
        renderCarousel(
          activeCat,
        );
      },
      150,
    );
  },
);

// ============================================================
// PROFILE FILTER
// ============================================================

profileFilter?.addEventListener(
  "change",
  () =>
    renderCarousel(
      activeCat,
    ),
);

// ============================================================
// WISHLIST PANEL
// ============================================================

wishlistToggle?.addEventListener(
  "click",
  () => openFavorites(),
);

wishlistItems?.addEventListener(
  "click",
  (e) => {
    const b =
      e.target.closest(
        "[data-wishlist-jump]",
      );

    if (!b) {
      return;
    }

    const p =
      catalog.find(
        b.dataset
          .wishlistJump,
      );

    if (!p) {
      return;
    }

    activeCat = p.cat;

    tabs.forEach((t) =>
      t.classList.toggle(
        "active",
        t.dataset.cat ===
          activeCat,
      ),
    );

    renderCarousel(
      activeCat,
    );

    document
      .getElementById(
        "collection",
      )
      ?.scrollIntoView({
        behavior: "smooth",
      });
  },
);

// ============================================================
// SCENT OPTIONS
// ============================================================

function renderScentOptions() {
  if (!scentSelect) {
    return;
  }

  scentSelect.innerHTML =
    '<option value="">Choose a scent…</option>' +
    catalog
      .all()
      .filter((p) => p.active == true)
      .map(
        (p) =>
          `<option value="${escapeHTML(p.id)}"${p.stock != null && Number(p.stock) <= 0 ? " disabled" : ""}>${escapeHTML(p.name)} (${
            p.cat === "men"
              ? "For Him"
              : p.cat === "unisex" ? "Unisex" : "For Her"
          })${p.stock != null && Number(p.stock) <= 0 ? " — sold out" : ""}</option>`,
      )
      .join("");
}

// ============================================================
// FRAGRANCE DETAILS MODAL
// ============================================================

const fragranceModal =
  document.getElementById(
    "fragranceModal",
  );

const fragranceClose =
  document.getElementById(
    "fragranceClose",
  );

const fragranceModalTitle =
  document.getElementById(
    "fragranceModalTitle",
  );

const fragranceModalCategory =
  document.getElementById(
    "fragranceModalCategory",
  );

const fragranceModalDescription =
  document.getElementById(
    "fragranceModalDescription",
  );

const fragranceTopNotes =
  document.getElementById(
    "fragranceTopNotes",
  );

const fragranceHeartNotes =
  document.getElementById(
    "fragranceHeartNotes",
  );

const fragranceBaseNotes =
  document.getElementById(
    "fragranceBaseNotes",
  );

const fragranceApplication =
  document.getElementById(
    "fragranceApplication",
  );

const fragranceOccasion =
  document.getElementById(
    "fragranceOccasion",
  );

const fragranceProfileBars =
  document.getElementById(
    "fragranceProfileBars",
  );

const fragranceDayNight =
  document.getElementById(
    "fragranceDayNight",
  );

// ============================================================
// HTML ESCAPE
// ============================================================

function escapeHTML(value) {
  return String(value ?? "")
    .replace(
      /&/g,
      "&amp;",
    )
    .replace(
      /</g,
      "&lt;",
    )
    .replace(
      />/g,
      "&gt;",
    )
    .replace(
      /"/g,
      "&quot;",
    )
    .replace(
      /'/g,
      "&#039;",
    );
}

// ============================================================
// STRENGTH NORMALIZATION
// ============================================================

function normalizeStrength(
  value,
) {
  const strength =
    String(
      value || "moderate",
    )
      .trim()
      .toLowerCase();

  if (
    strength === "light"
  ) {
    return "subtle";
  }

  if (
    strength === "strong"
  ) {
    return "bold";
  }

  if (
    [
      "subtle",
      "moderate",
      "bold",
    ].includes(strength)
  ) {
    return strength;
  }

  return "moderate";
}

// ============================================================
// OPEN FRAGRANCE DETAILS
// ============================================================

function openFragranceDetails(
  productId,
) {
  const product =
    catalog.find(productId);

  if (!product) {
    return;
  }

  // Built in the PRODUCT DETAILS section at the end of this file
  renderFragranceDetails(product);

  fragranceModal.classList.add(
    "show",
  );

  fragranceModal.setAttribute(
    "aria-hidden",
    "false",
  );

  document.body.style.overflow =
    "hidden";
}

// ============================================================
// CLOSE FRAGRANCE DETAILS
// ============================================================

function closeFragranceDetails() {
  clearDetailsHash();

  fragranceModal.classList.remove(
    "show",
  );

  fragranceModal.setAttribute(
    "aria-hidden",
    "true",
  );

  document.body.style.overflow =
    "";
}

fragranceClose?.addEventListener(
  "click",
  closeFragranceDetails,
);

fragranceModal?.addEventListener(
  "click",
  (e) => {
    if (
      e.target ===
      fragranceModal
    ) {
      closeFragranceDetails();
    }
  },
);

document.addEventListener(
  "keydown",
  (e) => {
    if (
      e.key === "Escape" &&
      fragranceModal?.classList.contains(
        "show",
      )
    ) {
      closeFragranceDetails();
    }
  },
);

// ============================================================
// CATEGORY TABS
// ============================================================

tabs.forEach((tab) => {
  tab.addEventListener(
    "click",
    () => {
      tabs.forEach((t) =>
        t.classList.remove(
          "active",
        ),
      );

      tab.classList.add(
        "active",
      );

      activeCat =
        tab.dataset.cat;

      renderCarousel(
        activeCat,
      );

      requestAnimationFrame(
        updateCarouselArrows,
      );
    },
  );
});

// ============================================================
// CAROUSEL CLICK EVENTS
// ============================================================

function handleProductClick(e) {
  const wish =
    e.target.closest(
      ".wishlist-btn",
    );

  if (wish) {
    toggleFavorite(
      wish.dataset
        .wishlistId,
    );
    return;
  }

  const detailsBtn =
    e.target.closest(
      ".pdetails",
    );

  if (detailsBtn) {
    openFragranceDetails(
      detailsBtn.dataset
        .detailsId,
    );
    return;
  }

  const btn =
    e.target.closest(
      ".porder",
    );

  if (
    !btn ||
    btn.disabled
  ) {
    return;
  }

  // Customers stay on the product list; the toast offers "View cart".
  if (addToCart(btn.dataset.id, 1) && scentSelect) {
    scentSelect.value =
      btn.dataset.id;
  }
}

carousel?.addEventListener(
  "click",
  handleProductClick,
);

document
  .getElementById("featuredRows")
  ?.addEventListener(
    "click",
    handleProductClick,
  );


// ============================================================
// INITIAL RENDER
// ============================================================

renderScentOptions();

updateWishlistPanel();

renderCarousel(
  activeCat,
);

requestAnimationFrame(
  updateCarouselArrows,
);

// ============================================================
// SUPABASE DATABASE
// ============================================================

apiClient =
  new SupabaseApi();

// ============================================================
// PRODUCT CATALOG SYNC
// ============================================================

async function loadManagedProducts() {
  if (
    !isSupabaseConfigured()
  ) {
    return;
  }

  try {
    const result =
      await apiClient.get({
        action: "products",
      });

    if (
      !result.success ||
      !Array.isArray(
        result.products,
      )
    ) {
      return;
    }

    result.products.forEach(
      (remote) => {
        const existing =
          catalog.find(
            remote.id,
          );

        if (existing) {
          Object.assign(
            existing,
            {
              ...existing,
              ...remote,

              img:
                remote.img ||
                existing.img,

              desc:
                remote.desc ||
                existing.desc,

              descLong:
                remote.descLong ||
                existing.descLong,

              topNotes:
                remote.topNotes
                  ?.length
                  ? remote.topNotes
                  : existing.topNotes,

              heartNotes:
                remote.heartNotes
                  ?.length
                  ? remote.heartNotes
                  : existing.heartNotes,

              baseNotes:
                remote.baseNotes
                  ?.length
                  ? remote.baseNotes
                  : existing.baseNotes,

              application:
                remote.application ||
                existing.application,
            },
          );

          // Product changed.
          // Rebuild its search cache next time.
          productSearchCache.delete(
            String(
              remote.id,
            ),
          );
        } else {
          catalog.upsert(
            remote,
          );
        }

        PRODUCT_META[
          remote.id
        ] = Object.assign(
          PRODUCT_META[
            remote.id
          ] || {},

          {
            profiles:
              remote.profiles ||
              [],

            occasion:
              remote.occasion ||
              "",

            strength: (
              {
                light:
                  "subtle",

                strong:
                  "bold",
              }[
                String(
                  remote.strength ||
                    "moderate",
                ).toLowerCase()
              ] ||
              String(
                remote.strength ||
                  "moderate",
              )
            ).toLowerCase(),

            longevity:
              remote.longevity ||
              7,

            projection:
              remote.projection ||
              7,

            time:
              remote.time ||
              [],

            badges:
              remote.badges ||
              [],

            sortOrder:
              remote.sortOrder ||
              0,
          },
        );

        // Metadata changed.
        productSearchCache.delete(
          String(
            remote.id,
          ),
        );
      },
    );

    window.__aeCatalogReady = true;

    renderScentOptions();

    renderReviewScentOptions();

        // Reviews may have loaded before these products existed.
    computeReviewStats();

    renderStoreContent();

    renderCarousel(
      activeCat,
    );

    renderCart();

    syncQuantity();
  } catch (error) {
    console.warn(
      "Managed catalog unavailable; using built-in catalog.",
      error,
    );
  } finally {
    if (!window.__aeCatalogReady) {
      // database unreachable: fall back to the built-in list
      window.__aeCatalogReady = true;
      renderStoreContent();
      renderCarousel(activeCat);
    }
  }
}

loadManagedProducts();
loadActivePromotions();

// ============================================================
// CUSTOMER REVIEWS
// ============================================================

const reviewForm =
  document.getElementById(
    "reviewForm",
  );

const reviewScent =
  document.getElementById(
    "reviewScent",
  );

const reviewRating =
  document.getElementById(
    "reviewRating",
  );

const starButtons =
  document.querySelectorAll(
    "#starSelect button",
  );

const reviewSubmit =
  document.getElementById(
    "reviewSubmit",
  );

const reviewStatus =
  document.getElementById(
    "reviewStatus",
  );

const reviewsCarousel =
  document.getElementById(
    "reviewsCarousel",
  );

const reviewsLoading =
  document.getElementById(
    "reviewsLoading",
  );

const reviewsEmpty =
  document.getElementById(
    "reviewsEmpty",
  );

// ============================================================
// REVIEW SCENT OPTIONS
// ============================================================

function renderReviewScentOptions() {
  if (!reviewScent) {
    return;
  }

  reviewScent.innerHTML =
    '<option value="">Choose a scent</option>' +
    catalog
      .all()
      .filter((p) => p.active == true)
      .map(
        (p) =>
          `<option value="${p.id}">${p.name}</option>`,
      )
      .join("");
}

function setRating(rating) {
  reviewRating.value =
    String(rating);

  starButtons.forEach(
    (btn) => {
      btn.classList.toggle(
        "active",
        Number(
          btn.dataset.rating,
        ) <= rating,
      );
    },
  );
}

starButtons.forEach(
  (btn) => {
    btn.addEventListener(
      "click",
      () =>
        setRating(
          Number(
            btn.dataset.rating,
          ),
        ),
    );
  },
);

setRating(5);

renderReviewScentOptions();

function showReviewStatus(
  message,
  type,
) {
  reviewStatus.textContent =
    message;

  reviewStatus.className =
    "review-status show " +
    type;
}

function escapeText(value) {
  return value == null
    ? ""
    : String(value);
}

// ============================================================
// RENDER REVIEWS
// ============================================================

function computeReviewStats() {
  Object.keys(
    reviewStats,
  ).forEach(
    (k) =>
      delete reviewStats[k],
  );

  const products = catalog.all();

  lastReviews.forEach(
    (r) => {
      const scentName =
        String(r.scent || "")
          .trim()
          .toLowerCase();

      const scentId =
        String(r.scentId || "")
          .trim()
          .toLowerCase();

      const p =
        products.find(
          (x) =>
            String(x.id).toLowerCase() === scentId ||
            String(x.name || "").trim().toLowerCase() === scentName,
        );

      if (!p) {
        return;
      }

      reviewStats[p.id] ||=
        {
          sum: 0,
          count: 0,
          avg: 0,
        };

      reviewStats[p.id].sum +=
        Number(
          r.rating,
        ) || 0;

      reviewStats[p.id]
        .count += 1;

      reviewStats[p.id].avg =
        reviewStats[p.id].sum /
        reviewStats[p.id]
          .count;
    },
  );
}

function renderReviews(
  reviews,
) {
  reviewsLoading.style.display =
    "none";

  lastReviews = reviews || [];

  computeReviewStats();

  renderCarousel(
    activeCat,
  );

  reviewsCarousel.innerHTML =
    "";

  if (
    !reviews ||
    !reviews.length
  ) {
    reviewsCarousel.style.display =
      "none";

    reviewsEmpty.style.display =
      "block";

    return;
  }

  reviewsEmpty.style.display =
    "none";

  reviewsCarousel.style.display =
    "flex";

  const fragment =
    document.createDocumentFragment();

  reviews.forEach(
    (review) => {
      const card =
        document.createElement(
          "article",
        );

      card.className =
        "review-card";

      const photo =
        document.createElement(
          "div",
        );

      photo.className =
        "review-photo";

      if (
        review.photoUrl
      ) {
        const img =
          document.createElement(
            "img",
          );

        img.src =
          review.photoUrl;

        img.alt =
          "Customer photo for " +
          escapeText(
            review.scent,
          );

        img.loading =
          "lazy";

                img.decoding =
          "async";

        // If the photo can't load (e.g. Drive sharing changed), show the neat empty style
        img.onerror = () => {
          photo.classList.add("empty");
          photo.innerHTML = `<div>“<small>CUSTOMER REVIEW</small></div>`;
        };

        photo.appendChild(
          img,
        );
      } else {
                photo.classList.add(
          "empty",
        );

        photo.innerHTML =
          `<div>“<small>CUSTOMER REVIEW</small></div>`;
      }

      const body =
        document.createElement(
          "div",
        );

      body.className =
        "review-body";

      const stars =
        document.createElement(
          "div",
        );

      stars.className =
        "review-stars";

      const rating =
        Math.max(
          1,
          Math.min(
            5,
            Number(
              review.rating,
            ) || 5,
          ),
        );

      stars.textContent =
        "★".repeat(
          rating,
        ) +
        "☆".repeat(
          5 - rating,
        );

      const text =
        document.createElement(
          "p",
        );

      text.className =
        "review-text";

      text.textContent =
        review.review || "";

      const meta =
        document.createElement(
          "div",
        );

      meta.className =
        "review-meta";

      const name =
        document.createElement(
          "span",
        );

      name.className =
        "review-name";

      name.textContent =
        review.customerName ||
        review.name ||
        "Customer";

      const scent =
        document.createElement(
          "span",
        );

      scent.className =
        "review-scent";

      scent.textContent =
        (
          review.scent ||
          ""
        ).toUpperCase();

      meta.append(
        name,
        scent,
      );

      body.append(
        stars,
        text,
        meta,
      );

      card.append(
        photo,
        body,
      );

      fragment.appendChild(
        card,
      );
    },
  );

  reviewsCarousel.appendChild(
    fragment,
  );
}

// ============================================================
// LOAD REVIEWS
// ============================================================

function loadReviews() {
  if (
    !isSupabaseConfigured()
  ) {
    reviewsLoading.textContent =
      "Connect Supabase (assets/js/supabase-config.js) to load customer reviews.";

    return;
  }

  apiClient
    .get({
      action: "reviews",
    })
    .then((data) => {
      if (
        !data ||
        !data.success
      ) {
        throw new Error(
          data?.message ||
            "Unable to load reviews.",
        );
      }

      renderReviews(
        data.reviews || [],
      );
    })
    .catch(() => {
      reviewsLoading.textContent =
        "Customer reviews are temporarily unavailable.";
    });
}

// ============================================================
// COMPRESS REVIEW IMAGE
// ============================================================

function compressReviewImage(
  file,
) {
  return new Promise(
    (resolve, reject) => {
      const reader =
        new FileReader();

      reader.onload = () => {
        const img =
          new Image();

        img.onload = () => {
          const maxSide =
            1200;

          const scale =
            Math.min(
              1,
              maxSide /
                Math.max(
                  img.width,
                  img.height,
                ),
            );

          const canvas =
            document.createElement(
              "canvas",
            );

          canvas.width =
            Math.max(
              1,
              Math.round(
                img.width *
                  scale,
              ),
            );

          canvas.height =
            Math.max(
              1,
              Math.round(
                img.height *
                  scale,
              ),
            );

          const ctx =
            canvas.getContext(
              "2d",
            );

          ctx.drawImage(
            img,
            0,
            0,
            canvas.width,
            canvas.height,
          );

          resolve(
            canvas.toDataURL(
              "image/jpeg",
              0.78,
            ),
          );
        };

        img.onerror = () =>
          reject(
            new Error(
              "The selected image could not be read.",
            ),
          );

        img.src =
          reader.result;
      };

      reader.onerror = () =>
        reject(
          new Error(
            "The selected image could not be read.",
          ),
        );

      reader.readAsDataURL(
        file,
      );
    },
  );
}

// ============================================================
// REVIEW FORM
// ============================================================

reviewForm?.addEventListener(
  "submit",
  async function (e) {
    e.preventDefault();

    if (
      !isSupabaseConfigured()
    ) {
      showReviewStatus(
        "The review service is not connected yet.",
        "error",
      );

      return;
    }

    const file =
      document.getElementById(
        "reviewPhoto",
      )?.files?.[0];

    if (!file) {
      showReviewStatus(
        "Please attach a photo with your review.",
        "error",
      );

      return;
    }

    if (
      !file.type.startsWith(
        "image/",
      )
    ) {
      showReviewStatus(
        "Please upload an image file.",
        "error",
      );

      return;
    }

    if (
      file.size >
      5 * 1024 * 1024
    ) {
      showReviewStatus(
        "Please choose an image smaller than 5 MB.",
        "error",
      );

      return;
    }

    reviewSubmit.disabled =
      true;

    reviewSubmit.textContent =
      "UPLOADING…";

    showReviewStatus(
      "Preparing your photo and review…",
      "success",
    );

    try {
      const photoData =
        await compressReviewImage(
          file,
        );

      if (
        photoData.length >
        1600000
      ) {
        throw new Error(
          "The photo is still too large after compression. Please choose another image.",
        );
      }

      const selectedScent =
        catalog
          .all()
          .find(
            (p) =>
              p.id ===
              reviewScent.value,
          );

      const payload =
        new URLSearchParams({
          action:
            "submitReview",

          name: document
            .getElementById(
              "reviewName",
            )
            .value.trim(),

          scent: selectedScent
            ? selectedScent.name
            : reviewScent.value,

          scentId:
            reviewScent.value,

          rating:
            reviewRating.value,

          review: document
            .getElementById(
              "reviewText",
            )
            .value.trim(),

          photo: photoData,
        });

      const response =
        await apiClient.post(
          Object.fromEntries(
            payload.entries(),
          ),
        );

      if (
        !response.success
      ) {
        throw new Error(
          response.message ||
            "Unable to submit review.",
        );
      }

      showReviewStatus(
        "Thank you! Your review was submitted and will appear after approval.",
        "success",
      );

      reviewForm.reset();

      setRating(5);

      renderReviewScentOptions();
    } catch (err) {
      console.error(err);

      showReviewStatus(
        err.message ||
          "Unable to submit your review. Please try again.",
        "error",
      );
    } finally {
      reviewSubmit.disabled =
        false;

      reviewSubmit.textContent =
        "SUBMIT REVIEW";
    }
  },
);

loadReviews();

// ============================================================
// FIND YOUR SCENT QUIZ
// ============================================================

const quizAnswers = {
  profile: [],
  occasion: "",
  strength: "",
};

// ============================================================
// FIND YOUR SCENT PROFILE
// ============================================================

const SCENT_PROFILES = [
  "Fresh",
  "Spicy",
  "Citrus",
  "Amber",
  "Woody",
  "Aquatic",
  "Sweet",
  "Warm",
  "Vanilla",
  "Chestnut",
  "Marine",
  "Aromatic",
  "Minty",
  "Floral",
  "Rose",
  "Powdery",
  "Coffee",
  "Musky",
  "Fruity",
];

// ============================================================
// NORMALIZE PROFILE
// ============================================================

function normalizeProfile(
  value,
) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

// ============================================================
// CREATE PROFILE OPTIONS
// ============================================================

function renderScentProfileQuizOptions() {
  const profileGroup =
    document.querySelector(
      '.quiz-options[data-question="profile"]',
    );

  if (!profileGroup) {
    console.warn(
      'Find Your Scent profile group [data-question="profile"] was not found.',
    );

    return;
  }

  profileGroup.innerHTML =
    SCENT_PROFILES.map(
      (profile) => {
        const value =
          normalizeProfile(
            profile,
          );

        return `
          <button
            type="button"
            class="quiz-option"
            data-value="${escapeHTML(
              value,
            )}"
          >
            ${escapeHTML(
              profile,
            )}
          </button>
        `;
      },
    ).join("");
}

// ============================================================
// QUIZ OPTIONS
// ============================================================

function setupQuizOptions() {
  const quizGroups =
    document.querySelectorAll(
      ".quiz-options",
    );

  quizGroups.forEach(
    (group) => {
      group.addEventListener(
        "click",
        (e) => {
          const btn =
            e.target.closest(
              ".quiz-option",
            );

          if (!btn) {
            return;
          }

          const question =
            group.dataset
              .question;

          let value =
            btn.dataset.value ||
            "";

          // --------------------------------------------------
          // PROFILE
          // --------------------------------------------------

          if (
            question ===
            "profile"
          ) {
            const profile =
              normalizeProfile(
                value,
              );

            if (!profile) {
              return;
            }

            const currentProfiles =
              Array.isArray(
                quizAnswers.profile,
              )
                ? quizAnswers.profile
                : [];

            const exists =
              currentProfiles.includes(
                profile,
              );

            if (exists) {
              quizAnswers.profile =
                currentProfiles.filter(
                  (item) =>
                    item !==
                    profile,
                );
            } else {
              quizAnswers.profile =
                [
                  ...currentProfiles,
                  profile,
                ];
            }

            group
              .querySelectorAll(
                ".quiz-option",
              )
              .forEach(
                (option) => {
                  const optionValue =
                    normalizeProfile(
                      option.dataset
                        .value,
                    );

                  option.classList.toggle(
                    "active",
                    quizAnswers.profile.includes(
                      optionValue,
                    ),
                  );
                },
              );

            return;
          }

          // --------------------------------------------------
          // STRENGTH
          // --------------------------------------------------

          if (
            question ===
            "strength"
          ) {
            value =
              normalizeStrength(
                value,
              );

            quizAnswers.strength =
              value;

            group
              .querySelectorAll(
                ".quiz-option",
              )
              .forEach(
                (option) => {
                  option.classList.toggle(
                    "active",
                    option ===
                      btn,
                  );
                },
              );

            return;
          }

          // --------------------------------------------------
          // OCCASION
          // --------------------------------------------------

          if (
            question ===
            "occasion"
          ) {
            quizAnswers.occasion =
              normalizeProfile(
                value,
              );

            group
              .querySelectorAll(
                ".quiz-option",
              )
              .forEach(
                (option) => {
                  option.classList.toggle(
                    "active",
                    option ===
                      btn,
                  );
                },
              );

            return;
          }

          // --------------------------------------------------
          // OTHER
          // --------------------------------------------------

          quizAnswers[
            question
          ] = value;

          group
            .querySelectorAll(
              ".quiz-option",
            )
            .forEach(
              (option) => {
                option.classList.toggle(
                  "active",
                  option ===
                    btn,
                );
              },
            );
        },
      );
    },
  );
}

// ============================================================
// INITIALIZE QUIZ
// ============================================================

renderScentProfileQuizOptions();

setupQuizOptions();

// ============================================================
// FIND MY SCENT
// ============================================================

document
  .getElementById(
    "findScentBtn",
  )
  ?.addEventListener(
    "click",
    () => {
      const selectedProfiles =
        Array.isArray(
          quizAnswers.profile,
        )
          ? quizAnswers.profile
              .map(
                (
                  profile,
                ) =>
                  normalizeProfile(
                    profile,
                  ),
              )
              .filter(Boolean)
          : [];

      const selectedOccasion =
        normalizeProfile(
          quizAnswers.occasion,
        );

      const selectedStrength =
        normalizeStrength(
          quizAnswers.strength,
        );

      const scores =
        catalog
          .all()
          .filter(
            (product) =>
              product.active !==
              false,
          )
          .map(
            (product) => {
              const meta =
                PRODUCT_META[
                  product.id
                ] || {};

              let score = 0;

              let productProfiles =
                [];

              if (
                Array.isArray(
                  meta.profiles,
                )
              ) {
                productProfiles =
                  meta.profiles
                    .map(
                      (
                        profile,
                      ) =>
                        normalizeProfile(
                          profile,
                        ),
                    )
                    .filter(
                      Boolean,
                    );
              } else {
                productProfiles =
                  String(
                    meta.profiles ||
                      "",
                  )
                    .split(",")
                    .map(
                      (
                        profile,
                      ) =>
                        normalizeProfile(
                          profile,
                        ),
                    )
                    .filter(
                      Boolean,
                    );
              }

              if (
                selectedProfiles.length
              ) {
                selectedProfiles.forEach(
                  (
                    selectedProfile,
                  ) => {
                    if (
                      productProfiles.includes(
                        selectedProfile,
                      )
                    ) {
                      score += 4;
                    }
                  },
                );
              }

              const productOccasions =
                Array.isArray(
                  meta.occasion,
                )
                  ? meta.occasion
                      .map(
                        (
                          value,
                        ) =>
                          normalizeProfile(
                            value,
                          ),
                      )
                      .filter(
                        Boolean,
                      )
                  : String(
                      meta.occasion ||
                        "",
                    )
                      .split(",")
                      .map(
                        (
                          value,
                        ) =>
                          normalizeProfile(
                            value,
                          ),
                      )
                      .filter(
                        Boolean,
                      );

              if (
                selectedOccasion &&
                productOccasions.includes(
                  selectedOccasion,
                )
              ) {
                score += 3;
              }

              const productStrength =
                normalizeStrength(
                  meta.strength,
                );

              if (
                quizAnswers.strength &&
                productStrength ===
                  selectedStrength
              ) {
                score += 2;
              }

              return {
                p: product,
                score,
                matchedProfiles:
                  selectedProfiles.filter(
                    (
                      profile,
                    ) =>
                      productProfiles.includes(
                        profile,
                      ),
                  ),
              };
            },
          )
          .sort(
            (a, b) => {
              if (
                b.score !==
                a.score
              ) {
                return (
                  b.score -
                  a.score
                );
              }

              return (
                b.matchedProfiles
                  .length -
                a.matchedProfiles
                  .length
              );
            },
          );

      const winner =
        scores[0]?.p ||
        catalog.all()[0];

      if (!winner) {
        return;
      }

      document.getElementById(
        "quizResultName",
      ).textContent =
        winner.name;

      const winnerMeta =
        PRODUCT_META[
          winner.id
        ] || {};

      const winnerProfiles =
        Array.isArray(
          winnerMeta.profiles,
        )
          ? winnerMeta.profiles
          : String(
              winnerMeta.profiles ||
                "",
            )
              .split(",")
              .map(
                (profile) =>
                  profile.trim(),
              )
              .filter(Boolean);

      const matchedProfiles =
        selectedProfiles.filter(
          (selected) =>
            winnerProfiles.some(
              (profile) =>
                normalizeProfile(
                  profile,
                ) ===
                normalizeProfile(
                  selected,
                ),
            ),
        );

      let resultText =
        winner.desc || "";

      if (
        matchedProfiles.length
      ) {
        resultText +=
          " Your selected scent character" +
          (matchedProfiles.length >
          1
            ? "s are: "
            : " is: ") +
          matchedProfiles
            .map(
              (profile) =>
                profile
                  .charAt(0)
                  .toUpperCase() +
                profile.slice(
                  1,
                ),
            )
            .join(", ") +
          ".";
      }

      if (
        winner.occasion
      ) {
        resultText +=
          " Best suited for: " +
          winner.occasion +
          ".";
      }

      document.getElementById(
        "quizResultText",
      ).textContent =
        resultText;

      document
        .getElementById(
          "quizResult",
        )
        .classList.add(
          "show",
        );

      document.getElementById(
        "quizOrderBtn",
      ).dataset.id =
        winner.id;
    },
  );

// ============================================================
// QUIZ ORDER BUTTON
// ============================================================

document
  .getElementById(
    "quizOrderBtn",
  )
  ?.addEventListener(
    "click",
    (e) => {
      const productId =
        e.currentTarget
          .dataset.id;

      if (!productId) {
        return;
      }

      scentSelect.value =
        productId;

      syncQuantity();

      document
        .getElementById(
          "order",
        )
        ?.scrollIntoView({
          behavior: "smooth",
        });
    },
  );

// ============================================================
// BUILD YOUR DUO
// ============================================================

const duoOne =
  document.getElementById(
    "duoOne",
  );

const duoTwo =
  document.getElementById(
    "duoTwo",
  );

const duoTotal =
  document.getElementById(
    "duoTotal",
  );

[duoOne, duoTwo].forEach((select) =>
  select?.addEventListener("change", () => {
    select.dataset.touched = "1";   // keep the customer's choice when the list refreshes
    updateDuoTotal();
  }),
);

document
  .getElementById(
    "duoOrderBtn",
  )
  ?.addEventListener(
    "click",
    () => {
      const a = duoOne?.value;
      const b = duoTwo?.value;
      if (!a || !b) return;

      // Both bottles go straight into the cart (the same scent twice is fine)
      const okA = addToCart(a, 1);
      const okB = okA && addToCart(b, 1);

      if (okA && okB) {
        const names = [a, b].map((id) => getProductById(id)?.name || id);
        showToast(
          `Added duo <b>${escapeHTML(names.join(" + "))}</b> to your cart ✓`,
          { link: true },
        );
      }
    },
  );


// ============================================================
// ORDER FORM
// ============================================================

const form =
  document.getElementById(
    "orderForm",
  );

const summaryEmpty =
  document.getElementById(
    "summaryEmpty",
  );

const summaryLines =
  document.getElementById(
    "summaryLines",
  );

const summaryActions =
  document.getElementById(
    "summaryActions",
  );

const copyBtn =
  document.getElementById(
    "copyBtn",
  );

const qtyNumber =
  document.getElementById(
    "qtyNumber",
  );

const qtyHidden =
  document.getElementById(
    "qty",
  );

const liveTotal =
  document.getElementById(
    "liveTotal",
  );

// ============================================================
// QUANTITY
// ============================================================

function syncQuantity() {
  if (
    !qtyNumber ||
    !qtyHidden ||
    !liveTotal
  ) {
    return 1;
  }

  let n = Math.max(
    1,
    Math.min(
      10,
      parseInt(
        qtyNumber.value ||
          "1",
        10,
      ),
    ),
  );

  qtyNumber.value =
    n;

  qtyHidden.value =
    n +
    (n === 1
      ? " bottle"
      : " bottles");

  const selectedId =
    scentSelect.value;

  const p =
    getProductById(
      selectedId,
    );

  const singleItemSubtotal =
    (p
      ? Number(
          p.price ||
            PRODUCT_PRICE,
        )
      : PRODUCT_PRICE) *
    n;

  const preview =
    calculatePromotionDiscount(
      singleItemSubtotal,
      n,
    );

  liveTotal.textContent =
    preview.promotion
      ? `Estimated total: ₱${preview.total.toLocaleString()} — ${preview.promotion.name}`
      : "Estimated total: ₱" +
        preview.total.toLocaleString();

  return n;
}

document
  .getElementById(
    "qtyMinus",
  )
  ?.addEventListener(
    "click",
    () => {
      qtyNumber.value =
        Number(
          qtyNumber.value ||
            1,
        ) - 1;

      syncQuantity();
    },
  );

document
  .getElementById(
    "qtyPlus",
  )
  ?.addEventListener(
    "click",
    () => {
      qtyNumber.value =
        Number(
          qtyNumber.value ||
            1,
        ) + 1;

      syncQuantity();
    },
  );

qtyNumber?.addEventListener(
  "input",
  syncQuantity,
);

scentSelect?.addEventListener(
  "change",
  syncQuantity,
);

syncQuantity();

renderCart();

// ============================================================
// SUBMIT STATUS
// ============================================================

function showSubmitStatus(
  message,
  type,
) {
  const status =
    document.getElementById(
      "submitStatus",
    );

  if (!status) {
    return;
  }

  status.textContent =
    message;

  status.className =
    "submit-status show " +
    type;
}

// ============================================================
// ORDER SUBMISSION
// ============================================================

form?.addEventListener(
  "submit",
  async function (e) {
    e.preventDefault();

    const submitBtn =
      document.getElementById(
        "submitBtn",
      );

    const data =
      new FormData(form);

    if (!cart.length) {
      showSubmitStatus(
        "Please add at least one fragrance to your cart.",
        "error",
      );

      return;
    }

    const quantityNumber =
      cart.reduce(
        (sum, item) =>
          sum +
          Number(
            item.qty || 0,
          ),
        0,
      );

    const orderTotal =
      getCartTotal();

    const scentName =
      cart
        .map(
          (item) =>
            getProductById(
              item.id,
            )?.name ||
            item.id,
        )
        .join(", ");

    const cartLines =
      cart
        .map((item) => {
          const p =
            getProductById(
              item.id,
            );

          return `
${p.name} × ${item.qty} — ₱${(
            Number(
              p.price ||
                PRODUCT_PRICE,
            ) * item.qty
          ).toLocaleString()}`;
        })
        .join("\n");

    const lines = [
      "AURA & ESSENCE — Order",

      "—————————————",

      "Name: " +
        data.get(
          "fullname",
        ),

      "Contact: " +
        data.get(
          "contact",
        ),

      "Items:",

      cartLines,

      "Location: " +
        data.get(
          "address",
        ),

      "Payment: " +
        data.get(
          "payment",
        ),

      "Notes: " +
        (data.get(
          "notes",
        ) || "—"),

      "—————————————",

      "Total items: " +
        quantityNumber,

      ...voucherSummaryLines(),

      "Estimated total: ₱" +
        estimatedOrderTotal(orderTotal).toLocaleString(),
    ].join("\n");

    summaryLines.textContent =
      lines;

    summaryEmpty.style.display =
      "none";

    summaryLines.style.display =
      "block";

    summaryActions.style.display =
      "flex";

    if (
      !isSupabaseConfigured()
    ) {
      showSubmitStatus(
        "Order summary created, but the database is not connected yet. Please send us the summary below directly.",
        "error",
      );

      summaryLines.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });

      return;
    }

    submitBtn.disabled =
      true;

    submitBtn.textContent =
      "Saving Order…";

    showSubmitStatus(
      "Saving your order securely…",
      "success",
    );

    try {
      const payload =
        new URLSearchParams({
          fullname:
            data.get(
              "fullname",
            ) || "",

          contact:
            data.get(
              "contact",
            ) || "",

          scent: scentName,

          scentId:
            cart
              .map(
                (item) =>
                  item.id,
              )
              .join(","),

          qty:
            quantityNumber +
            (quantityNumber ===
            1
              ? " bottle"
              : " bottles"),

          items: JSON.stringify(
            cart.map(
              (item) => ({
                id: item.id,

                name:
                  getProductById(
                    item.id,
                  )?.name ||
                  item.id,

                qty: item.qty,
              }),
            ),
          ),

          address:
            data.get(
              "address",
            ) || "",

          payment:
            data.get(
              "payment",
            ) || "",

          notes:
            data.get(
              "notes",
            ) || "",

          price:
            "430",

          voucher:
            getAppliedVoucherCode(),

          total:
            String(
              orderTotal,
            ),
        });

      // IMPORTANT:
      // No automatic retry for orders.
      // Retrying a POST could create duplicate orders.
      const response =
        await apiClient.post(
          Object.fromEntries(
            payload.entries(),
          ),
        );

      if (
        !response.success
      ) {
        throw new Error(
          response.message ||
            "Unable to save the order.",
        );
      }

      showSubmitStatus(
        "Order saved successfully. We received your order and will contact you soon.",
        "success",
      );

      document.getElementById(
        "confirmationOrderId",
      ).textContent =
        response.orderId ||
        "ORDER RECEIVED";

      document.getElementById(
        "confirmationMessage",
      ).textContent =
        `Thank you, ${
          data.get(
            "fullname",
          ) || "customer"
        }. Your order has been received${
          response.total != null
            ? ` (total ₱${Number(response.total).toLocaleString()})`
            : ""
        }. We will contact you regarding confirmation and delivery or meetup details.${
          response.voucher
            ? ` Voucher ${response.voucher} applied.`
            : ""
        }${
          response.voucherNote
            ? ` ${response.voucherNote}`
            : ""
        }`;

      clearVoucher();

      const payBox = document.getElementById("payInstructions");
      if (payBox) {
        payBox.innerHTML = payInstructionsHTML({
          payment: data.get("payment"),
          amount: response.total != null ? Number(response.total) : estimatedOrderTotal(orderTotal),
          orderId: response.orderId,
        });
      }
      goCheckoutStep(1, { silent: true });

      document
        .getElementById(
          "confirmationModal",
        )
        .classList.add(
          "show",
        );

      document
        .getElementById(
          "confirmationModal",
        )
        .setAttribute(
          "aria-hidden",
          "false",
        );

      form.reset();

      if (qtyNumber) qtyNumber.value = 1;

      cart = [];

      cartManager.clear();

      syncQuantity();

      renderCart();

      renderScentOptions();
    } catch (err) {
      console.error(err);

      // Show the real reason (e.g. "Sauvage has only 1 bottle(s) in stock.")
      showSubmitStatus(
        err && err.message
          ? err.message
          : "The order summary was created, but saving to the database failed. Please try again or contact us directly.",
        "error",
      );
    } finally {
      submitBtn.disabled =
        false;

      submitBtn.textContent =
        "Submit Order";
    }

    summaryLines.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  },
);

// ============================================================
// ORDER CONFIRMATION MODAL
// ============================================================

const confirmationModal =
  document.getElementById(
    "confirmationModal",
  );

document
  .getElementById(
    "confirmationCloseBtn",
  )
  ?.addEventListener(
    "click",
    () => {
      confirmationModal.classList.remove(
        "show",
      );

      confirmationModal.setAttribute(
        "aria-hidden",
        "true",
      );
    },
  );

document
  .getElementById(
    "confirmationTrackBtn",
  )
  ?.addEventListener(
    "click",
    () => {
      const id =
        document
          .getElementById(
            "confirmationOrderId",
          )
          .textContent.trim();

      document.getElementById(
        "trackingOrderId",
      ).value = id;

      confirmationModal.classList.remove(
        "show",
      );

      document
        .getElementById(
          "tracking",
        )
        ?.scrollIntoView({
          behavior: "smooth",
        });
    },
  );

confirmationModal?.addEventListener(
  "click",
  (e) => {
    if (
      e.target ===
      confirmationModal
    ) {
      document
        .getElementById(
          "confirmationCloseBtn",
        )
        ?.click();
    }
  },
);

// ============================================================
// ORDER TRACKING
// ============================================================

const trackingResult =
  document.getElementById(
    "trackingResult",
  );

const trackingStatus =
  document.getElementById(
    "trackingStatus",
  );

const trackingResultId =
  document.getElementById(
    "trackingResultId",
  );

const trackingResultSummary =
  document.getElementById(
    "trackingResultSummary",
  );

// Same steps and names as the admin Orders page.
const trackSteps = [
  { status: "New", label: "Order received", hint: "We got your order." },
  { status: "Confirmed", label: "Confirmed", hint: "We've confirmed your order." },
  { status: "Preparing", label: "Preparing", hint: "Your scents are being packed." },
  { status: "Out for Delivery", label: "Out for delivery", hint: "On the way, or ready for meetup." },
  { status: "Completed", label: "Completed", hint: "Enjoy your Aura & Essence!" },
];

function trackDate(value) {
  if (!value) return "";
  const d = new Date(value);
  return isNaN(d)
    ? ""
    : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function trackPeso(value) {
  return "₱" + Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function renderTracking(
  data,
) {
  const status = data.status || "New";
  const cancelled = status === "Cancelled";

  // Latest time each status was set (older orders may not have a timeline)
  const history = Array.isArray(data.history) && data.history.length
    ? data.history
    : [{ status: "New", at: data.timestamp }];
  const when = {};
  history.forEach((h) => { when[h.status] = h.at; });
  if (!when.New) when.New = data.timestamp;

  const current = trackSteps.findIndex((s) => s.status === status);

  trackingResultId.textContent = data.orderId || "ORDER";

  /* ---------- order summary ---------- */

  const items = Array.isArray(data.items) && data.items.length
    ? data.items.map((i) => `${escapeHTML(i.name)} × ${escapeHTML(i.qty)}`).join(", ")
    : escapeHTML(data.scent || "Order");

  const total = Number(data.total || 0);
  const paid = data.amountPaid == null ? null : Number(data.amountPaid);
  const payStatus = data.paymentStatus || "Unpaid";
  const method = data.payment ? ` · ${escapeHTML(data.payment)}` : "";

  let paymentLine;
  if (cancelled) {
    paymentLine = payStatus === "Refunded" ? `Refunded${method}` : `No payment due${method}`;
  } else if (payStatus === "Paid") {
    paymentLine = `<span class="track-ok">Paid ${trackPeso(paid ?? total)}</span>${method}`;
  } else if (payStatus === "Partial") {
    paymentLine = `Paid ${trackPeso(paid || 0)} · <b>Balance ${trackPeso(Math.max(0, total - (paid || 0)))}</b>${method}`;
  } else if (payStatus === "Refunded") {
    paymentLine = `Refunded${method}`;
  } else {
    paymentLine = `<b>To pay: ${trackPeso(total)}</b>${method}`;
  }

  trackingResultSummary.innerHTML = `
    <div class="track-summary">
      <div class="track-badge ${cancelled ? "is-cancelled" : status === "Completed" ? "is-done" : ""}">
        ${escapeHTML(cancelled ? "Cancelled" : (trackSteps[current]?.label || status))}
      </div>
      <dl>
        <dt>Items</dt><dd>${items}</dd>
        <dt>Total</dt><dd>${trackPeso(total)}</dd>
        <dt>Payment</dt><dd>${paymentLine}</dd>
        <dt>Ordered</dt><dd>${escapeHTML(trackDate(data.timestamp))}</dd>
        <dt>Customer</dt><dd>${escapeHTML(data.fullname || "")}</dd>
      </dl>
    </div>
    ${!cancelled && (payStatus === "Unpaid" || payStatus === "Partial")
      ? payInstructionsHTML({
          payment: data.payment,
          amount: payStatus === "Partial" ? Math.max(0, total - (paid || 0)) : total,
          orderId: data.orderId,
          compact: true,
        })
      : ""}
  `;

  /* ---------- progress ---------- */

  if (cancelled) {
    trackingStatus.innerHTML = `
      <div class="track-cancelled">
        This order was cancelled${when.Cancelled ? " on " + escapeHTML(trackDate(when.Cancelled)) : ""}.
        If you think this is a mistake, please message us with your Order ID.
      </div>
    `;
  } else {
    trackingStatus.innerHTML = trackSteps
      .map((step, i) => {
        const state = i < current ? "done" : i === current ? "current" : "";
        const time = i <= current && when[step.status] ? trackDate(when[step.status]) : "";
        return `
          <div class="track-step ${state}">
            <span class="track-dot">${i < current ? "✓" : i === current ? "●" : "○"}</span>
            <div>
              <b>${escapeHTML(step.label)}</b>
              <small>${i === current ? escapeHTML(step.hint) : ""}${time ? (i === current ? " · " : "") + escapeHTML(time) : ""}</small>
            </div>
          </div>
        `;
      })
      .join("");
  }

  trackingResult.classList.add(
    "show",
  );
}

function showTrackingError(
  msg,
) {
  trackingResult.classList.add(
    "show",
  );

  trackingResultId.textContent =
    "NOT FOUND";

  trackingResultSummary.innerHTML = `
    <p
      style="
        color:#e8b0b0
      "
    >
      ${escapeHTML(msg)}
    </p>
  `;

  trackingStatus.innerHTML =
    "";
}

document
  .getElementById(
    "trackOrderBtn",
  )
  ?.addEventListener(
    "click",
    () => {
      const orderId =
        document
          .getElementById(
            "trackingOrderId",
          )
          .value.trim();

      const contact =
        document
          .getElementById(
            "trackingContact",
          )
          .value.trim();

      if (
        !orderId ||
        !contact
      ) {
        showTrackingError(
          "Please enter both your Order ID and contact number.",
        );

        return;
      }

      apiClient
        .get({
          action: "trackOrder",
          orderId,
          contact,
        })
        .then((data) => {
          if (
            !data?.success
          ) {
            throw new Error(
              data?.message ||
                "Order not found.",
            );
          }

          renderTracking(
            data,
          );
        })
        .catch((e) => {
          showTrackingError(
            e.message ||
              "The tracking service is temporarily unavailable.",
          );
        });
    },
  );

// ============================================================
// COPY ORDER SUMMARY
// ============================================================

copyBtn?.addEventListener(
  "click",
  async function () {
    try {
      await navigator.clipboard.writeText(
        summaryLines.textContent,
      );

      copyBtn.textContent =
        "Copied!";

      setTimeout(() => {
        copyBtn.textContent =
          "Copy Order Summary";
      }, 1800);
    } catch (err) {
      copyBtn.textContent =
        "Select the text above to copy";
    }
  },
);


// ============================================================
// STOREFRONT UPGRADES
// Header cart, toast, promo bar, menu, live counts, guide,
// duo, featured rows (Best Sellers / New / Featured / Signature)
// (`var` on purpose: these are used by code that runs earlier in this file)
// ============================================================

var storeSettings = {};
var toastTimer = null;

var GUIDE_GROUPS = [
  { label: "Fresh & Clean", profiles: ["fresh", "aquatic", "marine", "citrus"] },
  { label: "Sweet & Warm", profiles: ["sweet", "warm", "vanilla", "chestnut", "coffee"] },
  { label: "Floral & Elegant", profiles: ["floral", "rose", "powdery"] },
  { label: "Woody & Amber", profiles: ["woody", "amber", "smoky"] },
  { label: "Fruity & Playful", profiles: ["fruity"] },
  { label: "Spicy & Bold", profiles: ["spicy", "aromatic", "minty"] },
];

var FEATURED_ROWS = [
  { setting: "showBestSellers", badge: "BEST SELLER", title: "Best Sellers", tag: "Customer favorites" },
  { setting: "showNewArrivals", badge: "NEW", title: "New Arrivals", tag: "Just added" },
  { setting: "showFeatured", badge: "FEATURED", title: "Featured", tag: "Our picks" },
  { setting: "showSignature", badge: "SIGNATURE", title: "Signature Collection", tag: "House signatures" },
];

function peso(value) {
  return "₱" + Number(value || 0).toLocaleString();
}

/* ---------- Toast ---------- */

function showToast(html, options = {}) {
  const toast = document.getElementById("toast");
  if (!toast) return;

  toast.innerHTML =
    `<span>${html}</span>` +
    (options.link ? `<a href="#order" data-toast-cart>View cart</a>` : "");
  toast.classList.toggle("warn", Boolean(options.warn));
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add("show"));

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => { toast.hidden = true; }, 250);
  }, options.warn ? 3800 : 2800);
}

document.getElementById("toast")?.addEventListener("click", (e) => {
  if (e.target.closest("[data-toast-cart]")) {
    e.currentTarget.classList.remove("show");
  }
});

/* ---------- Header + bottom bar cart count ---------- */

function cartQuantity() {
  return (cart || []).reduce((sum, item) => sum + Number(item.qty || 0), 0);
}

function updateHeaderCart() {
  const qty = cartQuantity();
  const button = document.getElementById("headerCart");

  ["headerCartCount", "bottomCartCount"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = qty;
    el.hidden = qty === 0;
  });

  if (button) button.setAttribute("aria-label", `Cart, ${qty} item${qty === 1 ? "" : "s"}`);
}

function bumpCart() {
  const button = document.getElementById("headerCart");
  if (!button) return;
  button.classList.remove("bump");
  void button.offsetWidth; // restart the animation
  button.classList.add("bump");
}

/* ---------- Mobile menu ---------- */

const menuBtn = document.getElementById("menuBtn");
const navLinks = document.getElementById("navLinks");

function setMenu(open) {
  navLinks?.classList.toggle("open", open);
  menuBtn?.setAttribute("aria-expanded", String(open));
  menuBtn?.setAttribute("aria-label", open ? "Close menu" : "Open menu");
}

menuBtn?.addEventListener("click", () => setMenu(!navLinks?.classList.contains("open")));
navLinks?.addEventListener("click", (e) => { if (e.target.closest("a")) setMenu(false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") setMenu(false); });

/* ---------- Promo bar (from active Promotions in the admin) ---------- */

function promoText(promo) {
  if (promo.type === "fixed_total") {
    return `<b>${escapeHTML(promo.name)}</b> — any ${Number(promo.minQty)} bottles for ${peso(promo.fixedTotal)}`;
  }
  return `<b>${escapeHTML(promo.name)}</b> — ${Number(promo.percentOff)}% off when you buy ${Number(promo.minQty)}+ bottles`;
}

function renderPromoBar() {
  const bar = document.getElementById("promoBar");
  const text = document.getElementById("promoText");
  if (!bar || !text) return;

  let dismissed = false;
  try { dismissed = sessionStorage.getItem("aePromoClosed") === "1"; } catch { /* ignore */ }

  const promos = (activePromotions || []).filter((p) =>
    (p.type === "fixed_total" && Number(p.fixedTotal) > 0) ||
    (p.type === "percent" && Number(p.percentOff) > 0),
  );

  if (!promos.length || dismissed) {
    bar.hidden = true;
    return;
  }

  text.innerHTML = "✨ " + promos.slice(0, 2).map(promoText).join(" &nbsp;·&nbsp; ");
  bar.hidden = false;
}

document.getElementById("promoClose")?.addEventListener("click", () => {
  const bar = document.getElementById("promoBar");
  if (bar) bar.hidden = true;
  try { sessionStorage.setItem("aePromoClosed", "1"); } catch { /* ignore */ }
});

/* ---------- Live counts ---------- */

function activeProducts() {
  return catalog.all().filter((p) => p.active !== false);
}

function renderCounts() {
  if (!isCatalogReady()) return;   // don't flash the built-in list's numbers
  const products = activeProducts();
  if (!products.length) return;

  const men = products.filter((p) => p.cat === "men").length;
  const women = products.filter((p) => p.cat === "women").length;
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
                 "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
  const word = (n) => words[n] || String(n);
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

  const sub = document.getElementById("heroSub");
  if (sub) {
    sub.textContent =
      `Iconic scents, refined. ${cap(word(products.length))} signature blends inspired by the world's most recognized fragrances — ${word(men)} for him, ${word(women)} for her.`;
  }

  const title = document.getElementById("blendCountTitle");
  const text = document.getElementById("blendCountText");
  if (title) title.textContent = `${products.length} Signature Blends`;
  if (text) text.textContent = `${cap(word(men))} for him, ${word(women)} for her — black cap for the men's line, gold cap for the women's line.`;

  document.querySelectorAll(".tab[data-cat] .count").forEach((el) => {
    const cat = el.closest(".tab").dataset.cat;
    el.textContent = `(${products.filter((p) => p.cat === cat).length})`;
  });
}

/* ---------- How to Choose (built from each scent's profiles) ---------- */

function renderGuide() {
  if (!isCatalogReady()) return;
  const list = document.getElementById("guideList");
  if (!list) return;

  const products = activeProducts();

  const rows = GUIDE_GROUPS.map((group) => {
    const picks = products
      .map((p) => {
        const profiles = getProductSearchData(p).profiles || [];
        return { p, hits: group.profiles.filter((g) => profiles.includes(g)).length };
      })
      .filter((x) => x.hits > 0)
      .sort((a, b) =>
        (Number(a.p.stock) === 0) - (Number(b.p.stock) === 0) ||
        b.hits - a.hits ||
        String(a.p.name).localeCompare(String(b.p.name)))
      .slice(0, 4)
      .map((x) => x.p);

    if (!picks.length) return "";

    return `
      <div class="guide-item">
        <span>${escapeHTML(group.label)}</span>
        <span class="guide-picks">
          ${picks.map((p) => `<button type="button" class="guide-pick ${Number(p.stock) === 0 ? "sold" : ""}" data-guide-id="${escapeHTML(p.id)}" title="See details">${escapeHTML(p.name)}</button>`).join("")}
        </span>
      </div>`;
  }).join("");

  if (rows.trim()) list.innerHTML = rows;
}

document.getElementById("guideList")?.addEventListener("click", (e) => {
  const pick = e.target.closest("[data-guide-id]");
  if (pick) openFragranceDetails(pick.dataset.guideId);
});

/* ---------- Build Your Duo ---------- */

function renderDuo() {
  if (!isCatalogReady()) return;
  if (!duoOne || !duoTwo) return;

  const products = activeProducts().slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const inStock = products.filter((p) => Number(p.stock) !== 0);
  const keepA = duoOne.value;
  const keepB = duoTwo.value;

  const options = products
    .map((p) => {
      const sold = Number(p.stock) === 0;
      return `<option value="${escapeHTML(p.id)}" ${sold ? "disabled" : ""}>${escapeHTML(p.name)}${sold ? " — sold out" : ""}</option>`;
    })
    .join("");

  duoOne.innerHTML = options;
  duoTwo.innerHTML = options;

  const valid = (id) => inStock.some((p) => p.id === id);
  const isBest = (p) => (PRODUCT_META[p.id]?.badges || []).includes("BEST SELLER");
  const preferred = inStock.slice().sort((a, b) => Number(isBest(b)) - Number(isBest(a)));

  const keepOne = duoOne.dataset.touched && valid(keepA);
  const keepTwo = duoTwo.dataset.touched && valid(keepB);

  duoOne.value = keepOne ? keepA : (preferred[0]?.id || "");
  duoTwo.value = keepTwo ? keepB : (preferred.find((p) => p.id !== duoOne.value)?.id || duoOne.value);

  const lede = document.getElementById("duoLede");
  const twoFor = (activePromotions || []).find((p) =>
    p.type === "fixed_total" && Number(p.minQty) === 2 && Number(p.fixedTotal) > 0);

  if (lede) {
    lede.textContent = twoFor
      ? `Choose any two fragrances — ${twoFor.name}: both for ${peso(twoFor.fixedTotal)}.`
      : `Choose any two fragrances for a two-bottle set at ${peso(PRODUCT_PRICE)} per bottle.`;
  }

  updateDuoTotal();
}

function updateDuoTotal() {
  if (!duoTotal) return;

  const a = getProductById(duoOne?.value);
  const b = getProductById(duoTwo?.value);

  if (!a || !b) {
    duoTotal.textContent = "Choose two scents.";
    return;
  }

  const subtotal = Number(a.price || PRODUCT_PRICE) + Number(b.price || PRODUCT_PRICE);
  const result = calculatePromotionDiscount(subtotal, 2);

  duoTotal.innerHTML = result.discount > 0
    ? `2 bottles • <b>${peso(result.total)}</b> <s>${peso(subtotal)}</s><span class="save">Save ${peso(result.discount)}</span>`
    : `2 bottles • <b>${peso(subtotal)}</b>`;
}

/* ---------- Featured rows (follow the admin Homepage switches) ---------- */

function renderFeaturedRows() {
  if (!isCatalogReady()) return;
  const box = document.getElementById("featuredRows");
  if (!box) return;

  const products = activeProducts();
  box.innerHTML = "";

  (FEATURED_ROWS || []).forEach((row) => {
    if (String((storeSettings || {})[row.setting] ?? "true") === "false") return;

    const picks = products.filter((p) =>
      (PRODUCT_META[p.id]?.badges || p.badges || [])
        .map((b) => String(b).toUpperCase())
        .includes(row.badge));

    if (!picks.length) return;

    const section = document.createElement("div");
    section.className = "featured-row";
    section.innerHTML =
      `<h3>${escapeHTML(row.title)}<small>${escapeHTML(row.tag)}</small></h3><div class="mini-row"></div>`;

    const strip = section.querySelector(".mini-row");
    picks.forEach((p) => strip.appendChild(buildProductCard(p)));
    box.appendChild(section);
  });
}

async function loadStoreSettings() {
  if (!isSupabaseConfigured()) return;
  try {
    const result = await apiClient.get({ action: "settings" });
    if (result?.success) {
      storeSettings = result.settings || {};
      renderFeaturedRows();
    }
  } catch {
    // keep defaults (all rows on)
  }
}

function renderStoreContent() {
  renderCounts();
  renderGuide();
  renderDuo();
  renderFeaturedRows();
}

renderStoreContent();
renderPromoBar();
updateHeaderCart();
loadStoreSettings();

// ============================================================
// VOUCHER CODES (checkout)
// The discount is checked on the server with real prices.
// A voucher is never combined with a promo — the bigger one wins.
// (var + function declarations: renderCart() runs before this
//  part of the file, so nothing here may be in a TDZ.)
// ============================================================

var voucherState = null;   // { code, result, error }
var voucherTimer = null;
var voucherSeq = 0;

function getAppliedVoucherCode() {
  return voucherState && voucherState.result && voucherState.result.applies === "voucher"
    ? voucherState.code
    : "";
}

function voucherWins() {
  return Boolean(getAppliedVoucherCode());
}

function estimatedOrderTotal(fallback) {
  return voucherWins() ? Number(voucherState.result.total) : fallback;
}

function voucherSummaryLines() {
  if (!voucherWins()) return [];
  return [`Voucher: ${voucherState.code} (−₱${Number(voucherState.result.voucherDiscount).toLocaleString()})`];
}

function scheduleVoucherRefresh() {
  clearTimeout(voucherTimer);
  voucherTimer = setTimeout(() => {
    if (voucherState && voucherState.code) checkVoucherCode(voucherState.code, true);
    else renderCartLines();
  }, 250);
}

function clearVoucher() {
  voucherState = null;
  voucherSeq++;
  const input = document.getElementById("voucherInput");
  if (input) input.value = "";
  renderVoucher();
}

async function checkVoucherCode(rawCode, quiet) {
  const code = String(rawCode || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!code) {
    clearVoucher();
    return;
  }

  if (!cart || !cart.length) {
    voucherState = { code, result: null, error: null, waiting: true };
    renderVoucher();
    return;
  }

  if (typeof isSupabaseConfigured === "function" && !isSupabaseConfigured()) {
    voucherState = { code, result: null, error: "Vouchers need the online store connection." };
    renderVoucher();
    return;
  }

  const seq = ++voucherSeq;
  const button = document.getElementById("voucherApply");
  if (button && !quiet) { button.disabled = true; button.textContent = "Checking…"; }

  try {
    const res = await apiClient.post({
      action: "checkVoucher",
      code,
      items: JSON.stringify(cart.map((i) => ({ id: i.id, qty: i.qty }))),
      contact: document.getElementById("contact")?.value || "",
    });
    if (seq !== voucherSeq) return;
    voucherState = res && res.success
      ? { code: res.code || code, result: res, error: null }
      : { code, result: null, error: (res && res.message) || "Voucher code not found." };
  } catch (err) {
    if (seq !== voucherSeq) return;
    voucherState = { code, result: null, error: (err && err.message) || "Could not check the voucher. Please try again." };
  } finally {
    if (button) button.disabled = false;
  }

  renderVoucher();
}

function renderVoucher() {
  const input = document.getElementById("voucherInput");
  const status = document.getElementById("voucherStatus");
  const button = document.getElementById("voucherApply");
  const box = document.getElementById("voucherBox");

  if (status) {
    let text = "";
    let kind = "";
    if (voucherState && voucherState.result) {
      const r = voucherState.result;
      if (r.applies === "voucher") {
        text = `✓ ${r.code}: ${r.label} — you save ₱${Number(r.voucherDiscount).toLocaleString()}`;
        kind = "ok";
      } else {
        text = `${r.promo || "Your promo"} already gives a bigger discount (₱${Number(r.promoDiscount).toLocaleString()}), so we'll use that instead of ${r.code}.`;
        kind = "info";
      }
    } else if (voucherState && voucherState.waiting) {
      text = `Voucher ${voucherState.code} is ready — add a scent and it will be applied.`;
      kind = "info";
    } else if (voucherState && voucherState.error) {
      text = voucherState.error;
      kind = "error";
    }
    status.textContent = text;
    status.className = "voucher-status" + (kind ? " " + kind : "");
  }

  const applied = Boolean(voucherState && (voucherState.result || voucherState.waiting));
  if (input && voucherState && applied) input.value = voucherState.code;
  if (button) button.textContent = applied ? "Remove" : "Apply";
  box?.classList.toggle("applied", voucherWins());

  renderCartLines();
}

function renderCartLines() {
  const lines = document.getElementById("cartLines");
  const totalEl = document.getElementById("cartTotal");
  if (!lines || !totalEl || typeof getCartSubtotal !== "function") return;

  const subtotal = cart && cart.length ? getCartSubtotal() : 0;
  let discount = 0;
  let label = "Discount";
  let total = subtotal;

  if (voucherWins()) {
    discount = Number(voucherState.result.voucherDiscount);
    label = `Voucher ${voucherState.code}`;
    total = Number(voucherState.result.total);
  } else if (subtotal > 0) {
    const promo = calculatePromotionDiscount(subtotal);
    discount = Number(promo.discount || 0);
    label = promo.promotion ? promo.promotion.name : "Discount";
    total = Number(promo.total);
  }

  lines.hidden = !(discount > 0);
  const sub = document.getElementById("cartSubtotal");
  const dl = document.getElementById("cartDiscountLabel");
  const d = document.getElementById("cartDiscount");
  if (sub) sub.textContent = "₱" + subtotal.toLocaleString();
  if (dl) dl.textContent = label;
  if (d) d.textContent = "−₱" + discount.toLocaleString();
  totalEl.textContent = "₱" + Math.max(0, total).toLocaleString();
  updateCoBar(Math.max(0, total));
}

document.getElementById("voucherApply")?.addEventListener("click", () => {
  if (voucherState && (voucherState.result || voucherState.waiting)) {
    clearVoucher();
    return;
  }
  checkVoucherCode(document.getElementById("voucherInput")?.value);
});

document.getElementById("voucherInput")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();   // don't submit the order
    checkVoucherCode(e.currentTarget.value);
  }
});

document.getElementById("voucherInput")?.addEventListener("input", (e) => {
  const typed = e.currentTarget.value.trim().toUpperCase();
  if (voucherState && typed !== voucherState.code) {
    voucherState = null;
    voucherSeq++;
    renderVoucher();
  }
});

// "Once per customer" vouchers depend on the contact number
document.getElementById("contact")?.addEventListener("change", () => {
  if (voucherState && voucherState.code) checkVoucherCode(voucherState.code, true);
});

// Share links like  https://yoursite/?voucher=SUKI50#order
(function readVoucherFromLink() {
  try {
    const code = new URLSearchParams(location.search).get("voucher");
    if (code) {
      const input = document.getElementById("voucherInput");
      if (input) input.value = code.toUpperCase();
      checkVoucherCode(code, true);
    }
  } catch { /* ignore */ }
})();

// ============================================================
// FAVORITES DRAWER (wishlist)
// Saved on this device. Can be shared as a link (?favs=id1,id2).
// ============================================================

var favSharedIds = null;   // set while viewing a list someone shared

function favDrawerEl() {
  return document.getElementById("favDrawer");
}

function openFavorites() {
  const drawer = favDrawerEl();
  if (!drawer) return;
  renderFavorites();
  drawer.classList.add("show");
  drawer.setAttribute("aria-hidden", "false");
  document.body.classList.add("fav-open");
  setTimeout(() => drawer.querySelector(".fav-close")?.focus(), 50);
}

function closeFavorites() {
  const drawer = favDrawerEl();
  if (!drawer) return;
  drawer.classList.remove("show");
  drawer.setAttribute("aria-hidden", "true");
  document.body.classList.remove("fav-open");
}

function favStockInfo(p) {
  if (p.active === false) return { ok: false, text: "Not available right now", cls: "out" };
  const stock = p.stock == null || p.stock === "" ? null : Number(p.stock);
  if (stock === null) return { ok: true, text: "In stock", cls: "" };
  if (stock <= 0) return { ok: false, text: "Sold out", cls: "out" };
  if (stock <= 2) return { ok: true, text: `Only ${stock} left`, cls: "low" };
  return { ok: true, text: "In stock", cls: "" };
}

function updateFavCount() {
  const n = (favorites || []).length;
  const badge = document.getElementById("headerFavCount");
  if (badge) { badge.textContent = n; badge.hidden = n === 0; }
  document.getElementById("headerFav")?.setAttribute("aria-label", `Favorites, ${n} saved`);
  const toggle = document.getElementById("wishlistToggle");
  if (toggle) toggle.textContent = n ? `♡ Favorites (${n})` : "♡ Favorites";
}

function renderFavorites() {
  updateFavCount();
  const list = document.getElementById("favList");
  if (!list || typeof catalog === "undefined") return;

  const shared = Array.isArray(favSharedIds);
  const ids = shared ? favSharedIds : (favorites || []);
  const items = ids.map((id) => catalog.find(id)).filter(Boolean);

  document.getElementById("favShared").hidden = !shared;
  document.getElementById("favTitle").textContent = shared ? "Shared list" : "Favorites";
  document.getElementById("favEyebrow").textContent =
    items.length ? `${items.length} perfume${items.length === 1 ? "" : "s"}` : "Your list";
  document.getElementById("favEmpty").hidden = items.length > 0;
  document.getElementById("favFoot").hidden = items.length === 0;
  document.getElementById("favShare").hidden = shared;

  list.innerHTML = items.map((p) => {
    const info = favStockInfo(p);
    const id = escapeHTML(p.id);
    const tag = p.cat === "women" ? "For Her" : p.cat === "unisex" ? "Unisex" : "For Him";
    return `
      <div class="fav-item">
        <button type="button" class="fav-thumb${p.img ? "" : " ph"}" data-fav-details="${id}" aria-label="Details of ${escapeHTML(p.name)}">
          ${p.img ? `<img src="${escapeHTML(p.img)}" alt="" loading="lazy" onerror="this.onerror=null;this.parentNode.classList.add('ph');this.remove()">` : ""}
        </button>
        <div class="fav-info">
          <small>${tag}</small>
          <b>${escapeHTML(p.name)}</b>
          <span class="fav-price">₱${Number(p.price || PRODUCT_PRICE).toLocaleString()}</span>
          <span class="fav-stock ${info.cls}">${info.text}</span>
        </div>
        <div class="fav-actions">
          <button type="button" class="fav-add" data-fav-add="${id}" ${info.ok ? "" : "disabled"}>${info.ok ? "Add" : "—"}</button>
          ${shared ? "" : `<button type="button" class="fav-remove" data-fav-remove="${id}" aria-label="Remove ${escapeHTML(p.name)} from favorites">♥</button>`}
        </div>
      </div>`;
  }).join("");

  const available = items.filter((p) => favStockInfo(p).ok).length;
  const addAll = document.getElementById("favAddAll");
  if (addAll) {
    addAll.disabled = available === 0;
    addAll.textContent = available ? `Add ${available === 1 ? "it" : `all ${available}`} to cart` : "Nothing available";
  }
}

// Called by toggleFavorite(): update hearts everywhere without re-rendering
function onFavoritesChanged(id) {
  const saved = (favorites || []).includes(id);
  const product = typeof catalog !== "undefined" ? catalog.find(id) : null;
  const name = product ? product.name : "";

  document.querySelectorAll(".wishlist-btn").forEach((btn) => {
    if (btn.dataset.wishlistId !== id) return;
    btn.classList.toggle("active", saved);
    btn.textContent = saved ? "♥" : "♡";
    btn.setAttribute("aria-label", `${saved ? "Remove" : "Add"} ${name} ${saved ? "from" : "to"} favorites`);
  });

  syncModalFav(document.getElementById("fragranceModal")?.dataset.productId);

  if (product && typeof showToast === "function" && !document.body.classList.contains("fav-open")) {
    showToast(saved
      ? `Saved <b>${escapeHTML(name)}</b> to favorites ♥ <a href="#" data-open-favs>View</a>`
      : `Removed <b>${escapeHTML(name)}</b> from favorites`);
  }
}

function syncModalFav(id) {
  const modal = document.getElementById("fragranceModal");
  const btn = document.getElementById("fragranceFav");
  if (!modal || !btn || !id) return;
  modal.dataset.productId = id;
  const saved = (favorites || []).includes(id);
  btn.textContent = saved ? "♥ Saved" : "♡ Save";
  btn.classList.toggle("active", saved);
  btn.setAttribute("aria-pressed", String(saved));
}

function addProductsToCart(ids) {
  let added = 0;
  let skipped = 0;
  ids.forEach((id) => {
    const p = getProductById(id);
    if (!p || !favStockInfo(p).ok) { skipped++; return; }
    const inCart = cartManager.find(id)?.qty || 0;
    if (p.stock != null && inCart + 1 > Number(p.stock)) { skipped++; return; }
    if (cartManager.add(p, 1)) added++;
  });
  cart = cartManager.items;
  renderCart();
  if (added) bumpCart();
  showToast(
    added
      ? `Added ${added} perfume${added === 1 ? "" : "s"} to your cart ✓${skipped ? ` (${skipped} not available)` : ""}`
      : "Those perfumes are not available right now.",
    { link: Boolean(added), warn: !added },
  );
}

document.getElementById("headerFav")?.addEventListener("click", openFavorites);

document.getElementById("fragranceFav")?.addEventListener("click", () => {
  const id = document.getElementById("fragranceModal")?.dataset.productId;
  if (id) toggleFavorite(id);
});

document.getElementById("toast")?.addEventListener("click", (e) => {
  if (e.target.closest("[data-open-favs]")) {
    e.preventDefault();
    openFavorites();
  }
});

favDrawerEl()?.addEventListener("click", (e) => {
  if (e.target.closest("[data-fav-close]")) {
    closeFavorites();
    return;
  }
  const add = e.target.closest("[data-fav-add]");
  if (add) { addToCart(add.dataset.favAdd, 1); return; }

  const remove = e.target.closest("[data-fav-remove]");
  if (remove) { toggleFavorite(remove.dataset.favRemove); return; }

  const details = e.target.closest("[data-fav-details]");
  if (details) {
    closeFavorites();
    openFragranceDetails(details.dataset.favDetails);
  }
});

document.getElementById("favAddAll")?.addEventListener("click", () => {
  addProductsToCart(Array.isArray(favSharedIds) ? favSharedIds : favorites);
});

document.getElementById("favShare")?.addEventListener("click", async () => {
  const ids = (favorites || []).filter((id) => catalog.find(id));
  if (!ids.length) return;
  const url = `${location.origin}${location.pathname}?favs=${ids.map(encodeURIComponent).join(",")}#collection`;
  const text = "My Aura & Essence favorites ♡";
  try {
    if (navigator.share) {
      await navigator.share({ title: text, text, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    showToast("Link copied — send it to anyone ♡");
  } catch (err) {
    if (err && err.name === "AbortError") return;
    window.prompt("Copy this link:", url);
  }
});

document.getElementById("favSaveShared")?.addEventListener("click", () => {
  (favSharedIds || []).forEach((id) => {
    if (!(favorites || []).includes(id) && catalog.find(id)) favorites = wishlistManager.toggle(id);
  });
  favSharedIds = null;
  favorites.forEach((id) => onFavoritesChanged(id));
  renderFavorites();
  showToast("Saved to your favorites ♥");
});

document.getElementById("favShowMine")?.addEventListener("click", () => {
  favSharedIds = null;
  renderFavorites();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && favDrawerEl()?.classList.contains("show")) closeFavorites();
});

// Someone opened a shared favorites link
(function readSharedFavorites() {
  try {
    const raw = new URLSearchParams(location.search).get("favs");
    if (!raw) return;
    const ids = raw.split(",").map((s) => decodeURIComponent(s).trim()).filter(Boolean).slice(0, 30);
    if (!ids.length) return;
    favSharedIds = ids;
    // wait a moment so live products/stock from the database are loaded
    setTimeout(openFavorites, 900);
  } catch { /* ignore */ }
})();

updateFavCount();

// ============================================================
// CHECKOUT: Cart → Details → Review, live summary,
// mobile checkout bar, payment instructions, loading state
// (function declarations + var only — renderCart() calls into
//  this part of the file before it has run)
// ============================================================

var coStep = 1;
var DEFAULT_GCASH = "09351936851";

function isCatalogReady() {
  return window.__aeCatalogReady === true ||
    (typeof isSupabaseConfigured === "function" && !isSupabaseConfigured());
}

function phoneDigits(value) {
  let d = String(value || "").replace(/\D/g, "");
  if (d.startsWith("63") && d.length === 12) d = "0" + d.slice(2);
  if (d.length === 10 && d.startsWith("9")) d = "0" + d;
  return d;
}

function prettyPhone(value) {
  const d = phoneDigits(value);
  return /^09\d{9}$/.test(d) ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : String(value || "");
}

function payMethod() {
  return document.querySelector('#orderForm input[name="payment"]:checked')?.value || "Cash on Delivery / Meetup";
}

/* ---------- validation ---------- */

function setFieldError(id, message) {
  const input = document.getElementById(id);
  const out = document.querySelector(`[data-error-for="${id}"]`);
  input?.classList.toggle("invalid", Boolean(message));
  input?.setAttribute("aria-invalid", message ? "true" : "false");
  if (out) out.textContent = message || "";
  return !message;
}

function validateDetails(focus) {
  const name = document.getElementById("fullname")?.value.trim() || "";
  const contact = document.getElementById("contact")?.value || "";
  const address = document.getElementById("address")?.value.trim() || "";

  const checks = [
    ["fullname", name.length >= 2 ? "" : "Please enter your full name."],
    ["contact", /^09\d{9}$/.test(phoneDigits(contact)) ? "" : "Enter a valid mobile number, e.g. 0917 123 4567."],
    ["address", address.length >= 4 ? "" : "Please enter where we'll deliver or meet you."],
  ];

  let firstBad = null;
  checks.forEach(([id, msg]) => {
    if (!setFieldError(id, msg) && !firstBad) firstBad = id;
  });
  if (firstBad && focus) document.getElementById(firstBad)?.focus();
  return !firstBad;
}

/* ---------- steps ---------- */

function goCheckoutStep(n, opts) {
  const options = opts || {};
  const cartError = document.getElementById("coCartError");

  if (n >= 2 && (!cart || !cart.length)) {
    if (cartError && !options.silent) cartError.hidden = false;
    n = 1;
  } else if (cartError) {
    cartError.hidden = true;
  }
  if (n === 3 && !validateDetails(!options.silent)) n = 2;

  coStep = n;
  document.querySelectorAll("#orderForm .co-panel").forEach((panel) => {
    panel.hidden = Number(panel.dataset.panel) !== n;
  });
  document.querySelectorAll("#coSteps li").forEach((li) => {
    const step = Number(li.dataset.step);
    li.classList.toggle("active", step === n);
    li.classList.toggle("done", step < n);
    li.querySelector("button")?.setAttribute("aria-current", step === n ? "step" : "false");
  });

  if (n === 3) renderReview();
  document.body.classList.remove("co-step-1", "co-step-2", "co-step-3");
  document.body.classList.add(`co-step-${n}`);

  if (!options.silent) {
    const top = document.getElementById("coSteps");
    if (top && top.getBoundingClientRect().top < 110) {
      top.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (n === 2) setTimeout(() => {
      const first = ["fullname", "contact", "address"].map((id) => document.getElementById(id)).find((el) => el && !el.value);
      first?.focus({ preventScroll: true });
    }, 60);
  }
}

/* ---------- live summary ---------- */

function cartLinesHTML(withThumbs) {
  return (cart || []).map((item) => {
    const p = getProductById(item.id);
    if (!p) return "";
    const price = Number(p.price || PRODUCT_PRICE);
    const thumb = withThumbs
      ? (p.img
          ? `<img src="${escapeHTML(p.img)}" alt="" loading="lazy" onerror="this.onerror=null;this.outerHTML='<span class=&quot;img-ph sm&quot;>A&amp;E</span>'">`
          : `<span class="img-ph sm">A&amp;E</span>`)
      : "";
    return `<div class="sum-line">${thumb}<span>${escapeHTML(p.name)} <small>× ${item.qty}</small></span><b>₱${(price * item.qty).toLocaleString()}</b></div>`;
  }).join("");
}

function renderCheckoutExtras() {
  const box = document.getElementById("sumItems");
  if (!box) return;

  const qty = typeof cartQuantity === "function" ? cartQuantity() : 0;
  box.innerHTML = qty
    ? cartLinesHTML(true)
    : `<p class="summary-empty">No scents yet. Tap <b>Add</b> on any perfume, or pick one on the left.</p>`;

  // "Add 1 more for the 2-Bottle Promo"
  const nudge = document.getElementById("promoNudge");
  if (nudge) {
    const promos = (typeof activePromotions !== "undefined" && Array.isArray(activePromotions) ? activePromotions : [])
      .filter((p) => p.active !== false && Number(p.minQty) > qty)
      .sort((a, b) => Number(a.minQty) - Number(b.minQty));
    const next = promos[0];
    const appliesNow = qty && typeof getApplicablePromotion === "function" && getApplicablePromotion(qty);
    if (qty > 0 && next && !appliesNow) {
      const more = Number(next.minQty) - qty;
      const deal = next.type === "fixed_total"
        ? `any ${Number(next.minQty)} for ₱${Number(next.fixedTotal).toLocaleString()}`
        : `${Number(next.percentOff)}% off ${Number(next.minQty)}+ bottles`;
      nudge.innerHTML = `✨ Add <b>${more} more</b> scent${more === 1 ? "" : "s"} for the ${escapeHTML(next.name)} — ${deal}.`;
      nudge.hidden = false;
    } else if (appliesNow) {
      nudge.innerHTML = `✓ ${escapeHTML(appliesNow.name)} applied.`;
      nudge.hidden = false;
    } else {
      nudge.hidden = true;
    }
  }

  if (!qty && coStep !== 1) goCheckoutStep(1, { silent: true });
  if (coStep === 3) renderReview();
  updateCoBar();
}

function renderReview() {
  const box = document.getElementById("reviewBox");
  if (!box) return;
  const val = (id) => document.getElementById(id)?.value.trim() || "";
  const pay = payMethod();
  const total = document.getElementById("cartTotal")?.textContent || "";
  const linesEl = document.getElementById("cartLines");
  const discount = linesEl && !linesEl.hidden
    ? `<div class="sum-line muted"><span>${escapeHTML(document.getElementById("cartDiscountLabel")?.textContent || "Discount")}</span><b>${escapeHTML(document.getElementById("cartDiscount")?.textContent || "")}</b></div>`
    : "";

  box.innerHTML = `
    <div class="review-sec">
      <div class="review-head"><h5>Items</h5><button type="button" class="co-edit" data-go="1">Edit</button></div>
      ${cartLinesHTML(false)}
      ${discount}
      <div class="sum-line total"><span>Total</span><b>${escapeHTML(total)}</b></div>
    </div>
    <div class="review-sec">
      <div class="review-head"><h5>Deliver to</h5><button type="button" class="co-edit" data-go="2">Edit</button></div>
      <p><b>${escapeHTML(val("fullname"))}</b> · ${escapeHTML(prettyPhone(val("contact")))}<br>${escapeHTML(val("address"))}</p>
      ${val("notes") ? `<p class="muted">Note: ${escapeHTML(val("notes"))}</p>` : ""}
    </div>
    <div class="review-sec">
      <div class="review-head"><h5>Payment</h5><button type="button" class="co-edit" data-go="2">Change</button></div>
      <p>${escapeHTML(pay)}</p>
      <p class="muted">${pay === "GCash"
        ? "After you submit, we'll show the GCash number and the exact amount to send."
        : "Pay when you receive your order. We'll message you to confirm the schedule."}</p>
    </div>`;
}

/* ---------- mobile checkout bar ---------- */

function updateCoBar(total) {
  const bar = document.getElementById("coBar");
  if (!bar) return;
  const qty = typeof cartQuantity === "function" ? cartQuantity() : 0;
  bar.hidden = qty === 0;
  const count = document.getElementById("coBarCount");
  if (count) count.textContent = `${qty} item${qty === 1 ? "" : "s"}`;
  document.body.classList.toggle("has-cobar", qty > 0);
  const t = document.getElementById("coBarTotal");
  if (t) t.textContent = total != null ? "₱" + Number(total).toLocaleString() : (document.getElementById("cartTotal")?.textContent || "");
}

(function watchOrderSection() {
  const section = document.getElementById("order");
  if (!section || !("IntersectionObserver" in window)) return;
  new IntersectionObserver((entries) => {
    document.body.classList.toggle("order-in-view", entries[0].isIntersecting);
  }, { threshold: 0.05 }).observe(section);
})();

/* ---------- payment instructions (confirmation + Track Order) ---------- */

function messengerLink(orderId) {
  const raw = String((storeSettings || {}).messengerUrl || "").trim();
  if (!/^https:\/\/(m\.me|(www\.)?messenger\.com|(www\.|m\.)?facebook\.com)\//i.test(raw)) return "";
  try {
    const url = new URL(raw);
    if (orderId && /m\.me$/i.test(url.hostname)) url.searchParams.set("text", `Hi! Here's my payment for order ${orderId}.`);
    return url.toString();
  } catch {
    return "";
  }
}

function payInstructionsHTML(opts) {
  const o = opts || {};
  const settings = storeSettings || {};
  const amount = Number(o.amount || 0);
  const amountText = "₱" + amount.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const orderId = escapeHTML(o.orderId || "");
  const msg = messengerLink(o.orderId);
  const msgBtn = msg
    ? `<a class="msg-btn" href="${escapeHTML(msg)}" target="_blank" rel="noopener">Send screenshot via Messenger</a>`
    : "";

  if (o.payment === "GCash") {
    const number = phoneDigits(settings.gcashNumber || DEFAULT_GCASH);
    const name = String(settings.gcashName || "").trim();
    return `
      <div class="pay-box${o.compact ? " compact" : ""}">
        <h5>Pay with GCash</h5>
        <div class="pay-row"><span>Send exactly</span><b>${amountText}</b><button type="button" class="copy-chip" data-copy="${amount}">Copy</button></div>
        <div class="pay-row"><span>GCash number</span><b>${escapeHTML(prettyPhone(number))}</b><button type="button" class="copy-chip" data-copy="${escapeHTML(number)}">Copy</button></div>
        ${name ? `<div class="pay-row"><span>Account name</span><b>${escapeHTML(name)}</b><span></span></div>` : ""}
        <ol>
          <li>Open GCash → <b>Send Money</b> and send the exact amount.</li>
          <li>Take a screenshot of the receipt.</li>
          <li>Send the screenshot with your Order ID <b>${orderId}</b>${msg ? " through Messenger" : " to us"}.</li>
        </ol>
        ${msgBtn}
      </div>`;
  }

  if (/cash|cod|meetup/i.test(String(o.payment || ""))) {
    return `
      <div class="pay-box${o.compact ? " compact" : ""}">
        <h5>Cash on delivery / meetup</h5>
        <p>Please prepare <b>${amountText}</b>. We'll message you to confirm the delivery or meetup schedule.</p>
        ${msg ? `<a class="msg-btn ghost" href="${escapeHTML(msg)}" target="_blank" rel="noopener">Message us</a>` : ""}
      </div>`;
  }

  return `
    <div class="pay-box${o.compact ? " compact" : ""}">
      <h5>Payment</h5>
      <p>Amount due: <b>${amountText}</b>. We'll message you the payment details.</p>
      ${msgBtn}
    </div>`;
}

/* ---------- events ---------- */

document.addEventListener("click", async (e) => {
  const go = e.target.closest("#order [data-go]");
  if (go) {
    e.preventDefault();
    const target = Number(go.dataset.go);
    // moving forward from the cart validates it; going back never does
    goCheckoutStep(target);
    return;
  }

  const copy = e.target.closest("[data-copy], [data-copy-target]");
  if (copy) {
    const text = copy.dataset.copy ?? document.getElementById(copy.dataset.copyTarget)?.textContent.trim() ?? "";
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const t = document.createElement("textarea");
      t.value = text;
      document.body.appendChild(t);
      t.select();
      try { document.execCommand("copy"); } catch { /* ignore */ }
      t.remove();
    }
    const label = copy.textContent;
    copy.textContent = "Copied ✓";
    copy.classList.add("done");
    setTimeout(() => { copy.textContent = label; copy.classList.remove("done"); }, 1500);
  }
});

// Enter in a field moves to the next step instead of submitting early
document.addEventListener("submit", (e) => {
  if (e.target?.id !== "orderForm") return;
  if (coStep !== 3 || !cart.length || !validateDetails(true)) {
    e.preventDefault();
    e.stopPropagation();
    goCheckoutStep(Math.min(3, coStep + 1));
  }
}, true);

["fullname", "contact", "address"].forEach((id) => {
  const el = document.getElementById(id);
  el?.addEventListener("input", () => {
    if (el.classList.contains("invalid")) setFieldError(id, "");
  });
});

document.getElementById("contact")?.addEventListener("blur", (e) => {
  const pretty = prettyPhone(e.target.value);
  if (pretty !== e.target.value && /^09/.test(phoneDigits(e.target.value))) e.target.value = pretty;
});

document.querySelectorAll('#orderForm input[name="payment"]').forEach((r) =>
  r.addEventListener("change", () => { if (coStep === 3) renderReview(); }));

document.getElementById("coBarBtn")?.addEventListener("click", () => {
  if (coStep === 1 && cart.length) setTimeout(() => goCheckoutStep(1, { silent: true }), 0);
});

renderCheckoutExtras();
goCheckoutStep(1, { silent: true });

// ============================================================
// PRODUCT DETAILS (the popup behind "Details")
// Photo, price, stock, add to cart, at-a-glance profile,
// scent timeline, reviews, similar scents, ‹ › navigation and
// a shareable link (#scent-<id>).
// ============================================================

var fdCurrentId = null;
var fdList = [];

function fdMeta(p) {
  return (typeof PRODUCT_META !== "undefined" && PRODUCT_META[p.id]) || {};
}

function fdListOf(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  return String(value || "").split(/[,•·|]/).map((v) => v.trim()).filter(Boolean);
}

function fdCatLabel(p) {
  return p.cat === "men" ? "For Him" : p.cat === "unisex" ? "Unisex" : "For Her";
}

function fdStars(avg) {
  const full = Math.round(Number(avg) || 0);
  return "★★★★★".slice(0, full) + "☆☆☆☆☆".slice(0, 5 - full);
}

function fdReviewsFor(p) {
  const name = String(p.name || "").trim().toLowerCase();
  const id = String(p.id).toLowerCase();
  return (lastReviews || []).filter((r) =>
    String(r.scentId || "").trim().toLowerCase() === id ||
    String(r.scent || "").trim().toLowerCase() === name);
}

// Products the ‹ › buttons walk through: what the customer is browsing
function fdNavList(p) {
  let list = [];
  try {
    list = getVisibleProducts(activeCat).filter((x) => x.active !== false);
  } catch { /* ignore */ }
  if (!list.some((x) => x.id === p.id)) {
    list = catalog.all().filter((x) => x.active !== false && x.cat === p.cat);
  }
  return list;
}

function fdSimilar(p) {
  const mine = new Set(fdListOf(fdMeta(p).profiles).map((x) => x.toLowerCase()));
  return catalog.all()
    .filter((x) => x.id !== p.id && x.active !== false)
    .map((x) => {
      const theirs = fdListOf(fdMeta(x).profiles).map((t) => t.toLowerCase());
      const shared = theirs.filter((t) => mine.has(t)).length;
      const available = favStockInfo(x).ok ? 1 : 0;
      return { x, score: shared * 3 + (x.cat === p.cat ? 1 : 0) + available * 2 };
    })
    .sort((a, b) => b.score - a.score || String(a.x.name).localeCompare(String(b.x.name)))
    .slice(0, 3)
    .map((s) => s.x);
}

function fdPhotoHTML(p, cls) {
  return p.img
    ? `<img src="${escapeHTML(p.img)}" alt="${escapeHTML(p.name)}" class="${cls || ""}" onerror="this.onerror=null;this.outerHTML='<div class=&quot;img-ph ${cls || ""}&quot;>A&amp;E</div>'">`
    : `<div class="img-ph ${cls || ""}">A&amp;E</div>`;
}

function renderFragranceDetails(p) {
  fdCurrentId = p.id;
  const meta = fdMeta(p);
  const info = favStockInfo(p);
  const price = "₱" + Number(p.price || PRODUCT_PRICE).toLocaleString();
  const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  const text = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };

  /* ----- top: photo, name, rating, price, stock ----- */
  const badges = fdListOf(meta.badges || p.badges).slice(0, 2)
    .map((b) => `<span class="product-badge">${escapeHTML(b)}</span>`).join("");
  set("fdPhoto", `${badges ? `<div class="product-badges">${badges}</div>` : ""}${fdPhotoHTML(p, "fd-img")}`);
  text("fragranceModalCategory", `${fdCatLabel(p)} · Extrait de Parfum`);
  text("fragranceModalTitle", p.name);

  const stats = reviewStats[p.id];
  set("fdRating", stats && stats.count
    ? `<span class="stars">${fdStars(stats.avg)}</span> ${stats.avg.toFixed(1)} · ${stats.count} review${stats.count === 1 ? "" : "s"}`
    : `<span class="muted">No reviews yet</span>`);

  text("fdPrice", price);
  const stockEl = document.getElementById("fdStock");
  if (stockEl) { stockEl.textContent = info.text; stockEl.className = `fd-stock ${info.cls}`; }
  text("fdShort", p.desc || "");

  ["fdAdd", "fdBarAdd"].forEach((id) => {
    const b = document.getElementById(id);
    if (!b) return;
    b.disabled = !info.ok;
    b.textContent = info.ok ? "Add to cart" : info.text;
  });
  text("fdBarPrice", price);
  text("fdBarStock", info.text);
  syncModalFav(p.id);

  const promo = (activePromotions || [])
    .filter((x) => x.active !== false && x.type === "fixed_total" && Number(x.minQty) === 2)[0];
  const promoEl = document.getElementById("fdPromo");
  if (promoEl) {
    promoEl.hidden = !promo || !info.ok;
    if (promo) promoEl.innerHTML = `✨ Pair it with another scent — <b>any 2 for ₱${Number(promo.fixedTotal).toLocaleString()}</b>`;
  }

  /* ----- at a glance ----- */
  const longevity = Math.max(1, Math.min(10, Number(meta.longevity || p.longevity) || 7));
  const projection = Math.max(1, Math.min(10, Number(meta.projection || p.projection) || 7));
  const strengthKey = normalizeStrength(meta.strength || p.strength);
  const strength = { subtle: ["Subtle", 4], moderate: ["Moderate", 7], bold: ["Bold", 10] }[strengthKey] || ["Moderate", 7];
  const times = fdListOf(meta.time || p.time).map((t) => t.toLowerCase());
  const occasion = String(meta.occasion || p.occasion || "").trim();
  const profiles = fdListOf(meta.profiles || p.profiles);
  const word = (n) => (n >= 8 ? "Long-lasting" : n >= 5 ? "Moderate" : "Light");
  const bar = (label, n, caption) => `
    <div class="fd-meter"><span class="fd-k">${label}</span>
      <span class="fd-track"><i style="width:${n * 10}%"></i></span>
      <span class="fd-v">${caption}</span></div>`;

  set("fdGlance", `
    ${bar("Longevity", longevity, `${word(longevity)} · ${longevity}/10`)}
    ${bar("Projection", projection, `${projection >= 8 ? "Fills the room" : projection >= 5 ? "Arm's length" : "Close to skin"} · ${projection}/10`)}
    ${bar("Strength", strength[1], strength[0])}
    <div class="fd-chips">
      <span class="fd-chip ${times.includes("day") ? "on" : ""}">☀ Day</span>
      <span class="fd-chip ${times.includes("night") ? "on" : ""}">☾ Night</span>
      ${occasion ? fdListOf(occasion).slice(0, 4).map((o) => `<span class="fd-chip">${escapeHTML(o)}</span>`).join("") : ""}
    </div>
    ${profiles.length ? `<div class="fd-tags">${profiles.map((t) => `<span class="profile-tag">${escapeHTML(t)}</span>`).join("")}</div>` : ""}
  `);

  /* ----- timeline ----- */
  const notes = (v) => fdListOf(v).join(" · ") || "—";
  text("fragranceTopNotes", notes(p.topNotes));
  text("fragranceHeartNotes", notes(p.heartNotes));
  text("fragranceBaseNotes", notes(p.baseNotes));

  /* ----- description (short first) + how to apply ----- */
  const desc = document.getElementById("fragranceModalDescription");
  const more = document.getElementById("fdMore");
  if (desc) {
    desc.textContent = p.descLong || p.desc || "";
    desc.classList.add("fd-clamp");
    if (more) {
      more.textContent = "Read more";
      more.hidden = true;
      requestAnimationFrame(() => { more.hidden = desc.scrollHeight <= desc.clientHeight + 2; });
    }
  }
  const apply = document.getElementById("fdApply");
  if (apply) {
    apply.open = false;
    apply.hidden = !p.application;
  }
  text("fragranceApplication", p.application || "");

  /* ----- reviews ----- */
  const reviews = fdReviewsFor(p);
  set("fdReviewList", reviews.length
    ? reviews.slice(0, 3).map((r) => `
        <div class="fd-review">
          ${r.photoUrl ? `<img src="${escapeHTML(r.photoUrl)}" alt="" loading="lazy" onerror="this.remove()">` : ""}
          <div>
            <div class="fd-review-head"><b>${escapeHTML(r.customerName || r.name || "Customer")}</b><span class="stars">${fdStars(r.rating)}</span></div>
            <p>${escapeHTML(String(r.review || "").slice(0, 220))}${String(r.review || "").length > 220 ? "…" : ""}</p>
          </div>
        </div>`).join("") +
      `<a class="fd-link" href="#reviews" data-fd-goto="reviews">See all reviews →</a>`
    : `<p class="muted">No reviews for ${escapeHTML(p.name)} yet. <a class="fd-link" href="#reviews" data-fd-goto="reviews">Be the first to review →</a></p>`);

  /* ----- you may also like ----- */
  set("fdSimilar", fdSimilar(p).map((x) => {
    const xi = favStockInfo(x);
    return `
      <div class="fd-sim">
        <button type="button" class="fd-sim-open" data-fd-open="${escapeHTML(x.id)}" aria-label="View ${escapeHTML(x.name)}">
          ${fdPhotoHTML(x, "fd-sim-img")}
          <span><small>${fdCatLabel(x)}</small><b>${escapeHTML(x.name)}</b><em>₱${Number(x.price || PRODUCT_PRICE).toLocaleString()}</em></span>
        </button>
        <button type="button" class="fd-sim-add" data-fd-add="${escapeHTML(x.id)}" ${xi.ok ? "" : "disabled"}>${xi.ok ? "+ Add" : xi.text}</button>
      </div>`;
  }).join(""));

  /* ----- ‹ › navigation ----- */
  fdList = fdNavList(p);
  const idx = fdList.findIndex((x) => x.id === p.id);
  text("fdPos", fdList.length > 1 && idx >= 0 ? `${idx + 1} / ${fdList.length}` : "");
  ["fdPrev", "fdNext"].forEach((id) => {
    const b = document.getElementById(id);
    if (b) b.hidden = fdList.length < 2 || idx < 0;
  });

  document.getElementById("fdBody")?.scrollTo({ top: 0 });
  setDetailsHash(p.id);
}

function fdStep(dir) {
  if (!fdList.length || !fdCurrentId) return;
  const idx = fdList.findIndex((x) => x.id === fdCurrentId);
  const next = fdList[(idx + dir + fdList.length) % fdList.length];
  if (next) renderFragranceDetails(next);
}

/* ----- shareable link ----- */

function setDetailsHash(id) {
  try { history.replaceState(null, "", `${location.pathname}${location.search}#scent-${encodeURIComponent(id)}`); } catch { /* ignore */ }
}

function clearDetailsHash() {
  if (!/^#scent-/.test(location.hash)) return;
  try { history.replaceState(null, "", `${location.pathname}${location.search}`); } catch { /* ignore */ }
}

function openFromHash() {
  const m = location.hash.match(/^#scent-(.+)$/);
  if (!m) return false;
  const id = decodeURIComponent(m[1]);
  const p = catalog.find(id) || catalog.all().find((x) => String(x.id).toLowerCase() === id.toLowerCase());
  if (!p) return false;
  openFragranceDetails(p.id);
  return true;
}

/* ----- events ----- */

document.getElementById("fdPrev")?.addEventListener("click", () => fdStep(-1));
document.getElementById("fdNext")?.addEventListener("click", () => fdStep(1));

["fdAdd", "fdBarAdd"].forEach((id) => {
  document.getElementById(id)?.addEventListener("click", (e) => {
    if (!fdCurrentId) return;
    if (addToCart(fdCurrentId, 1) !== false) {
      const btn = e.currentTarget;
      btn.textContent = "Added ✓";
      btn.classList.add("done");
      setTimeout(() => { btn.textContent = "Add to cart"; btn.classList.remove("done"); }, 1400);
    }
  });
});

document.getElementById("fdMore")?.addEventListener("click", (e) => {
  const desc = document.getElementById("fragranceModalDescription");
  const open = desc.classList.toggle("fd-clamp") === false;
  e.currentTarget.textContent = open ? "Show less" : "Read more";
});

document.getElementById("fdShare")?.addEventListener("click", async (e) => {
  const p = catalog.find(fdCurrentId);
  if (!p) return;
  const url = `${location.origin}${location.pathname}#scent-${encodeURIComponent(p.id)}`;
  const btn = e.currentTarget;
  try {
    if (navigator.share) {
      await navigator.share({ title: `${p.name} — Aura & Essence`, text: p.desc || p.name, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    btn.textContent = "Link copied ✓";
  } catch (err) {
    if (err && err.name === "AbortError") return;
    window.prompt("Copy this link:", url);
  }
  setTimeout(() => { btn.textContent = "Share"; }, 1600);
});

fragranceModal?.addEventListener("click", (e) => {
  const open = e.target.closest("[data-fd-open]");
  if (open) { renderFragranceDetails(catalog.find(open.dataset.fdOpen)); return; }

  const add = e.target.closest("[data-fd-add]");
  if (add) {
    if (addToCart(add.dataset.fdAdd, 1) !== false) {
      add.textContent = "Added ✓";
      setTimeout(() => { add.textContent = "+ Add"; }, 1400);
    }
    return;
  }

  const go = e.target.closest("[data-fd-goto]");
  if (go) {
    e.preventDefault();
    closeFragranceDetails();
    document.getElementById(go.dataset.fdGoto)?.scrollIntoView({ behavior: "smooth" });
    return;
  }

  const rating = e.target.closest("#fdRating");
  if (rating) {
    e.preventDefault();
    document.getElementById("fdReviews")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
});

document.addEventListener("keydown", (e) => {
  if (!fragranceModal?.classList.contains("show")) return;
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "")) return;
  if (e.key === "ArrowLeft") fdStep(-1);
  if (e.key === "ArrowRight") fdStep(1);
});

// Swipe left/right on phones
(function swipeDetails() {
  const body = document.getElementById("fdBody");
  if (!body) return;
  let x0 = null, y0 = null;
  body.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  body.addEventListener("touchend", (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) fdStep(dx < 0 ? 1 : -1);
    x0 = y0 = null;
  }, { passive: true });
})();

// Opening a shared link (…/#scent-sauvage) shows that perfume
window.addEventListener("hashchange", () => { if (/^#scent-/.test(location.hash)) openFromHash(); });
(function openSharedScent() {
  if (!/^#scent-/.test(location.hash)) return;
  let tries = 0;
  const attempt = () => {
    // wait for live products (stock/price) when the database is connected
    if (isCatalogReady() || tries > 20) { openFromHash(); return; }
    tries++;
    setTimeout(attempt, 150);
  };
  attempt();
})();
