/* =========================================================
   AURA & ESSENCE — Supabase backend client
   ---------------------------------------------------------
   Replaces the old Google Apps Script backend.

   The site still calls   api.get({ action: "products" })
   and                    api.post({ action: "adminSaveProduct", ... })
   exactly like before, and gets back the same response shape
   ({ success: true, ... } or { success: false, message }).
   This file translates those calls into Supabase queries.
========================================================= */

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase-config.js";

const REVIEW_BUCKET = "review-photos";

/* ---------------------------------------------------------
   CONNECTION
--------------------------------------------------------- */

export function isSupabaseConfigured() {
  return (
    /^https:\/\/.+/.test(String(SUPABASE_URL || "")) &&
    !String(SUPABASE_URL).includes("PASTE_YOUR_") &&
    Boolean(SUPABASE_ANON_KEY) &&
    !String(SUPABASE_ANON_KEY).includes("PASTE_YOUR_")
  );
}

let client = null;

export function getSupabase() {
  if (!isSupabaseConfigured()) {
    throw new Error(
      "Supabase is not connected yet. Open assets/js/supabase-config.js and paste your Project URL and anon key.",
    );
  }
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}

/* ---------------------------------------------------------
   SMALL HELPERS
--------------------------------------------------------- */

function toList(value) {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  const text = String(value ?? "").trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      return toList(JSON.parse(text));
    } catch {
      /* fall through */
    }
  }
  return text
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function toBool(value, fallback = true) {
  if (value === true || value === false) return value;
  const text = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!text) return fallback;
  return !["false", "0", "no", "off"].includes(text);
}

function toInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function toNum(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function parseJSON(value, fallback) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

// Same as the old Apps Script slugify_(): used when the ID is left blank.
function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 40);
}

function normalizeStrength(value) {
  const s = String(value || "")
    .trim()
    .toLowerCase();
  if (s === "light") return "subtle";
  if (s === "strong") return "bold";
  return ["subtle", "moderate", "bold"].includes(s) ? s : "moderate";
}

function friendlyError(error) {
  const code = error?.code || "";
  const msg = String(error?.message || error || "Something went wrong.");

  if (
    code === "42501" ||
    code === "PGRST301" ||
    /jwt|not authorized|permission denied/i.test(msg)
  ) {
    return "You don't have permission for this. Please sign in again as an admin.";
  }
  if (code === "23505")
    return "That ID is already used. Please choose a different one.";
  if (code === "23514" && /products_id_check/.test(msg)) {
    return "Product ID can only use letters, numbers, spaces, - _ or . (e.g. sauvage-edp).";
  }
  if (code === "23514")
    return "Some fields have invalid values. Please check numbers and ranges.";
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return "Can't reach the database right now. Check your internet connection and try again.";
  }
  return msg;
}

/* ---------------------------------------------------------
   ROW ⇄ APP OBJECT MAPPING
   (database uses snake_case, the site uses camelCase)
--------------------------------------------------------- */

function productFromRow(r) {
  return {
    id: r.id,
    name: r.name,
    cat: r.cat,
    price: Number(r.price),
    stock: r.stock,
    sortOrder: r.sort_order,
    img: r.img,
    desc: r.descr,
    descLong: r.desc_long,
    topNotes: r.top_notes || [],
    heartNotes: r.heart_notes || [],
    baseNotes: r.base_notes || [],
    application: r.application,
    profiles: r.profiles || [],
    longevity: r.longevity,
    projection: r.projection,
    strength: r.strength,
    time: r.time || [],
    occasion: r.occasion,
    badges: r.badges || [],
    active: r.active,
  };
}

