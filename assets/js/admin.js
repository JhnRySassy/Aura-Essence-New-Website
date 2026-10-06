import { ApiClient, isSupabaseConfigured } from "./admin-api.js";
import { PRODUCTS } from "./products.js";

/* =========================================================
   CONSTANTS
========================================================= */



const CACHE_PREFIX = "aeAdminCache_";

const ORDER_STATUSES = [
  "New",
  "Confirmed",
  "Preparing",
  "Out for Delivery",
  "Completed",
  "Cancelled"
];

const ACTIVE_STATUSES = ["New", "Confirmed", "Preparing", "Out for Delivery"];

const NEXT_STATUS = {
  "New": "Confirmed",
  "Confirmed": "Preparing",
  "Preparing": "Out for Delivery",
  "Out for Delivery": "Completed"
};

const NEXT_LABEL = {
  "New": "Confirm",
  "Confirmed": "Start preparing",
  "Preparing": "Out for delivery",
  "Out for Delivery": "Mark completed"
};

const STATUS_CLASS = {
  "New": "st-new",
  "Confirmed": "st-confirmed",
  "Preparing": "st-preparing",
  "Out for Delivery": "st-out",
  "Completed": "st-completed",
  "Cancelled": "st-cancelled"
};

const DEFAULT_PRODUCT_PRICE = 430;
const DEFAULT_LOW_STOCK = 5;
const DEFAULT_PROMO_QTY = 2;
const DEFAULT_PROMO_FIXED = 840;


/* =========================================================
   HELPERS
========================================================= */

function safeJSONParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function debounce(fn, delay = 120) {
  let timer = null;

  return (...args) => {
    clearTimeout(timer);

    timer = setTimeout(() => {
      fn(...args);
    }, delay);
  };
}

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function formatCurrency(value) {
  return "₱" + Number(value || 0).toLocaleString();
}

// Stops Excel/Sheets from running a customer-typed "=formula" when the CSV is opened.
function csvSafe(value) {
  const text = String(value ?? "");
  if (/^[+-]?[\d\s().-]+$/.test(text)) return text;   // phone numbers / amounts are safe
  return /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
}

function statusPill(status) {
  return `<span class="pill ${STATUS_CLASS[status] || "st-new"}">${escapeHTML(status || "New")}</span>`;
}

function payPill(order) {
  const st = order.paymentStatus || "Unpaid";
  if (order.status === "Cancelled" && st === "Unpaid") {
    return `<span class="pill pay-refunded">No payment</span>`;
  }
  return `<span class="pill pay-${st.toLowerCase()}">${escapeHTML(st)}</span>`;
}

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


/* =========================================================
   ADMIN SESSION
========================================================= */

class AdminSession {

  /*
   * The real session (a secure token) is stored and refreshed by
   * Supabase Auth. No password or admin key is kept in the browser.
   */

  constructor() {
    this.data = {};
  }


  save(email) {
    this.data = { email };
  }


  clear() {
    this.data = {};

    try {
      Object.keys(sessionStorage)
        .filter(key => key.startsWith(CACHE_PREFIX))
        .forEach(key => sessionStorage.removeItem(key));
    } catch {
      // Ignore storage errors.
    }
  }


  get() {
    return this.data;
  }


  valid() {
    return Boolean(this.data.email);
  }
}


/* =========================================================
   ADMIN APP
========================================================= */

class AdminApp {

  constructor() {

    this.api = new ApiClient();

    this.session = new AdminSession();

    this.products = [];
    this.orders = [];
    this.promotions = [];
    this.reviews = [];
    this.settings = {};


    /* -----------------------------------------------
       PERFORMANCE / REALTIME STATE
    ------------------------------------------------ */

    this.cachePrefix = CACHE_PREFIX;

    this.unsubscribeOrders = null;

    this.pollers = {
      orders: null,
      dashboard: null
    };

    this.polling = false;
    this._visibilityHandler = null;
    this._pollingOrders = false;
    this._pollingDashboard = false;

    /* -----------------------------------------------
       SEARCH CACHE
    ------------------------------------------------ */

    this.productSearchIndex = [];
    this.orderSearchIndex = [];

    /* -----------------------------------------------
       PRODUCT / PROMOTION LOOKUP
    ------------------------------------------------ */

    this.productMap = new Map();
    this.promotionMap = new Map();

    /* -----------------------------------------------
       VIEWS
    ------------------------------------------------ */

    this.views = [
      "dashboard",
      "orders",
      "products",
      "promotions",
      "homepage",
      "reviews",
      "audit"
    ];

    /* -----------------------------------------------
       DOM CACHE
    ------------------------------------------------ */

    this.dom = {};

    this.cacheDOM();

    this.bind();
  }


  /* =====================================================
     DOM CACHE
  ===================================================== */

  cacheDOM() {

    const ids = [
      "globalStatus",
      "loginStatus",

      "credentialsForm",
      "logoutBtn",

      "loginIdentifier",
      "loginPassword",

      "loginView",
      "appView",

      "refreshOrders",
      "exportOrders",
      "orderSearch",
      "orderPayFilter",
      "orderTabs",
      "orderDrawer",
      "drawerBody",
      "ordersRows",

      "refreshProducts",
      "newProduct",
      "productSearch",
      "filterCat",
      "filterStock",
      "filterBadge",
      "filterActive",
      "sortProducts",
      "clearFilters",
      "productCount",
      "productsRows",

      "productEditor",
      "closeEditor",
      "productForm",
      "deleteProduct",

      "editorTitle",
      "pOriginalId",
      "pId",
      "pName",
      "pCat",
      "pPrice",
      "pStock",
      "pSort",
      "pImg",
      "pDesc",
      "pDescLong",
      "pTop",
      "pHeart",
      "pBase",
      "pApplication",
      "pProfiles",
      "pLongevity",
      "pProjection",
      "pStrength",
      "pTime",
      "pOccasion",
      "pActive",

      "newPromo",
      "closePromo",
      "promoEditor",
      "promoForm",

      "promoId",
      "promoName",
      "promoType",
      "promoQty",
      "promoFixed",
      "promoPercent",
      "promoActive",

      "settingsForm",
      "setLowStock",
      "setBest",
      "setFeatured",
      "setNew",
      "setSignature",

      "refreshReviews",
      "reviewsRows",

      "refreshAudit",
      "auditRows",

      "statsCards",
      "revenueChart",
      "chartLabel",
      "chartTip",
      "setAlertAt",
      "backupBtn",
      "pImgFile",
      "pImgPreview",
      "pImgEmpty",
      "pImgStatus",
      "rangePreset",
      "rangeFrom",
      "rangeTo",
      "rangeLabel",
      "topProducts",
      "lowStockLabel",
      "lowStock",

      "viewTitle"
    ];

    ids.forEach(id => {
      this.dom[id] = document.getElementById(id);
    });
  }


  /* =====================================================
     AUTH
  ===================================================== */

  auth() {
    return this.session.get();
  }


  /* =====================================================
     STATUS
  ===================================================== */

  setStatus(message, error = false) {

    const el = this.dom.globalStatus;

    if (!el) return;

    el.textContent = message;

    el.className =
      "status " +
      (error ? "error" : "ok");
  }


  loginStatus(message, error = false) {

    const el = this.dom.loginStatus;

    if (!el) return;

    el.textContent = message;

    el.className =
      "status " +
      (error ? "error" : "");
  }


  /* =====================================================
     API REQUEST
  ===================================================== */

  async request(method, params = {}) {

    const response =
      method === "GET"
        ? await this.api.get(params)
        : await this.api.post(params);

    if (!response?.success) {

      throw new Error(
        response?.message ||
        "Request failed."
      );
    }

    return response;
  }


  /* =====================================================
     EVENT BINDING
  ===================================================== */

  bind() {

    /* -----------------------------------------------
       LOGIN
    ------------------------------------------------ */

    this.dom.credentialsForm?.addEventListener(
      "submit",
      e => this.credentials(e)
    );


    


    


    this.dom.logoutBtn?.addEventListener(
      "click",
      async () => {

        this.stopRealtime();

        this.session.clear();

        await this.api.post({
          action: "adminLogout"
        });

        location.reload();
      }
    );


    /* -----------------------------------------------
       NAVIGATION
    ------------------------------------------------ */

    document
      .querySelectorAll(".nav-item")
      .forEach(button => {

        button.addEventListener(
          "click",
          () => this.showView(button.dataset.view)
        );
      });


    /* -----------------------------------------------
       ORDERS
    ------------------------------------------------ */

    this.dom.refreshOrders?.addEventListener(
      "click",
      () => this.loadOrders()
    );


    this.dom.exportOrders?.addEventListener(
      "click",
      () => this.exportOrders()
    );


    this.debouncedOrderSearch =
      debounce(
        () => this.renderOrders(),
        120
      );


    this.dom.orderSearch?.addEventListener(
      "input",
      () => this.debouncedOrderSearch()
    );


    this.orderTab = "active";


    this.dom.orderTabs?.addEventListener(
      "click",
      e => {
        const tab = e.target.closest("[data-tab]");
        if (!tab) return;
        this.orderTab = tab.dataset.tab;
        this.renderOrders();
      }
    );


    this.dom.orderPayFilter?.addEventListener(
      "change",
      () => this.renderOrders()
    );


    this.dom.ordersRows?.addEventListener(
      "click",
      e => {
        const next = e.target.closest("[data-next]");
        if (next) {
          e.stopPropagation();
          this.advanceOrder(next.dataset.next);
          return;
        }

        const row = e.target.closest("[data-order]");
        if (row) this.openOrder(row.dataset.order);
      }
    );


    this.dom.orderDrawer?.addEventListener(
      "click",
      e => {
        if (e.target.closest("[data-close-drawer]")) this.closeOrder();
      }
    );


    document.addEventListener("keydown", e => {
      if (e.key === "Escape") this.closeOrder();
    });


    /* -----------------------------------------------
       PRODUCTS
    ------------------------------------------------ */

    this.dom.refreshProducts?.addEventListener(
      "click",
      () => this.loadProducts()
    );


    this.dom.newProduct?.addEventListener(
      "click",
      () => this.editProduct(null)
    );


    this.debouncedProductSearch =
      debounce(
        () => this.renderProducts(),
        120
      );


    this.dom.productSearch?.addEventListener(
      "input",
      () => this.debouncedProductSearch()
    );


    /* Product filters */
    [
      "filterCat",
      "filterStock",
      "filterBadge",
      "filterActive",
      "sortProducts"
    ].forEach(id => {
      this.dom[id]?.addEventListener(
        "change",
        () => this.renderProducts()
      );
    });


    this.dom.clearFilters?.addEventListener(
      "click",
      () => {
        ["filterCat", "filterStock", "filterBadge", "filterActive"]
          .forEach(id => {
            if (this.dom[id]) this.dom[id].value = "";
          });

        if (this.dom.sortProducts) this.dom.sortProducts.value = "order";
        if (this.dom.productSearch) this.dom.productSearch.value = "";

        this.renderProducts();
      }
    );


    this.dom.closeEditor?.addEventListener(
      "click",
      () =>
        this.dom.productEditor?.classList.add(
          "hidden"
        )
    );


    this.dom.productForm?.addEventListener(
      "submit",
      e => this.saveProduct(e)
    );


    this.dom.deleteProduct?.addEventListener(
      "click",
      () => this.deleteProduct()
    );


    this.dom.productsRows?.addEventListener(
      "click",
      e => {

        const stockButton =
          e.target.closest("[data-stock]");

        if (stockButton) {
          this.adjustStock(
            stockButton.dataset.stock,
            stockButton.dataset.op
          );
          return;
        }


        const editButton =
          e.target.closest("[data-edit]");

        if (editButton) {

          const product =
            this.productMap.get(
              String(editButton.dataset.edit)
            );

          if (product) {
            this.editProduct(product);
          }

          return;
        }


        const deleteButton =
          e.target.closest("[data-delete]");

        if (deleteButton) {

          this.deleteProduct(
            deleteButton.dataset.delete
          );
        }
      }
    );


    /* -----------------------------------------------
       PROMOTIONS
    ------------------------------------------------ */

    this.dom.newPromo?.addEventListener(
      "click",
      () => this.editPromotion(null)
    );


    this.dom.closePromo?.addEventListener(
      "click",
      () =>
        this.dom.promoEditor?.classList.add(
          "hidden"
        )
    );


    this.dom.promoForm?.addEventListener(
      "submit",
      e => this.savePromotion(e)
    );


    /* Promotion event delegation */

    document
      .getElementById("promosList")
      ?.addEventListener(
        "click",
        e => {

          const editButton =
            e.target.closest("[data-pedit]");

          if (editButton) {

            const promotion =
              this.promotionMap.get(
                String(editButton.dataset.pedit)
              );

            if (promotion) {
              this.editPromotion(promotion);
            }

            return;
          }


          const deleteButton =
            e.target.closest("[data-pdel]");

          if (deleteButton) {

            this.deletePromotion(
              deleteButton.dataset.pdel
            );
          }
        }
      );


    /* -----------------------------------------------
       SETTINGS
    ------------------------------------------------ */

    this.dom.settingsForm?.addEventListener(
      "submit",
      e => this.saveSettings(e)
    );


    /* -----------------------------------------------
       AUDIT
    ------------------------------------------------ */

    this.dom.refreshAudit?.addEventListener(
      "click",
      () => this.loadAudit()
    );


    /* -----------------------------------------------
       SESSION
    ------------------------------------------------ */

    /* -----------------------------------------------
       PRODUCT PHOTO UPLOAD
    ------------------------------------------------ */

    this.dom.pImgFile?.addEventListener(
      "change",
      () => this.uploadProductImage()
    );

    this.dom.pImg?.addEventListener(
      "input",
      debounce(() => this.showImagePreview(this.dom.pImg.value), 300)
    );


    /* -----------------------------------------------
       BACKUP
    ------------------------------------------------ */

    this.dom.backupBtn?.addEventListener(
      "click",
      () => this.downloadBackup()
    );


    /* -----------------------------------------------
       DASHBOARD DATE RANGE
    ------------------------------------------------ */

    this.dom.rangePreset?.addEventListener(
      "change",
      () => {
        this.fillRangeInputs();
        this.renderDashboard(this.lastDashboard || {});
      }
    );


    ["rangeFrom", "rangeTo"].forEach(id => {
      this.dom[id]?.addEventListener(
        "change",
        () => {
          if (this.dom.rangePreset) this.dom.rangePreset.value = "custom";
          this.renderDashboard(this.lastDashboard || {});
        }
      );
    });


    /* -----------------------------------------------
       REVIEWS
    ------------------------------------------------ */

    this.dom.refreshReviews?.addEventListener(
      "click",
      () => this.loadReviews()
    );


    this.dom.reviewsRows?.addEventListener(
      "click",
      e => {

        const button =
          e.target.closest("[data-review]");

        if (!button) return;

        const id = button.dataset.review;
        const op = button.dataset.op;

        if (op === "delete") {
          this.deleteReview(id);
        } else {
          this.setReviewApproved(id, op === "approve");
        }
      }
    );


    this.restoreSession();
  }


  /* =====================================================
     RESTORE SESSION (already signed in?)
  ===================================================== */

  async restoreSession() {

    if (!isSupabaseConfigured()) {

      this.loginStatus(
        "Supabase is not connected yet. Paste your Project URL and anon key in assets/js/supabase-config.js.",
        true
      );

      return;
    }


    const response =
      await this.api.get({
        action: "adminSession"
      });


    if (response?.success) {

      this.session.save(response.email);

      this.openApp();
    }
  }


  /* =====================================================
     LOGIN
  ===================================================== */

  async credentials(e) {

    e.preventDefault();

    const identifier =
      this.dom.loginIdentifier?.value.trim();

    const password =
      this.dom.loginPassword?.value || "";


    if (!identifier || !password) {
      return;
    }


    this.loginStatus(
      "Signing in…"
    );


    try {

      const response =
        await this.api.post({
          action: "adminLogin",
          identifier,
          password
        });


      if (!response?.success) {

        throw new Error(
          response?.message ||
          "Invalid credentials."
        );
      }


      if (this.dom.loginPassword) {
        this.dom.loginPassword.value = "";
      }


      this.session.save(identifier);

      this.loginStatus("");

      this.openApp();

    } catch (error) {

      this.loginStatus(
        error.message,
        true
      );
    }
  }


  /* =====================================================
     SESSION CACHE
  ===================================================== */

  cacheRead(key) {

    try {

      return safeJSONParse(
        sessionStorage.getItem(
          this.cachePrefix + key
        ),
        null
      );

    } catch {
      return null;
    }
  }


  cacheWrite(key, value) {

    try {

      sessionStorage.setItem(
        this.cachePrefix + key,
        JSON.stringify(value)
      );

    } catch {
      // Ignore storage quota errors.
    }
  }


  /* =====================================================
     REALTIME POLLING
  ===================================================== */

  startRealtime() {

    if (this.polling) {
      return;
    }


    if (!this.session.valid()) {
      return;
    }


    this.polling = true;


    const pollVisible = () => {

      if (
        !this.polling ||
        document.hidden ||
        !this.session.valid()
      ) {
        return;
      }


      this.loadOrders(true)
        .catch(() => {});


      this.loadDashboard(true)
        .catch(() => {});
    };


    this.pollers.orders =
      setInterval(
        () => {

          if (
            !document.hidden &&
            this.session.valid()
          ) {

            this.loadOrders(true)
              .catch(() => {});
          }

        },
        60000
      );


    this.pollers.dashboard =
      setInterval(
        () => {

          if (
            !document.hidden &&
            this.session.valid()
          ) {

            this.loadDashboard(true)
              .catch(() => {});
          }

        },
        120000
      );


    this._visibilityHandler =
      () => {

        if (
          !document.hidden &&
          this.session.valid()
        ) {

          pollVisible();
        }
      };


    document.addEventListener(
      "visibilitychange",
      this._visibilityHandler
    );


    /*
     * Instant updates: Supabase Realtime tells us
     * whenever an order is created or changed.
     */
    const onOrderChange =
      debounce(
        () => {
          this.loadOrders(true).catch(() => {});
          this.loadDashboard(true).catch(() => {});
        },
        400
      );

    this.unsubscribeOrders =
      this.api.onOrdersChange(onOrderChange);


    /*
     * Initial realtime refresh.
     */
    pollVisible();
  }


  stopRealtime() {

    this.polling = false;

    if (this.pollers.orders) {

      clearInterval(
        this.pollers.orders
      );
    }


    if (this.pollers.dashboard) {

      clearInterval(
        this.pollers.dashboard
      );
    }


    this.pollers.orders = null;
    this.pollers.dashboard = null;


    if (this.unsubscribeOrders) {

      this.unsubscribeOrders();

      this.unsubscribeOrders = null;
    }


    if (this._visibilityHandler) {

      document.removeEventListener(
        "visibilitychange",
        this._visibilityHandler
      );

      this._visibilityHandler = null;
    }


    this._pollingOrders = false;
    this._pollingDashboard = false;
  }


  /* =====================================================
     CACHE HYDRATION
  ===================================================== */

  hydrateCachedAdmin() {

    const dashboard =
      this.cacheRead("dashboard");

    if (dashboard) {

      this.renderDashboard(
        dashboard
      );
    }


    const products =
      this.cacheRead("products");

    if (Array.isArray(products)) {

      this.products = products;

      this.rebuildProductIndex();

      this.renderProducts();
    }


    const promotions =
      this.cacheRead("promotions");

    if (Array.isArray(promotions)) {

      this.promotions = promotions;

      this.rebuildPromotionIndex();

      this.renderPromotions();
    }


    const settings =
      this.cacheRead("settings");

    if (
      settings &&
      typeof settings === "object"
    ) {

      this.settings = settings;

      this.applySettingsToForm();
    }
  }


  /* =====================================================
     SETTINGS FORM
  ===================================================== */

  applySettingsToForm() {

    const lowStock =
      this.dom.setLowStock;

    if (lowStock) {

      lowStock.value =
        this.settings.lowStockThreshold ||
        DEFAULT_LOW_STOCK;
    }


    const best =
      this.dom.setBest;

    if (best) {

      best.checked =
        this.settings.showBestSellers !==
        "false";
    }


    const featured =
      this.dom.setFeatured;

    if (featured) {

      featured.checked =
        this.settings.showFeatured !==
        "false";
    }


    const newArrivals =
      this.dom.setNew;

    if (newArrivals) {

      newArrivals.checked =
        this.settings.showNewArrivals !==
        "false";
    }


    if (this.dom.setAlertAt) {
      this.dom.setAlertAt.value =
        this.settings.lowStockAlertAt ?? 1;
    }

    [["setGcashNumber", "gcashNumber"], ["setGcashName", "gcashName"], ["setMessenger", "messengerUrl"]]
      .forEach(([id, key]) => {
        const el = document.getElementById(id);
        if (el) el.value = this.settings[key] ?? "";
      });


    const signature =
      this.dom.setSignature;

    if (signature) {

      signature.checked =
        this.settings.showSignature !==
        "false";
    }
  }


  /* =====================================================
     OPEN ADMIN APP
  ===================================================== */

  async openApp() {

    this.dom.loginView?.classList.add(
      "hidden"
    );

    this.dom.appView?.classList.remove(
      "hidden"
    );


    /*
     * Paint cached data first.
     */
    this.hydrateCachedAdmin();


    try {

      /*
       * Fetch everything concurrently.
       */
      await Promise.all([
        this.loadDashboard(),
        this.loadProducts(),
        this.loadOrders(),
        this.loadPromotions(),
        this.loadSettings()
      ]);


      this.setStatus(
        "Admin connected"
      );


      this.startRealtime();

    } catch (error) {

      this.setStatus(
        error.message,
        true
      );


      /*
       * Still allow realtime to start.
       */
      this.startRealtime();
    }
  }


  /* =====================================================
     AUTH PARAMETERS
  ===================================================== */

  params(extra = {}) {

    /*
     * Authentication is handled by the Supabase
     * session token, so no credentials are sent.
     */
    return { ...extra };
  }


  /* =====================================================
     VIEW NAVIGATION
  ===================================================== */

  showView(view) {

    this.views.forEach(
      currentView => {

        const element =
          document.getElementById(
            currentView + "View"
          );

        if (!element) {
          return;
        }


        element.classList.toggle(
          "hidden",
          currentView !== view
        );
      }
    );


    document
      .querySelectorAll(".nav-item")
      .forEach(button => {

        button.classList.toggle(
          "active",
          button.dataset.view === view
        );
      });


    if (this.dom.viewTitle) {

      this.dom.viewTitle.textContent =
        view.charAt(0).toUpperCase() +
        view.slice(1);
    }


    if (view === "audit") {

      this.loadAudit();
    }


    if (view === "reviews") {

      this.loadReviews();
    }


    if (view === "orders") {
      this.unseenOrders = 0;
      this.updateOrderBadge?.();
    }
  }


  /* =====================================================
     DASHBOARD
  ===================================================== */

  async loadDashboard(silent = false) {

    /*
     * Prevent overlapping realtime dashboard calls.
     */
    if (
      silent &&
      this._pollingDashboard
    ) {
      return;
    }


    this._pollingDashboard = true;


    try {

      const response =
        await this.request(
          "GET",
          this.params({
            action:
              "adminDashboard"
          })
        );


      this.cacheWrite(
        "dashboard",
        response
      );


      this.renderDashboard(
        response
      );

    } finally {

      this._pollingDashboard = false;
    }
  }


