/* =========================================================
   AURA & ESSENCE — premium UI behaviour (loaded after app.js)
   • "Shop by feel" and "Scent finder" share one spot (tabs)
   • Scent finder runs as steps, one question at a time
   • FAQ shows the first questions, the rest on request
   • Brand film is hidden if its files are missing
   • Mobile checkout: total + next step stay at the bottom
   Nothing here changes orders, prices or stock.
========================================================= */

const $ = (sel, root = document) => root.querySelector(sel);

/* ---------- Shop by feel | Scent finder (tabs) ---------- */
function initDiscover() {
  const feel = $("#shopByFeel");
  const finder = $("#scentFinder");
  if (!feel || !finder || $("#discoverTabs")) return;

  const bar = document.createElement("div");
  bar.className = "discover-tabs";
  bar.id = "discoverTabs";
  bar.innerHTML = `
    <div class="seg" role="tablist" aria-label="Find your scent">
      <button type="button" role="tab" id="tabFeel" aria-controls="shopByFeel" aria-selected="true">Shop by feel</button>
      <button type="button" role="tab" id="tabFinder" aria-controls="scentFinder" aria-selected="false">Take the quiz</button>
    </div>`;
  feel.before(bar);

  const tabFeel = $("#tabFeel");
  const tabFinder = $("#tabFinder");

  function show(which, scroll) {
    const quiz = which === "finder";
    feel.hidden = quiz;
    finder.hidden = !quiz;
    tabFeel.setAttribute("aria-selected", String(!quiz));
    tabFinder.setAttribute("aria-selected", String(quiz));
    if (scroll) bar.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  tabFeel.addEventListener("click", () => show("feel"));
  tabFinder.addEventListener("click", () => show("finder"));
  bar.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const toQuiz = tabFeel.getAttribute("aria-selected") === "true";
      show(toQuiz ? "finder" : "feel");
      (toQuiz ? tabFinder : tabFeel).focus();
    }
  });

  // Links like "Find scent" in the menu / bottom bar open the right tab
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href="#scentFinder"], a[href="#shopByFeel"]');
    if (!a) return;
    e.preventDefault();
    show(a.getAttribute("href") === "#scentFinder" ? "finder" : "feel", true);
  });

  show(location.hash === "#scentFinder" ? "finder" : "feel", location.hash === "#scentFinder");
}

/* ---------- Scent finder as steps ---------- */
function initWizard() {
  const sec = $("#scentFinder");
  const grid = sec && $(".feature-grid", sec);
  if (!grid || sec.classList.contains("sf-wizard")) return;
  const cards = [...grid.children].filter((c) => c.classList.contains("feature-card") && c.querySelector(".quiz-options"));
  if (cards.length < 3) return;
  sec.classList.add("sf-wizard");

  const prog = document.createElement("div");
  prog.className = "sf-progress";
  prog.innerHTML = `<span id="sfLabel"></span><span class="bar"><i id="sfBar"></i></span>`;
  const nav = document.createElement("div");
  nav.className = "sf-nav";
  nav.innerHTML = `<button type="button" class="sf-back" id="sfBack">← Back</button><button type="button" class="btn-primary" id="sfNext">Next</button>`;
  grid.before(prog);
  grid.after(nav);

  let step = 0;
  function go(n) {
    step = Math.max(0, Math.min(cards.length - 1, n));
    cards.forEach((c, i) => c.classList.toggle("sf-on", i === step));
    $("#sfLabel").textContent = `Question ${step + 1} of ${cards.length}`;
    $("#sfBar").style.width = `${((step + 1) / cards.length) * 100}%`;
    $("#sfBack").hidden = step === 0;
    $("#sfNext").hidden = step !== 1;          // question 2 allows several answers, so it needs "Next"
  }

  $("#sfBack").addEventListener("click", () => go(step - 1));
  $("#sfNext").addEventListener("click", () => go(step + 1));
  // Question 1 is a single choice: move on by itself
  cards[0].addEventListener("click", (e) => {
    if (e.target.closest(".quiz-option")) setTimeout(() => go(1), 260);
  });
  // Question 3 is a single choice too; "Reveal my scent" is on that card
  go(0);
}

/* ---------- FAQ: first four, rest on request ---------- */
function initFaq() {
  const list = $("#faqList");
  if (!list || list.dataset.trim) return;
  list.dataset.trim = "1";
  const LIMIT = 4;
  let expanded = false;
  let btn = null;

  function apply() {
    const count = list.children.length;
    if (count <= LIMIT) {
      list.classList.remove("is-trim");
      btn?.remove();
      btn = null;
      return;
    }
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "faq-more";
      btn.addEventListener("click", () => { expanded = !expanded; apply(); });
      list.after(btn);
    }
    list.classList.toggle("is-trim", !expanded);
    btn.textContent = expanded ? "Show fewer questions" : `Show all ${count} questions`;
    btn.setAttribute("aria-expanded", String(expanded));
  }

  new MutationObserver(apply).observe(list, { childList: true });
  apply();
}

/* ---------- Brand film: hide the block if its files are missing ---------- */
function initFilm() {
  const fig = $("#houseFilm");
  const video = $("#filmVideo");
  if (!fig || !video) return;
  const poster = video.getAttribute("poster") || video.dataset.widePoster;
  const mp4 = video.dataset.wide;

  const probePoster = () => new Promise((resolve) => {
    if (!poster) return resolve(false);
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = poster;
  });
  const probeVideo = () => mp4
    ? fetch(mp4, { method: "HEAD" }).then((r) => r.ok).catch(() => false)
    : Promise.resolve(false);

  Promise.all([probePoster(), probeVideo()]).then(([hasPoster, hasVideo]) => {
    if (!hasPoster && !hasVideo) fig.remove();
  });
}

/* ---------- Mobile checkout: sticky total + next step ---------- */
function initCheckoutBar() {
  const sheet = $("#order");
  if (!sheet || $("#coSticky")) return;

  const bar = document.createElement("div");
  bar.className = "co-sticky";
  bar.id = "coSticky";
  bar.innerHTML = `
    <div class="co-sticky-total"><small>Total</small><b id="coStickyTotal">₱0</b></div>
    <button type="button" class="submit" id="coStickyBtn">Continue</button>`;
  sheet.appendChild(bar);
  document.documentElement.classList.add("has-co-sticky");

  const btn = $("#coStickyBtn");
  const primary = () => {
    const panel = sheet.querySelector(".co-panel:not([hidden])");
    return panel && (panel.querySelector(".co-next") || panel.querySelector("#submitBtn"));
  };

  function sync() {
    $("#coStickyTotal").textContent = $("#cartTotal")?.textContent || "₱0";
    const p = primary();
    btn.hidden = !p;
    if (p) btn.textContent = p.textContent.trim();
  }

  btn.addEventListener("click", () => primary()?.click());

  // Watch only the things that change (never our own bar, so there is no loop)
  const watch = new MutationObserver(sync);
  const total = $("#cartTotal");
  if (total) watch.observe(total, { childList: true, characterData: true, subtree: true });
  sheet.querySelectorAll(".co-panel").forEach((p) => watch.observe(p, { attributes: true, attributeFilter: ["hidden"] }));
  const submit = $("#submitBtn");
  if (submit) watch.observe(submit, { childList: true, characterData: true, subtree: true });
  sync();
}

function init() {
  initDiscover();
  initWizard();
  initFaq();
  initFilm();
  initCheckoutBar();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