function productToRow(p) {
  const stockText = String(p.stock ?? "").trim();
  return {
    id: String(p.id || "").trim() || slugify(p.name),
    name: String(p.name || "").trim(),
    cat: ["men", "women", "unisex"].includes(p.cat) ? p.cat : "men",
    price: Math.max(0, toNum(p.price, 430)),
    stock: stockText === "" ? null : Math.max(0, toInt(stockText, 0)),
    sort_order: toInt(p.sortOrder, 0),
    img: String(p.img || "").trim(),
    descr: String(p.desc || ""),
    desc_long: String(p.descLong || ""),
    top_notes: toList(p.topNotes),
    heart_notes: toList(p.heartNotes),
    base_notes: toList(p.baseNotes),
    application: String(p.application || ""),
    profiles: toList(p.profiles),
    longevity: clamp(toInt(p.longevity, 7), 1, 10),
    projection: clamp(toInt(p.projection, 7), 1, 10),
    strength: normalizeStrength(p.strength),
    time: toList(p.time),
    occasion: String(p.occasion || ""),
    badges: toList(p.badges).map((b) => b.toUpperCase()),
    active: toBool(p.active, true),
  };
}

function promotionFromRow(r) {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    minQty: r.min_qty,
    fixedTotal: Number(r.fixed_total),
    percentOff: Number(r.percent_off),
    active: r.active,
  };
}

function orderFromRow(r) {
  return {
    orderId: r.order_id,
    fullname: r.fullname,
    contact: r.contact,
    items: Array.isArray(r.items) ? r.items : [],
    scent: r.scent,
    qty: r.quantity,
    address: r.address,
    payment: r.payment,
    notes: r.notes,
    subtotal: Number(r.subtotal),
    discount: Number(r.discount),
    total: Number(r.total),
    promotion: r.promotion_name,
    status: r.status,
    timestamp: r.created_at,
  };
}

function reviewFromRow(r) {
  return {
    id: r.id,
    name: r.name,
    customerName: r.name,
    scent: r.scent,
    scentId: r.scent_id,
    rating: r.rating,
    review: r.review,
    photoUrl: r.photo_url,
    approved: r.approved,
    timestamp: r.created_at,
  };
}

// The admin form expects settings values as strings ("true"/"false").
function settingsOut(data = {}) {
  const out = {};
  Object.entries(data || {}).forEach(([k, v]) => {
    out[k] = String(v);
  });
  return out;
}

function settingsIn(data = {}) {
  return {
    lowStockThreshold: Math.max(0, toInt(data.lowStockThreshold, 5)),
    showBestSellers: toBool(data.showBestSellers),
    showFeatured: toBool(data.showFeatured),
    showNewArrivals: toBool(data.showNewArrivals),
    showSignature: toBool(data.showSignature),
  };
}

// Works on plain http too (crypto.randomUUID needs https).
function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return res.blob();
}

function ok(extra = {}) {
  return { success: true, ...extra };
}

function must({ data, error }) {
  if (error) throw error;
  return data;
}

/* ---------------------------------------------------------
   ACTIONS
--------------------------------------------------------- */