  renderDashboard(response) {

    /*
     * Keep the full (all-time) data from the database, then
     * recalculate orders/revenue/top products for the chosen dates.
     */
    this.lastDashboard = response || {};

    const range = this.dashboardRange();

    if (range) {
      response = {
        ...response,
        ...this.computeDashboard(range)
      };
    }

    this.renderRangeLabel(range, response?.stats);

    this.renderRevenueChart(range);

    const stats =
      response?.stats || {};


    /* -----------------------------------------------
       STAT CARDS
    ------------------------------------------------ */

    const cards =
      this.dom.statsCards;


    if (cards) {

      const statsHTML = [
        [
          "Orders",
          stats.orders || 0
        ],

        [
          "Revenue",
          formatCurrency(
            stats.revenue || 0
          )
        ],

        [
          "Completed",
          stats.completed || 0
        ],

        [
          "Pending",
          stats.pending || 0
        ],

        [
          "Customers",
          stats.customers || 0
        ],

        [
          "To collect",
          formatCurrency(stats.toCollect || 0),
          `${stats.unpaidOrders || 0} unpaid order${Number(stats.unpaidOrders) === 1 ? "" : "s"}`
        ]

      ]
        .map(
          ([label, value, sub]) =>
            `
            <div class="stat">
              <small>${escapeHTML(label)}</small>
              <strong>${escapeHTML(value)}</strong>
              ${sub ? `<small class="sub">${escapeHTML(sub)}</small>` : ""}
            </div>
            `
        )
        .join("");


      cards.innerHTML = statsHTML;
    }


    /* -----------------------------------------------
       TOP PRODUCTS
    ------------------------------------------------ */

    const topProducts =
      this.dom.topProducts;


    if (topProducts) {

      const list =
        Array.isArray(
          response?.topProducts
        )
          ? response.topProducts
          : [];


      topProducts.innerHTML =
        `
        <div class="mini-list">
          ${
            list
              .map(
                (product, index) =>
                  `
                  <div class="mini">
                    <span>
                      ${index + 1}.
                      ${escapeHTML(product.name)}
                    </span>

                    <b>
                      ${escapeHTML(product.units)}
                    </b>
                  </div>
                  `
              )
              .join("")
          }
        </div>
        `;
    }


    /* -----------------------------------------------
       LOW STOCK THRESHOLD
    ------------------------------------------------ */

    if (this.dom.lowStockLabel) {

      this.dom.lowStockLabel.textContent =
        "Threshold " +
        (
          Number(
            response?.settings
              ?.lowStockThreshold
          ) || DEFAULT_LOW_STOCK
        );
    }


    /* -----------------------------------------------
       LOW STOCK PRODUCTS
    ------------------------------------------------ */

    const lowStock =
      this.dom.lowStock;


    if (lowStock) {

      const list =
        Array.isArray(
          response?.lowStock
        )
          ? response.lowStock
          : [];


      lowStock.innerHTML =
        list.length

          ?

          list
            .map(
              product =>
                `
                <div class="mini">
                  <span>
                    ${escapeHTML(product.name)}
                  </span>

                  <b>
                    ${escapeHTML(product.stock)}
                    left
                  </b>
                </div>
                `
            )
            .join("")

          :

          `
          <p class="muted">
            No low-stock products.
          </p>
          `;


      if (list.length) {
        lowStock.innerHTML =
          `<div class="mini-list">${lowStock.innerHTML}</div>`;
      }
    }
  }


  /* =====================================================
     ORDERS
  ===================================================== */

  async loadOrders(silent = false) {

    if (
      silent &&
      this._pollingOrders
    ) {
      return;
    }


    this._pollingOrders = true;


    try {

      const response =
        await this.request(
          "GET",
          this.params({
            action:
              "adminOrders"
          })
        );


      this.orders =
        Array.isArray(
          response?.orders
        )
          ? response.orders
          : [];


      this.rebuildOrderIndex();

      this.renderOrders();

      this.checkNewOrders();

      if (this.openOrderId && !this.dom.orderDrawer?.classList.contains("hidden")) {
        // keep the open details panel in sync, unless you're typing in it
        if (!this.dom.drawerBody?.contains(document.activeElement)) this.openOrder(this.openOrderId);
      }


      if (this.dashboardRange()) {
        this.renderDashboard(this.lastDashboard || {});
      } else {
        this.renderRevenueChart(null);
      }

    } finally {

      this._pollingOrders = false;
    }
  }


  rebuildOrderIndex() {

    this.orderSearchIndex =
      this.orders.map(order => ({

        order,

        search:
          [
            order.orderId,
            order.fullname,
            order.contact,
            order.scent
          ]
            .map(normalize)
            .join(" ")

      }));
  }


  renderOrders() {

    const table =
      this.dom.ordersRows;

    if (!table) {
      return;
    }

    const search =
      normalize(
        this.dom.orderSearch?.value
      );

    const pay = this.dom.orderPayFilter?.value || "";

    this.dom.orderPayFilter?.classList.toggle("on", Boolean(pay));

    const searched =
      this.orderSearchIndex
        .filter(item =>
          !search ||
          item.search.includes(search)
        )
        .map(item => item.order)
        .filter(order => !pay || (order.paymentStatus || "Unpaid") === pay);


    /* ---------- tabs with counts ---------- */

    const tabs = [
      ["active", "Needs action", o => ACTIVE_STATUSES.includes(o.status)],
      ...ORDER_STATUSES.map(st => [st, st, o => o.status === st]),
      ["all", "All", () => true]
    ];

    const current = tabs.find(t => t[0] === this.orderTab) || tabs[0];

    if (this.dom.orderTabs) {
      this.dom.orderTabs.innerHTML = tabs
        .map(([key, label, test]) => {
          const count = searched.filter(test).length;
          const urgent = (key === "active" || key === "New") && count > 0;
          return `<button type="button" role="tab" class="tab ${key === current[0] ? "active" : ""} ${urgent ? "urgent" : ""}"
                    data-tab="${escapeHTML(key)}" aria-selected="${key === current[0]}">${escapeHTML(label)}<b>${count}</b></button>`;
        })
        .join("");
    }

    const rows = searched.filter(current[2]);

    if (!rows.length) {
      table.innerHTML =
        `<tr><td colspan="7" class="muted">${current[0] === "active" ? "Nothing to do right now. 🎉" : "No orders here."}</td></tr>`;
      return;
    }

    table.innerHTML = rows
      .map(order => {
        const next = NEXT_STATUS[order.status];
        const paid = order.amountPaid;
        const diff = paid != null && order.paymentStatus === "Paid" && paid < Number(order.total);

        return `
          <tr data-order="${escapeHTML(order.orderId)}">
            <td class="td-main">
              <b>${escapeHTML(order.orderId)}</b>
              <small>${order.timestamp ? escapeHTML(new Date(order.timestamp).toLocaleString()) : ""}</small>
            </td>
            <td data-label="Customer">
              ${escapeHTML(order.fullname)}
              <small>${escapeHTML(order.contact)}</small>
            </td>
            <td data-label="Items">
              ${
                Array.isArray(order.items) && order.items.length
                  ? order.items.map(item => `${escapeHTML(item.name)} × ${escapeHTML(item.qty)}`).join("<br>")
                  : escapeHTML(order.scent || "")
              }
            </td>
            <td data-label="Total">
              ${formatCurrency(order.total)}
              ${
                paid != null && paid !== Number(order.total)
                  ? `<small class="${diff ? "paid-diff" : ""}">paid ${formatCurrency(paid)}</small>`
                  : ""
              }
            </td>
            <td data-label="Payment">${payPill(order)}<small>${escapeHTML(order.payment || "")}</small></td>
            <td data-label="Status">${statusPill(order.status)}</td>
            <td>
              <div class="order-actions">
                ${
                  next
                    ? `<button class="btn next-btn" type="button" data-next="${escapeHTML(order.orderId)}">${escapeHTML(NEXT_LABEL[order.status])}</button>`
                    : ""
                }
              </div>
            </td>
          </tr>
        `;
      })
      .join("");
  }


  /* =====================================================
     UPDATE ORDER
  ===================================================== */

  async updateOrder(
    orderId,
    status
  ) {

    try {

      const response = await this.request(
        "POST",
        this.params({

          action:
            "adminUpdateOrderStatus",

          orderId,

          status
        })
      );


      /*
       * Update local state immediately.
       */
      this.replaceOrder(orderId, response.order, { status });


      this.rebuildOrderIndex();
      this.renderOrders();


      this.setStatus(
        `Order ${orderId}: ${status}`
      );

      if (this.openOrderId === orderId) this.openOrder(orderId);

      // Stock changes when an order is cancelled
      if (status === "Cancelled") this.loadProducts().catch(() => {});

      await this.loadDashboard();

    } catch (error) {

      this.setStatus(
        error.message,
        true
      );
    }
  }


  /* =====================================================
     EXPORT ORDERS
  ===================================================== */

  exportOrders() {

    const headers = [
      "Order ID",
      "Customer",
      "Contact",
      "Items",
      "Total",
      "Amount Paid",
      "Payment Status",
      "Payment Method",
      "Payment Ref",
      "Payment Note",
      "Status",
      "Date",
      "Delivery / Meetup",
      "Notes"
    ];


    const lines = [

      headers,

      ...this.orders.map(
        order => [

          order.orderId,

          order.fullname,

          order.contact,

          (order.items || [])
            .map(
              item =>
                `${item.name} x ${item.qty}`
            )
            .join(" | "),

          order.total,

          order.amountPaid ?? "",

          order.paymentStatus || "Unpaid",

          order.payment || "",

          order.paymentRef || "",

          order.paymentNote || "",

          order.status,

          order.timestamp,

          order.address || "",

          order.notes || ""
        ]
      )

    ]

      .map(
        row =>
          row
            .map(
              value =>
              '"' +
              csvSafe(value).replace(
                  /"/g,
                  '""'
                ) +
                '"'
            )
            .join(",")
      )

      .join("\n");


    const url =
      URL.createObjectURL(
        new Blob(
          [lines],
          {
            type:
              "text/csv;charset=utf-8"
          }
        )
      );


    const link =
      document.createElement("a");


    link.href = url;

    link.download =
      "aura-essence-orders.csv";


    document.body.appendChild(link);

    link.click();

    link.remove();


    /*
     * Delay revoke slightly so browsers
     * have time to start the download.
     */
    setTimeout(
      () => URL.revokeObjectURL(url),
      100
    );
  }


  /* =====================================================
     PRODUCTS
  ===================================================== */

  async loadProducts() {

    const response =
      await this.request(
        "GET",
        this.params({
          action:
            "adminProducts"
        })
      );


    this.products =
      Array.isArray(
        response?.products
      )
        ? response.products
        : [];


    this.rebuildProductIndex();


    this.cacheWrite(
      "products",
      this.products
    );


    /*
     * If the products table is empty,
     * automatically seed existing
     * products from products.js.
     */

    if (
      !this.products.length &&
      PRODUCTS.length
    ) {

      await this.syncCatalog();

      return;
    }


    this.renderProducts();
  }


  rebuildProductIndex() {

    this.productMap.clear();

    this.productSearchIndex = [];


    this.products.forEach(
      product => {

        const id =
          String(product.id);


        this.productMap.set(
          id,
          product
        );


        this.productSearchIndex.push({

          product,

          search:
            [
              product.name,
              product.id
            ]
              .map(normalize)
              .join(" ")
        });
      }
    );
  }


  /* =====================================================
     SYNC CATALOG
  ===================================================== */

  async syncCatalog() {

    const products =
      PRODUCTS.map(
        product => ({

          id:
            product.id,

          name:
            product.name,

          cat:
            product.cat,

          desc:
            product.desc,

          img:
            product.img || "",

          price:
            product.price ||
            DEFAULT_PRODUCT_PRICE,

          stock:
            product.stock == null
              ? 10
              : product.stock,

          badges:
            product.badges || [],

          active:
            product.active !== false,

          profiles:
            product.profiles || [],

          longevity:
            product.longevity,

          projection:
            product.projection,

          strength:
            product.strength,

          time:
            product.time || [],

          occasion:
            product.occasion,

          descLong:
            product.descLong,

          topNotes:
            product.topNotes || [],

          heartNotes:
            product.heartNotes || [],

          baseNotes:
            product.baseNotes || [],

          application:
            product.application,

          sortOrder:
            product.sortOrder || 0
        })
      );


    await this.request(
      "POST",
      this.params({

        action:
          "adminSeedProducts",

        products:
          JSON.stringify(products)
      })
    );


    const response =
      await this.request(
        "GET",
        this.params({
          action:
            "adminProducts"
        })
      );


    this.products =
      Array.isArray(
        response?.products
      )
        ? response.products
        : [];


    this.rebuildProductIndex();


    this.cacheWrite(
      "products",
      this.products
    );


    this.renderProducts();


    this.setStatus(
      "Product catalog synced"
    );
  }


  /* =====================================================
     RENDER PRODUCTS
  ===================================================== */

  renderProducts() {

    const table =
      this.dom.productsRows;


    if (!table) {
      return;
    }


    const search =
      normalize(
        this.dom.productSearch?.value
      );


    const cat = this.dom.filterCat?.value || "";
    const stockFilter = this.dom.filterStock?.value || "";
    const badge = this.dom.filterBadge?.value || "";
    const visibility = this.dom.filterActive?.value || "";
    const sortBy = this.dom.sortProducts?.value || "order";

    const lowLimit =
      Number(this.settings?.lowStockThreshold) ||
      DEFAULT_LOW_STOCK;

    const stockOf = product =>
      product.stock == null ? Infinity : Number(product.stock);

    // Highlight filters that are switched on
    ["filterCat", "filterStock", "filterBadge", "filterActive"]
      .forEach(id =>
        this.dom[id]?.classList.toggle("on", Boolean(this.dom[id].value))
      );

    const sorters = {
      order: (a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) ||
                       String(a.name).localeCompare(String(b.name)),
      name: (a, b) => String(a.name).localeCompare(String(b.name)),
      stockAsc: (a, b) => stockOf(a) - stockOf(b),
      stockDesc: (a, b) => stockOf(b) - stockOf(a),
      priceAsc: (a, b) => Number(a.price || 0) - Number(b.price || 0),
      priceDesc: (a, b) => Number(b.price || 0) - Number(a.price || 0)
    };

    const products =
      this.productSearchIndex

        .filter(item =>
          !search ||
          item.search.includes(search)
        )

        .map(item => item.product)

        .filter(product => {

          if (cat && product.cat !== cat) return false;

          const stock = stockOf(product);

          if (stockFilter === "in" && !(stock > 0)) return false;
          if (stockFilter === "low" && !(stock > 0 && stock <= lowLimit)) return false;
          if (stockFilter === "out" && stock !== 0) return false;
          if (stockFilter === "unlimited" && product.stock != null) return false;

          const badges = (product.badges || []).map(b => String(b).toUpperCase());

          if (badge === "__none" && badges.length) return false;
          if (badge && badge !== "__none" && !badges.includes(badge)) return false;

          if (visibility === "active" && product.active === false) return false;
          if (visibility === "hidden" && product.active !== false) return false;

          return true;
        })

        .slice()
        .sort(sorters[sortBy] || sorters.order);


    if (this.dom.productCount) {
      this.dom.productCount.textContent =
        products.length === this.products.length
          ? `${products.length} products`
          : `Showing ${products.length} of ${this.products.length}`;
    }


    if (!products.length) {
      table.innerHTML =
        `<tr><td colspan="7" class="muted">No products match these filters.</td></tr>`;
      return;
    }


    table.innerHTML =
      products
        .map(
          product =>
            `
            <tr>

              <td>
                <b>
                  ${escapeHTML(product.name)}
                </b>

                <small>
                  ${escapeHTML(product.id)}
                </small>
              </td>

              <td>
                ${formatCurrency(product.price)}
              </td>

              <td>
                ${
                  product.stock == null
                    ? `<div class="stock-cell"><b>∞</b><button class="mini-btn text" data-stock="${escapeHTML(product.id)}" data-op="set" title="Start tracking stock">Set</button></div>`
                    : `<div class="stock-cell">
                         <button class="mini-btn" data-stock="${escapeHTML(product.id)}" data-op="dec" title="Remove 1" aria-label="Remove 1">−</button>
                         <b class="${Number(product.stock) === 0 ? "zero" : ""}">${escapeHTML(product.stock)}</b>
                         <button class="mini-btn" data-stock="${escapeHTML(product.id)}" data-op="inc" title="Add 1" aria-label="Add 1">+</button>
                         <button class="mini-btn text" data-stock="${escapeHTML(product.id)}" data-op="restock" title="Add several bottles">Restock</button>
                       </div>`
                }
              </td>

              <td>
                ${
                  Array.isArray(product.badges) &&
                  product.badges.length

                    ?

                    product.badges
                      .map(
                        badge =>
                          `
                          <span class="badge">
                            ${escapeHTML(badge)}
                          </span>
                          `
                      )
                      .join("")

                    :

                    "—"
                }
              </td>

              <td>
                ${
                  product.active !== false
                    ? "Yes"
                    : "No"
                }
              </td>

              <td>
                ${
                  product.sortOrder || 0
                }
              </td>

              <td class="row-actions">

                <button
                  class="btn"
                  data-edit="${escapeHTML(product.id)}"
                >
                  Edit
                </button>

                <button
                  class="btn danger"
                  data-delete="${escapeHTML(product.id)}"
                >
                  Delete
                </button>

              </td>

            </tr>
            `
        )
        .join("");
  }


  /* =====================================================
     EDIT PRODUCT
  ===================================================== */

  editProduct(product) {

    this.dom.productEditor?.classList.remove(
      "hidden"
    );


    if (this.dom.editorTitle) {

      this.dom.editorTitle.textContent =
        product
          ? "Edit Product"
          : "Add Product";
    }


    const set =
      (id, value) => {

        const element =
          document.getElementById(id);

        if (element) {

          element.value =
            value ?? "";
        }
      };


    set(
      "pOriginalId",
      product?.id || ""
    );

    set(
      "pId",
      product?.id || ""
    );

    set(
      "pName",
      product?.name || ""
    );

    set(
      "pCat",
      product?.cat || "men"
    );

    set(
      "pPrice",
      product?.price ||
      DEFAULT_PRODUCT_PRICE
    );

    set(
      "pStock",
      product?.stock ?? 10
    );

    set(
      "pCost",
      product?.cost ?? ""
    );

    set(
      "pSort",
      product?.sortOrder || 0
    );

    set(
      "pImg",
      product?.img || ""
    );

    this.showImagePreview(product?.img || "");

    if (this.dom.pImgStatus) {
      this.dom.pImgStatus.textContent =
        "JPG, PNG or WebP. Big photos are resized automatically.";
    }

    if (this.dom.pImgFile) this.dom.pImgFile.value = "";

    set(
      "pDesc",
      product?.desc || ""
    );

    set(
      "pDescLong",
      product?.descLong || ""
    );

    set(
      "pTop",
      (product?.topNotes || [])
        .join(", ")
    );

    set(
      "pHeart",
      (product?.heartNotes || [])
        .join(", ")
    );

    set(
      "pBase",
      (product?.baseNotes || [])
        .join(", ")
    );

    set(
      "pApplication",
      product?.application || ""
    );

    set(
      "pProfiles",
      (product?.profiles || [])
        .join(", ")
    );

    set(
      "pLongevity",
      product?.longevity || 7
    );

    set(
      "pProjection",
      product?.projection || 7
    );


    const normalizedStrength = {

      light:
        "subtle",

      subtle:
        "subtle",

      moderate:
        "moderate",

      strong:
        "bold",

      bold:
        "bold"

    }[
      normalize(
        product?.strength ||
        "moderate"
      )
    ] || "moderate";


    set(
      "pStrength",
      normalizedStrength
    );


    set(
      "pTime",
      (product?.time || [])
        .join(", ")
    );

    set(
      "pOccasion",
      product?.occasion || ""
    );


    const active =
      document.getElementById(
        "pActive"
      );


    if (active) {

      active.checked =
        product?.active !== false;
    }


    document
      .querySelectorAll(".badge")
      .forEach(
        badge => {

          /*
           * Preserve the existing behavior.
           */
          badge.checked =
            (
              product?.badges || []
            ).includes(
              badge.value
            );
        }
      );
  }


  /* =====================================================
     SAVE PRODUCT
  ===================================================== */

  async saveProduct(e) {

    e.preventDefault();


    const value =
      id => {

        const element =
          document.getElementById(id);

        return element
          ? element.value.trim()
          : "";
      };


    const payload =
      this.params({

        action:
            "adminSaveProduct",

          originalId:
            value("pOriginalId"),

        id:
          value("pId"),

        name:
          value("pName"),

        cat:
          value("pCat"),

        price:
          value("pPrice"),

        stock:
          value("pStock"),

        cost:
          value("pCost"),

        sortOrder:
          value("pSort"),

        img:
          value("pImg"),

        desc:
          value("pDesc"),

        descLong:
          value("pDescLong"),

        topNotes:
          value("pTop"),

        heartNotes:
          value("pHeart"),

        baseNotes:
          value("pBase"),

        application:
          value("pApplication"),

        profiles:
          value("pProfiles"),

        longevity:
          value("pLongevity"),

        projection:
          value("pProjection"),

        strength:
          value("pStrength"),

        time:
          value("pTime"),

        occasion:
          value("pOccasion"),

        active:
          this.dom.pActive?.checked ||
          false,

        badges:
          [
            ...document.querySelectorAll(
              ".badge:checked"
            )
          ]
            .map(
              element =>
                element.value
            )
            .join(",")
      });


    try {

      await this.request(
        "POST",
        payload
      );


      this.setStatus(
        "Product saved"
      );


      this.dom.productEditor?.classList.add(
        "hidden"
      );


      /*
       * Refresh both products and dashboard.
       */
      await Promise.all([
        this.loadProducts(),
        this.loadDashboard()
      ]);

    } catch (error) {

      this.setStatus(
        error.message,
        true
      );
    }
  }


  /* =====================================================
     DELETE PRODUCT
  ===================================================== */

  async deleteProduct(
    id =
      this.dom.pOriginalId?.value
  ) {

    if (!id) {
      return;
    }


    if (
      !confirm(
        "Delete this product?"
      )
    ) {
      return;
    }


    try {

      await this.request(
        "POST",
        this.params({

          action:
            "adminDeleteProduct",

          id
        })
      );


      this.setStatus(
        "Product deleted"
      );


      this.dom.productEditor?.classList.add(
        "hidden"
      );


      await Promise.all([
        this.loadProducts(),
        this.loadDashboard()
      ]);

    } catch (error) {

      this.setStatus(
        error.message,
        true
      );
    }
  }


  /* =====================================================
     PROMOTIONS
  ===================================================== */

  async loadPromotions() {

    const response =
      await this.request(
        "GET",
        this.params({
          action:
            "adminPromotions"
        })
      );


    this.promotions =
      Array.isArray(
        response?.promotions
      )
        ? response.promotions
        : [];


    this.rebuildPromotionIndex();


    this.cacheWrite(
      "promotions",
      this.promotions
    );


    this.renderPromotions();
  }


  rebuildPromotionIndex() {

    this.promotionMap.clear();


    this.promotions.forEach(
      promotion => {

        this.promotionMap.set(
          String(promotion.id),
          promotion
        );
      }
    );
  }


  renderPromotions() {

    const container =
      document.getElementById(
        "promosList"
      );


    if (!container) {
      return;
    }


    container.innerHTML =
      this.promotions
        .map(
          promotion =>
            `
            <div class="list-row">

              <div>

                <b>
                  ${escapeHTML(promotion.name)}
                </b>

                <small>
                  ${escapeHTML(promotion.type)}
                  • min ${escapeHTML(promotion.minQty)}
                  • ${
                    promotion.type ===
                    "fixed_total"

                      ?

                      formatCurrency(
                        promotion.fixedTotal
                      )

                      :

                      escapeHTML(
                        promotion.percentOff
                      ) +
                      "% off"
                  }
                </small>

              </div>

              <div class="row-actions">

                <span class="badge">
                  ${
                    promotion.active
                      ? "ACTIVE"
                      : "OFF"
                  }
                </span>

                <button
                  class="btn"
                  data-pedit="${escapeHTML(promotion.id)}"
                >
                  Edit
                </button>

                <button
                  class="btn danger"
                  data-pdel="${escapeHTML(promotion.id)}"
                >
                  Delete
                </button>

              </div>

            </div>
            `
        )
        .join("");
  }


  /* =====================================================
     EDIT PROMOTION
  ===================================================== */

  editPromotion(
    promotion
  ) {

    this.dom.promoEditor?.classList.remove(
      "hidden"
    );


    const set =
      (id, value) => {

        const element =
          document.getElementById(id);

        if (element) {

          element.value =
            value ?? "";
        }
      };


    set(
      "promoId",
      promotion?.id || ""
    );

    set(
      "promoName",
      promotion?.name || ""
    );

    set(
      "promoType",
      promotion?.type ||
      "fixed_total"
    );

    set(
      "promoQty",
      promotion?.minQty ||
      DEFAULT_PROMO_QTY
    );

    set(
      "promoFixed",
      promotion?.fixedTotal ||
      DEFAULT_PROMO_FIXED
    );

    set(
      "promoPercent",
      promotion?.percentOff ||
      0
    );


    const active =
      document.getElementById(
        "promoActive"
      );


    if (active) {

      active.checked =
        promotion?.active !== false;
    }
  }


  /* =====================================================
     SAVE PROMOTION
  ===================================================== */

  async savePromotion(e) {

    e.preventDefault();


    const value =
      id => {

        const element =
          document.getElementById(id);

        return element
          ? element.value.trim()
          : "";
      };


    try {

      await this.request(
        "POST",
        this.params({

          action:
            "adminSavePromotion",

          id:
            value("promoId"),

          name:
            value("promoName"),

          type:
            value("promoType"),

          minQty:
            value("promoQty"),

          fixedTotal:
            value("promoFixed"),

          percentOff:
            value("promoPercent"),

          active:
            document.getElementById(
              "promoActive"
            )?.checked ||
            false
        })
      );


      this.dom.promoEditor?.classList.add(
        "hidden"
      );


      await this.loadPromotions();


      this.setStatus(
        "Promotion saved"
      );

    } catch (error) {

      this.setStatus(
        error.message,
        true
      );
    }
  }


