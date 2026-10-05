/**
 * AURA & ESSENCE
 * Product model + seed catalog.
 */

export class Product {
  constructor(data = {}) {
    Object.assign(this, data);
  }

  get isAvailable() {
    return this.active !== false && Number(this.stock ?? 1) > 0;
  }

  get priceValue() {
    return Number(this.price || 430);
  }
}

export const PRODUCTS = [
  {
    id: "sauvage",
    name: "Sauvage",
    cat: "men",
    desc: "Fresh, woody-ambery — a bold everyday classic.",
    img: "assets/images/sauvage.jpg",
    descLong:
"Sauvage opens with a bright, citrusy burst that feels fresh, clean, and immediately noticeable. As it settles, the freshness becomes more aromatic and slightly spicy, creating a smooth transition into a warm ambery-woody trail. The result is a versatile profile that works especially well when you want a crisp, confident scent without feeling overly sweet.",
    topNotes: ["Calabrian Bergamot", "Pepper"],
    heartNotes: ["Elemi", "Lavender", "Geranium"],
    baseNotes: ["Ambroxan", "Cedar", "Labdanum"],
    application:
"For a balanced everyday application, spray lightly on the neck and chest, then add one spray to clothing from a short distance. For a stronger trail, use the pulse points behind the ears and inner elbows. Avoid rubbing after spraying so the fragrance can develop naturally.",
    occasion: "Daily • Office • Commute • Night Out",
  },
  {
    id: "invictus",
    name: "Invictus",
    cat: "men",
    desc: "Aquatic-woody, energetic and youthful.",
    img: "assets/images/invictus.jpg",
    descLong:
"Invictus is built around a bright aquatic freshness with a sporty, energetic character. Its opening feels crisp and refreshing, while the heart introduces a cleaner aromatic-floral side before settling into a warmer woody-ambery base. It is an easy choice when you want a youthful scent that feels fresh in the daytime and still has enough presence for casual evenings.",
    topNotes: ["Grapefruit", "Marine Accord", "Bay Leaf"],
    heartNotes: ["Jasmine", "Hedione", "Violet Leaf"],
    baseNotes: ["Guaiac Wood", "Patchouli", "Amber Accord"],
    application:
"Start with 2 sprays on the neck and 1 on the chest. For outdoor use, add one spray to the back of the neck or clothing. Because the profile is fresh and airy, avoid overspraying in small enclosed rooms.",
    occasion: "Daily • Gym/Active Days • Outdoor • Casual Date",
  },
  {
    id: "strongerwithyou",
    name: "Stronger With You",
    cat: "men",
    desc: "Warm spicy-vanilla, magnetic and modern.",
    img: "assets/images/strongerwithyou.jpg",
    descLong:
"Stronger With You combines a warm spicy opening with a rich, sweet gourmand character. The chestnut and spice create a cozy first impression, followed by an aromatic heart that keeps the sweetness from becoming too heavy. As it dries down, vanilla and warm woods create a soft, comforting trail that is especially suited to cooler weather and intimate settings.",
    topNotes: ["Pink Pepper", "Cardamom", "Chestnut Accord"],
    heartNotes: ["Sage", "Lavender", "Violet Leaf"],
    baseNotes: ["Vanilla", "Tonka Bean", "Amberwood", "Cedar"],
    application:
"Use fewer sprays because the warm-sweet profile can build quickly. Try 1 spray on each side of the neck and 1 on the chest. For a date-night application, add one light spray to clothing rather than repeatedly spraying the skin.",
    occasion: "Date Night • Evening • Cool Weather • Special Occasions",
  },
  {
    id: "aquadigio",
    name: "Aqua Di Gio",
    cat: "men",
    desc: "Crisp aquatic-citrus, clean and fresh.",
    img: "assets/images/aquadigio.jpg",
    descLong:
"Aqua Di Gio is a clean aquatic-citrus fragrance inspired by the freshness of the sea and Mediterranean air. The opening is bright and sparkling, then develops into a transparent marine-aromatic heart with a subtle earthy depth. The dry-down becomes smoother and woody, leaving a clean scent that feels especially natural in warm weather.",
    topNotes: ["Bergamot", "Neroli", "Green Mandarin"],
    heartNotes: ["Marine Accord", "Rosemary", "Persimmon"],
    baseNotes: ["Patchouli", "Cedarwood", "Musk"],
    application:
"For hot and humid days, start with 2–3 sprays on the neck and inner elbows. A light spray on the shirt can help create a fresh aura around you. Reapply lightly rather than using many sprays at once, especially during long outdoor days.",
    occasion: "Hot Weather • Office • Beach/Outdoor • Everyday",
  },
  {
    id: "eros",
    name: "Eros",
    cat: "men",
    desc: "Minty-vanilla with a woody trail, confident and magnetic.",
    img: "assets/images/eros.jpg",
    descLong:
"Eros opens with a lively combination of citrus, mint, and sweet apple that gives it an energetic first impression. The heart becomes more aromatic and slightly floral, while the dry-down develops into a creamy, sweet, woody trail with vanilla and earthy woods. The contrast between freshness and sweetness gives Eros a noticeable, playful character that suits social occasions particularly well.",
    topNotes: ["Italian Lemon", "Mandarin", "Mint", "Candied Apple"],
    heartNotes: ["Geranium", "Clary Sage", "Amber Accord"],
    baseNotes: [
"Cedarwood",
"Vetiver",
"Patchouli",
"Sandalwood",
"Vanilla",
    ],
    application:
"Try 2 sprays on the neck, 1 on the chest, and 1 behind the ears. For a stronger evening presence, add one light spray to clothing. Avoid rubbing the wrists together after application.",
    occasion: "Date Night • Parties • Night Out • Casual Wear",
  },
  {
    id: "missdior",
    name: "Miss Dior",
    cat: "women",
    desc: "Floral-fruity, romantic and elegant.",
    img: "assets/images/missdior.jpg",
    descLong:
"Miss Dior presents a polished floral profile with a bright, romantic opening and a soft, elegant heart. The floral bouquet feels feminine and refined rather than sharp, while the base adds a smooth, creamy warmth that gives the fragrance more depth. It is a versatile style for someone who wants a clean, dressed-up floral scent that can move easily from daytime to evening.",
    topNotes: ["Citrus", "Mandarin", "Bergamot"],
    heartNotes: ["Grasse Rose", "Peony", "Lily of the Valley", "Iris"],
    baseNotes: ["Vanilla", "Sandalwood", "Tonka Bean", "Musk"],
    application:
"For daytime, use 2 sprays on the neck and one behind each ear. For a softer effect, spray once into the air and walk through the mist. For evenings, add a light spray to the inner elbows or clothing from a distance.",
    occasion: "Office • Brunch • Date • Formal Events",
  },
  {
    id: "blackop",
    name: "YSL Black Opium",
    cat: "women",
    desc: "Sweet coffee-vanilla gourmand, seductive.",
    img: "assets/images/blackop.jpg",
    descLong:
"Black Opium is a warm coffee-floral gourmand built around the contrast between dark roasted coffee, luminous white flowers, and a sensual vanilla base. The opening has an energetic, slightly edgy character before the floral heart softens it. As it dries down, the vanilla and woody facets become warmer and smoother, creating a rich, cozy trail that is especially suited to evenings.",
    topNotes: ["Pear", "Pink Pepper", "Orange Blossom"],
    heartNotes: ["Coffee", "Jasmine", "Bitter Almond", "Licorice"],
    baseNotes: ["Vanilla", "Patchouli", "Cedarwood", "Cashmere Wood"],
    application:
"Use 2 sprays on the neck and 1 on the chest for a balanced scent. For a longer evening trail, add one spray to the inner elbows and a light mist on clothing. Because the scent is rich and sweet, start light and build only if needed.",
    occasion: "Date Night • Evening • Events • Cool Weather",
  },
  {
    id: "valaya",
    name: "Valaya",
    cat: "women",
    desc: "Warm floral-oriental, graceful and refined.",
    img: "assets/images/valaya.jpg",
    descLong:
"Valaya has a clean, airy elegance that combines sparkling citrus and juicy white peach with a soft bouquet of white flowers. The heart feels creamy and luminous, while the musky woody base gives the fragrance a smooth veil-like finish. The overall effect is delicate but distinctive—fresh enough for daytime while still feeling refined and sensual.",
    topNotes: ["Bergamot", "Mandarin", "White Peach"],
    heartNotes: ["Orange Blossom", "White Flowers"],
    baseNotes: ["White Musks", "Akigalawood", "Vanilla", "Vetiver"],
    application:
"Apply 2 sprays to the neck and 1 to the inner elbows for a soft, elegant trail. For a clean linen-like effect, add one light spray to clothing from a distance. Avoid overspraying; the airy character works best when it has room to move.",
    occasion: "Daytime • Brunch • Office • Elegant Events",
  },
  {
    id: "paradoxe",
    name: "Paradoxe",
    cat: "women",
    desc: "Floral-musky, soft yet daring.",
    img: "assets/images/paradoxe.jpg",
    descLong:
"Paradoxe balances a crisp floral opening with a warm, modern ambery heart and a soft musky trail. The first impression is bright and clean, then the fragrance becomes warmer and more enveloping as it develops. Its contrast between freshness, floral radiance, and warm musk gives it a polished character that works across both daytime and evening settings.",
    topNotes: ["Neroli Bud"],
    heartNotes: ["Ambrofix™", "White Floral Accord"],
    baseNotes: ["Serenolide™", "Musk", "Amber"],
    application:
"For a polished daytime scent, use 2 sprays on the neck and one on the inner elbow. For stronger longevity, focus on the warm areas such as the neck, inner elbows, and behind the knees. Do not rub the fragrance after spraying.",
    occasion: "Office • Date • Day-to-Night • Special Events",
  },
  {
    id: "eclat",
    name: "Eclat",
    cat: "women",
    desc: "Fresh floral-fruity, delicate and luminous.",
    img: "assets/images/eclat.jpg",
    descLong:
"Eclat d'Arpege is a light, airy floral fragrance with a fresh green opening and a delicate fruity-floral heart. Its character is soft, clean, and luminous, making it easy to wear when you want something understated rather than heavy. The musky woody base keeps the scent smooth and close to the skin as it dries down.",
    topNotes: ["Green Lilac", "Lemon Leaves"],
    heartNotes: ["Peach Blossom", "Wisteria", "Green Tea", "Peony"],
    baseNotes: ["White Cedar", "Amber", "Musk"],
    application:
"For a subtle everyday effect, use 2 sprays on the neck and one behind each ear. For a fresh all-over impression, spray lightly on clothing from a distance. Reapply lightly during the day instead of applying many sprays at once.",
    occasion: "Daily • Office • School • Casual Daytime",
  },
];