const actions = {
  /* ===== Storefront (public) ===== */

  async products(db) {
    const rows = must(
      await db.from("products").select("*").order("sort_order").order("name"),
    );
    return ok({ products: rows.map(productFromRow) });
  },

  async promotions(db) {
    const rows = must(
      await db
        .from("promotions")
        .select("*")
        .eq("active", true)
        .order("min_qty"),
    );
    return ok({ promotions: rows.map(promotionFromRow) });
  },

  async settings(db) {
    const row = must(
      await db.from("site_settings").select("data").eq("id", 1).maybeSingle(),
    );
    return ok({ settings: settingsOut(row?.data) });
  },

  async reviews(db) {
    const rows = must(
      await db
        .from("reviews")
        .select("*")
        .eq("approved", true)
        .order("created_at", { ascending: false })
        .limit(30),
    );
    return ok({ reviews: rows.map(reviewFromRow) });
  },

  async trackOrder(db, p) {
    return must(
      await db.rpc("track_order", {
        p_order_id: String(p.orderId || ""),
        p_contact: String(p.contact || ""),
      }),
    );
  },

  // Called with no "action" — the checkout form.
  async placeOrder(db, p) {
    const items = parseJSON(p.items, [])
      .map((i) => ({ id: String(i.id || ""), qty: toInt(i.qty, 0) }))
      .filter((i) => i.id && i.qty > 0);

    return must(
      await db.rpc("place_order", {
        p_fullname: String(p.fullname || ""),
        p_contact: String(p.contact || ""),
        p_items: items,
        p_address: String(p.address || ""),
        p_payment: String(p.payment || ""),
        p_notes: String(p.notes || ""),
      }),
    );
  },

  async submitReview(db, p) {
    let photoUrl = null;

    if (p.photo) {
      const blob = await dataUrlToBlob(p.photo);
      const path = `pending/${randomId()}.jpg`;
      must(
        await db.storage.from(REVIEW_BUCKET).upload(path, blob, {
          contentType: "image/jpeg",
          upsert: false,
        }),
      );
      photoUrl = db.storage.from(REVIEW_BUCKET).getPublicUrl(path)
        .data.publicUrl;
    }

    return must(
      await db.rpc("submit_review", {
        p_name: String(p.name || ""),
        p_scent: String(p.scent || ""),
        p_scent_id: String(p.scentId || ""),
        p_rating: toInt(p.rating, 5),
        p_review: String(p.review || ""),
        p_photo_url: photoUrl,
      }),
    );
  },

  /* ===== Admin (requires a signed-in admin) ===== */

  async adminLogin(db, p) {
    const email = String(p.identifier || p.email || "").trim();
    const { error } = await db.auth.signInWithPassword({
      email,
      password: String(p.password || ""),
    });
    if (error) {
      return {
        success: false,
        message: /invalid/i.test(error.message)
          ? "Incorrect email or password."
          : error.message,
      };
    }
    const isAdmin = must(await db.rpc("is_admin"));
    if (!isAdmin) {
      await db.auth.signOut();
      return { success: false, message: "This account is not an admin." };
    }
    return ok();
  },

  async adminLogout(db) {
    await db.auth.signOut();
    return ok();
  },

  async adminSession(db) {
    const { data } = await db.auth.getSession();
    if (!data?.session) return { success: false, message: "Not signed in." };
    const isAdmin = must(await db.rpc("is_admin"));
    return isAdmin
      ? ok({ email: data.session.user?.email || "" })
      : { success: false, message: "This account is not an admin." };
  },

  async adminDashboard(db) {
    const data = must(await db.rpc("admin_dashboard"));
    return ok({ ...data, settings: settingsOut(data?.settings) });
  },

  async adminOrders(db) {
    const rows = must(
      await db
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(2000),
    );
    return ok({ orders: rows.map(orderFromRow) });
  },

  async adminUpdateOrderStatus(db, p) {
    const rows = must(
      await db
        .from("orders")
        .update({ status: String(p.status) })
        .eq("order_id", String(p.orderId))
        .select("order_id"),
    );
    if (!rows.length) return { success: false, message: "Order not found." };
    return ok();
  },

  async adminProducts(db) {
    return actions.products(db);
  },

  async adminSeedProducts(db, p) {
    const rows = parseJSON(p.products, [])
      .map(productToRow)
      .filter((r) => r.id && r.name);
    if (!rows.length) return ok({ inserted: 0 });
    // Only adds products that don't exist yet — never overwrites your edits.
    must(
      await db
        .from("products")
        .upsert(rows, { onConflict: "id", ignoreDuplicates: true }),
    );
    return ok({ inserted: rows.length });
  },

  async adminSaveProduct(db, p) {
    const row = productToRow(p);
    if (!row.id || !row.name)
      return { success: false, message: "Product ID and name are required." };

    const originalId = String(p.originalId || "").trim();

    if (originalId && originalId !== row.id) {
      // Renaming an existing product's ID
      const rows = must(
        await db.from("products").update(row).eq("id", originalId).select("id"),
      );
      if (!rows.length)
        return { success: false, message: "Original product not found." };
    } else {
      must(await db.from("products").upsert(row, { onConflict: "id" }));
    }
    return ok();
  },

  async adminDeleteProduct(db, p) {
    must(await db.from("products").delete().eq("id", String(p.id)));
    return ok();
  },

  async adminPromotions(db) {
    const rows = must(
      await db.from("promotions").select("*").order("min_qty").order("name"),
    );
    return ok({ promotions: rows.map(promotionFromRow) });
  },

  async adminSavePromotion(db, p) {
    const row = {
      name: String(p.name || "").trim(),
      type: p.type === "percent" ? "percent" : "fixed_total",
      min_qty: Math.max(1, toInt(p.minQty, 2)),
      fixed_total: Math.max(0, toNum(p.fixedTotal, 0)),
      percent_off: clamp(toNum(p.percentOff, 0), 0, 100),
      active: toBool(p.active, true),
    };
    if (!row.name)
      return { success: false, message: "Promotion name is required." };

    if (p.id) {
      must(await db.from("promotions").update(row).eq("id", String(p.id)));
    } else {
      must(await db.from("promotions").insert(row));
    }
    return ok();
  },

  async adminDeletePromotion(db, p) {
    must(await db.from("promotions").delete().eq("id", String(p.id)));
    return ok();
  },

  async adminSettings(db) {
    return actions.settings(db);
  },

  async adminSaveSettings(db, p) {
    const data = settingsIn(parseJSON(p.settings, {}));
    const rows = must(
      await db.from("site_settings").update({ data }).eq("id", 1).select("id"),
    );
    if (!rows.length)
      return {
        success: false,
        message: "Settings row is missing. Re-run supabase/schema.sql.",
      };
    return ok({ settings: settingsOut(data) });
  },

  async adminAudit(db) {
    const rows = must(
      await db
        .from("audit_log")
        .select("*")
        .order("id", { ascending: false })
        .limit(300),
    );
    return ok({
      logs: rows.map((r) => ({
        timestamp: r.created_at,
        actor: r.actor,
        action: r.action,
        details: r.details,
      })),
    });
  },

  async adminReviews(db) {
    const rows = must(
      await db
        .from("reviews")
        .select("*")
        .order("approved")
        .order("created_at", { ascending: false })
        .limit(500),
    );
    return ok({ reviews: rows.map(reviewFromRow) });
  },

  async adminSetReviewApproved(db, p) {
    must(
      await db
        .from("reviews")
        .update({ approved: toBool(p.approved, false) })
        .eq("id", String(p.id)),
    );
    return ok();
  },

  async adminDeleteReview(db, p) {
    const row = must(
      await db
        .from("reviews")
        .delete()
        .eq("id", String(p.id))
        .select("photo_url")
        .maybeSingle(),
    );
    const marker = `/object/public/${REVIEW_BUCKET}/`;
    const url = row?.photo_url || "";
    if (url.includes(marker)) {
      // Best effort: also remove the photo file.
      await db.storage.from(REVIEW_BUCKET).remove([url.split(marker)[1]]);
    }
    return ok();
  },
};

/* ---------------------------------------------------------
   PUBLIC CLIENT
   Same get()/post() interface as the old ApiClient.
--------------------------------------------------------- */

export class SupabaseApi {
  async call(params = {}) {
    const action = params.action || "placeOrder";
    const handler = actions[action];

    if (!handler) {
      return { success: false, message: `Unknown action: ${action}` };
    }

    try {
      const db = getSupabase();
      const result = await handler(db, params);
      return result && typeof result === "object" ? result : ok();
    } catch (error) {
      console.error(`[Supabase] ${action} failed:`, error);
      return { success: false, message: friendlyError(error) };
    }
  }

  get(params = {}) {
    return this.call(params);
  }

  post(params = {}) {
    return this.call(params);
  }

  // Calls `callback` whenever an order is created or changed (admins only).
  // Returns a function that stops listening.
  onOrdersChange(callback) {
    try {
      const db = getSupabase();
      const channel = db
        .channel("admin-orders")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "orders" },
          () => callback(),
        )
        .subscribe();
      return () => db.removeChannel(channel);
    } catch {
      return () => {};
    }
  }
}

// Backwards-compatible name used by admin.js
export { SupabaseApi as ApiClient };