  /* =====================================================
     DELETE PROMOTION
  ===================================================== */

  async deletePromotion(id) {

    if (
      !confirm(
        "Delete this promotion?"
      )
    ) {
      return;
    }


    try {

      await this.request(
        "POST",
        this.params({

          action:
            "adminDeletePromotion",

          id
        })
      );


      await this.loadPromotions();


      this.setStatus(
        "Promotion deleted"
      );

    } catch (error) {

      this.setStatus(
        error.message,
        true
      );
    }
  }


  /* =====================================================
     SETTINGS
  ===================================================== */

  async loadSettings() {

    const response =
      await this.request(
        "GET",
        this.params({
          action:
            "adminSettings"
        })
      );


    this.settings =
      response?.settings || {};


    this.cacheWrite(
      "settings",
      this.settings
    );


    this.applySettingsToForm();
  }


  async saveSettings(e) {

    e.preventDefault();


    const settings = {

      lowStockThreshold:
        this.dom.setLowStock?.value ||
        DEFAULT_LOW_STOCK,

      showBestSellers:
        this.dom.setBest?.checked ||
        false,

      showFeatured:
        this.dom.setFeatured?.checked ||
        false,

      showNewArrivals:
        this.dom.setNew?.checked ||
        false,

      showSignature:
        this.dom.setSignature?.checked ||
        false,

      lowStockAlertAt:
        this.dom.setAlertAt?.value ?? 1,

      gcashNumber:
        document.getElementById("setGcashNumber")?.value.trim() || "",

      gcashName:
        document.getElementById("setGcashName")?.value.trim() || "",

      messengerUrl:
        document.getElementById("setMessenger")?.value.trim() || ""
    };


    try {

      await this.request(
        "POST",
        this.params({

          action:
            "adminSaveSettings",

          settings:
            JSON.stringify(settings)
        })
      );


      /*
       * Update local state immediately.
       */
      this.settings = {
        ...this.settings,
        ...settings
      };


      this.cacheWrite(
        "settings",
        this.settings
      );


      this.setStatus(
        "Settings saved"
      );


      await this.loadDashboard();

    } catch (error) {

      this.setStatus(
        error.message,
        true
      );
    }
  }


  /* =====================================================
     AUDIT
  ===================================================== */

  async loadAudit() {

    try {

      const response =
        await this.request(
          "GET",
          this.params({
            action:
              "adminAudit"
          })
        );


      const table =
        this.dom.auditRows;


      if (!table) {
        return;
      }


      const logs =
        Array.isArray(
          response?.logs
        )
          ? response.logs
          : [];


      table.innerHTML =
        logs
          .map(
            log =>
              `
              <tr>

                <td>
                  ${
                    log.timestamp
                      ? escapeHTML(
                          new Date(
                            log.timestamp
                          ).toLocaleString()
                        )
                      : ""
                  }
                </td>

                <td>
                  ${escapeHTML(log.actor || "")}
                </td>

                <td>
                  ${escapeHTML(log.action || "")}
                </td>

              </tr>
              `
          )
          .join("");

    } catch (error) {

      this.setStatus(
        error.message,
        true
      );
    }
  }
}


/* =========================================================
   DASHBOARD DATE RANGE
========================================================= */

function toDateInput(d) {
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

Object.assign(AdminApp.prototype, {

  presetRange(preset) {
    const now = new Date();
    const today = startOfDay(now);
    const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

    switch (preset) {
      case "today":     return { from: today, to: endOfDay(today) };
      case "yesterday": { const y = addDays(today, -1); return { from: y, to: endOfDay(y) }; }
      case "7d":        return { from: addDays(today, -6), to: endOfDay(today) };
      case "30d":       return { from: addDays(today, -29), to: endOfDay(today) };
      case "thisMonth": return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: endOfDay(today) };
      case "lastMonth": return {
        from: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        to: endOfDay(new Date(now.getFullYear(), now.getMonth(), 0))
      };
      case "thisYear":  return { from: new Date(now.getFullYear(), 0, 1), to: endOfDay(today) };
      default:          return null;
    }
  },


  fillRangeInputs() {
    const range = this.presetRange(this.dom.rangePreset?.value);

    if (this.dom.rangeFrom) this.dom.rangeFrom.value = range ? toDateInput(range.from) : "";
    if (this.dom.rangeTo) this.dom.rangeTo.value = range ? toDateInput(range.to) : "";
  },


  // Returns { from, to } or null for "All time"
  dashboardRange() {
    const preset = this.dom.rangePreset?.value || "all";

    if (preset === "all") return null;
    if (preset !== "custom") return this.presetRange(preset);

    const parse = v => {
      const [y, m, d] = String(v || "").split("-").map(Number);
      return y ? new Date(y, m - 1, d) : null;
    };

    let from = parse(this.dom.rangeFrom?.value);
    let to = parse(this.dom.rangeTo?.value);

    if (!from && !to) return null;
    if (!from) from = new Date(2000, 0, 1);
    if (!to) to = new Date();
    if (from > to) [from, to] = [to, from];

    return { from: startOfDay(from), to: endOfDay(to) };
  },


  computeDashboard({ from, to }) {
    const orders = this.orders.filter(order => {
      const t = new Date(order.timestamp);
      return !isNaN(t) && t >= from && t <= to;
    });

    const counted = orders.filter(order => order.status !== "Cancelled");

    const received = order => Number(order.amountPaid ?? order.total ?? 0);
    const revenue = counted.reduce((sum, order) => sum + received(order), 0);
    const unpaid = counted.filter(order => ["Unpaid", "Partial"].includes(order.paymentStatus || "Unpaid"));
    const toCollect = unpaid.reduce((sum, order) =>
      sum + Math.max(0, Number(order.total || 0) - Number(order.amountPaid || 0)), 0);

    const customers = new Set(
      orders.map(order =>
        String(order.contact || "").replace(/\D/g, "").slice(-10) ||
        normalize(order.fullname)
      )
    );

    const sales = {};
    counted.forEach(order =>
      (order.items || []).forEach(item => {
        const key = String(item.id ?? item.name);
        sales[key] = (sales[key] || 0) + Number(item.qty || 0);
      })
    );

    const topProducts = this.products
      .map(product => ({ id: product.id, name: product.name, units: sales[String(product.id)] || 0 }))
      .sort((a, b) => b.units - a.units || String(a.name).localeCompare(String(b.name)))
      .slice(0, 10);

    return {
      stats: {
        orders: orders.length,
        revenue,
        completed: orders.filter(o => o.status === "Completed").length,
        pending: orders.filter(o => o.status !== "Completed" && o.status !== "Cancelled").length,
        customers: customers.size,
        toCollect,
        unpaidOrders: unpaid.length,
        averageOrderValue: counted.length ? revenue / counted.length : 0
      },
      topProducts
    };
  },


  renderRangeLabel(range, stats = {}) {
    this.dom.rangePreset?.classList.toggle("on", Boolean(range));

    if (!this.dom.rangeLabel) return;

    const fmt = d => d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    const avg = Number(stats.averageOrderValue || 0);
    const avgText = avg ? ` · avg ${formatCurrency(Math.round(avg))}/order` : "";

    this.dom.rangeLabel.textContent = range
      ? `${fmt(range.from)} – ${fmt(range.to)}${avgText}`
      : `All time${avgText}`;
  }
});


/* =========================================================
   PRODUCT PHOTOS · QUICK STOCK · CHART · BACKUP
========================================================= */

// Resize big photos in the browser before uploading (max 1200px side).
function resizeImage(file, maxSide = 1200) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      if (scale === 1 && file.size < 1.5 * 1024 * 1024) return resolve(file);

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);

      const type = file.type === "image/png" ? "image/png" : "image/jpeg";
      canvas.toBlob(
        blob => blob ? resolve(new File([blob], file.name, { type })) : reject(new Error("Could not process the photo.")),
        type,
        0.85
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file isn't a readable image."));
    };

    img.src = url;
  });
}

const DAY_MS = 86400000;

