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
            <td>
              <b>${escapeHTML(order.orderId)}</b>
              <small>${order.timestamp ? escapeHTML(new Date(order.timestamp).toLocaleString()) : ""}</small>
            </td>
            <td>
              ${escapeHTML(order.fullname)}
              <small>${escapeHTML(order.contact)}</small>
            </td>
            <td>
              ${
                Array.isArray(order.items) && order.items.length
                  ? order.items.map(item => `${escapeHTML(item.name)} × ${escapeHTML(item.qty)}`).join("<br>")
                  : escapeHTML(order.scent || "")
              }
            </td>
            <td>
              ${formatCurrency(order.total)}
              ${
                paid != null && paid !== Number(order.total)
                  ? `<small class="${diff ? "paid-diff" : ""}">paid ${formatCurrency(paid)}</small>`
                  : ""
              }
            </td>
            <td>${payPill(order)}<small>${escapeHTML(order.payment || "")}</small></td>
            <td>${statusPill(order.status)}</td>
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
        this.dom.setAlertAt?.value ?? 1
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
    const bw = Math.max(1, slot - gap);
    const y = v => pad.t + ih - (v / top) * ih;

    const short = d => d.toLocaleDateString(undefined, unit === "month" ? { month: "short", year: "2-digit" } : { month: "short", day: "numeric" });
    const labelEvery = Math.max(1, Math.ceil(buckets.length / Math.floor(iw / 64)));

    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Revenue ${this.dom.chartLabel?.textContent?.toLowerCase() || ""}">`;

    for (let v = 0; v <= top + 1e-9; v += step) {
      svg += `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>`;
      svg += `<text class="axis-text" x="${pad.l - 8}" y="${y(v) + 3}" text-anchor="end">₱${Math.round(v).toLocaleString()}</text>`;
    }

    buckets.forEach((b, i) => {
      const x = pad.l + i * slot + gap / 2;
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
          "Delivery / Meetup": o.address,
          "Payment": o.payment,
          "Notes": o.notes,
          "Items JSON": JSON.stringify(o.items || [])
        })),
        Products: data.products.map(p => ({
          "ID": p.id, "Name": p.name, "Category": p.cat, "Price": Number(p.price),
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
   START ADMIN APP
========================================================= */

new AdminApp();
