/* ============================================================
   AURA & ESSENCE
   PROFILE SYNC
   ============================================================ */

(() => {

  "use strict";


  /* ----------------------------------------------------------
     STRENGTH NORMALIZATION
     ---------------------------------------------------------- */

  function normalizeStrength(value) {

    const strength =
      String(value || "")
        .trim()
        .toLowerCase();


    if (strength === "light") {
      return "subtle";
    }


    if (strength === "strong") {
      return "bold";
    }


    if (
      strength === "subtle" ||
      strength === "moderate" ||
      strength === "bold"
    ) {
      return strength;
    }


    return "moderate";
  }


  /* ----------------------------------------------------------
     STRENGTH SCORE
     ---------------------------------------------------------- */

  function getStrengthScore(value) {

    const strength =
      normalizeStrength(value);


    const scores = {
      subtle: 4,
      moderate: 7,
      bold: 10
    };


    return scores[strength] || 7;
  }


  /* ----------------------------------------------------------
     STRENGTH LABEL
     ---------------------------------------------------------- */

  function getStrengthLabel(value) {

    const strength =
      normalizeStrength(value);


    const labels = {
      subtle: "Subtle",
      moderate: "Moderate",
      bold: "Bold"
    };


    return labels[strength] || "Moderate";
  }


  /* ----------------------------------------------------------
     CLEAN PROFILE TEXT
     ---------------------------------------------------------- */

  function getProfiles(meta) {

    if (!meta) {
      return [];
    }


    /*
      Profiles can come from:

      1. Supabase
      2. Admin
      3. products.js

      Accepted format:

      Fresh, Sweet, Woody

      or

      ["Fresh", "Sweet", "Woody"]
    */


    if (Array.isArray(meta.profiles)) {

      return meta.profiles
        .map(profile =>
          String(profile).trim()
        )
        .filter(Boolean);

    }


    if (
      typeof meta.profiles === "string"
    ) {

      return meta.profiles
        .split(",")
        .map(profile =>
          profile.trim()
        )
        .filter(Boolean);

    }


    return [];

  }


  /* ----------------------------------------------------------
     ESCAPE HTML
     ---------------------------------------------------------- */

  function escapeHTML(value) {

    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

  }


  /* ----------------------------------------------------------
     RENDER PROFILE DISPLAY
     ---------------------------------------------------------- */

  function renderProfileDisplay(productId) {

    /*
      Wait until the main website has loaded its catalog.
    */

    if (
      typeof window.catalog === "undefined" &&
      typeof catalog === "undefined"
    ) {
      return;
    }


    let product = null;


    try {

      if (
        typeof window.getProductById ===
        "function"
      ) {

        product =
          window.getProductById(productId);

      }

    } catch (_) {}


    if (!product) {
      return;
    }


    const meta =
      window.PRODUCT_META?.[product.id] ||
      window.PRODUCT_META?.[productId] ||
      product ||
      {};


    const container =
      document.getElementById(
        "fragranceProfileBars"
      );


    if (!container) {
      return;
    }


    /* --------------------------------------------------------
       PROFILES
       -------------------------------------------------------- */

    const profiles =
      getProfiles(meta);


    const profileHTML =
      profiles.length

        ? profiles
            .map(profile => `
              <span class="profile-tag">
                ${escapeHTML(profile)}
              </span>
            `)
            .join("")

        : `
            <span class="profile-tag">
              No profile listed
            </span>
          `;


    /* --------------------------------------------------------
       LONGEVITY
       -------------------------------------------------------- */

    const longevity =
      Math.max(
        0,
        Math.min(
          10,
          Number(meta.longevity) || 7
        )
      );


    /* --------------------------------------------------------
       STRENGTH
       -------------------------------------------------------- */

    const strength =
      normalizeStrength(
        meta.strength
      );


    const strengthScore =
      getStrengthScore(strength);


    const strengthLabel =
      getStrengthLabel(strength);


    /* --------------------------------------------------------
       FINAL DISPLAY
       -------------------------------------------------------- */

    container.innerHTML = `

      <div class="profile-section">

        <div class="profile-label">
          Scent Profile
        </div>

        <div class="profile-tags">
          ${profileHTML}
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
            style="width:${strengthScore * 10}%"
          ></span>

        </span>

        <span>
          ${escapeHTML(strengthLabel)}
        </span>

      </div>

    `;

  }


  /* ----------------------------------------------------------
     OVERRIDE THE EXISTING OPEN FUNCTION
     ---------------------------------------------------------- */

  function installProfileOverride() {

    /*
      The existing app.js already contains:

      openFragranceDetails(productId)

      We don't remove the original function.

      Instead, we wait for it to render and then replace
      only the profile section.
    */


    const original =
      window.openFragranceDetails;


    if (
      typeof original !== "function"
    ) {

      return false;

    }


    if (
      original.__auraEssenceProfileOverride
    ) {

      return true;

    }


    function overriddenOpenFragranceDetails(
      productId
    ) {

      /*
        Run the original Aura & Essence
        fragrance modal.
      */

      original.call(
        this,
        productId
      );


      /*
        Then replace the profile display
        with the new text + bars layout.
      */

      setTimeout(() => {

        renderProfileDisplay(
          productId
        );

      }, 0);

    }


    overriddenOpenFragranceDetails
      .__auraEssenceProfileOverride =
      true;


    window.openFragranceDetails =
      overriddenOpenFragranceDetails;


    return true;

  }


  /* ----------------------------------------------------------
     ADMIN STRENGTH NORMALIZATION
     ---------------------------------------------------------- */

  function normalizeAdminStrength() {

    const select =
      document.getElementById(
        "pStrength"
      );


    if (!select) {
      return;
    }


    /*
      Remove old values if they still exist.
    */

    const current =
      normalizeStrength(
        select.value
      );


    select.innerHTML = `

      <option value="subtle">
        Subtle
      </option>

      <option value="moderate">
        Moderate
      </option>

      <option value="bold">
        Bold
      </option>

    `;


    select.value =
      current;

  }


  /* ----------------------------------------------------------
     FIND MY SCENT NORMALIZATION
     ---------------------------------------------------------- */

  function normalizeQuizStrength() {

    const groups =
      document.querySelectorAll(
        '.quiz-options[data-question="strength"]'
      );


    if (!groups.length) {
      return;
    }


    groups.forEach(group => {

      const buttons =
        group.querySelectorAll(
          ".quiz-option"
        );


      buttons.forEach(button => {

        const value =
          normalizeStrength(
            button.dataset.value
          );


        button.dataset.value =
          value;


        if (
          value === "subtle"
        ) {

          button.textContent =
            "Subtle";

        }


        if (
          value === "moderate"
        ) {

          button.textContent =
            "Moderate";

        }


        if (
          value === "bold"
        ) {

          button.textContent =
            "Bold";

        }

      });

    });

  }


  /* ----------------------------------------------------------
     FIND MY SCENT ANSWER NORMALIZATION
     ---------------------------------------------------------- */

  function normalizeQuizAnswer() {

    if (
      typeof window.quizAnswers ===
      "undefined"
    ) {

      return;

    }


    if (
      window.quizAnswers.strength
    ) {

      window.quizAnswers.strength =
        normalizeStrength(
          window.quizAnswers.strength
        );

    }

  }


  /* ----------------------------------------------------------
     INITIALIZATION
     ---------------------------------------------------------- */

  function initialize() {

    normalizeAdminStrength();

    normalizeQuizStrength();

    installProfileOverride();

  }


  /* ----------------------------------------------------------
     DOM READY
     ---------------------------------------------------------- */

  if (
    document.readyState ===
    "loading"
  ) {

    document.addEventListener(
      "DOMContentLoaded",
      initialize
    );

  } else {

    initialize();

  }


  /* ----------------------------------------------------------
     RETRY
     app.js may load functions after
     DOMContentLoaded depending on module timing.
     ---------------------------------------------------------- */

  let attempts = 0;


  const retry =
    setInterval(() => {

      attempts++;


      installProfileOverride();

      normalizeAdminStrength();

      normalizeQuizStrength();


      if (
        attempts >= 20
      ) {

        clearInterval(retry);

      }

    }, 250);


})();