function dayKey(d) {
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

Object.assign(AdminApp.prototype, {

  showImagePreview(src) {
    const img = this.dom.pImgPreview;
    const empty = this.dom.pImgEmpty;
    if (!img) return;

    const value = String(src || "").trim();

    if (!value) {
      img.hidden = true;
      img.removeAttribute("src");
      if (empty) empty.hidden = false;
      return;
    }

    // Relative paths (assets/images/...) live on the customer site.
    img.src = /^(https?:|data:|blob:)/.test(value) ? value : new URL(value, location.href).href;
    img.hidden = false;
    if (empty) empty.hidden = true;
    img.onerror = () => {
      img.hidden = true;
      if (empty) { empty.hidden = false; empty.textContent = "Can't load"; }
    };
  },


  async uploadProductImage() {
    const file = this.dom.pImgFile?.files?.[0];
    const status = this.dom.pImgStatus;
    if (!file) return;

    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      if (status) status.textContent = "Please choose a JPG, PNG or WebP photo.";
      return;
    }

    try {
      if (status) status.textContent = "Uploading…";
      const ready = await resizeImage(file);

      if (ready.size > 5 * 1024 * 1024) {
        throw new Error("Photo is still bigger than 5 MB after resizing. Try another one.");
      }

      const response = await this.request("POST", {
        action: "adminUploadProductImage",
        file: ready,
        productId: this.dom.pId?.value || this.dom.pName?.value || "product"
      });

      if (this.dom.pImg) this.dom.pImg.value = response.url;
      this.showImagePreview(response.url);
      if (status) status.textContent = "Uploaded ✓  Click Save Product to keep it.";

    } catch (error) {
      if (status) status.textContent = error.message;
    } finally {
      if (this.dom.pImgFile) this.dom.pImgFile.value = "";
    }
  },


  async adjustStock(id, op) {
    const product = this.productMap.get(String(id));
    if (!product) return;

    const params = { action: "adminAdjustStock", id };

    if (op === "inc") params.delta = 1;
    else if (op === "dec") params.delta = -1;
    else {
      const asked = prompt(
        op === "set"
          ? `How many bottles of ${product.name} do you have now?`
          : `How many bottles of ${product.name} are you adding?`,
        op === "set" ? "10" : "5"
      );
      if (asked === null) return;

      const n = parseInt(asked, 10);
      if (!Number.isFinite(n) || n < 0) {
        this.setStatus("Please enter a number of bottles.", true);
        return;
      }

      if (op === "set") params.set = n;
      else params.delta = n;
    }

    try {
      const response = await this.request("POST", params);

      product.stock = response.stock;
      this.cacheWrite("products", this.products);
      this.renderProducts();
      this.setStatus(`${product.name}: ${response.stock} in stock`);

      this.loadDashboard(true).catch(() => {});

    } catch (error) {
      this.setStatus(error.message, true);
    }
  },


  // Daily revenue (cancelled orders excluded) for the chosen range.
  renderRevenueChart(range) {
    const box = this.dom.revenueChart;
    if (!box) return;

    const tip = this.dom.chartTip;
    if (tip) tip.hidden = true;

    const orders = (this.orders || [])
      .filter(o => o.status !== "Cancelled")
      .map(o => ({ t: new Date(o.timestamp), total: Number(o.amountPaid ?? o.total ?? 0) }))
      .filter(o => !isNaN(o.t));

    let from, to;
    if (range) {
      from = startOfDay(range.from);
      to = startOfDay(range.to);
    } else {
      if (!orders.length) {
        box.innerHTML = `<p class="chart-empty">No orders yet.</p>`;
        if (this.dom.chartLabel) this.dom.chartLabel.textContent = "";
        return;
      }
      from = startOfDay(new Date(Math.min(...orders.map(o => o.t))));
      to = startOfDay(new Date());
    }

    // Group by day, or by week/month for long ranges so bars stay readable.
    const days = Math.round((to - from) / DAY_MS) + 1;
    const unit = days > 400 ? "month" : days > 92 ? "week" : "day";

    const bucketStart = d => {
      const x = startOfDay(d);
      if (unit === "month") return new Date(x.getFullYear(), x.getMonth(), 1);
      if (unit === "week") { x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; } // Monday
      return x;
    };

    const buckets = [];
    const index = new Map();
    for (let d = bucketStart(from); d <= to; ) {
      const key = dayKey(d);
      index.set(key, buckets.length);
      buckets.push({ start: new Date(d), total: 0, count: 0 });
      d = unit === "month" ? new Date(d.getFullYear(), d.getMonth() + 1, 1)
        : new Date(d.getFullYear(), d.getMonth(), d.getDate() + (unit === "week" ? 7 : 1));
    }

    orders.forEach(o => {
      if (o.t < from || o.t > endOfDay(to)) return;
      const i = index.get(dayKey(bucketStart(o.t)));
      if (i !== undefined) { buckets[i].total += o.total; buckets[i].count += 1; }
    });

    if (this.dom.chartLabel) {
      this.dom.chartLabel.textContent = { day: "Per day", week: "Per week", month: "Per month" }[unit];
    }

    const max = Math.max(0, ...buckets.map(b => b.total));
    if (!max) {
      box.innerHTML = `<p class="chart-empty">No sales in this period.</p>`;
      return;
    }

    // Nice y-axis ticks
    const step = (() => {
      const raw = max / 4;
      const pow = Math.pow(10, Math.floor(Math.log10(raw)));
      return [1, 2, 2.5, 5, 10].map(m => m * pow).find(s => s >= raw);
    })();
    const top = Math.ceil(max / step) * step;

    const W = Math.max(box.clientWidth || 800, 320), H = 240;
    const pad = { l: 56, r: 8, t: 10, b: 26 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const slot = iw / buckets.length;
    const gap = Math.min(2, slot * 0.2);
    const bw = Math.max(1, Math.min(slot - gap, 48));   // never a giant bar
    const y = v => pad.t + ih - (v / top) * ih;

    const short = d => d.toLocaleDateString(undefined, unit === "month" ? { month: "short", year: "2-digit" } : { month: "short", day: "numeric" });
    const labelEvery = Math.max(1, Math.ceil(buckets.length / Math.floor(iw / 64)));

    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Revenue ${this.dom.chartLabel?.textContent?.toLowerCase() || ""}">`;

    for (let v = 0; v <= top + 1e-9; v += step) {
      svg += `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>`;
      svg += `<text class="axis-text" x="${pad.l - 8}" y="${y(v) + 3}" text-anchor="end">₱${Math.round(v).toLocaleString()}</text>`;
    }

    buckets.forEach((b, i) => {
      const x = pad.l + i * slot + (slot - bw) / 2;
      if (b.total > 0) {
        const h = Math.max(2, ih - (y(b.total) - pad.t));
        const yy = pad.t + ih - h;
        const rr = Math.min(4, bw / 2, h);
        // rounded top, square bottom on the baseline
        svg += `<path class="bar" data-i="${i}" d="M${x},${yy + h} V${yy + rr} Q${x},${yy} ${x + rr},${yy} H${x + bw - rr} Q${x + bw},${yy} ${x + bw},${yy + rr} V${yy + h} Z"/>`;
      }
      svg += `<rect class="hit" data-i="${i}" x="${pad.l + i * slot}" y="${pad.t}" width="${slot}" height="${ih}"/>`;
      if (i % labelEvery === 0) {
        svg += `<text class="axis-text" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${short(b.start)}</text>`;
      }
    });

    svg += `</svg>`;
    box.innerHTML = svg;

    // Hover tooltip
    const svgEl = box.querySelector("svg");
    const bars = [...box.querySelectorAll(".bar")];
    const panel = box.parentElement;

    const hide = () => {
      if (tip) tip.hidden = true;
      bars.forEach(b => b.classList.remove("dim"));
    };

    box.querySelectorAll(".hit").forEach(hit => {
      hit.addEventListener("mouseenter", () => {
        const b = buckets[Number(hit.dataset.i)];
        bars.forEach(el => el.classList.toggle("dim", el.dataset.i !== hit.dataset.i));
        if (!tip) return;

        const when = unit === "week"
          ? `Week of ${b.start.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
          : b.start.toLocaleDateString(undefined, unit === "month" ? { month: "long", year: "numeric" } : { weekday: "short", month: "short", day: "numeric", year: "numeric" });

        tip.innerHTML = `${escapeHTML(when)}<b>${formatCurrency(b.total)}</b>${b.count} order${b.count === 1 ? "" : "s"}`;
        tip.hidden = false;

        const hr = hit.getBoundingClientRect(), pr = panel.getBoundingClientRect();
        const left = Math.min(Math.max(hr.left - pr.left + hr.width / 2 - tip.offsetWidth / 2, 8), pr.width - tip.offsetWidth - 8);
        tip.style.left = `${left}px`;
        tip.style.top = `${hr.top - pr.top + 4}px`;
      });
    });

    svgEl.addEventListener("mouseleave", hide);
  },


  async downloadBackup() {
    const button = this.dom.backupBtn;
    const label = button?.textContent;

    try {
      if (button) { button.disabled = true; button.textContent = "Preparing backup…"; }

      const [data, XLSX] = await Promise.all([
        this.request("GET", { action: "adminBackup" }),
        import("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm")
      ]);

      const list = v => Array.isArray(v) ? v.join(", ") : (v ?? "");
      const when = v => v ? new Date(v).toLocaleString() : "";

      const sheets = {
        Orders: data.orders.map(o => ({
          "Order ID": o.order_id,
          "Date": when(o.created_at),
          "Status": o.status,
          "Full Name": o.fullname,
          "Contact": o.contact,
          "Items": (o.items || []).map(i => `${i.name} × ${i.qty}`).join(" | "),
          "Bottles": o.quantity,
          "Subtotal": Number(o.subtotal),
          "Discount": Number(o.discount),
          "Total": Number(o.total),
          "Amount Paid": o.amount_paid == null ? "" : Number(o.amount_paid),
          "Payment Status": o.payment_status || "Unpaid",
          "Payment Ref": o.payment_ref || "",
          "Payment Note": o.payment_note || "",
          "Promo": o.promotion_name || "",
          "Voucher": o.voucher_code || "",
          "Delivery / Meetup": o.address,
          "Payment": o.payment,
          "Notes": o.notes,
          "Items JSON": JSON.stringify(o.items || [])
        })),
        Products: data.products.map(p => ({
          "ID": p.id, "Name": p.name, "Category": p.cat, "Price": Number(p.price),
          "Cost": p.cost == null ? "" : Number(p.cost),
          "Stock": p.stock ?? "unlimited", "Active": p.active ? "TRUE" : "FALSE",
          "Badges": list(p.badges), "Sort Order": p.sort_order, "Image URL": p.img,
          "Description": p.descr, "Long Description": p.desc_long,
          "Top Notes": list(p.top_notes), "Heart Notes": list(p.heart_notes), "Base Notes": list(p.base_notes),
          "Profiles": list(p.profiles), "Longevity": p.longevity, "Projection": p.projection,
          "Strength": p.strength, "Time": list(p.time), "Occasion": p.occasion, "Application": p.application
        })),
        Promotions: data.promotions.map(p => ({
          "ID": p.id, "Name": p.name, "Type": p.type, "Min Qty": p.min_qty,
          "Fixed Total": Number(p.fixed_total), "Percent Off": Number(p.percent_off), "Active": p.active ? "TRUE" : "FALSE"
        })),
        Reviews: data.reviews.map(r => ({
          "Date": when(r.created_at), "Review ID": r.id, "Customer Name": r.name, "Scent": r.scent,
          "Rating": r.rating, "Review": r.review, "Photo URL": r.photo_url || "",
          "Status": r.approved ? "Approved" : "Pending"
        })),
        "Audit Log": data.audit.map(a => ({ "Date": when(a.created_at), "Actor": a.actor, "Action": a.action })),
        Vouchers: (data.vouchers || []).map(v => ({
          "Code": v.code, "Type": v.type, "Value": Number(v.value),
          "Max Discount": v.max_discount == null ? "" : Number(v.max_discount),
          "Min Order": Number(v.min_order), "Starts": when(v.starts_at), "Expires": when(v.expires_at),
          "Usage Limit": v.usage_limit ?? "", "Per Customer": v.per_customer ?? "",
          "Active": v.active ? "TRUE" : "FALSE", "Note": v.note
        })),
        Restocks: (data.restocks || []).map(r => ({
          "Date Received": r.received_at, "Product": r.product_name, "Product ID": r.product_id || "",
          "Qty": r.qty, "Unit Cost": r.unit_cost == null ? "" : Number(r.unit_cost),
          "Total Cost": r.unit_cost == null ? "" : Number(r.unit_cost) * r.qty,
          "Supplier": r.supplier, "Note": r.note, "Recorded By": r.created_by
        })),
        Settings: Object.entries(data.settings[0]?.data || {}).map(([Key, Value]) => ({ Key, Value: String(Value) }))
      };

      const book = XLSX.utils.book_new();
      Object.entries(sheets).forEach(([name, rows]) => {
        const sheet = rows.length ? XLSX.utils.json_to_sheet(rows) : XLSX.utils.aoa_to_sheet([["(empty)"]]);
        XLSX.utils.book_append_sheet(book, sheet, name);
      });

      XLSX.writeFile(book, `aura-essence-backup-${dayKey(new Date())}.xlsx`);
      this.setStatus(`Backup downloaded: ${data.orders.length} orders, ${data.products.length} products, ${data.reviews.length} reviews`);

    } catch (error) {
      this.setStatus("Backup failed: " + error.message, true);
    } finally {
      if (button) { button.disabled = false; button.textContent = label; }
    }
  }
});


/* =========================================================
   ORDER DETAILS · PAYMENTS · NEW-ORDER ALERT
========================================================= */

function peso(value) {
  return "₱" + Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function last10(contact) {
  return String(contact || "").replace(/\D/g, "").slice(-10);
}

// Short two-tone chime, no audio file needed. Browsers may block it
// until you've clicked somewhere on the page; that's fine.
function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.4);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch {
    // no sound available
  }
}

Object.assign(AdminApp.prototype, {

  findOrder(orderId) {
    return this.orders.find(o => String(o.orderId) === String(orderId));
  },


  replaceOrder(orderId, fresh, fallback = {}) {
    const i = this.orders.findIndex(o => String(o.orderId) === String(orderId));
    if (i < 0) return;
    this.orders[i] = fresh ? fresh : { ...this.orders[i], ...fallback };
    this.rebuildOrderIndex();
    this.renderOrders();
  },


  advanceOrder(orderId) {
    const order = this.findOrder(orderId);
    const next = order && NEXT_STATUS[order.status];
    if (next) this.updateOrder(orderId, next);
  },


  cancelOrder(orderId) {
    const order = this.findOrder(orderId);
    if (!order) return;
    if (!confirm(`Cancel order ${orderId}?\n\nThe bottles go back into stock.`)) return;
    this.updateOrder(orderId, "Cancelled");
  },


  setOrderStatus(orderId, status) {
    const order = this.findOrder(orderId);
    if (!order || !status || status === order.status) return;

    if (status === "Cancelled") return this.cancelOrder(orderId);

    if (order.status === "Cancelled" &&
        !confirm(`Re-open this cancelled order as "${status}"?\n\nIts bottles will be taken out of stock again.`)) {
      return;
    }

    this.updateOrder(orderId, status);
  },


  closeOrder() {
    if (!this.dom.orderDrawer || this.dom.orderDrawer.classList.contains("hidden")) return;
    this.dom.orderDrawer.classList.add("hidden");
    this.dom.orderDrawer.setAttribute("aria-hidden", "true");
    this.openOrderId = null;
  },


  openOrder(orderId) {
    const order = this.findOrder(orderId);
    const body = this.dom.drawerBody;
    if (!order || !body) return;

    this.openOrderId = order.orderId;

    const items = Array.isArray(order.items) ? order.items : [];
    const total = Number(order.total || 0);
    const subtotal = Number(order.subtotal || 0) || items.reduce((sum, i) => sum + Number(i.price || 0) * Number(i.qty || 0), 0) || total;
    const promoDiscount = Number(order.discount || 0);

    const sameCustomer = this.orders
      .filter(o => last10(o.contact) && last10(o.contact) === last10(order.contact))
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const nth = sameCustomer.findIndex(o => o.orderId === order.orderId) + 1;
    const buyerText = sameCustomer.length <= 1
      ? "First order from this customer"
      : `Order ${nth} of ${sameCustomer.length} from this customer · repeat buyer`;

    const history = (order.history && order.history.length)
      ? order.history
      : [{ status: "New", at: order.timestamp, by: "customer" }];

    const next = NEXT_STATUS[order.status];

    body.innerHTML = `
      <div class="drawer-head">
        <div>
          <p class="eyebrow">ORDER</p>
          <h3 id="drawerTitle">${escapeHTML(order.orderId)}</h3>
          <div class="status-row">${statusPill(order.status)} ${payPill(order)}</div>
        </div>
        <button class="btn ghost" type="button" data-close-drawer>Close</button>
      </div>

      <div class="drawer-sec">
        <div class="status-row">
          ${next ? `<button class="btn primary" type="button" data-d-next>${escapeHTML(NEXT_LABEL[order.status])}</button>` : ""}
          ${order.status !== "Cancelled" ? `<button class="btn danger" type="button" data-d-cancel>Cancel order</button>` : ""}
          <select data-d-status aria-label="Change status">
            <option value="">Change status…</option>
            ${ORDER_STATUSES.filter(st => st !== order.status).map(st => `<option>${escapeHTML(st)}</option>`).join("")}
          </select>
        </div>
      </div>

      <div class="drawer-sec">
        <h4>Customer</h4>
        <div class="kv">
          <span>Name</span><div>${escapeHTML(order.fullname)}</div>
          <span>Contact</span><div>${escapeHTML(order.contact)}</div>
          <span>Delivery / Meetup</span><div>${escapeHTML(order.address || "—")}</div>
          <span>Payment method</span><div>${escapeHTML(order.payment || "—")}</div>
          <span>Notes</span><div>${escapeHTML(order.notes || "—")}</div>
          <span>History</span><div>${escapeHTML(buyerText)}</div>
        </div>
      </div>

      <div class="drawer-sec">
        <h4>Items</h4>
        <table class="items">
          <tbody>
            ${items.map(i => `
              <tr>
                <td>${escapeHTML(i.name || i.id)} × ${escapeHTML(i.qty)}</td>
                <td>${i.price != null ? peso(Number(i.price) * Number(i.qty || 0)) : ""}</td>
              </tr>`).join("") || `<tr><td>${escapeHTML(order.scent || "—")}</td><td></td></tr>`}
          </tbody>
          <tfoot>
            <tr><td>Subtotal</td><td>${peso(subtotal)}</td></tr>
            ${promoDiscount > 0 ? `<tr><td>Promo${order.promotion ? " · " + escapeHTML(order.promotion) : ""}</td><td>−${peso(promoDiscount)}</td></tr>` : ""}
            <tr class="total"><td>Order total</td><td>${peso(total)}</td></tr>
          </tfoot>
        </table>
      </div>

      <div class="drawer-sec">
        <h4>Payment</h4>
        <form class="pay-form" data-d-pay>
          <label>Status
            <select name="paymentStatus">
              ${["Unpaid", "Partial", "Paid", "Refunded"].map(st =>
                `<option ${st === (order.paymentStatus || "Unpaid") ? "selected" : ""}>${st}</option>`).join("")}
            </select>
          </label>
          <label>Amount received (₱)
            <input name="amountPaid" type="number" min="0" step="0.01" inputmode="decimal"
                   placeholder="${escapeHTML(total)}" value="${order.amountPaid ?? ""}">
          </label>
          <label class="full">GCash / reference no.
            <input name="paymentRef" maxlength="120" value="${escapeHTML(order.paymentRef || "")}" placeholder="optional">
          </label>
          <label class="full">Note (e.g. reason for discount)
            <input name="paymentNote" maxlength="500" value="${escapeHTML(order.paymentNote || "")}" placeholder="e.g. Suki discount ₱30">
          </label>
          <div class="full pay-note" data-d-paysum></div>
          <div class="full pay-actions">
            <button class="btn primary" type="submit">Save payment</button>
            <button class="btn" type="button" data-d-fullpay>Paid in full (${peso(total)})</button>
          </div>
        </form>
      </div>

      <div class="drawer-sec">
        <h4>Timeline</h4>
        <ul class="timeline">
          ${history.map(h => `
            <li><div>${escapeHTML(h.status)}
              <small>${h.at ? escapeHTML(new Date(h.at).toLocaleString()) : ""}${h.by ? " · " + escapeHTML(h.by) : ""}</small>
            </div></li>`).join("")}
          ${order.paidAt ? `<li><div>Payment received<small>${escapeHTML(new Date(order.paidAt).toLocaleString())}</small></div></li>` : ""}
        </ul>
      </div>
    `;

    const form = body.querySelector("[data-d-pay]");
    const summary = body.querySelector("[data-d-paysum]");

    const updateSummary = () => {
      const st = form.paymentStatus.value;
      const raw = form.amountPaid.value.trim();
      const amount = raw === "" ? (st === "Paid" ? total : 0) : Number(raw);
      summary.classList.remove("warn");

      if (st === "Paid" && amount < total) {
        summary.classList.add("warn");
        summary.textContent = `Discount given outside the system: ${peso(total - amount)} (received ${peso(amount)} of ${peso(total)})`;
      } else if (st === "Paid" && amount > total) {
        summary.textContent = `Received ${peso(amount - total)} more than the order total.`;
      } else if (st === "Paid") {
        summary.textContent = `Paid in full: ${peso(total)}`;
      } else if (st === "Partial") {
        summary.classList.add("warn");
        summary.textContent = `Balance to collect: ${peso(Math.max(0, total - amount))} (received ${peso(amount)})`;
      } else if (st === "Refunded") {
        summary.textContent = "Refunded — this order no longer counts as money received once you set the amount to 0.";
      } else {
        summary.textContent = `To collect: ${peso(total)}`;
      }
    };

    form.addEventListener("input", updateSummary);
    updateSummary();

    form.addEventListener("submit", e => {
      e.preventDefault();
      const st = form.paymentStatus.value;
      let amount = form.amountPaid.value.trim();
      if (st === "Paid" && amount === "") amount = String(total);   // blank = paid in full
      if (st === "Refunded" && amount === "") amount = "0";
      this.savePayment(order.orderId, {
        paymentStatus: st,
        amountPaid: amount,
        paymentRef: form.paymentRef.value,
        paymentNote: form.paymentNote.value
      });
    });

    body.querySelector("[data-d-fullpay]")?.addEventListener("click", () => {
      this.savePayment(order.orderId, {
        paymentStatus: "Paid",
        amountPaid: String(total),
        paymentRef: form.paymentRef.value,
        paymentNote: form.paymentNote.value
      });
    });

    body.querySelector("[data-d-next]")?.addEventListener("click", () => this.advanceOrder(order.orderId));
    body.querySelector("[data-d-cancel]")?.addEventListener("click", () => this.cancelOrder(order.orderId));
    body.querySelector("[data-d-status]")?.addEventListener("change", e => {
      const value = e.target.value;
      e.target.value = "";
      this.setOrderStatus(order.orderId, value);
    });

    this.dom.orderDrawer.classList.remove("hidden");
    this.dom.orderDrawer.setAttribute("aria-hidden", "false");
  },


  async savePayment(orderId, payment) {
    try {
      const response = await this.request("POST", { action: "adminSavePayment", orderId, ...payment });
      this.replaceOrder(orderId, response.order);
      this.setStatus(`Payment saved for ${orderId}`);
      if (this.openOrderId === orderId) this.openOrder(orderId);
      this.loadDashboard(true).catch(() => {});
    } catch (error) {
      this.setStatus(error.message, true);
    }
  },


  // Called after every orders refresh: chime + badge for orders we haven't seen.
  checkNewOrders() {
    const ids = new Set(this.orders.map(o => o.orderId));

    if (!this.knownOrderIds) {
      this.knownOrderIds = ids;      // first load: nothing is "new"
      this.updateOrderBadge();
      return;
    }

    const fresh = this.orders.filter(o => !this.knownOrderIds.has(o.orderId));
    this.knownOrderIds = ids;

    if (fresh.length) {
      const viewingOrders = !document.getElementById("ordersView")?.classList.contains("hidden");
      if (!viewingOrders || document.hidden) {
        this.unseenOrders = (this.unseenOrders || 0) + fresh.length;
      }
      playChime();
      this.setStatus(fresh.length === 1
        ? `New order from ${fresh[0].fullname} (${peso(fresh[0].total)})`
        : `${fresh.length} new orders`);
    }

    this.updateOrderBadge();
  },


  updateOrderBadge() {
    const navButton = document.querySelector('.nav-item[data-view="orders"]');
    if (!navButton) return;

    const newCount = this.orders.filter(o => o.status === "New").length;
    let badge = navButton.querySelector(".nav-badge");

    if (newCount > 0) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "nav-badge";
        navButton.appendChild(badge);
      }
      badge.textContent = newCount;
      badge.title = `${newCount} new order${newCount === 1 ? "" : "s"} waiting`;
    } else {
      badge?.remove();
    }

    const base = this.baseTitle || (this.baseTitle = document.title);
    document.title = this.unseenOrders ? `(${this.unseenOrders}) ${base}` : base;
  }
});


/* =========================================================
   REVIEWS (moderation)
========================================================= */

Object.assign(AdminApp.prototype, {

  async loadReviews() {

    try {

      const response =
        await this.request(
          "GET",
          this.params({
            action: "adminReviews"
          })
        );

      this.reviews =
        Array.isArray(response?.reviews)
          ? response.reviews
          : [];

      this.renderReviews();

    } catch (error) {

      this.setStatus(
        error.message,
        true
      );
    }
  },


  renderReviews() {

    const table =
      this.dom.reviewsRows;

    if (!table) return;

    if (!this.reviews.length) {

      table.innerHTML =
        `<tr><td colspan="6" class="muted">No reviews yet.</td></tr>`;

      return;
    }

    table.innerHTML =
      this.reviews
        .map(
          review => `
            <tr>
              <td>
                ${
                  review.photoUrl
                    ? `<a href="${escapeHTML(review.photoUrl)}" target="_blank" rel="noopener">
                         <img src="${escapeHTML(review.photoUrl)}" alt="" loading="lazy"
                              style="width:56px;height:56px;object-fit:cover;border-radius:8px">
                       </a>`
                    : "—"
                }
              </td>
              <td>
                <b>${escapeHTML(review.name)}</b>
                <small>${escapeHTML(review.scent || "")}</small>
              </td>
              <td>${"★".repeat(Number(review.rating) || 0)}</td>
              <td style="max-width:360px;white-space:normal">${escapeHTML(review.review)}</td>
              <td>${review.approved ? "Visible" : "<b>Pending</b>"}</td>
              <td>
                ${
                  review.approved
                    ? `<button class="btn" data-review="${escapeHTML(review.id)}" data-op="hide">Hide</button>`
                    : `<button class="btn primary" data-review="${escapeHTML(review.id)}" data-op="approve">Approve</button>`
                }
                <button class="btn danger" data-review="${escapeHTML(review.id)}" data-op="delete">Delete</button>
              </td>
            </tr>
          `
        )
        .join("");
  },


  async setReviewApproved(id, approved) {

    try {

      await this.request(
        "POST",
        this.params({
          action: "adminSetReviewApproved",
          id,
          approved
        })
      );

      this.setStatus(
        approved ? "Review approved" : "Review hidden"
      );

      await this.loadReviews();

    } catch (error) {

      this.setStatus(
        error.message,
        true
      );
    }
  },


  async deleteReview(id) {

    if (!confirm("Delete this review and its photo?")) {
      return;
    }

    try {

      await this.request(
        "POST",
        this.params({
          action: "adminDeleteReview",
          id
        })
      );

      this.setStatus("Review deleted");

      await this.loadReviews();

    } catch (error) {

      this.setStatus(
        error.message,
        true
      );
    }
  }
});


/* =========================================================
   ADMIN UI v2
   Notifications bell, pop-up toasts, styled dialogs, busy
   buttons, mobile navigation, side editors, clearer dashboard,
   product thumbnails + switches, readable promotions, review
   tabs, filterable audit log.
   (These replace/extend the methods defined above.)
========================================================= */

const NOTIF_SEEN_KEY = "aeAdminNotifSeen";
const MORE_VIEWS = ["promotions", "homepage", "reviews", "audit"];

const NOTIF_ICON = { order: "🛍", payment: "₱", stock: "!", review: "★" };

function timeAgo(value) {
  const t = new Date(value).getTime();
  if (!t) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} day${s < 172800 ? "" : "s"} ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function readSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(NOTIF_SEEN_KEY) || "[]")); } catch { return new Set(); }
}

function writeSeen(set) {
  try { localStorage.setItem(NOTIF_SEEN_KEY, JSON.stringify([...set].slice(-400))); } catch { /* ignore */ }
}

function pctChange(now, before) {
  if (!before) return now ? null : 0;
  return Math.round(((now - before) / before) * 100);
}

function promoSummary(p) {
  return p.type === "percent"
    ? `${Number(p.percentOff)}% off when buying ${Number(p.minQty)}+ bottles`
    : `Any ${Number(p.minQty)} bottles for ${peso(p.fixedTotal)}`;
}

const _orig = {
  cacheDOM: AdminApp.prototype.cacheDOM,
  bind: AdminApp.prototype.bind,
  request: AdminApp.prototype.request,
  showView: AdminApp.prototype.showView,
  openApp: AdminApp.prototype.openApp,
  loadOrders: AdminApp.prototype.loadOrders,
  loadProducts: AdminApp.prototype.loadProducts,
  loadReviews: AdminApp.prototype.loadReviews,
  loadSettings: AdminApp.prototype.loadSettings,
  editPromotion: AdminApp.prototype.editPromotion,
  editProduct: AdminApp.prototype.editProduct,
  updateOrderBadge: AdminApp.prototype.updateOrderBadge
};

Object.assign(AdminApp.prototype, {

  /* ---------------------------------------------------
     Setup
  --------------------------------------------------- */

  cacheDOM() {
    _orig.cacheDOM.call(this);
    [
      "notifBtn", "notifCount", "notifPanel", "notifList", "notifReadAll",
      "toastStack", "dialog", "dialogTitle", "dialogMessage", "dialogInput", "dialogOk", "dialogCancel",
      "moreBtn", "moreSheet", "mOrdersBadge", "mMoreBadge", "mReviewsBadge",
      "promoTitle", "promoPreview", "reviewTabs", "auditList", "auditFilter", "auditSearch"
    ].forEach(id => { this.dom[id] = document.getElementById(id); });
  },


  bind() {
    this.notifs = new Map();
    this.notifSeen = readSeen();
    this.reviewTab = "pending";

    _orig.bind.call(this);

    /* Notifications bell */
    this.dom.notifBtn?.addEventListener("click", e => {
      e.stopPropagation();
      this.toggleNotifPanel();
    });
    this.dom.notifReadAll?.addEventListener("click", () => {
      this.notifs.forEach((_, id) => this.notifSeen.add(id));
      writeSeen(this.notifSeen);
      this.renderNotifications();
    });
    this.dom.notifList?.addEventListener("click", e => {
      const item = e.target.closest("[data-notif]");
      if (!item) return;
      const n = this.notifs.get(item.dataset.notif);
      this.notifSeen.add(item.dataset.notif);
      writeSeen(this.notifSeen);
      this.toggleNotifPanel(false);
      if (n) this.runNotifAction(n);
    });
    document.addEventListener("click", e => {
      if (!this.dom.notifPanel?.classList.contains("hidden") && !e.target.closest(".notif-wrap")) {
        this.toggleNotifPanel(false);
      }
    });

    /* Dialog */
    this.dom.dialogCancel?.addEventListener("click", () => this.closeDialog(null));
    this.dom.dialog?.querySelector(".modal-backdrop")?.addEventListener("click", () => this.closeDialog(null));
    this.dom.dialogOk?.addEventListener("click", () => this.closeDialog(true));
    this.dom.dialogInput?.addEventListener("keydown", e => { if (e.key === "Enter") this.closeDialog(true); });

    /* Escape closes whatever is on top */
    document.addEventListener("keydown", e => {
      if (e.key !== "Escape") return;
      if (!this.dom.dialog?.classList.contains("hidden")) return this.closeDialog(null);
      this.toggleNotifPanel(false);
      this.closeEditors();
      this.dom.moreSheet?.classList.add("hidden");
    });

    /* Side editors: backdrop closes */
    document.querySelectorAll("[data-close-editor]").forEach(el =>
      el.addEventListener("click", () => this.closeEditors()));

    /* Busy buttons: remember the button that started an action */
    document.addEventListener("click", e => {
      const btn = e.target.closest("button, .btn");
      if (!btn || btn.closest(".modal, .side-nav, .mobile-nav, .tabs, .more-panel, .notif-wrap")) return;
      this._busyCandidate = { btn, at: Date.now() };
    }, true);
    document.addEventListener("submit", e => {
      if (e.submitter) this._busyCandidate = { btn: e.submitter, at: Date.now() };
    }, true);

    /* Mobile navigation */
    document.querySelectorAll(".m-nav[data-view], .more-panel [data-view]").forEach(btn =>
      btn.addEventListener("click", () => this.showView(btn.dataset.view)));
    this.dom.moreBtn?.addEventListener("click", () => {
      const open = this.dom.moreSheet.classList.toggle("hidden") === false;
      this.dom.moreBtn.setAttribute("aria-expanded", String(open));
    });
    this.dom.moreSheet?.querySelector("[data-close-more]")?.addEventListener("click", () =>
      this.dom.moreSheet.classList.add("hidden"));
    this.dom.moreSheet?.addEventListener("click", e => {
      const action = e.target.closest("[data-more-action]")?.dataset.moreAction;
      if (action === "backup") { this.dom.moreSheet.classList.add("hidden"); this.downloadBackup(); }
      if (action === "logout") this.dom.logoutBtn?.click();
    });

    /* Products: visible switch */
    this.dom.productsRows?.addEventListener("change", e => {
      const toggle = e.target.closest("[data-toggle-active]");
      if (toggle) this.setProductActive(toggle.dataset.toggleActive, toggle.checked, toggle);
    });

    /* Promotions: on/off switch + live preview */
    document.getElementById("promosList")?.addEventListener("change", e => {
      const toggle = e.target.closest("[data-promo-toggle]");
      if (toggle) this.setPromotionActive(toggle.dataset.promoToggle, toggle.checked, toggle);
    });
    ["promoType", "promoQty", "promoFixed", "promoPercent"].forEach(id =>
      document.getElementById(id)?.addEventListener("input", () => this.updatePromoPreview()));

    /* Low stock rows open the product */
    document.getElementById("lowStock")?.addEventListener("click", e => {
      const row = e.target.closest("[data-product]");
      const product = row && this.productMap.get(row.dataset.product);
      if (product) this.editProduct(product);
    });

    /* Reviews tabs */
    this.dom.reviewTabs?.addEventListener("click", e => {
      const tab = e.target.closest("[data-rtab]");
      if (!tab) return;
      this._reviewTabAuto = false;
      this.reviewTab = tab.dataset.rtab;
      this.renderReviews();
    });

    /* Audit filters */
    this.dom.auditFilter?.addEventListener("change", () => this.renderAudit());
    this.dom.auditSearch?.addEventListener("input", debounce(() => this.renderAudit(), 150));

    /* Body class while a side panel is open (moves pop-ups out of the way) */
    const drawers = ["orderDrawer", "productEditor", "promoEditor", "voucherEditor"].map(id => document.getElementById(id)).filter(Boolean);
    const syncDrawerClass = () =>
      document.body.classList.toggle("has-drawer", drawers.some(d => !d.classList.contains("hidden")));
    const observer = new MutationObserver(syncDrawerClass);
    drawers.forEach(d => observer.observe(d, { attributes: true, attributeFilter: ["class"] }));

    /* Refresh "x min ago" in the bell now and then */
    setInterval(() => {
      if (!this.dom.notifPanel?.classList.contains("hidden")) this.renderNotifications();
    }, 60000);
  },


  /* ---------------------------------------------------
     Toasts (replace the small status text)
  --------------------------------------------------- */

  toast(message, type = "ok", options = {}) {
    const stack = this.dom.toastStack;
    if (!stack || !message) return;

    const item = document.createElement("div");
    item.className = `toast-item ${type}`;
    item.setAttribute("role", type === "error" ? "alert" : "status");
    item.innerHTML = `
      <span class="t-icon">${type === "error" ? "⚠" : type === "info" ? "🔔" : "✓"}</span>
      <div>${options.title ? `<b>${escapeHTML(options.title)}</b>` : ""}${escapeHTML(message)}</div>
      <button type="button" aria-label="Dismiss">×</button>`;

    const remove = () => {
      item.classList.add("out");
      setTimeout(() => item.remove(), 200);
    };

    item.querySelector("button").addEventListener("click", ev => { ev.stopPropagation(); remove(); });
    if (options.onClick) item.addEventListener("click", () => { options.onClick(); remove(); });

    stack.prepend(item);
    while (stack.children.length > 4) stack.lastElementChild.remove();
    setTimeout(remove, options.timeout || (type === "error" ? 7000 : 3500));
  },


  setStatus(message, error = false) {
    const dot = this.dom.globalStatus;

    if (/^Admin connected$/i.test(String(message))) {
      if (dot) { dot.className = "conn ok"; dot.title = "Connected to the database"; }
      return;
    }

    if (error && dot && /reach the database|Failed to fetch/i.test(String(message))) {
      dot.className = "conn error";
      dot.title = "Can't reach the database";
    }

    this.toast(message, error ? "error" : "ok");
  },


  /* ---------------------------------------------------
     Styled confirm / prompt dialog
  --------------------------------------------------- */

  ask({ title, message = "", okText = "OK", cancelText = "Cancel", danger = false, input = null }) {
    const d = this.dom;
    if (!d.dialog) return Promise.resolve(input ? null : false);

    d.dialogTitle.textContent = title;
    d.dialogMessage.textContent = message;
    d.dialogOk.textContent = okText;
    d.dialogCancel.textContent = cancelText;
    d.dialogOk.className = "btn " + (danger ? "danger-solid" : "primary");

    d.dialogInput.hidden = !input;
    if (input) {
      d.dialogInput.value = input.value ?? "";
      d.dialogInput.min = input.min ?? 0;
    }

    d.dialog.classList.remove("hidden");
    setTimeout(() => (input ? d.dialogInput : d.dialogOk).focus(), 30);

    return new Promise(resolve => {
      this._dialogResolve = value => resolve(input ? (value ? d.dialogInput.value : null) : Boolean(value));
    });
  },


  closeDialog(value) {
    this.dom.dialog?.classList.add("hidden");
    const resolve = this._dialogResolve;
    this._dialogResolve = null;
    resolve?.(value);
  },


  /* ---------------------------------------------------
     Busy state on the button that started a save
  --------------------------------------------------- */

  async request(method, params = {}) {
    const candidate = this._busyCandidate;
    this._busyCandidate = null;

    const btn = method === "POST" && candidate && Date.now() - candidate.at < 4000 && document.contains(candidate.btn)
      ? candidate.btn
      : null;

    if (btn) {
      btn.classList.add("is-busy");
      btn.setAttribute("aria-busy", "true");
      if (btn.tagName === "BUTTON") btn.disabled = true;
    }

    try {
      return await _orig.request.call(this, method, params);
    } finally {
      if (btn) {
        btn.classList.remove("is-busy");
        btn.removeAttribute("aria-busy");
        if (btn.tagName === "BUTTON") btn.disabled = false;
      }
    }
  },


  /* ---------------------------------------------------
     Navigation
  --------------------------------------------------- */

  showView(view) {
    _orig.showView.call(this, view);

    document.querySelectorAll(".m-nav[data-view]").forEach(btn =>
      btn.classList.toggle("active", btn.dataset.view === view));
    this.dom.moreBtn?.classList.toggle("active", MORE_VIEWS.includes(view));
    this.dom.moreSheet?.classList.add("hidden");
    this.dom.moreBtn?.setAttribute("aria-expanded", "false");
    this.toggleNotifPanel(false);

    const titles = { audit: "Audit Log", homepage: "Homepage & Alerts" };
    if (this.dom.viewTitle && titles[view]) this.dom.viewTitle.textContent = titles[view];

    window.scrollTo({ top: 0 });
  },


  closeEditors() {
    ["productEditor", "promoEditor"].forEach(id => {
      const el = this.dom[id] || document.getElementById(id);
      el?.classList.add("hidden");
      el?.setAttribute("aria-hidden", "true");
    });
  },


  async openApp() {
    this.initialLoadDone = false;
    await _orig.openApp.call(this);
    // Reviews are needed for the badge and notifications
    await this.loadReviews().catch(() => {});
    this.initialLoadDone = true;
    this.refreshNotifications({ summary: true });
  },


  /* ---------------------------------------------------
     Data loads → refresh notifications + dashboard
  --------------------------------------------------- */

  async loadOrders(silent = false) {
    await _orig.loadOrders.call(this, silent);
    this.ordersLoaded = true;
    this.renderDashboard(this.lastDashboard || {});
    this.refreshNotifications();
  },


  async loadProducts() {
    await _orig.loadProducts.call(this);
    this.refreshNotifications();
    if (this.lastDashboard) this.renderDashboard(this.lastDashboard);
  },


  async loadReviews() {
    await _orig.loadReviews.call(this);
    this.updateReviewBadges();
    this.refreshNotifications();
  },


  async loadSettings() {
    await _orig.loadSettings.call(this);
    this.refreshNotifications();
  },


  updateOrderBadge() {
    _orig.updateOrderBadge.call(this);
    const count = this.orders.filter(o => o.status === "New").length;
    if (this.dom.mOrdersBadge) {
      this.dom.mOrdersBadge.textContent = count;
      this.dom.mOrdersBadge.hidden = count === 0;
    }
  },


  updateReviewBadges() {
    const pending = (this.reviews || []).filter(r => !r.approved).length;

    const nav = document.querySelector('.nav-item[data-view="reviews"]');
    let badge = nav?.querySelector(".nav-badge");
    if (nav && pending) {
      if (!badge) { badge = document.createElement("span"); badge.className = "nav-badge"; nav.appendChild(badge); }
      badge.textContent = pending;
    } else {
      badge?.remove();
    }

    [this.dom.mReviewsBadge, this.dom.mMoreBadge].forEach(el => {
      if (!el) return;
      el.textContent = pending;
      el.hidden = pending === 0;
    });
  },


  /* ---------------------------------------------------
     Notifications bell
  --------------------------------------------------- */

  refreshNotifications(options = {}) {
    if (!this.dom.notifList) return;

    const list = [];
    const alertAt = Number(this.settings?.lowStockAlertAt ?? 1);

    (this.orders || []).forEach(o => {
      if (o.status === "New") {
        list.push({
          id: `order-new:${o.orderId}`, type: "order", time: o.timestamp,
          title: "New order",
          body: `${o.fullname} · ${peso(o.total)} · ${(o.items || []).map(i => `${i.name} × ${i.qty}`).join(", ")}`,
          action: { orderId: o.orderId }
        });
      }
      if (o.status === "Completed" && ["Unpaid", "Partial"].includes(o.paymentStatus || "Unpaid")) {
        const owed = Math.max(0, Number(o.total || 0) - Number(o.amountPaid || 0));
        list.push({
          id: `order-unpaid:${o.orderId}:${o.paymentStatus}`, type: "payment", time: o.timestamp,
          title: "Completed but not fully paid",
          body: `${o.fullname} · ${peso(owed)} to collect · ${o.orderId}`,
          action: { orderId: o.orderId }
        });
      }
    });

    (this.products || []).forEach(p => {
      if (p.active === false || p.stock == null) return;
      const stock = Number(p.stock);
      if (stock > alertAt) return;
      list.push({
        id: `stock:${p.id}:${stock}`, type: "stock", time: null,
        title: stock === 0 ? "Sold out" : "Low stock",
        body: stock === 0 ? `${p.name} is sold out on the website.` : `${p.name} — only ${stock} left.`,
        action: { view: "products", stock: stock === 0 ? "out" : "low" }
      });
    });

    const pending = (this.reviews || []).filter(r => !r.approved);
    if (pending.length) {
      const newest = pending.slice().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
      list.push({
        id: `reviews:${pending.length}:${newest?.id}`, type: "review", time: newest?.timestamp,
        title: `${pending.length} review${pending.length === 1 ? "" : "s"} waiting for approval`,
        body: newest ? `Latest: ${newest.name} on ${newest.scent || "a scent"} (${"★".repeat(Number(newest.rating) || 0)})` : "",
        action: { view: "reviews", tab: "pending" }
      });
    }

    list.sort((a, b) => (b.time ? new Date(b.time) : Infinity) - (a.time ? new Date(a.time) : Infinity));

    // Pop up anything new that appeared after the first full load
    const fresh = this.initialLoadDone && !options.summary
      ? list.filter(n => !this.notifs.has(n.id) && !this.notifSeen.has(n.id))
      : [];

    this.notifs = new Map(list.slice(0, 50).map(n => [n.id, n]));
    this.renderNotifications();

    if (options.summary) {
      const unread = [...this.notifs.keys()].filter(id => !this.notifSeen.has(id)).length;
      if (unread) {
        this.toast(`You have ${unread} new notification${unread === 1 ? "" : "s"}.`, "info", {
          onClick: () => this.toggleNotifPanel(true)
        });
      }
      return;
    }

    fresh.slice(0, 3).forEach(n => {
      this.toast(n.body, "info", { title: n.title, onClick: () => this.runNotifAction(n), timeout: 6000 });
    });
    if (fresh.length) {
      this.dom.notifBtn?.classList.remove("ring");
      void this.dom.notifBtn?.offsetWidth;
      this.dom.notifBtn?.classList.add("ring");
    }
  },


  renderNotifications() {
    const listEl = this.dom.notifList;
    if (!listEl) return;

    const items = [...this.notifs.values()];
    const unread = items.filter(n => !this.notifSeen.has(n.id)).length;

    if (this.dom.notifCount) {
      this.dom.notifCount.textContent = unread > 9 ? "9+" : unread;
      this.dom.notifCount.hidden = unread === 0;
    }
    this.dom.notifBtn?.setAttribute("aria-label", `Notifications${unread ? `, ${unread} unread` : ""}`);

    listEl.innerHTML = items.length
      ? items.map(n => `
          <button type="button" class="notif-item ${this.notifSeen.has(n.id) ? "" : "unread"}" data-notif="${escapeHTML(n.id)}">
            <span class="notif-icon ${n.type}">${NOTIF_ICON[n.type] || "•"}</span>
            <span>
              <div class="notif-title">${escapeHTML(n.title)}</div>
              <div class="notif-body">${escapeHTML(n.body)}</div>
              ${n.time ? `<div class="notif-time">${escapeHTML(timeAgo(n.time))}</div>` : ""}
            </span>
          </button>`).join("")
      : `<div class="notif-empty">You're all caught up ✓</div>`;
  },


  toggleNotifPanel(force) {
    const panel = this.dom.notifPanel;
    if (!panel) return;

    const open = force ?? panel.classList.contains("hidden");
    if (open === !panel.classList.contains("hidden")) return;

    panel.classList.toggle("hidden", !open);
    this.dom.notifBtn?.setAttribute("aria-expanded", String(open));

    if (open) {
      this.renderNotifications();
      // Opening the bell clears the badge; items keep their dot until next time
      this.notifs.forEach((_, id) => this.notifSeen.add(id));
      writeSeen(this.notifSeen);
      if (this.dom.notifCount) this.dom.notifCount.hidden = true;
    } else {
      this.renderNotifications();
    }
  },


  runNotifAction(n) {
    const a = n.action || {};

    if (a.orderId) {
      this.showView("orders");
      this.orderTab = "all";
      this.renderOrders();
      this.openOrder(a.orderId);
      return;
    }

    if (a.view === "products") {
      this.showView("products");
      if (this.dom.filterStock) this.dom.filterStock.value = a.stock || "";
      this.renderProducts();
      return;
    }

    if (a.view === "reviews") {
      this.reviewTab = a.tab || "pending";
      this.showView("reviews");
    }
  },


  /* New orders: chime + badge (+ the bell via refreshNotifications) */
  checkNewOrders() {
    const ids = new Set(this.orders.map(o => o.orderId));

    if (!this.knownOrderIds) {
      this.knownOrderIds = ids;
      this.updateOrderBadge();
      return;
    }

    const fresh = this.orders.filter(o => !this.knownOrderIds.has(o.orderId));
    this.knownOrderIds = ids;

    if (fresh.length) {
      const viewingOrders = !document.getElementById("ordersView")?.classList.contains("hidden");
      if (!viewingOrders || document.hidden) this.unseenOrders = (this.unseenOrders || 0) + fresh.length;
      playChime();
    }

    this.updateOrderBadge();
  },


  /* ---------------------------------------------------
     Dashboard
  --------------------------------------------------- */

  computeDashboard(range) {
    const from = range?.from || new Date(0);
    const to = range?.to || new Date(8640000000000000);

    const orders = (this.orders || []).filter(o => {
      const t = new Date(o.timestamp);
      return !isNaN(t) && t >= from && t <= to;
    });

    const counted = orders.filter(o => o.status !== "Cancelled");
    const expectedOf = o => (o.paymentStatus === "Paid" && o.amountPaid != null) ? Number(o.amountPaid) : Number(o.total || 0);
    const expected = counted.reduce((sum, o) => sum + expectedOf(o), 0);
    const collected = counted.reduce((sum, o) =>
      sum + (["Paid", "Partial"].includes(o.paymentStatus) ? Number(o.amountPaid ?? o.total ?? 0) : 0), 0);
    const unpaid = counted.filter(o => ["Unpaid", "Partial"].includes(o.paymentStatus || "Unpaid"));
    const toCollect = unpaid.reduce((sum, o) => sum + Math.max(0, Number(o.total || 0) - Number(o.amountPaid || 0)), 0);

    const customers = new Set(orders.map(o => last10(o.contact) || normalize(o.fullname)));

    const sales = {};
    counted.forEach(o => (o.items || []).forEach(i => {
      const key = String(i.id ?? i.name);
      sales[key] = (sales[key] || 0) + Number(i.qty || 0);
    }));

    const names = new Map(this.products.map(p => [String(p.id), p.name]));
    const topProducts = Object.entries(sales)
      .map(([id, units]) => ({ id, name: names.get(id) || id, units }))
      .filter(t => t.units > 0)
      .sort((a, b) => b.units - a.units || String(a.name).localeCompare(String(b.name)))
      .slice(0, 8);

    return {
      stats: {
        orders: orders.length,
        completed: orders.filter(o => o.status === "Completed").length,
        pending: orders.filter(o => ACTIVE_STATUSES.includes(o.status)).length,
        cancelled: orders.filter(o => o.status === "Cancelled").length,
        customers: customers.size,
        expected,
        collected,
        toCollect,
        unpaidOrders: unpaid.length,
        revenue: expected,
        averageOrderValue: counted.length ? expected / counted.length : 0
      },
      topProducts
    };
  },


  renderDashboard(response) {
    this.lastDashboard = response || {};

    const range = this.dashboardRange();
    let stats, topProducts, prev = null;

    if (this.ordersLoaded) {
      const now = this.computeDashboard(range);
      stats = now.stats;
      topProducts = now.topProducts;

      if (range) {
        const span = range.to - range.from + 1;
        prev = this.computeDashboard({ from: new Date(range.from - span), to: new Date(range.from - 1) }).stats;
      }
    } else {
      const s = this.lastDashboard.stats || {};
      stats = { ...s, expected: s.revenue || 0, collected: null };
      topProducts = (this.lastDashboard.topProducts || []).filter(t => Number(t.units) > 0);
    }

    this.renderRangeLabel(range, stats);
    this.renderRevenueChart(range);

    const days = range ? Math.max(1, Math.round((range.to - range.from + 1) / 86400000)) : 0;
    const prevLabel = days === 1 ? "previous day" : `previous ${days} days`;

    const delta = (now, before) => {
      if (!prev) return "";
      const pct = pctChange(now, before);
      if (pct === null) return `<span class="delta up">▲ new vs ${prevLabel}</span>`;
      if (pct === 0) return `<span class="delta flat">— same as ${prevLabel}</span>`;
      return `<span class="delta ${pct > 0 ? "up" : "down"}">${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}% vs ${prevLabel}</span>`;
    };

    const card = (label, value, sub = "", extra = "", cls = "") => `
      <div class="stat ${cls}">
        <small>${escapeHTML(label)}</small>
        <strong>${escapeHTML(value)}</strong>
        ${sub ? `<small class="sub">${escapeHTML(sub)}</small>` : ""}
        ${extra}
      </div>`;

    if (this.dom.statsCards) {
      this.dom.statsCards.innerHTML = [
        card("Orders", stats.orders || 0, `${stats.completed || 0} completed · ${stats.pending || 0} open`, delta(stats.orders, prev?.orders)),
        card("Expected sales", formatCurrency(Math.round(stats.expected || 0)), "after discounts, excl. cancelled", delta(stats.expected, prev?.expected)),
        card("Collected", stats.collected == null ? "—" : formatCurrency(Math.round(stats.collected)), "money received", stats.collected == null ? "" : delta(stats.collected, prev?.collected), "highlight"),
        card("To collect", formatCurrency(Math.round(stats.toCollect || 0)), `${stats.unpaidOrders || 0} unpaid order${Number(stats.unpaidOrders) === 1 ? "" : "s"}`),
        card("Avg. order", formatCurrency(Math.round(stats.averageOrderValue || 0)), "per order"),
        card("Customers", stats.customers || 0, "unique numbers")
      ].join("");
    }

    /* Top products: only what sold, with a bar */
    if (this.dom.topProducts) {
      const max = Math.max(1, ...topProducts.map(t => Number(t.units)));
      this.dom.topProducts.innerHTML = topProducts.length
        ? topProducts.map((t, i) => `
            <div class="top-row">
              <span>${i + 1}. ${escapeHTML(t.name)}</span><b>${escapeHTML(t.units)}</b>
              <div class="bar"><i style="width:${Math.max(4, (Number(t.units) / max) * 100)}%"></i></div>
            </div>`).join("")
        : `<p class="empty-note">No sales in this period yet.</p>`;
    }

    /* Low stock: live from products, click to edit */
    const threshold = Number(this.settings?.lowStockThreshold ?? response?.settings?.lowStockThreshold) || DEFAULT_LOW_STOCK;
    if (this.dom.lowStockLabel) this.dom.lowStockLabel.textContent = `At or below ${threshold}`;

    if (this.dom.lowStock) {
      const low = (this.products.length ? this.products : (response?.lowStock || []))
        .filter(p => p.active !== false && p.stock != null && Number(p.stock) <= threshold)
        .sort((a, b) => Number(a.stock) - Number(b.stock) || String(a.name).localeCompare(String(b.name)));

      this.dom.lowStock.innerHTML = low.length
        ? `<div class="mini-list">${low.map(p => `
            <div class="mini" data-product="${escapeHTML(p.id)}" style="cursor:pointer" title="Edit ${escapeHTML(p.name)}">
              <span>${escapeHTML(p.name)}</span>
              <b style="color:${Number(p.stock) === 0 ? "var(--red)" : "inherit"}">${Number(p.stock) === 0 ? "Sold out" : `${escapeHTML(p.stock)} left`}</b>
            </div>`).join("")}</div>`
        : `<p class="empty-note">Everything is well stocked.</p>`;
    }
  },


  /* ---------------------------------------------------
     Products: thumbnails, visible switch, side editor
  --------------------------------------------------- */

  renderProducts() {
    const table = this.dom.productsRows;
    if (!table) return;

    const search = normalize(this.dom.productSearch?.value);
    const cat = this.dom.filterCat?.value || "";
    const stockFilter = this.dom.filterStock?.value || "";
    const badge = this.dom.filterBadge?.value || "";
    const visibility = this.dom.filterActive?.value || "";
    const sortBy = this.dom.sortProducts?.value || "order";
    const lowLimit = Number(this.settings?.lowStockThreshold) || DEFAULT_LOW_STOCK;
    const stockOf = p => (p.stock == null ? Infinity : Number(p.stock));

    ["filterCat", "filterStock", "filterBadge", "filterActive"].forEach(id =>
      this.dom[id]?.classList.toggle("on", Boolean(this.dom[id].value)));

    const sorters = {
      order: (a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || String(a.name).localeCompare(String(b.name)),
      name: (a, b) => String(a.name).localeCompare(String(b.name)),
      stockAsc: (a, b) => stockOf(a) - stockOf(b),
      stockDesc: (a, b) => stockOf(b) - stockOf(a),
      priceAsc: (a, b) => Number(a.price || 0) - Number(b.price || 0),
      priceDesc: (a, b) => Number(b.price || 0) - Number(a.price || 0)
    };

    const products = this.productSearchIndex
      .filter(item => !search || item.search.includes(search))
      .map(item => item.product)
      .filter(p => {
        if (cat && p.cat !== cat) return false;
        const stock = stockOf(p);
        if (stockFilter === "in" && !(stock > 0)) return false;
        if (stockFilter === "low" && !(stock > 0 && stock <= lowLimit)) return false;
        if (stockFilter === "out" && stock !== 0) return false;
        if (stockFilter === "unlimited" && p.stock != null) return false;
        const badges = (p.badges || []).map(b => String(b).toUpperCase());
        if (badge === "__none" && badges.length) return false;
        if (badge && badge !== "__none" && !badges.includes(badge)) return false;
        if (visibility === "active" && p.active === false) return false;
        if (visibility === "hidden" && p.active !== false) return false;
        return true;
      })
      .slice()
      .sort(sorters[sortBy] || sorters.order);

    if (this.dom.productCount) {
      this.dom.productCount.textContent = products.length === this.products.length
        ? `${products.length} products`
        : `Showing ${products.length} of ${this.products.length}`;
    }

    if (!products.length) {
      table.innerHTML = `<tr><td colspan="6" class="muted">No products match these filters.</td></tr>`;
      return;
    }

    const catLabel = { men: "For Him", women: "For Her", unisex: "Unisex" };

    table.innerHTML = products.map(p => {
      const id = escapeHTML(p.id);
      const stockCell = p.stock == null
        ? `<div class="stock-cell"><b>∞</b><button class="mini-btn text" data-stock="${id}" data-op="set" title="Start tracking stock">Set</button></div>`
        : `<div class="stock-cell">
             <button class="mini-btn" data-stock="${id}" data-op="dec" aria-label="Remove 1 ${escapeHTML(p.name)}">−</button>
             <b class="${Number(p.stock) === 0 ? "zero" : ""}">${escapeHTML(p.stock)}</b>
             <button class="mini-btn" data-stock="${id}" data-op="inc" aria-label="Add 1 ${escapeHTML(p.name)}">+</button>
             <button class="mini-btn text" data-stock="${id}" data-op="restock">Restock</button>
           </div>`;

      return `
        <tr>
          <td class="td-main">
            <div class="prod-cell">
              <div class="thumb">${p.img ? `<img src="${escapeHTML(p.img)}" alt="" loading="lazy" onerror="this.remove()">` : "No photo"}</div>
              <div><b>${escapeHTML(p.name)}</b><small>${escapeHTML(catLabel[p.cat] || p.cat || "")} · ${id}</small></div>
            </div>
          </td>
          <td data-label="Price">${formatCurrency(p.price)}</td>
          <td data-label="Stock">${stockCell}</td>
          <td data-label="Badges">${(p.badges || []).length ? p.badges.map(b => `<span class="badge">${escapeHTML(b)}</span>`).join("") : "—"}</td>
          <td data-label="Visible"><input type="checkbox" class="switch" data-toggle-active="${id}" ${p.active !== false ? "checked" : ""} aria-label="Show ${escapeHTML(p.name)} on the website"></td>
          <td><div class="row-actions"><button class="btn" data-edit="${id}">Edit</button></div></td>
        </tr>`;
    }).join("");
  },


  editProduct(product) {
    _orig.editProduct.call(this, product);
    this.dom.productEditor?.setAttribute("aria-hidden", "false");
    if (this.dom.deleteProduct) this.dom.deleteProduct.hidden = !product;
    this.dom.productEditor?.querySelector(".drawer-panel")?.scrollTo({ top: 0 });
    setTimeout(() => this.dom.pName?.focus(), 50);
  },


  async setProductActive(id, active, toggle) {
    const product = this.productMap.get(String(id));
    if (!product) return;

    toggle.disabled = true;
    try {
      const res = await this.request("POST", { action: "adminSetProductActive", id, active });
      product.active = res.active;
      this.cacheWrite("products", this.products);
      this.setStatus(`${product.name} is now ${res.active ? "visible" : "hidden"} on the website`);
    } catch (error) {
      toggle.checked = !active;
      this.setStatus(error.message, true);
    } finally {
      toggle.disabled = false;
    }
  },


  async deleteProduct(id = this.dom.pOriginalId?.value) {
    if (!id) return;
    const product = this.productMap.get(String(id));

    const ok = await this.ask({
      title: "Delete product?",
      message: `"${product?.name || id}" will be removed from the website and the admin. This can't be undone.\n\nTip: switch off "Visible" instead if you only want to hide it for now.`,
      okText: "Delete product",
      danger: true
    });
    if (!ok) return;

    try {
      await this.request("POST", { action: "adminDeleteProduct", id });
      this.setStatus(`Deleted ${product?.name || id}`);
      this.closeEditors();
      await Promise.all([this.loadProducts(), this.loadDashboard()]);
    } catch (error) {
      this.setStatus(error.message, true);
    }
  },


  async adjustStock(id, op) {
    const product = this.productMap.get(String(id));
    if (!product) return;

    const params = { action: "adminAdjustStock", id };

    if (op === "inc") params.delta = 1;
    else if (op === "dec") params.delta = -1;
    else {
      const asked = await this.ask({
        title: op === "set" ? `Track stock for ${product.name}` : `Restock ${product.name}`,
        message: op === "set" ? "How many bottles do you have now?" : `How many bottles are you adding? (now ${product.stock})`,
        okText: op === "set" ? "Set stock" : "Add bottles",
        input: { value: op === "set" ? 10 : 5, min: 0 }
      });
      if (asked === null) return;

      const n = parseInt(asked, 10);
      if (!Number.isFinite(n) || n < 0) return this.setStatus("Please enter a number of bottles.", true);
      if (op === "set") params.set = n; else params.delta = n;
    }

    try {
      const response = await this.request("POST", params);
      product.stock = response.stock;
      this.cacheWrite("products", this.products);
      this.renderProducts();
      this.setStatus(`${product.name}: ${response.stock} in stock`);
      this.refreshNotifications();
      this.loadDashboard(true).catch(() => {});
    } catch (error) {
      this.setStatus(error.message, true);
    }
  },


  /* ---------------------------------------------------
     Promotions: readable cards, switches, side editor
  --------------------------------------------------- */

  renderPromotions() {
    const box = document.getElementById("promosList");
    if (!box) return;

    box.innerHTML = this.promotions.length
      ? this.promotions.map(p => `
          <div class="promo-card ${p.active ? "" : "off"}">
            <div class="promo-main">
              <b>${escapeHTML(p.name)}</b>
              <span>${escapeHTML(promoSummary(p))}</span>
              <small>${p.active ? "Showing on the website and applied at checkout" : "Off — not shown or applied"}</small>
            </div>
            <div class="promo-actions">
              <label class="switch-row" style="border:0;padding:0"><span class="muted" style="font-size:11px">${p.active ? "On" : "Off"}</span><input type="checkbox" class="switch" data-promo-toggle="${escapeHTML(p.id)}" ${p.active ? "checked" : ""} aria-label="Turn ${escapeHTML(p.name)} on or off"></label>
              <button class="btn" data-pedit="${escapeHTML(p.id)}">Edit</button>
              <button class="btn danger" data-pdel="${escapeHTML(p.id)}">Delete</button>
            </div>
          </div>`).join("")
      : `<p class="empty-note">No promotions yet. Add one, e.g. "Any 2 bottles for ₱840".</p>`;
  },


  editPromotion(promotion) {
    _orig.editPromotion.call(this, promotion);
    if (this.dom.promoTitle) this.dom.promoTitle.textContent = promotion ? "Edit promotion" : "Add promotion";
    this.dom.promoEditor?.setAttribute("aria-hidden", "false");
    this.updatePromoPreview();
    setTimeout(() => document.getElementById("promoName")?.focus(), 50);
  },


  updatePromoPreview() {
    const type = document.getElementById("promoType")?.value || "fixed_total";
    document.querySelectorAll("[data-promo-field]").forEach(el => {
      el.hidden = el.dataset.promoField !== type;
    });

    const preview = this.dom.promoPreview;
    if (!preview) return;
    preview.textContent = "Customers see: " + promoSummary({
      type,
      minQty: document.getElementById("promoQty")?.value || 2,
      fixedTotal: document.getElementById("promoFixed")?.value || 0,
      percentOff: document.getElementById("promoPercent")?.value || 0
    });
  },


  async setPromotionActive(id, active, toggle) {
    const promo = this.promotionMap.get(String(id));
    toggle.disabled = true;
    try {
      const res = await this.request("POST", { action: "adminSetPromotionActive", id, active });
      if (promo) promo.active = res.active;
      this.renderPromotions();
      this.setStatus(`${promo?.name || "Promotion"} turned ${res.active ? "on" : "off"}`);
    } catch (error) {
      toggle.checked = !active;
      this.setStatus(error.message, true);
    } finally {
      toggle.disabled = false;
    }
  },


  async deletePromotion(id) {
    const promo = this.promotionMap.get(String(id));
    const ok = await this.ask({
      title: "Delete promotion?",
      message: `"${promo?.name || "This promotion"}" will stop applying right away. You can switch it off instead to keep it for later.`,
      okText: "Delete",
      danger: true
    });
    if (!ok) return;

    try {
      await this.request("POST", { action: "adminDeletePromotion", id });
      await this.loadPromotions();
      this.setStatus("Promotion deleted");
    } catch (error) {
      this.setStatus(error.message, true);
    }
  },


  /* ---------------------------------------------------
     Orders: styled confirmations
  --------------------------------------------------- */

  async cancelOrder(orderId) {
    const order = this.findOrder(orderId);
    if (!order) return;

    const ok = await this.ask({
      title: "Cancel this order?",
      message: `${orderId} · ${order.fullname} · ${peso(order.total)}\n\nThe bottles go back into stock.`,
      okText: "Cancel order",
      cancelText: "Keep order",
      danger: true
    });
    if (ok) this.updateOrder(orderId, "Cancelled");
  },


  async setOrderStatus(orderId, status) {
    const order = this.findOrder(orderId);
    if (!order || !status || status === order.status) return;

    if (status === "Cancelled") return this.cancelOrder(orderId);

    if (order.status === "Cancelled") {
      const ok = await this.ask({
        title: "Re-open cancelled order?",
        message: `It will become "${status}" and its bottles will be taken out of stock again.`,
        okText: "Re-open"
      });
      if (!ok) return;
    }

    this.updateOrder(orderId, status);
  },


  /* ---------------------------------------------------
     Reviews: tabs + labels for mobile
  --------------------------------------------------- */

  renderReviews() {
    const table = this.dom.reviewsRows;
    if (!table) return;

    const all = this.reviews || [];
    const pending = all.filter(r => !r.approved);
    const visible = all.filter(r => r.approved);

    if (this.reviewTab === "pending" && !pending.length && this._reviewTabAuto !== false) this.reviewTab = "all";

    if (this.dom.reviewTabs) {
      const tabs = [["pending", "Pending", pending.length], ["visible", "Visible", visible.length], ["all", "All", all.length]];
      this.dom.reviewTabs.innerHTML = tabs.map(([key, label, n]) =>
        `<button type="button" class="tab ${this.reviewTab === key ? "active" : ""} ${key === "pending" && n ? "urgent" : ""}" data-rtab="${key}">${label}<b>${n}</b></button>`).join("");
    }

    const rows = this.reviewTab === "pending" ? pending : this.reviewTab === "visible" ? visible : all;

    table.innerHTML = rows.length
      ? rows.map(r => `
          <tr>
            <td class="td-main">
              ${r.photoUrl
                ? `<a href="${escapeHTML(r.photoUrl)}" target="_blank" rel="noopener"><img src="${escapeHTML(r.photoUrl)}" alt="Photo from ${escapeHTML(r.name)}" loading="lazy" style="width:64px;height:64px;object-fit:cover;border:1px solid var(--line)" onerror="this.replaceWith(document.createTextNode('Photo unavailable'))"></a>`
                : `<span class="muted">No photo</span>`}
            </td>
            <td data-label="Customer"><b>${escapeHTML(r.name)}</b><small>${escapeHTML(r.scent || "")}</small></td>
            <td data-label="Rating">${"★".repeat(Number(r.rating) || 0)}</td>
            <td data-label="Review" style="max-width:380px;white-space:normal">${escapeHTML(r.review)}</td>
            <td data-label="Status">${r.approved ? `<span class="pill st-completed">Visible</span>` : `<span class="pill st-new">Pending</span>`}</td>
            <td>
              <div class="row-actions">
                ${r.approved
                  ? `<button class="btn" data-review="${escapeHTML(r.id)}" data-op="hide">Hide</button>`
                  : `<button class="btn primary" data-review="${escapeHTML(r.id)}" data-op="approve">Approve</button>`}
                <button class="btn danger" data-review="${escapeHTML(r.id)}" data-op="delete">Delete</button>
              </div>
            </td>
          </tr>`).join("")
      : `<tr><td colspan="6" class="muted">${this.reviewTab === "pending" ? "No reviews waiting. ✓" : "No reviews here yet."}</td></tr>`;

    this.updateReviewBadges();
  },


  async deleteReview(id) {
    const review = (this.reviews || []).find(r => String(r.id) === String(id));
    const ok = await this.ask({
      title: "Delete review?",
      message: `The review from ${review?.name || "this customer"} and its photo will be removed permanently.`,
      okText: "Delete review",
      danger: true
    });
    if (!ok) return;

    try {
      await this.request("POST", { action: "adminDeleteReview", id });
      this.setStatus("Review deleted");
      await this.loadReviews();
    } catch (error) {
      this.setStatus(error.message, true);
    }
  },


  /* ---------------------------------------------------
     Audit log: filter, search, grouped by day
  --------------------------------------------------- */

  async loadAudit() {
    try {
      const response = await this.request("GET", { action: "adminAudit" });
      this.auditLogs = Array.isArray(response?.logs) ? response.logs : [];
      this.renderAudit();
    } catch (error) {
      this.setStatus(error.message, true);
    }
  },


  renderAudit() {
    const box = this.dom.auditList;
    if (!box) return;

    const kindOf = log => {
      const k = log.details?.kind;
      if (k) return k;
      const a = String(log.action || "").toLowerCase();
      if (a.includes("payment")) return "payment";
      if (a.includes(" order")) return "order";
      if (a.includes("promotion")) return "promotion";
      if (a.includes("review")) return "review";
      if (a.includes("setting")) return "homepage settings";
      if (a.includes("product") || a.includes("seeded")) return "product";
      return "other";
    };

    const icon = { order: ["🛍", "order"], payment: ["₱", "payment"], product: ["◇", "stock"], promotion: ["%", "order"], review: ["★", "review"], "homepage settings": ["⚙", ""] };
    const filter = this.dom.auditFilter?.value || "";
    const search = normalize(this.dom.auditSearch?.value);

    const logs = (this.auditLogs || []).filter(log =>
      (!filter || kindOf(log) === filter) &&
      (!search || normalize(`${log.action} ${log.actor}`).includes(search)));

    if (!logs.length) {
      box.innerHTML = `<p class="empty-note">Nothing in the log matches.</p>`;
      return;
    }

    const today = dayKey(new Date());
    const yesterday = dayKey(new Date(Date.now() - 86400000));
    const groups = new Map();
    logs.forEach(log => {
      const d = new Date(log.timestamp);
      const key = isNaN(d) ? "Unknown date" : dayKey(d);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(log);
    });

    box.innerHTML = [...groups.entries()].map(([key, items]) => {
      const label = key === today ? "Today" : key === yesterday ? "Yesterday"
        : key === "Unknown date" ? key
        : new Date(`${key}T00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });

      return `
        <div class="audit-day">
          <h4>${escapeHTML(label)}</h4>
          ${items.map(log => {
            const [sym, cls] = icon[kindOf(log)] || ["•", ""];
            const d = new Date(log.timestamp);
            return `
              <div class="audit-item">
                <span class="notif-icon ${cls}">${sym}</span>
                <div>${escapeHTML(log.action)}<small>${escapeHTML(log.actor || "")}</small></div>
                <time>${isNaN(d) ? "" : escapeHTML(d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }))}</time>
              </div>`;
          }).join("")}
        </div>`;
    }).join("");
  }
});


/* =========================================================
   BUSINESS TOOLS (v3)
   Vouchers · Restock log · Profit report · Monthly Excel/PDF
========================================================= */

const _orig3 = {
  bind: AdminApp.prototype.bind,
  showView: AdminApp.prototype.showView,
  closeEditors: AdminApp.prototype.closeEditors,
  loadOrders: AdminApp.prototype.loadOrders,
  loadProducts: AdminApp.prototype.loadProducts
};

MORE_VIEWS.push("reports", "inventory", "vouchers");

const byId = id => document.getElementById(id);
const MANILA = "Asia/Manila";

// ₱1,234 or ₱1,234.50
function peso2(value) {
  const n = Math.round(Number(value || 0) * 100) / 100;
  return "₱" + n.toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

// Same for the PDF (the built-in PDF font has no ₱ sign)
function phpText(value) {
  const n = Math.round(Number(value || 0) * 100) / 100;
  return "PHP " + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pctText(n) {
  return Number.isFinite(n) ? `${Math.round(n * 10) / 10}%` : "—";
}

// YYYY-MM-DD of a moment, in Manila time
function manilaDay(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: MANILA, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(value));
}

function niceDate(value) {
  if (!value) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + "T12:00:00+08:00") : new Date(value);
  return d.toLocaleDateString(undefined, { timeZone: MANILA, month: "short", day: "numeric", year: "numeric" });
}

function monthKeyOf(value) {
  return manilaDay(value).slice(0, 7);
}

function monthName(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
}

function orderSales(o) {
  return o.amountPaid != null ? Number(o.amountPaid) : Number(o.total || 0);
}

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-src="${src}"]`)?.dataset.loaded) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.dataset.src = src;
    s.onload = () => { s.dataset.loaded = "1"; resolve(); };
    s.onerror = () => reject(new Error("Could not load the PDF tool. Check your internet connection."));
    document.head.appendChild(s);
  });
}

function voucherDiscountText(v) {
  if (v.type === "percent") {
    return `${Number(v.value)}% off` + (v.maxDiscount ? ` (up to ${peso2(v.maxDiscount)})` : "");
  }
  return `${peso2(v.value)} off`;
}

function voucherRulesText(v) {
  const parts = [voucherDiscountText(v)];
  if (Number(v.minOrder) > 0) parts.push(`min. order ${peso2(v.minOrder)}`);
  if (v.perCustomer === 1) parts.push("once per customer");
  else if (v.perCustomer) parts.push(`${v.perCustomer}× per customer`);
  if (v.usageLimit) parts.push(`first ${v.usageLimit} uses`);
  if (v.startsAt && new Date(v.startsAt) > new Date()) parts.push(`starts ${niceDate(v.startsAt)}`);
  if (v.expiresAt) parts.push(`until ${niceDate(v.expiresAt)}`);
  return parts.join(" · ");
}

Object.assign(AdminApp.prototype, {

  /* ---------------------------------------------------
     Setup
  --------------------------------------------------- */

  bind() {
    _orig3.bind.call(this);

    ["inventory", "vouchers", "reports"].forEach(v => { if (!this.views.includes(v)) this.views.push(v); });
    this.vouchers = [];
    this.restocks = [];

    /* Vouchers */
    byId("newVoucher")?.addEventListener("click", () => this.editVoucher(null));
    byId("closeVoucher")?.addEventListener("click", () => this.closeEditors());
    byId("voucherForm")?.addEventListener("submit", e => { e.preventDefault(); this.saveVoucher(); });
    byId("deleteVoucher")?.addEventListener("click", () => this.deleteVoucher(byId("vOriginal").value));
    byId("voucherSearch")?.addEventListener("input", debounce(() => this.renderVouchers(), 150));
    byId("voucherFilter")?.addEventListener("change", () => this.renderVouchers());
    byId("vRandom")?.addEventListener("click", () => {
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      const bytes = crypto.getRandomValues(new Uint8Array(6));
      byId("vCode").value = "AE" + Array.from(bytes, b => chars[b % chars.length]).join("");
      this.updateVoucherPreview();
    });
    ["vCode", "vType", "vValue", "vMax", "vMin", "vStart", "vEnd", "vLimit", "vPer", "vActive"].forEach(id =>
      byId(id)?.addEventListener(id === "vType" || id === "vPer" || id === "vActive" ? "change" : "input", () => this.updateVoucherPreview()));
    byId("vCode")?.addEventListener("blur", e => { e.target.value = e.target.value.trim().toUpperCase().replace(/\s+/g, ""); });

    byId("vouchersList")?.addEventListener("click", e => {
      const edit = e.target.closest("[data-vedit]");
      if (edit) return this.editVoucher(this.vouchers.find(v => v.code === edit.dataset.vedit));
      const copy = e.target.closest("[data-vcopy]");
      if (copy) return this.copyVoucherLink(copy.dataset.vcopy);
      const del = e.target.closest("[data-vdel]");
      if (del) return this.deleteVoucher(del.dataset.vdel);
    });
    byId("vouchersList")?.addEventListener("change", e => {
      const t = e.target.closest("[data-vtoggle]");
      if (t) this.setVoucherActive(t.dataset.vtoggle, t.checked, t);
    });

    /* Restocks */
    byId("restockForm")?.addEventListener("submit", e => { e.preventDefault(); this.saveRestock(); });
    ["rProduct", "rQty", "rCost"].forEach(id =>
      byId(id)?.addEventListener(id === "rProduct" ? "change" : "input", () => this.updateRestockPreview()));
    byId("restockSearch")?.addEventListener("input", debounce(() => this.renderRestocks(), 150));
    byId("refreshRestocks")?.addEventListener("click", () => this.loadRestocks());
    byId("restockRows")?.addEventListener("click", e => {
      const del = e.target.closest("[data-rdel]");
      if (del) this.deleteRestock(del.dataset.rdel);
    });
    byId("invRows")?.addEventListener("click", e => {
      const pick = e.target.closest("[data-restock]");
      if (!pick) return;
      byId("rProduct").value = pick.dataset.restock;
      this.updateRestockPreview();
      byId("rQty")?.focus();
      byId("restockForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    /* Reports */
    const month = byId("reportMonth");
    if (month) month.value = manilaDay(new Date()).slice(0, 7);
    byId("reportRange")?.addEventListener("change", () => this.renderReports());
    month?.addEventListener("change", () => this.renderReports());
    byId("reportExcel")?.addEventListener("click", () => this.downloadReportExcel());
    byId("reportPdf")?.addEventListener("click", () => this.downloadReportPdf());
  },


  showView(view) {
    _orig3.showView.call(this, view);

    const titles = { inventory: "Restocks & Cost", vouchers: "Vouchers", reports: "Profit & Reports" };
    if (this.dom.viewTitle && titles[view]) this.dom.viewTitle.textContent = titles[view];

    if (view === "vouchers") this.loadVouchers();
    if (view === "inventory") this.loadRestocks();
    if (view === "reports") {
      this.renderReports();
      if (!this.restocksLoaded) this.loadRestocks(true);
    }
  },


  closeEditors() {
    _orig3.closeEditors.call(this);
    const el = byId("voucherEditor");
    el?.classList.add("hidden");
    el?.setAttribute("aria-hidden", "true");
  },


  async loadOrders(silent = false) {
    await _orig3.loadOrders.call(this, silent);
    const visible = v => !byId(v + "View")?.classList.contains("hidden");
    if (visible("vouchers")) this.renderVouchers();
    if (visible("reports")) this.renderReports();
  },


  async loadProducts() {
    await _orig3.loadProducts.call(this);
    this.fillRestockProducts();
    if (!byId("inventoryView")?.classList.contains("hidden")) this.renderInventory();
    if (!byId("reportsView")?.classList.contains("hidden")) this.renderReports();
  },


  /* ---------------------------------------------------
     VOUCHERS
  --------------------------------------------------- */

  async loadVouchers() {
    try {
      const res = await this.request("GET", { action: "adminVouchers" });
      this.vouchers = res.vouchers || [];
      this.renderVouchers();
    } catch (error) {
      this.setStatus("Could not load vouchers: " + error.message, true);
    }
  },


  voucherUsage(code) {
    const orders = (this.orders || []).filter(o => o.voucherCode === code && o.status !== "Cancelled");
    return {
      uses: orders.length,
      discount: orders.reduce((s, o) => s + Number(o.discount || 0), 0),
      sales: orders.reduce((s, o) => s + orderSales(o), 0),
      last: orders.reduce((m, o) => (!m || o.timestamp > m ? o.timestamp : m), "")
    };
  },


  voucherState(v, usage) {
    const now = new Date();
    if (!v.active) return { key: "off", label: "Off" };
    if (v.expiresAt && new Date(v.expiresAt) < now) return { key: "ended", label: "Expired" };
    if (v.usageLimit && usage.uses >= v.usageLimit) return { key: "ended", label: "Used up" };
    if (v.startsAt && new Date(v.startsAt) > now) return { key: "scheduled", label: "Scheduled" };
    return { key: "live", label: "Active" };
  },


  renderVouchers() {
    const box = byId("vouchersList");
    if (!box) return;

    const q = (byId("voucherSearch")?.value || "").trim().toLowerCase();
    const filter = byId("voucherFilter")?.value || "";

    const rows = this.vouchers.map(v => {
      const usage = this.voucherUsage(v.code);
      return { v, usage, state: this.voucherState(v, usage) };
    });

    // Summary cards
    const stats = byId("voucherStats");
    if (stats) {
      const live = rows.filter(r => r.state.key === "live").length;
      const uses = rows.reduce((s, r) => s + r.usage.uses, 0);
      const disc = rows.reduce((s, r) => s + r.usage.discount, 0);
      const sales = rows.reduce((s, r) => s + r.usage.sales, 0);
      const card = (label, value, sub) => `<div class="stat"><small>${escapeHTML(label)}</small><strong>${escapeHTML(value)}</strong><small class="sub">${escapeHTML(sub)}</small></div>`;
      stats.innerHTML = [
        card("Active vouchers", String(live), `${rows.length} total`),
        card("Times used", String(uses), "orders, excl. cancelled"),
        card("Discounts given", peso2(disc), "through vouchers"),
        card("Sales with vouchers", peso2(sales), "after discount")
      ].join("");
    }

    const list = rows.filter(({ v, state }) => {
      if (filter && filter !== state.key) return false;
      if (q && !`${v.code} ${v.note}`.toLowerCase().includes(q)) return false;
      return true;
    });

    if (!this.vouchers.length) {
      box.innerHTML = `<p class="empty-note">No vouchers yet. Create one — e.g. <b>SUKI50</b> for ₱50 off — and share the code on Facebook or with loyal customers.</p>`;
      return;
    }
    if (!list.length) {
      box.innerHTML = `<p class="empty-note">No vouchers match.</p>`;
      return;
    }

    box.innerHTML = list.map(({ v, usage, state }) => {
      const code = escapeHTML(v.code);
      const limit = v.usageLimit ? ` of ${v.usageLimit}` : "";
      const bar = v.usageLimit
        ? `<span class="v-bar"><i style="width:${Math.min(100, Math.round(usage.uses / v.usageLimit * 100))}%"></i></span>`
        : "";
      return `
        <div class="promo-card voucher-card ${state.key}">
          <div class="v-code"><b>${code}</b><span class="v-state ${state.key}">${state.label}</span></div>
          <div class="promo-main">
            <span>${escapeHTML(voucherRulesText(v))}</span>
            <small>Used ${usage.uses}${limit} time${usage.uses === 1 && !limit ? "" : "s"} · ${peso2(usage.discount)} discounts · ${peso2(usage.sales)} sales${usage.last ? ` · last used ${niceDate(usage.last)}` : ""}</small>
            ${bar}
            ${v.note ? `<small class="v-note">${escapeHTML(v.note)}</small>` : ""}
          </div>
          <div class="promo-actions">
            <label class="switch-row" style="border:0;padding:0"><span class="muted" style="font-size:11px">${v.active ? "On" : "Off"}</span><input type="checkbox" class="switch" data-vtoggle="${code}" ${v.active ? "checked" : ""} aria-label="Turn ${code} on or off"></label>
            <button class="btn" type="button" data-vcopy="${code}" title="Copy a link that fills in the code">Copy link</button>
            <button class="btn" type="button" data-vedit="${code}">Edit</button>
          </div>
        </div>`;
    }).join("");
  },


  editVoucher(v) {
    const el = byId("voucherEditor");
    if (!el) return;
    const set = (id, value) => { const f = byId(id); if (f) f.value = value ?? ""; };

    byId("voucherTitle").textContent = v ? `Edit ${v.code}` : "New voucher";
    set("vOriginal", v?.code || "");
    set("vCode", v?.code || "");
    set("vType", v?.type || "percent");
    set("vValue", v ? v.value : "");
    set("vMax", v?.maxDiscount ?? "");
    set("vMin", v ? v.minOrder : 0);
    set("vStart", v?.startsAt ? manilaDay(v.startsAt) : "");
    set("vEnd", v?.expiresAt ? manilaDay(v.expiresAt) : "");
    set("vLimit", v?.usageLimit ?? "");
    set("vPer", v?.perCustomer ? String(Math.min(3, v.perCustomer)) : "");
    set("vNote", v?.note || "");
    byId("vActive").checked = v ? v.active : true;
    byId("deleteVoucher").hidden = !v;

    this.updateVoucherPreview();
    el.classList.remove("hidden");
    el.setAttribute("aria-hidden", "false");
    setTimeout(() => byId(v ? "vValue" : "vCode")?.focus(), 50);
  },


  voucherFormData() {
    const val = id => byId(id)?.value ?? "";
    return {
      code: val("vCode").trim().toUpperCase().replace(/\s+/g, ""),
      originalCode: val("vOriginal"),
      type: val("vType"),
      value: val("vValue"),
      maxDiscount: val("vMax"),
      minOrder: val("vMin") || 0,
      startsAt: val("vStart"),
      expiresAt: val("vEnd"),
      usageLimit: val("vLimit"),
      perCustomer: val("vPer"),
      note: val("vNote"),
      active: byId("vActive")?.checked ?? true
    };
  },


  updateVoucherPreview() {
    const type = byId("vType")?.value || "percent";
    document.querySelectorAll("[data-vfield]").forEach(el => { el.hidden = el.dataset.vfield !== type; });
    const label = byId("vValueLabel");
    if (label) label.textContent = type === "percent" ? "Percent off (%)" : "Amount off (₱)";

    const f = this.voucherFormData();
    const preview = byId("vPreview");
    if (!preview) return;
    if (!(Number(f.value) > 0)) {
      preview.textContent = "Enter the discount to see a preview.";
      return;
    }
    const v = {
      type: f.type, value: Number(f.value), maxDiscount: Number(f.maxDiscount) || null, minOrder: Number(f.minOrder) || 0,
      perCustomer: f.perCustomer ? Number(f.perCustomer) : null, usageLimit: f.usageLimit ? Number(f.usageLimit) : null,
      startsAt: f.startsAt ? f.startsAt + "T00:00:00+08:00" : null, expiresAt: f.expiresAt ? f.expiresAt + "T23:59:59+08:00" : null
    };
    const example = Math.max(860, v.minOrder);
    const disc = v.type === "percent"
      ? Math.min(Math.round(example * v.value) / 100, v.maxDiscount || Infinity)
      : Math.min(v.value, example);
    preview.textContent = `${f.code || "CODE"}: ${voucherRulesText(v)}. Example: a ${peso2(example)} order saves ${peso2(disc)}. If a promo gives more, the promo is used instead.`;
  },


  async saveVoucher() {
    const data = this.voucherFormData();
    try {
      const res = await this.request("POST", { action: "adminSaveVoucher", ...data });
      this.toast(`Voucher ${res.code} saved`);
      this.closeEditors();
      await this.loadVouchers();
    } catch (error) {
      this.setStatus(error.message, true);
    }
  },


  async setVoucherActive(code, active, toggle) {
    toggle.disabled = true;
    try {
      const res = await this.request("POST", { action: "adminSetVoucherActive", code, active });
      const v = this.vouchers.find(x => x.code === code);
      if (v) v.active = res.active;
      this.toast(`${code} turned ${res.active ? "on" : "off"}`);
      this.renderVouchers();
    } catch (error) {
      toggle.checked = !active;
      this.setStatus(error.message, true);
    } finally {
      toggle.disabled = false;
    }
  },


  async deleteVoucher(code) {
    if (!code) return;
    const used = this.voucherUsage(code).uses;
    const ok = await this.ask({
      title: `Delete ${code}?`,
      message: used
        ? `It was used in ${used} order${used === 1 ? "" : "s"}. Those orders keep their discount, but the code stops working. Tip: turn it off instead to keep the history here.`
        : "Customers will no longer be able to use this code.",
      okText: "Delete", danger: true
    });
    if (!ok) return;
    try {
      await this.request("POST", { action: "adminDeleteVoucher", code });
      this.toast(`Deleted ${code}`);
      this.closeEditors();
      await this.loadVouchers();
    } catch (error) {
      this.setStatus(error.message, true);
    }
  },


  async copyVoucherLink(code) {
    const url = new URL("index.html", location.href);
    url.searchParams.set("voucher", code);
    url.hash = "order";
    const text = url.toString();
    try {
      await navigator.clipboard.writeText(text);
      this.toast(`Link copied — opening it fills in ${code} at checkout`);
    } catch {
      await this.ask({ title: "Copy this link", message: text, okText: "Done", cancelText: "Close" });
    }
  },


  /* ---------------------------------------------------
     RESTOCKS & COST
  --------------------------------------------------- */

  async loadRestocks(quiet = false) {
    try {
      const res = await this.request("GET", { action: "adminRestocks" });
      this.restocks = res.restocks || [];
      this.restocksLoaded = true;
      this.fillRestockProducts();
      this.renderInventory();
      this.renderRestocks();
      if (!byId("reportsView")?.classList.contains("hidden")) this.renderReports();
    } catch (error) {
      if (!quiet) this.setStatus("Could not load restocks: " + error.message, true);
    }
  },


  fillRestockProducts() {
    const select = byId("rProduct");
    if (!select) return;
    const current = select.value;
    const products = [...(this.products || [])].sort((a, b) => a.name.localeCompare(b.name));
    select.innerHTML = `<option value="">Choose a product…</option>` + products.map(p =>
      `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)}${p.stock == null ? " (unlimited)" : ` — ${p.stock} in stock`}</option>`).join("");
    if (current && products.some(p => p.id === current)) select.value = current;

    const date = byId("rDate");
    if (date && !date.value) date.value = manilaDay(new Date());

    const suppliers = [...new Set((this.restocks || []).map(r => r.supplier).filter(Boolean))];
    const dl = byId("supplierList");
    if (dl) dl.innerHTML = suppliers.map(s => `<option value="${escapeHTML(s)}">`).join("");

    this.updateRestockPreview();
  },


  updateRestockPreview() {
    const out = byId("rPreview");
    if (!out) return;
    const p = (this.products || []).find(x => x.id === byId("rProduct")?.value);
    const qty = parseInt(byId("rQty")?.value, 10);
    const costText = byId("rCost")?.value ?? "";
    if (!p) { out.textContent = "Choose a product to see the new stock and average cost."; return; }
    if (!(qty > 0)) { out.textContent = `${p.name}: ${p.stock == null ? "unlimited stock" : `${p.stock} in stock`} · average cost ${p.cost == null ? "not set yet" : peso2(p.cost)}.`; return; }

    const onHand = Math.max(0, Number(p.stock || 0));
    const unit = costText === "" ? null : Number(costText);
    let newCost = p.cost;
    if (unit != null) newCost = p.cost == null || onHand === 0 ? unit : (p.cost * onHand + unit * qty) / (onHand + qty);

    const stockText = p.stock == null ? "stays unlimited" : `${p.stock} → ${p.stock + qty}`;
    const costLine = unit == null
      ? `cost stays ${p.cost == null ? "not set" : peso2(p.cost)} (no cost entered)`
      : `average cost ${p.cost == null ? "—" : peso2(p.cost)} → ${peso2(Math.round(newCost * 100) / 100)}`;
    out.textContent = `Stock ${stockText} · ${costLine}${unit != null ? ` · total ${peso2(unit * qty)}` : ""}`;
  },


  async saveRestock() {
    const productId = byId("rProduct")?.value;
    const qty = byId("rQty")?.value;
    if (!productId) return this.setStatus("Choose a product first.", true);
    if (!(Number(qty) > 0)) return this.setStatus("Enter how many bottles arrived.", true);

    const product = (this.products || []).find(p => p.id === productId);
    try {
      const res = await this.request("POST", {
        action: "adminRestock",
        productId,
        qty,
        unitCost: byId("rCost")?.value ?? "",
        supplier: byId("rSupplier")?.value || "",
        note: byId("rNote")?.value || "",
        date: byId("rDate")?.value || ""
      });
      if (product) { product.stock = res.stock; product.cost = res.cost; }
      this.toast(`${product?.name || "Product"}: +${qty} bottles${res.stock != null ? ` (now ${res.stock})` : ""}${res.cost != null ? ` · avg cost ${peso2(res.cost)}` : ""}`);
      ["rQty", "rCost", "rNote"].forEach(id => { const f = byId(id); if (f) f.value = ""; });
      await Promise.all([this.loadRestocks(true), this.loadProducts()]);
    } catch (error) {
      this.setStatus(error.message, true);
    }
  },


  async deleteRestock(id) {
    const r = this.restocks.find(x => String(x.id) === String(id));
    if (!r) return;
    const ok = await this.ask({
      title: "Undo this restock?",
      message: `Removes "${r.productName} +${r.qty}" from the history and takes ${r.qty} bottle${r.qty === 1 ? "" : "s"} back out of stock. The average cost stays as is (you can edit it in the product).`,
      okText: "Undo restock", danger: true
    });
    if (!ok) return;
    try {
      await this.request("POST", { action: "adminDeleteRestock", id });
      this.toast(`Removed restock: ${r.productName} +${r.qty}`);
      await Promise.all([this.loadRestocks(true), this.loadProducts()]);
    } catch (error) {
      this.setStatus(error.message, true);
    }
  },


  renderInventory() {
    const products = [...(this.products || [])].sort((a, b) => a.name.localeCompare(b.name));
    const thisMonth = manilaDay(new Date()).slice(0, 7);

    const onHand = products.reduce((s, p) => s + (p.stock == null ? 0 : Math.max(0, p.stock)), 0);
    const value = products.reduce((s, p) => s + (p.stock == null || p.cost == null ? 0 : Math.max(0, p.stock) * p.cost), 0);
    const spent = (this.restocks || []).filter(r => String(r.receivedAt).slice(0, 7) === thisMonth)
      .reduce((s, r) => s + (r.unitCost == null ? 0 : r.unitCost * r.qty), 0);
    const noCost = products.filter(p => p.cost == null).length;

    const cards = byId("invCards");
    if (cards) {
      const card = (label, value, sub, cls = "") => `<div class="stat ${cls}"><small>${escapeHTML(label)}</small><strong>${escapeHTML(value)}</strong><small class="sub">${escapeHTML(sub)}</small></div>`;
      cards.innerHTML = [
        card("Bottles on hand", onHand.toLocaleString(), `${products.length} products`),
        card("Stock value", peso2(value), "at average cost"),
        card("Spent on restocks", peso2(spent), "this month"),
        card("Missing cost", String(noCost), noCost ? "set a cost to see profit" : "all products have a cost", noCost ? "warn" : "")
      ].join("");
    }

    const rows = byId("invRows");
    if (rows) {
      rows.innerHTML = products.map(p => {
        const margin = p.cost == null || !p.price ? null : (p.price - p.cost) / p.price * 100;
        return `<tr>
          <td data-label="Product" class="td-main"><button type="button" class="link-btn" data-restock="${escapeHTML(p.id)}" title="Record a restock">${escapeHTML(p.name)}</button></td>
          <td data-label="Stock">${p.stock == null ? "∞" : p.stock}</td>
          <td data-label="Avg. cost">${p.cost == null ? `<span class="muted">not set</span>` : peso2(p.cost)}</td>
          <td data-label="Price">${peso2(p.price)}</td>
          <td data-label="Margin">${margin == null ? "—" : `<span class="${margin < 20 ? "neg" : "pos"}">${pctText(margin)}</span>`}</td>
        </tr>`;
      }).join("");
    }
  },


  renderRestocks() {
    const tbody = byId("restockRows");
    if (!tbody) return;
    const q = (byId("restockSearch")?.value || "").trim().toLowerCase();
    const list = (this.restocks || []).filter(r =>
      !q || `${r.productName} ${r.supplier} ${r.note} ${r.createdBy}`.toLowerCase().includes(q));

    const count = byId("restockCount");
    if (count) {
      const total = list.reduce((s, r) => s + (r.unitCost == null ? 0 : r.unitCost * r.qty), 0);
      count.textContent = `${list.length} entr${list.length === 1 ? "y" : "ies"} · ${peso2(total)}`;
    }

    tbody.innerHTML = list.length ? list.map(r => `
      <tr>
        <td data-label="Date">${escapeHTML(niceDate(r.receivedAt))}</td>
        <td data-label="Product" class="td-main"><b>${escapeHTML(r.productName)}</b><small>by ${escapeHTML(r.createdBy)}</small></td>
        <td data-label="Bottles">+${r.qty}</td>
        <td data-label="Cost / bottle">${r.unitCost == null ? "—" : peso2(r.unitCost)}</td>
        <td data-label="Total">${r.unitCost == null ? "—" : peso2(r.unitCost * r.qty)}</td>
        <td data-label="Supplier / note">${escapeHTML([r.supplier, r.note].filter(Boolean).join(" · ")) || `<span class="muted">—</span>`}</td>
        <td data-label=""><button class="btn ghost small" type="button" data-rdel="${r.id}" title="Undo this restock">Undo</button></td>
      </tr>`).join("")
      : `<tr><td colspan="7" class="muted">${q ? "No restocks match." : "No restocks recorded yet. Use the form above when a new batch arrives."}</td></tr>`;
  },


  /* ---------------------------------------------------
     PROFIT & REPORTS
  --------------------------------------------------- */

  reportPeriod() {
    const range = byId("reportRange")?.value || "month";
    const month = byId("reportMonth")?.value || manilaDay(new Date()).slice(0, 7);
    if (range === "all") return { key: "all", label: "All time", match: () => true, file: "all-time" };
    if (range === "year") {
      const y = month.slice(0, 4);
      return { key: y, label: `Year ${y}`, match: d => d.startsWith(y), file: y };
    }
    return { key: month, label: monthName(month), match: d => d.startsWith(month), file: month };
  },


  // Everything the report needs, for one period
  computeProfit(period) {
    const productMap = new Map((this.products || []).map(p => [p.id, p]));
    const orders = (this.orders || []).filter(o => o.status !== "Cancelled" && period.match(manilaDay(o.timestamp)));

    const perProduct = new Map();
    const discounts = new Map();
    let sales = 0, cost = 0, missingBottles = 0, bottles = 0, gross = 0, discountTotal = 0, collected = 0, unpaid = 0;

    const orderRows = orders.map(o => {
      const oSales = orderSales(o);
      const lines = Array.isArray(o.items) && o.items.length ? o.items : [];
      // Older (imported) orders may not have a price per line: use the product price, else an even split
      const totalQty = lines.reduce((s, i) => s + Number(i.qty || 0), 0) || 1;
      const unitPrice = i => i.price != null && i.price !== ""
        ? Number(i.price)
        : productMap.get(i.id)?.price ?? Number(o.subtotal || 0) / totalQty;
      const lineGross = lines.reduce((s, i) => s + unitPrice(i) * Number(i.qty || 0), 0) || 1;
      let oCost = 0, oMissing = false;

      lines.forEach(i => {
        const qty = Number(i.qty || 0);
        const unit = i.cost != null ? Number(i.cost) : productMap.get(i.id)?.cost ?? null;
        const share = (unitPrice(i) * qty) / lineGross;
        const lineSales = oSales * share;
        const key = i.id || i.name;
        const row = perProduct.get(key) || { id: i.id, name: productMap.get(i.id)?.name || i.name || i.id, bottles: 0, sales: 0, cost: 0, missing: 0 };
        row.bottles += qty;
        row.sales += lineSales;
        if (unit == null) { row.missing += qty; missingBottles += qty; oMissing = true; }
        else { row.cost += unit * qty; oCost += unit * qty; }
        perProduct.set(key, row);
        bottles += qty;
      });

      if (Number(o.discount) > 0) {
        const label = o.voucherCode ? `Voucher ${o.voucherCode}` : (o.promotion || "Discount");
        const d = discounts.get(label) || { label, orders: 0, amount: 0, voucher: Boolean(o.voucherCode) };
        d.orders += 1;
        d.amount += Number(o.discount);
        discounts.set(label, d);
      }
      // money taken off outside the system (amount paid lower than the order total)
      if (o.amountPaid != null && Number(o.amountPaid) < Number(o.total) && o.paymentStatus === "Paid") {
        const label = "Extra discounts (paid less than total)";
        const d = discounts.get(label) || { label, orders: 0, amount: 0 };
        d.orders += 1;
        d.amount += Number(o.total) - Number(o.amountPaid);
        discounts.set(label, d);
      }

      sales += oSales;
      cost += oCost;
      gross += Number(o.subtotal || 0);
      discountTotal += Number(o.discount || 0);
      if (o.paymentStatus === "Paid") collected += oSales;
      else unpaid += Math.max(0, Number(o.total || 0) - Number(o.amountPaid || 0));

      return { o, sales: oSales, cost: oCost, profit: oSales - oCost, missing: oMissing };
    });

    const restocks = (this.restocks || []).filter(r => period.match(String(r.receivedAt)));
    const restockSpend = restocks.reduce((s, r) => s + (r.unitCost == null ? 0 : r.unitCost * r.qty), 0);

    const products = [...perProduct.values()]
      .map(r => ({ ...r, profit: r.sales - r.cost, margin: r.sales ? (r.sales - r.cost) / r.sales * 100 : NaN }))
      .sort((a, b) => b.profit - a.profit || b.bottles - a.bottles);

    return {
      period, orders, orderRows, products, restocks, restockSpend,
      discounts: [...discounts.values()].sort((a, b) => b.amount - a.amount),
      sales, cost, profit: sales - cost, margin: sales ? (sales - cost) / sales * 100 : NaN,
      bottles, missingBottles, gross, discountTotal, collected, unpaid
    };
  },


  monthlySummary(limit = 12) {
    const map = new Map();
    const productMap = new Map((this.products || []).map(p => [p.id, p]));
    (this.orders || []).filter(o => o.status !== "Cancelled").forEach(o => {
      const key = monthKeyOf(o.timestamp);
      const row = map.get(key) || { key, orders: 0, sales: 0, cost: 0 };
      row.orders += 1;
      row.sales += orderSales(o);
      (o.items || []).forEach(i => {
        const unit = i.cost != null ? Number(i.cost) : productMap.get(i.id)?.cost;
        if (unit != null) row.cost += unit * Number(i.qty || 0);
      });
      map.set(key, row);
    });
    return [...map.values()].sort((a, b) => b.key.localeCompare(a.key)).slice(0, limit);
  },


  renderReports() {
    if (!byId("profitCards")) return;
    const month = byId("reportMonth");
    const range = byId("reportRange")?.value || "month";
    if (month) month.hidden = range === "all";

    const r = this.computeProfit(this.reportPeriod());
    this.lastReport = r;

    byId("reportLabel").textContent = `${r.period.label} · ${r.orders.length} order${r.orders.length === 1 ? "" : "s"} · ${r.bottles} bottle${r.bottles === 1 ? "" : "s"}`;

    const card = (label, value, sub, cls = "") => `<div class="stat ${cls}"><small>${escapeHTML(label)}</small><strong>${escapeHTML(value)}</strong><small class="sub">${escapeHTML(sub)}</small></div>`;
    byId("profitCards").innerHTML = [
      card("Sales", peso2(r.sales), "after all discounts"),
      card("Cost of bottles sold", peso2(r.cost), `${r.bottles - r.missingBottles} of ${r.bottles} bottles have a cost`),
      card("Gross profit", peso2(r.profit), "sales − cost", r.profit >= 0 ? "highlight" : "warn"),
      card("Margin", pctText(r.margin), "profit ÷ sales"),
      card("Discounts given", peso2(r.discountTotal), "promos + vouchers"),
      card("Spent on restocks", peso2(r.restockSpend), `${r.restocks.length} restock${r.restocks.length === 1 ? "" : "s"} this period`)
    ].join("");

    const warn = byId("profitWarn");
    if (warn) {
      warn.hidden = !r.missingBottles;
      warn.textContent = r.missingBottles
        ? `${r.missingBottles} bottle${r.missingBottles === 1 ? "" : "s"} sold have no cost yet, so profit looks higher than it really is. Set the cost in Products, or record a restock with the cost per bottle.`
        : "";
    }

    byId("profitRows").innerHTML = r.products.length ? r.products.map(p => `
      <tr>
        <td data-label="Product" class="td-main"><b>${escapeHTML(p.name)}</b>${p.missing ? `<small class="neg">${p.missing} without cost</small>` : ""}</td>
        <td data-label="Bottles">${p.bottles}</td>
        <td data-label="Sales">${peso2(p.sales)}</td>
        <td data-label="Cost">${p.missing && !p.cost ? "—" : peso2(p.cost)}</td>
        <td data-label="Profit">${p.missing === p.bottles ? `<span class="muted">needs cost</span>` : `<b class="${p.profit < 0 ? "neg" : ""}">${peso2(p.profit)}</b>`}</td>
        <td data-label="Margin">${p.missing === p.bottles ? "—" : pctText(p.margin)}</td>
      </tr>`).join("")
      : `<tr><td colspan="6" class="muted">No sales in this period.</td></tr>`;

    byId("discountList").innerHTML = r.discounts.length ? r.discounts.map(d => `
      <div class="mini"><span>${escapeHTML(d.label)} <small class="muted">· ${d.orders} order${d.orders === 1 ? "" : "s"}</small></span><b>${peso2(d.amount)}</b></div>`).join("")
      : `<p class="muted">No discounts in this period.</p>`;

    const months = this.monthlySummary(12);
    byId("monthlyRows").innerHTML = months.length ? months.map(m => `
      <tr data-month="${m.key}" class="clickable">
        <td data-label="Month" class="td-main">${escapeHTML(monthName(m.key))}</td>
        <td data-label="Orders">${m.orders}</td>
        <td data-label="Sales">${peso2(m.sales)}</td>
        <td data-label="Profit">${peso2(m.sales - m.cost)}</td>
      </tr>`).join("")
      : `<tr><td colspan="4" class="muted">No orders yet.</td></tr>`;

    byId("monthlyRows").querySelectorAll("[data-month]").forEach(tr => tr.addEventListener("click", () => {
      byId("reportRange").value = "month";
      byId("reportMonth").value = tr.dataset.month;
      this.renderReports();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }));
  },


  async downloadReportExcel() {
    const r = this.lastReport || this.computeProfit(this.reportPeriod());
    try {
      const XLSX = await import("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm");
      const round = n => Math.round(Number(n || 0) * 100) / 100;
      const book = XLSX.utils.book_new();

      const summary = [
        ["AURA & ESSENCE — Sales Report"],
        ["Period", r.period.label],
        ["Generated", new Date().toLocaleString()],
        [],
        ["Orders (excl. cancelled)", r.orders.length],
        ["Bottles sold", r.bottles],
        ["Sales before discounts", round(r.gross)],
        ["Discounts (promos + vouchers)", round(r.discountTotal)],
        ["Sales (after all discounts)", round(r.sales)],
        ["Collected (paid orders)", round(r.collected)],
        ["Still to collect", round(r.unpaid)],
        ["Cost of bottles sold", round(r.cost)],
        ["Gross profit", round(r.profit)],
        ["Margin %", Number.isFinite(r.margin) ? round(r.margin) : ""],
        ["Spent on restocks", round(r.restockSpend)],
        ...(r.missingBottles ? [[], [`Note: ${r.missingBottles} bottle(s) have no cost — profit is overstated.`]] : [])
      ];
      const s1 = XLSX.utils.aoa_to_sheet(summary);
      s1["!cols"] = [{ wch: 34 }, { wch: 22 }];
      XLSX.utils.book_append_sheet(book, s1, "Summary");

      const s2 = XLSX.utils.json_to_sheet(r.products.map(p => ({
        "Product": p.name, "Bottles": p.bottles, "Sales": round(p.sales), "Cost": round(p.cost),
        "Profit": round(p.profit), "Margin %": Number.isFinite(p.margin) ? round(p.margin) : "",
        "Bottles without cost": p.missing || ""
      })));
      XLSX.utils.book_append_sheet(book, s2, "Per Product");

      const s3 = XLSX.utils.json_to_sheet(r.orderRows.map(({ o, sales, cost, profit, missing }) => ({
        "Date": new Date(o.timestamp).toLocaleString(undefined, { timeZone: MANILA }),
        "Order ID": o.orderId, "Customer": o.fullname, "Contact": o.contact,
        "Items": (o.items || []).map(i => `${i.name} × ${i.qty}`).join(" | "),
        "Bottles": o.qty, "Subtotal": round(o.subtotal), "Discount": round(o.discount),
        "Promo / Voucher": o.voucherCode ? `Voucher ${o.voucherCode}` : (o.promotion || ""),
        "Total": round(o.total), "Amount Paid": o.amountPaid == null ? "" : round(o.amountPaid),
        "Payment Status": o.paymentStatus, "Status": o.status,
        "Sales": round(sales), "Cost": missing && !cost ? "" : round(cost), "Profit": round(profit)
      })));
      XLSX.utils.book_append_sheet(book, s3, "Orders");

      const s4 = XLSX.utils.json_to_sheet(r.discounts.map(d => ({ "Discount": d.label, "Orders": d.orders, "Amount": round(d.amount) })));
      XLSX.utils.book_append_sheet(book, r.discounts.length ? s4 : XLSX.utils.aoa_to_sheet([["No discounts"]]), "Discounts");

      const s5 = XLSX.utils.json_to_sheet(r.restocks.map(x => ({
        "Date": x.receivedAt, "Product": x.productName, "Bottles": x.qty,
        "Cost / bottle": x.unitCost == null ? "" : round(x.unitCost),
        "Total": x.unitCost == null ? "" : round(x.unitCost * x.qty), "Supplier": x.supplier, "Note": x.note
      })));
      XLSX.utils.book_append_sheet(book, r.restocks.length ? s5 : XLSX.utils.aoa_to_sheet([["No restocks"]]), "Restocks");

      XLSX.writeFile(book, `aura-essence-report-${r.period.file}.xlsx`);
      this.toast(`Excel report downloaded (${r.period.label})`);
    } catch (error) {
      this.setStatus("Excel report failed: " + error.message, true);
    }
  },


  async downloadReportPdf() {
    const r = this.lastReport || this.computeProfit(this.reportPeriod());
    const btn = byId("reportPdf");
    const label = btn?.textContent;
    try {
      if (btn) { btn.disabled = true; btn.textContent = "Preparing PDF…"; }
      await loadScriptOnce("https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js");
      await loadScriptOnce("https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js");

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const W = doc.internal.pageSize.getWidth();
      const gold = [176, 141, 79], ink = [24, 22, 20], muted = [120, 112, 100];
      const M = 40;

      // Header
      doc.setFillColor(...ink);
      doc.rect(0, 0, W, 86, "F");
      doc.setTextColor(216, 189, 114);
      doc.setFont("times", "normal");
      doc.setFontSize(22);
      doc.text("AURA & ESSENCE", M, 42);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(235, 228, 214);
      doc.text(`Sales & Profit Report  ·  ${r.period.label}`, M, 62);
      doc.setTextColor(170, 160, 143);
      doc.text(`Generated ${new Date().toLocaleString("en-PH", { timeZone: MANILA })}`, W - M, 62, { align: "right" });

      // Summary boxes
      const boxes = [
        ["Sales", phpText(r.sales)],
        ["Cost of goods", phpText(r.cost)],
        ["Gross profit", phpText(r.profit)],
        ["Margin", pctText(r.margin)]
      ];
      const bw = (W - M * 2 - 30) / 4;
      boxes.forEach(([k, v], i) => {
        const x = M + i * (bw + 10);
        doc.setDrawColor(...gold);
        doc.setLineWidth(0.6);
        doc.rect(x, 104, bw, 54);
        doc.setFontSize(8);
        doc.setTextColor(...muted);
        doc.text(k.toUpperCase(), x + 10, 120);
        doc.setFontSize(13);
        doc.setTextColor(...ink);
        doc.text(v, x + 10, 143);
      });

      const tableStyle = {
        theme: "grid",
        headStyles: { fillColor: ink, textColor: [216, 189, 114], fontStyle: "normal", fontSize: 8.5 },
        styles: { fontSize: 8.5, cellPadding: 5, lineColor: [225, 218, 205], lineWidth: 0.5, textColor: [40, 36, 32] },
        alternateRowStyles: { fillColor: [250, 247, 241] },
        margin: { left: M, right: M }
      };
      const heading = (text, y) => {
        doc.setFontSize(12);
        doc.setTextColor(...ink);
        doc.setFont("times", "normal");
        doc.text(text, M, y);
        doc.setFont("helvetica", "normal");
        return y + 8;
      };

      let y = heading("Summary", 186);
      doc.autoTable({
        ...tableStyle,
        startY: y,
        head: [["", "Amount"]],
        body: [
          ["Orders (excl. cancelled)", String(r.orders.length)],
          ["Bottles sold", String(r.bottles)],
          ["Sales before discounts", phpText(r.gross)],
          ["Discounts (promos + vouchers)", "- " + phpText(r.discountTotal)],
          ["Sales after all discounts", phpText(r.sales)],
          ["Collected (paid orders)", phpText(r.collected)],
          ["Still to collect", phpText(r.unpaid)],
          ["Cost of bottles sold", phpText(r.cost)],
          ["Gross profit", phpText(r.profit)],
          ["Spent on restocks", phpText(r.restockSpend)]
        ],
        columnStyles: { 1: { halign: "right" } }
      });

      y = heading("Profit per product", doc.lastAutoTable.finalY + 26);
      doc.autoTable({
        ...tableStyle,
        startY: y,
        head: [["Product", "Bottles", "Sales", "Cost", "Profit", "Margin"]],
        body: r.products.length
          ? r.products.map(p => [p.name + (p.missing ? " *" : ""), String(p.bottles), phpText(p.sales), phpText(p.cost), phpText(p.profit), p.missing === p.bottles ? "-" : pctText(p.margin)])
          : [["No sales in this period", "", "", "", "", ""]],
        columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } }
      });

      if (r.discounts.length) {
        y = heading("Discounts given", doc.lastAutoTable.finalY + 26);
        doc.autoTable({
          ...tableStyle,
          startY: y,
          head: [["Discount", "Orders", "Amount"]],
          body: r.discounts.map(d => [d.label, String(d.orders), phpText(d.amount)]),
          columnStyles: { 1: { halign: "right" }, 2: { halign: "right" } }
        });
      }

      y = heading("Orders", doc.lastAutoTable.finalY + 26);
      doc.autoTable({
        ...tableStyle,
        startY: y,
        head: [["Date", "Order ID", "Customer", "Items", "Total", "Paid", "Profit"]],
        body: r.orderRows.length
          ? r.orderRows.map(({ o, profit }) => [
              new Date(o.timestamp).toLocaleDateString("en-PH", { timeZone: MANILA, month: "short", day: "numeric" }),
              o.orderId, o.fullname,
              (o.items || []).map(i => `${i.name} x${i.qty}`).join(", ") + (o.voucherCode ? ` (${o.voucherCode})` : ""),
              phpText(o.total), o.paymentStatus, phpText(profit)
            ])
          : [["No orders in this period", "", "", "", "", "", ""]],
        styles: { ...tableStyle.styles, fontSize: 7.5 },
        columnStyles: { 1: { cellWidth: 92 }, 4: { halign: "right" }, 6: { halign: "right" } }
      });

      if (r.missingBottles) {
        const yy = doc.lastAutoTable.finalY + 18;
        doc.setFontSize(8);
        doc.setTextColor(170, 90, 60);
        doc.text(`* ${r.missingBottles} bottle(s) sold have no cost recorded, so profit is overstated.`, M, yy);
      }

      // Page numbers
      const pages = doc.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(...muted);
        doc.text(`Aura & Essence · ${r.period.label} · Page ${i} of ${pages}`, W / 2, doc.internal.pageSize.getHeight() - 20, { align: "center" });
      }

      doc.save(`aura-essence-report-${r.period.file}.pdf`);
      this.toast(`PDF report downloaded (${r.period.label})`);
    } catch (error) {
      this.setStatus("PDF report failed: " + error.message, true);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  }
});


/* =========================================================
   ADMIN UX (v4)
   Ctrl+K search · bulk order actions · quick cost editing ·
   tidier pop-ups · remembers your place · installable app
========================================================= */

const _orig4 = {
  bind: AdminApp.prototype.bind,
  showView: AdminApp.prototype.showView,
  openApp: AdminApp.prototype.openApp,
  renderOrders: AdminApp.prototype.renderOrders,
  renderInventory: AdminApp.prototype.renderInventory
};

const STATE_KEY = "aeAdminState";
// Filters that are remembered between visits (element ids)
const REMEMBER_FIELDS = [
  "orderPayFilter", "rangePreset", "rangeFrom", "rangeTo",
  "filterCat", "filterStock", "filterBadge", "filterActive", "sortProducts",
  "reportRange", "reportMonth", "voucherFilter", "auditFilter"
];

function readAdminState() {
  try { return JSON.parse(localStorage.getItem(STATE_KEY) || "{}") || {}; } catch { return {}; }
}
function writeAdminState(patch) {
  try { localStorage.setItem(STATE_KEY, JSON.stringify({ ...readAdminState(), ...patch })); } catch { /* private mode */ }
}

let deferredInstall = null;
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  deferredInstall = e;
  ["installBtn", "mInstallBtn"].forEach(id => { const b = byId(id); if (b) b.hidden = false; });
});

Object.assign(AdminApp.prototype, {

  bind() {
    _orig4.bind.call(this);
    this.selectedOrders = new Set();

    /* ----- Ctrl+K search ----- */
    byId("paletteBtn")?.addEventListener("click", () => this.openPalette());
    document.addEventListener("keydown", e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        if (byId("appView")?.classList.contains("hidden")) return;
        e.preventDefault();
        byId("palette")?.classList.contains("hidden") ? this.openPalette() : this.closePalette();
      } else if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "") &&
                 !byId("appView")?.classList.contains("hidden")) {
        e.preventDefault();
        this.openPalette();
      }
    });
    byId("palette")?.querySelector("[data-close-palette]")?.addEventListener("click", () => this.closePalette());
    byId("paletteInput")?.addEventListener("input", () => { this.paletteIndex = 0; this.renderPalette(); });
    byId("paletteInput")?.addEventListener("keydown", e => {
      const n = (this.paletteItems || []).length;
      if (e.key === "ArrowDown") { e.preventDefault(); this.paletteIndex = (this.paletteIndex + 1) % Math.max(1, n); this.highlightPalette(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); this.paletteIndex = (this.paletteIndex - 1 + n) % Math.max(1, n); this.highlightPalette(); }
      else if (e.key === "Enter") { e.preventDefault(); this.runPaletteItem(this.paletteIndex); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.closePalette(); }
    });
    byId("paletteList")?.addEventListener("click", e => {
      const item = e.target.closest("[data-pi]");
      if (item) this.runPaletteItem(Number(item.dataset.pi));
    });
    byId("paletteList")?.addEventListener("mousemove", e => {
      const item = e.target.closest("[data-pi]");
      if (item && Number(item.dataset.pi) !== this.paletteIndex) { this.paletteIndex = Number(item.dataset.pi); this.highlightPalette(); }
    });

    /* ----- Bulk order actions ----- */
    // Capture phase: a checkbox click must not open the order drawer.
    this.dom.ordersRows?.addEventListener("click", e => {
      const box = e.target.closest("input[data-sel]");
      const cell = e.target.closest("td.td-check");
      if (!box && !cell) return;
      e.stopPropagation();
      if (!box && cell) {
        const b = cell.querySelector("input[data-sel]");
        if (b) { b.checked = !b.checked; this.toggleOrderSelection(b.dataset.sel, b.checked); }
        return;
      }
      this.toggleOrderSelection(box.dataset.sel, box.checked);
    }, true);
    byId("selectAllOrders")?.addEventListener("change", e => {
      document.querySelectorAll("#ordersRows input[data-sel]").forEach(b => {
        b.checked = e.target.checked;
        this.toggleOrderSelection(b.dataset.sel, b.checked, true);
      });
      this.updateBulkBar();
    });
    byId("bulkStatus")?.addEventListener("change", e => {
      const status = e.target.value;
      e.target.value = "";
      if (status) this.bulkSetStatus(status);
    });
    byId("bulkPaid")?.addEventListener("click", () => this.bulkMarkPaid());
    byId("bulkClear")?.addEventListener("click", () => { this.selectedOrders.clear(); this.renderOrders(); });

    /* ----- Quick cost editing (Restocks → Stock & cost) ----- */
    byId("invRows")?.addEventListener("click", e => {
      const cell = e.target.closest("[data-cost-edit]");
      if (cell && !cell.querySelector("input")) this.startCostEdit(cell);
    });
    byId("invCards")?.addEventListener("click", e => {
      if (e.target.closest(".stat.warn")) this.focusMissingCost();
    });

    /* ----- Remember filters ----- */
    document.addEventListener("change", e => {
      const id = e.target?.id;
      if (REMEMBER_FIELDS.includes(id)) {
        const filters = readAdminState().filters || {};
        filters[id] = e.target.value;
        writeAdminState({ filters });
      }
    });
    this.dom.orderTabs?.addEventListener("click", e => {
      const tab = e.target.closest("[data-tab]");
      if (tab) writeAdminState({ orderTab: tab.dataset.tab });
    });

    /* ----- Install as an app ----- */
    const install = async () => {
      if (deferredInstall) {
        deferredInstall.prompt();
        const choice = await deferredInstall.userChoice.catch(() => null);
        if (choice?.outcome === "accepted") this.toast("Installed — find “A&E Admin” on your home screen");
        deferredInstall = null;
        ["installBtn", "mInstallBtn"].forEach(id => { const b = byId(id); if (b) b.hidden = true; });
      }
    };
    byId("installBtn")?.addEventListener("click", install);
    this.dom.moreSheet?.addEventListener("click", e => {
      if (e.target.closest('[data-more-action="install"]')) { this.dom.moreSheet.classList.add("hidden"); install(); }
    });
    // iPhone/iPad: no install prompt — show how once, in the More menu
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.navigator.standalone;
    if (ios && byId("mInstallBtn")) {
      byId("mInstallBtn").hidden = false;
      byId("mInstallBtn").addEventListener("click", () =>
        this.ask({ title: "Add to Home Screen", message: "In Safari, tap the Share button (square with an arrow), then “Add to Home Screen”. The admin will open like an app.", okText: "Got it", cancelText: "Close" }));
    }

    if ("serviceWorker" in navigator && location.protocol === "https:") {
      navigator.serviceWorker.register("admin-sw.js", { scope: "./admin" }).catch(() => {});
    }
  },


  async openApp() {
    await _orig4.openApp.call(this);
    this.restoreAdminState();
  },


  restoreAdminState() {
    const state = readAdminState();
    const filters = state.filters || {};
    let touched = false;
    REMEMBER_FIELDS.forEach(id => {
      const el = byId(id);
      if (!el || filters[id] == null) return;
      if (el.tagName === "SELECT" && ![...el.options].some(o => o.value === filters[id])) return;
      if (el.value !== filters[id]) { el.value = filters[id]; touched = true; }
    });
    if (state.orderTab) this.orderTab = state.orderTab;

    if (touched || state.orderTab) {
      // let each screen re-render with the remembered filters
      ["rangePreset", "filterCat", "orderPayFilter", "reportRange", "voucherFilter", "auditFilter"].forEach(id => {
        if (filters[id] != null) byId(id)?.dispatchEvent(new Event("change", { bubbles: true }));
      });
      if (filters.rangePreset === "custom") byId("rangeFrom")?.dispatchEvent(new Event("change", { bubbles: true }));
      this.renderOrders?.();
    }

    if (state.view && state.view !== "dashboard" && this.views.includes(state.view)) this.showView(state.view);
  },


  showView(view) {
    _orig4.showView.call(this, view);
    if (view === "homepage" && this.dom.viewTitle) this.dom.viewTitle.textContent = "Homepage & Payment";
    writeAdminState({ view });
  },


  /* ---------------------------------------------------
     Pop-ups: max 3 at a time, repeats are merged ("×2")
  --------------------------------------------------- */

  toast(message, type = "ok", options = {}) {
    const stack = this.dom.toastStack;
    if (!stack || !message) return;

    const key = `${type}|${options.title || ""}|${message}`;
    const same = [...stack.children].find(el => el.dataset.key === key && !el.classList.contains("out"));
    if (same) {
      const n = Number(same.dataset.count || 1) + 1;
      same.dataset.count = n;
      let badge = same.querySelector(".t-count");
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "t-count";
        same.querySelector("div")?.appendChild(badge);
      }
      badge.textContent = ` ×${n}`;
      clearTimeout(same._timer);
      same._timer = setTimeout(() => same.querySelector("button")?.click(), options.timeout || (type === "error" ? 7000 : 3500));
      stack.prepend(same);
      return;
    }

    const item = document.createElement("div");
    item.className = `toast-item ${type}`;
    item.dataset.key = key;
    item.setAttribute("role", type === "error" ? "alert" : "status");
    item.innerHTML = `
      <span class="t-icon">${type === "error" ? "⚠" : type === "info" ? "🔔" : "✓"}</span>
      <div>${options.title ? `<b>${escapeHTML(options.title)}</b>` : ""}${escapeHTML(message)}</div>
      <button type="button" aria-label="Dismiss">×</button>`;

    const remove = () => {
      clearTimeout(item._timer);
      item.classList.add("out");
      setTimeout(() => item.remove(), 200);
    };
    item.querySelector("button").addEventListener("click", ev => { ev.stopPropagation(); remove(); });
    if (options.onClick) item.addEventListener("click", () => { options.onClick(); remove(); });

    stack.prepend(item);
    const live = [...stack.children].filter(el => !el.classList.contains("out"));
    live.slice(3).forEach(el => el.remove());
    item._timer = setTimeout(remove, options.timeout || (type === "error" ? 7000 : 3500));
  },


  /* ---------------------------------------------------
     Ctrl+K search
  --------------------------------------------------- */

  openPalette() {
    const pal = byId("palette");
    if (!pal) return;
    pal.classList.remove("hidden");
    const input = byId("paletteInput");
    input.value = "";
    this.paletteIndex = 0;
    this.renderPalette();
    setTimeout(() => input.focus(), 30);
    if (!this.vouchers?.length && !this._vouchersRequested) {
      this._vouchersRequested = true;
      this.request("GET", { action: "adminVouchers" })
        .then(res => { this.vouchers = res.vouchers || []; if (!pal.classList.contains("hidden")) this.renderPalette(); })
        .catch(() => {});
    }
  },


  closePalette() {
    byId("palette")?.classList.add("hidden");
  },


  paletteResults(q) {
    const query = normalize(q || "");
    const digits = String(q || "").replace(/\D/g, "");
    const has = text => normalize(text).includes(query);
    const out = [];

    const pages = [
      ["dashboard", "Dashboard", "Sales"], ["orders", "Orders", "Sales"], ["reports", "Profit & Reports", "Sales"],
      ["products", "Products", "Catalog"], ["inventory", "Restocks & cost", "Catalog"], ["promotions", "Promotions", "Catalog"],
      ["vouchers", "Vouchers", "Catalog"], ["homepage", "Homepage & Payment settings", "Site"], ["reviews", "Reviews", "Site"], ["audit", "Audit Log", "Site"]
    ];
    const actions = [
      ["New product", "Add a perfume", () => { this.showView("products"); this.editProduct(null); }],
      ["New voucher", "Create a discount code", () => { this.showView("vouchers"); this.editVoucher(null); }],
      ["Record a restock", "Add bottles + cost", () => { this.showView("inventory"); setTimeout(() => byId("rProduct")?.focus(), 80); }],
      ["Download PDF report", "This month's sales & profit", () => { this.showView("reports"); this.downloadReportPdf(); }],
      ["Download backup", "Everything as Excel", () => this.downloadBackup()],
      ["Open customer site", "In a new tab", () => window.open("index.html", "_blank", "noopener")]
    ];

    if (!query) {
      const fresh = (this.orders || []).filter(o => o.status === "New").slice(0, 5);
      fresh.forEach(o => out.push(this.paletteOrderItem(o)));
      actions.slice(0, 4).forEach(([t, s, run]) => out.push({ group: "Actions", icon: "＋", title: t, sub: s, run }));
      pages.forEach(([v, t, g]) => out.push({ group: "Go to", icon: "→", title: t, sub: g, run: () => this.showView(v) }));
      return out;
    }

    (this.orders || [])
      .filter(o => has(o.orderId) || has(o.fullname) || (digits.length >= 4 && String(o.contact || "").replace(/\D/g, "").includes(digits)) ||
                   (Array.isArray(o.items) && o.items.some(i => has(i.name))))
      .slice(0, 8)
      .forEach(o => out.push(this.paletteOrderItem(o)));

    (this.products || [])
      .filter(p => has(p.name) || has(p.id))
      .slice(0, 6)
      .forEach(p => out.push({
        group: "Products", icon: "◇", title: p.name,
        sub: `${p.stock == null ? "unlimited" : p.stock + " in stock"} · ${formatCurrency(p.price)}${p.cost == null ? " · no cost yet" : ""}`,
        run: () => { this.showView("products"); this.editProduct(p); }
      }));

    (this.vouchers || [])
      .filter(v => has(v.code) || has(v.note))
      .slice(0, 4)
      .forEach(v => out.push({
        group: "Vouchers", icon: "%", title: v.code, sub: voucherRulesText(v),
        run: () => { this.showView("vouchers"); this.editVoucher(v); }
      }));

    actions.filter(([t, s]) => has(t) || has(s))
      .forEach(([t, s, run]) => out.push({ group: "Actions", icon: "＋", title: t, sub: s, run }));
    pages.filter(([, t, g]) => has(t) || has(g))
      .forEach(([v, t, g]) => out.push({ group: "Go to", icon: "→", title: t, sub: g, run: () => this.showView(v) }));

    return out;
  },


  paletteOrderItem(o) {
    return {
      group: "Orders", icon: "☰",
      title: `${o.fullname} · ${formatCurrency(o.total)}`,
      sub: `${o.orderId} · ${o.status} · ${o.paymentStatus || "Unpaid"}`,
      run: () => { this.showView("orders"); this.openOrder(o.orderId); }
    };
  },


  renderPalette() {
    const list = byId("paletteList");
    if (!list) return;
    const q = byId("paletteInput")?.value || "";
    const items = this.paletteResults(q);
    this.paletteItems = items;

    if (!items.length) {
      list.innerHTML = `<p class="palette-empty">No results for “${escapeHTML(q)}”.</p>`;
      return;
    }

    let group = "";
    list.innerHTML = items.map((it, i) => {
      const head = it.group !== group ? `<p class="palette-group">${escapeHTML(it.group)}</p>` : "";
      group = it.group;
      return `${head}<button type="button" class="palette-item${i === this.paletteIndex ? " active" : ""}" data-pi="${i}" role="option" aria-selected="${i === this.paletteIndex}">
        <span class="pi-icon">${escapeHTML(it.icon)}</span><span class="pi-text"><b>${escapeHTML(it.title)}</b><small>${escapeHTML(it.sub || "")}</small></span></button>`;
    }).join("");
  },


  highlightPalette() {
    document.querySelectorAll("#paletteList [data-pi]").forEach(el => {
      const on = Number(el.dataset.pi) === this.paletteIndex;
      el.classList.toggle("active", on);
      el.setAttribute("aria-selected", String(on));
      if (on) el.scrollIntoView({ block: "nearest" });
    });
  },


  runPaletteItem(i) {
    const item = (this.paletteItems || [])[i];
    if (!item) return;
    this.closePalette();
    item.run();
  },


  /* ---------------------------------------------------
     Bulk order actions
  --------------------------------------------------- */

  renderOrders() {
    _orig4.renderOrders.call(this);
    const rows = document.querySelectorAll("#ordersRows tr[data-order]");
    const visible = new Set();
    rows.forEach(tr => {
      const id = tr.dataset.order;
      visible.add(id);
      const td = document.createElement("td");
      td.className = "td-check";
      td.innerHTML = `<input type="checkbox" data-sel="${escapeHTML(id)}" aria-label="Select ${escapeHTML(id)}" ${this.selectedOrders?.has(id) ? "checked" : ""}>`;
      tr.prepend(td);
      tr.classList.toggle("selected", Boolean(this.selectedOrders?.has(id)));
    });
    document.querySelectorAll("#ordersRows td[colspan]").forEach(td => { td.colSpan = 8; });
    // forget selections that are no longer on screen (other tab / search)
    [...(this.selectedOrders || [])].forEach(id => { if (!visible.has(id)) this.selectedOrders.delete(id); });
    this.updateBulkBar();
  },


  toggleOrderSelection(id, on, skipBar) {
    if (!this.selectedOrders) this.selectedOrders = new Set();
    on ? this.selectedOrders.add(id) : this.selectedOrders.delete(id);
    document.querySelector(`#ordersRows tr[data-order="${CSS.escape(id)}"]`)?.classList.toggle("selected", on);
    if (!skipBar) this.updateBulkBar();
  },


  updateBulkBar() {
    const bar = byId("bulkBar");
    const n = this.selectedOrders?.size || 0;
    if (bar) bar.hidden = n === 0;
    const count = byId("bulkCount");
    if (count) count.textContent = `${n} selected`;
    const all = byId("selectAllOrders");
    const boxes = document.querySelectorAll("#ordersRows input[data-sel]");
    if (all) {
      all.checked = boxes.length > 0 && n === boxes.length;
      all.indeterminate = n > 0 && n < boxes.length;
    }
  },


  selectedOrderList() {
    const ids = this.selectedOrders || new Set();
    return (this.orders || []).filter(o => ids.has(o.orderId));
  },


  async bulkSetStatus(status) {
    const list = this.selectedOrderList().filter(o => o.status !== status);
    if (!list.length) return this.toast(`Selected orders are already ${status}.`, "info");

    const ok = await this.ask({
      title: `Set ${list.length} order${list.length === 1 ? "" : "s"} to ${status}?`,
      message: status === "Cancelled"
        ? "Cancelled orders put their bottles back in stock. Customers see “Cancelled” in Track Order."
        : `Customers will see “${status}” when they track their order.`,
      okText: `Set ${status}`, danger: status === "Cancelled"
    });
    if (!ok) return;

    let done = 0, failed = 0;
    for (const o of list) {
      try {
        await this.request("POST", { action: "adminUpdateOrderStatus", orderId: o.orderId, status });
        done++;
      } catch { failed++; }
    }
    this.selectedOrders.clear();
    await this.loadOrders(true);
    this.toast(`${done} order${done === 1 ? "" : "s"} set to ${status}${failed ? ` · ${failed} failed` : ""}`, failed ? "error" : "ok");
  },


  async bulkMarkPaid() {
    const list = this.selectedOrderList().filter(o => o.paymentStatus !== "Paid" && o.status !== "Cancelled");
    if (!list.length) return this.toast("Selected orders are already paid (or cancelled).", "info");
    const sum = list.reduce((s, o) => s + Number(o.total || 0), 0);

    const ok = await this.ask({
      title: `Mark ${list.length} order${list.length === 1 ? "" : "s"} as paid?`,
      message: `Records the full order total as received (${formatCurrency(sum)} in all). If someone paid a different amount, open that order and enter it there.`,
      okText: "Mark as paid"
    });
    if (!ok) return;

    let done = 0, failed = 0;
    for (const o of list) {
      try {
        await this.request("POST", {
          action: "adminSavePayment", orderId: o.orderId, paymentStatus: "Paid", amountPaid: o.total,
          paymentRef: o.paymentRef || "", paymentNote: o.paymentNote || ""
        });
        done++;
      } catch { failed++; }
    }
    this.selectedOrders.clear();
    await this.loadOrders(true);
    this.toast(`${done} order${done === 1 ? "" : "s"} marked as paid${failed ? ` · ${failed} failed` : ""}`, failed ? "error" : "ok");
  },


  /* ---------------------------------------------------
     Quick cost editing
  --------------------------------------------------- */

  renderInventory() {
    _orig4.renderInventory.call(this);
    document.querySelectorAll("#invRows tr").forEach(tr => {
      const id = tr.querySelector("[data-restock]")?.dataset.restock;
      const cell = tr.querySelector('td[data-label="Avg. cost"]');
      if (!id || !cell) return;
      cell.dataset.costEdit = id;
      cell.classList.add("cost-cell");
      cell.title = "Click to edit the cost";
      cell.insertAdjacentHTML("beforeend", ` <span class="edit-hint" aria-hidden="true">✎</span>`);
    });
  },


  startCostEdit(cell) {
    const id = cell.dataset.costEdit;
    const p = (this.products || []).find(x => x.id === id);
    if (!p) return;
    cell.innerHTML = `<input type="number" min="0" step="0.01" inputmode="decimal" class="cost-input" value="${p.cost ?? ""}" placeholder="₱ cost" aria-label="Cost per bottle for ${escapeHTML(p.name)}">`;
    const input = cell.querySelector("input");
    input.focus();
    input.select();

    let finished = false;
    const finish = async save => {
      if (finished) return;
      finished = true;
      const text = input.value.trim();
      const next = text === "" ? null : Math.max(0, Number(text));
      if (!save || next === p.cost || (text !== "" && !Number.isFinite(next))) { this.renderInventory(); return; }
      try {
        await this.request("POST", { action: "adminSaveProduct", ...this.productForSave(p), cost: text });
        p.cost = next;
        this.toast(`${p.name}: cost ${next == null ? "cleared" : peso2(next)}`);
      } catch (error) {
        this.setStatus(error.message, true);
      }
      this.renderInventory();
      // jump to the next product without a cost
      if (save === "next") this.focusMissingCost(id);
    };

    input.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); finish("next"); }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); }
    });
    input.addEventListener("blur", () => finish(true));
  },


  // Same fields the product editor sends, so nothing else changes
  productForSave(p) {
    return {
      originalId: p.id, id: p.id, name: p.name, cat: p.cat, price: p.price,
      stock: p.stock ?? "", sortOrder: p.sortOrder ?? 0, img: p.img || "",
      desc: p.desc || "", descLong: p.descLong || "",
      topNotes: (p.topNotes || []).join(", "), heartNotes: (p.heartNotes || []).join(", "), baseNotes: (p.baseNotes || []).join(", "),
      application: p.application || "", profiles: (p.profiles || []).join(", "),
      longevity: p.longevity ?? 7, projection: p.projection ?? 7, strength: p.strength || "moderate",
      time: (p.time || []).join(", "), occasion: p.occasion || "",
      badges: (p.badges || []).join(", "), active: p.active !== false
    };
  },


  focusMissingCost(afterId) {
    const cells = [...document.querySelectorAll("#invRows [data-cost-edit]")];
    const missing = cells.filter(c => (this.products || []).find(p => p.id === c.dataset.costEdit)?.cost == null);
    if (!missing.length) { if (!afterId) this.toast("All products have a cost ✓"); return; }
    let target = missing[0];
    if (afterId) {
      const idx = cells.findIndex(c => c.dataset.costEdit === afterId);
      target = missing.find(c => cells.indexOf(c) > idx) || missing[0];
    }
    target.closest("tr")?.scrollIntoView({ behavior: "smooth", block: "center" });
    this.startCostEdit(target);
  }
});


/* =========================================================
   START ADMIN APP
========================================================= */

new AdminApp();
