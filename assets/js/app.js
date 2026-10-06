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
    alert(
      `Only ${product.stock} bottle(s) of ${product.name} available.`,
    );

    return;
  }

  if (
    !cartManager.add(
      product,
      qty,
    )
  ) {
    return;
  }

  cart =
    cartManager.items;

  renderCart();
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

        <img
          src="${p.img}"
          alt="${p.name}"
          loading="lazy"
          decoding="async"
        >

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

function renderCarousel(cat) {
  if (!carousel) {
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
    const card =
      document.createElement(
        "div",
      );

    card.className =
      "pcard";

    const meta =
      PRODUCT_META[p.id] ||
      {};

    const stats =
      reviewStats[p.id] || {
        avg: 0,
        count: 0,
      };

    const ratingText =
      stats.count
        ? `★ ${stats.avg.toFixed(
            1,
          )} <span>(${stats.count})</span>`
        : "No reviews yet";

    const badges = (
      meta.badges || []
    )
      .map(
        (b) =>
          `<span class="product-badge">${b}</span>`,
      )
      .join("");

    const saved =
      favorites.includes(
        p.id,
      );

    card.innerHTML = `
      <div class="pimg">

        <div class="product-badges">
          ${badges}
        </div>

        <button
          type="button"
          class="wishlist-btn ${
            saved ? "active" : ""
          }"
          data-wishlist-id="${p.id}"
          aria-label="${
            saved
              ? "Remove"
              : "Add"
          } ${p.name} ${
            saved
              ? "from"
              : "to"
          } favorites"
        >
          ${saved ? "♥" : "♡"}
        </button>

        <img
          src="${p.img}"
          alt="${p.name}"
          loading="lazy"
          decoding="async"
        >

      </div>

      <div class="pbody">

        <span class="ptag">
          ${
            cat === "men"
              ? "FOR HIM"
              : "FOR HER"
          }
        </span>

        <h4>
          ${p.name}
        </h4>

        <p>
          ${p.desc}
        </p>

        <div class="product-rating">
          ${ratingText}
        </div>

        <div class="pfoot">

          <span class="pprice">
            &#8369;${Number(
              p.price ||
                PRODUCT_PRICE,
            ).toLocaleString()}
          </span>

          <div class="pactions">

            <button
              type="button"
              class="pdetails"
              data-details-id="${p.id}"
            >
              Details
            </button>

            <button
              type="button"
              class="porder"
              data-id="${p.id}"
              ${
                p.stock === 0
                  ? "disabled"
                  : ""
              }
            >
              ${
                p.stock === 0
                  ? "Sold Out"
                  : "Add"
              }
            </button>

          </div>

        </div>

        ${
          p.stock !== null &&
          p.stock !== undefined
            ? `
              <span
                class="sold-out"
                style="color:${
                  p.stock === 0
                    ? "#d98b8b"
                    : "var(--parchment-dim)"
                }"
              >
                ${
                  p.stock === 0
                    ? "SOLD OUT"
                    : p.stock +
                      " in stock"
                }
              </span>
            `
            : ""
        }

      </div>
    `;

    fragment.appendChild(
      card,
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
  if (
    !wishlistItems ||
    !wishlistEmpty
  ) {
    return;
  }

  wishlistItems.innerHTML =
    "";

  const savedProducts =
    catalog
      .all()
      .filter((p) =>
        favorites.includes(
          p.id,
        ),
      );

  wishlistEmpty.style.display =
    savedProducts.length
      ? "none"
      : "block";

  if (!savedProducts.length) {
    return;
  }

  const fragment =
    document.createDocumentFragment();

  savedProducts.forEach((p) => {
    const b =
      document.createElement(
        "button",
      );

    b.type = "button";

    b.className =
      "wishlist-item";

    b.textContent =
      p.name;

    b.dataset.wishlistJump =
      p.id;

    fragment.appendChild(
      b,
    );
  });

  wishlistItems.appendChild(
    fragment,
  );
}

function toggleFavorite(id) {
  favorites =
    wishlistManager.toggle(
      id,
    );

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
  () => {
    wishlistPanel?.classList.toggle(
      "show",
    );

    updateWishlistPanel();
  },
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
    catalog
      .all()
      .filter((p) => p.active == true)
      .map(
        (p) =>
          `<option value="${p.id}">${p.name} (${
            p.cat === "men"
              ? "For Him"
              : "For Her"
          })</option>`,
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

  fragranceModalTitle.textContent =
    product.name;

  fragranceModalCategory.textContent =
    product.cat === "men"
      ? "For Him • Extrait de Parfum"
      : "For Her • Extrait de Parfum";

  fragranceModalDescription.textContent =
    product.descLong ||
    product.desc ||
    "";

  fragranceTopNotes.textContent =
    Array.isArray(
      product.topNotes,
    )
      ? product.topNotes.join(
          " • ",
        )
      : String(
          product.topNotes ||
            "",
        );

  fragranceHeartNotes.textContent =
    Array.isArray(
      product.heartNotes,
    )
      ? product.heartNotes.join(
          " • ",
        )
      : String(
          product.heartNotes ||
            "",
        );

  fragranceBaseNotes.textContent =
    Array.isArray(
      product.baseNotes,
    )
      ? product.baseNotes.join(
          " • ",
        )
      : String(
          product.baseNotes ||
            "",
        );

  fragranceApplication.textContent =
    product.application ||
    "";

  fragranceOccasion.textContent =
    product.occasion
      ? "Best suited for: " +
        product.occasion
      : "";

  const meta =
    PRODUCT_META[
      product.id
    ] || {};

  // ==========================================================
  // PROFILES
  // ==========================================================

  let profiles = [];

  if (
    Array.isArray(
      meta.profiles,
    )
  ) {
    profiles =
      meta.profiles
        .map((profile) =>
          String(profile).trim(),
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
          profile.trim(),
        )
        .filter(Boolean);
  }

  const profileText =
    profiles.length
      ? profiles
          .map(
            (profile) =>
              `<span class="profile-tag">${escapeHTML(
                profile,
              )}</span>`,
          )
          .join("")
      : `
        <span class="profile-tag">
          No profile listed
        </span>
      `;

  // ==========================================================
  // LONGEVITY
  // ==========================================================

  const longevity =
    Math.max(
      0,
      Math.min(
        10,
        Number(
          meta.longevity,
        ) || 7,
      ),
    );

  // ==========================================================
  // STRENGTH
  // ==========================================================

  const strengthKey =
    normalizeStrength(
      meta.strength,
    );

  const strengthScore = {
    subtle: 4,
    moderate: 7,
    bold: 10,
  }[strengthKey];

  const strengthLabel = {
    subtle: "Subtle",
    moderate: "Moderate",
    bold: "Bold",
  }[strengthKey];

  // ==========================================================
  // PROFILE DISPLAY
  // ==========================================================

  fragranceProfileBars.innerHTML = `
    <div class="profile-section">

      <div class="profile-label">
        Scent Profile
      </div>

      <div class="profile-tags">
        ${profileText}
      </div>

    </div>

    <div class="profile-row">

      <span>
        Longevity
      </span>

      <span class="profile-track">

        <span
          class="profile-fill"
          style="width:${longevity * 10}%"
        ></span>

      </span>

      <span>
        ${longevity}/10
      </span>

    </div>

    <div class="profile-row">

      <span>
        Strength
      </span>

      <span class="profile-track">

        <span
          class="profile-fill"
          style="width:${
            strengthScore * 10
          }%"
        ></span>

      </span>

      <span>
        ${strengthLabel}
      </span>

    </div>
  `;

  // ==========================================================
  // DAY / NIGHT
  // ==========================================================

  const time =
    Array.isArray(meta.time)
      ? meta.time.map(
          (value) =>
            String(
              value,
            ).toLowerCase(),
        )
      : String(
          meta.time || "",
        )
          .split(",")
          .map((value) =>
            value
              .trim()
              .toLowerCase(),
          )
          .filter(Boolean);

  fragranceDayNight.innerHTML = `
    <span>
      ☀ Day
      ${
        time.includes("day")
          ? "✓"
          : ""
      }
    </span>

    <span>
      🌙 Night
      ${
        time.includes("night")
          ? "✓"
          : ""
      }
    </span>
  `;

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

carousel?.addEventListener(
  "click",
  (e) => {
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

    addToCart(
      btn.dataset.id,
      1,
    );

    scentSelect.value =
      btn.dataset.id;

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

    renderScentOptions();

    renderReviewScentOptions();

    // Reviews may have loaded before these products existed.
    computeReviewStats();

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

        photo.appendChild(
          img,
        );
      } else {
        photo.classList.add(
          "empty",
        );

        photo.textContent =
          "CUSTOMER REVIEW";
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

[duoOne, duoTwo].forEach(
  (select) => {
    if (!select) {
      return;
    }

    select.innerHTML =
      catalog
        .all()
        .map(
          (p) =>
            `<option value="${p.id}">${p.name}</option>`,
        )
        .join("");

    select.addEventListener(
      "change",
      () => {
        const duoSubtotal =
          PRODUCT_PRICE * 2;

        const duoPreview =
          calculatePromotionDiscount(
            duoSubtotal,
            2,
          );

        duoTotal.textContent =
          duoPreview.promotion
            ? `2 bottles • ₱${duoPreview.total.toLocaleString()} — ${duoPreview.promotion.name}`
            : `2 bottles • ₱${duoPreview.total.toLocaleString()}`;
      },
    );
  },
);

document
  .getElementById(
    "duoOrderBtn",
  )
  ?.addEventListener(
    "click",
    () => {
      const names = [
        duoOne.value,
        duoTwo.value,
      ];

      scentSelect.value =
        names[0];

      document.getElementById(
        "qtyNumber",
      ).value = 2;

      syncQuantity();

      document.getElementById(
        "notes",
      ).value =
        "Duo: " +
        names
          .map(
            (id) =>
              catalog.find(
                id,
              )?.name || id,
          )
          .join(" + ");

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

      "Estimated total: ₱" +
        orderTotal.toLocaleString(),
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
        }. We will contact you regarding confirmation and delivery or meetup details.`;

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

      qtyNumber.value = 1;

      cart = [];

      cartManager.clear();

      syncQuantity();

      renderCart();

      renderScentOptions();
    } catch (err) {
      console.error(err);

      showSubmitStatus(
        "The order summary was created, but saving to the database failed. Please try again or contact us directly.",
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

const trackSteps = [
  "New",
  "Confirmed",
  "Preparing",
  "Out for Delivery",
  "Completed",
];

function renderTracking(
  data,
) {
  const status =
    data.status || "New";

  const current = Math.max(
    0,
    trackSteps.findIndex(
      (x) =>
        x.toLowerCase() ===
        status.toLowerCase(),
    ),
  );

  trackingResultId.textContent =
    data.orderId ||
    "ORDER";

  trackingResultSummary.innerHTML = `
    <p
      style="
        color:var(--parchment-dim);
        font-size:12px;
        line-height:1.6;
        margin:12px 0
      "
    >
      ${escapeHTML(
        data.scent ||
          "Order",
      )}
      •
      ${escapeHTML(
        data.qty || "",
      )}
      • ₱${Number(
        data.total || 0,
      ).toLocaleString()}

      <br>

      Customer:
      ${escapeHTML(
        data.fullname ||
          "",
      )}
    </p>
  `;

  trackingStatus.innerHTML =
    trackSteps
      .map(
        (step, i) =>
          `
          <div
            class="track-step ${
              i < current
                ? "done"
                : i === current
                  ? "current"
                  : ""
            }"
          >
            ${
              i < current
                ? "✓ "
                : i === current
                  ? "● "
                  : "○ "
            }

            ${step}

          </div>
        `,
      )
      .join("");

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