export const PRODUCT_PRICE = 430;

export const PRODUCT_META = {
  sauvage: { profiles:["fresh","woody"], occasion:["day","office","night"], strength:"bold", longevity:8, projection:8, time:["day","night"], badges:["FEATURED"] },
  invictus: { profiles:["fresh","sweet"], occasion:["day","outdoor"], strength:"moderate", longevity:7, projection:7, time:["day"], badges:[] },
  strongerwithyou: { profiles:["sweet","warm"], occasion:["night"], strength:"bold", longevity:9, projection:8, time:["night"], badges:["FEATURED"] },
  aquadigio: { profiles:["fresh","woody"], occasion:["day","office","outdoor"], strength:"moderate", longevity:7, projection:6, time:["day"], badges:[] },
  eros: { profiles:["fresh","sweet","woody"], occasion:["night","outdoor"], strength:"bold", longevity:8, projection:9, time:["day","night"], badges:["FEATURED"] },
  missdior: { profiles:["floral","sweet"], occasion:["day","office","night"], strength:"moderate", longevity:7, projection:6, time:["day","night"], badges:[] },
  blackop: { profiles:["sweet","warm","floral"], occasion:["night"], strength:"bold", longevity:9, projection:8, time:["night"], badges:["FEATURED"] },
  valaya: { profiles:["floral","fresh"], occasion:["day","office"], strength:"subtle", longevity:7, projection:6, time:["day"], badges:["SIGNATURE"] },
  paradoxe: { profiles:["floral","warm"], occasion:["office","night"], strength:"moderate", longevity:8, projection:7, time:["day","night"], badges:["SIGNATURE"] },
  eclat: { profiles:["floral","fresh"], occasion:["day","office"], strength:"subtle", longevity:6, projection:5, time:["day"], badges:[] }
};
