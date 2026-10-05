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
      "ordersRows",

      "refreshProducts",
      "newProduct",
      "productSearch",
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


    this.dom.ordersRows?.addEventListener(
      "change",
      e => {

        const select =
          e.target.closest("[data-status]");

        if (!select) return;

        this.updateOrder(
          select.dataset.status,
          select.value
        );
      }
    );


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
        ]

      ]
        .map(
          ([label, value]) =>
            `
            <div class="stat">
              <small>${escapeHTML(label)}</small>
              <strong>${escapeHTML(value)}</strong>
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


    const rows =
      this.orderSearchIndex
        .filter(item =>
          !search ||
          item.search.includes(search)
        )
        .map(item => item.order);


    table.innerHTML =
      rows
        .map(
          order =>
            `
            <tr>

              <td>
                <b>
                  ${escapeHTML(order.orderId)}
                </b>

                <small>
                  ${escapeHTML(order.payment || "")}
                </small>
              </td>

              <td>
                ${escapeHTML(order.fullname)}

                <small>
                  ${escapeHTML(order.contact)}
                </small>
              </td>

              <td>
                ${
                  Array.isArray(order.items) &&
                  order.items.length

                    ?

                    order.items
                      .map(
                        item =>
                          `${escapeHTML(item.name)}
                           × ${escapeHTML(item.qty)}`
                      )
                      .join("<br>")

                    :

                    escapeHTML(
                      order.scent || ""
                    )
                }
              </td>

              <td>
                ${formatCurrency(order.total)}
              </td>

              <td>

                <select
                  data-status="${escapeHTML(order.orderId)}"
                >

                  ${
                    ORDER_STATUSES
                      .map(
                        status =>
                          `
                          <option
                            ${
                              status === order.status
                                ? "selected"
                                : ""
                            }
                          >
                            ${escapeHTML(status)}
                          </option>
                          `
                      )
                      .join("")
                  }

                </select>

              </td>

              <td>
                ${
                  order.timestamp
                    ? escapeHTML(
                        new Date(
                          order.timestamp
                        ).toLocaleString()
                      )
                    : ""
                }
              </td>

            </tr>
            `
        )
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

      await this.request(
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
      const order =
        this.orders.find(
          item =>
            String(item.orderId) ===
            String(orderId)
        );


      if (order) {
        order.status = status;
      }


      this.rebuildOrderIndex();
      this.renderOrders();


      this.setStatus(
        "Order updated"
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
     EXPORT ORDERS
  ===================================================== */

  exportOrders() {

    const headers = [
      "Order ID",
      "Customer",
      "Contact",
      "Items",
      "Total",
      "Status",
      "Date"
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

          order.status,

          order.timestamp
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


    const products =
      this.productSearchIndex

        .filter(item =>
          !search ||
          item.search.includes(search)
        )

        .map(item => item.product)

        .slice()
        .sort(
          (a, b) =>
            Number(a.sortOrder || 0) -
            Number(b.sortOrder || 0)
        );


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
                    ? "—"
                    : escapeHTML(product.stock)
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
        false
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
