# AURA & ESSENCE

Perfume storefront and admin panel. Static HTML/JS (no build step), with **Supabase** as the database, login, and photo storage.

## Project structure
`index.html` and `admin.html` must stay at the repository root.

```text
aura-essence/
├── index.html                  ← customer site
├── admin.html                  ← admin panel
├── assets/
│   ├── css/
│   ├── images/
│   └── js/
│       ├── supabase-config.js  ← paste your Supabase URL + key here
│       ├── supabase-api.js     ← all database calls
│       ├── app.js              ← storefront
│       ├── admin.js            ← admin panel
│       ├── admin-api.js
│       ├── products.js         ← built-in catalog (used to seed the database)
│       └── profile-sync.js
├── google-apps-script/
│   └── OrderEmailNotifier.gs   ← optional: emails you on every new order
└── supabase/
    ├── schema.sql              ← run once to create the database
    ├── import-step1-staging.sql
    └── import-step2-convert.sql
```

---

## 1. Create the Supabase project
1. Sign in at [supabase.com](https://supabase.com) → **New project**. Pick the **Southeast Asia (Singapore)** region for speed in the Philippines.
2. Open **SQL Editor → New query**, paste the whole of `supabase/schema.sql`, and click **Run**.
   This creates the tables, security rules, order/review functions, the review-photo bucket, and realtime for orders.

## 2. Create your admin account
1. **Authentication → Users → Add user → Create new user**. Enter your email and a strong password, and tick **Auto Confirm User**.
2. In **SQL Editor**, run (with your email):
   ```sql
   insert into public.admins (user_id, email)
   select id, email from auth.users where email = 'you@example.com';
   ```
   Only accounts listed in `admins` can open the admin panel. Repeat for each staff member.
3. Recommended: **Authentication → Sign In / Providers → Email**, turn **off** "Allow new users to sign up" so nobody else can create accounts.

## 3. Connect the website
1. **Project Settings → API** (or **API Keys**). Copy the **Project URL** and the **anon / publishable** key.
2. Paste both into `assets/js/supabase-config.js`.
   These two values are meant to be public. **Never** put the `service_role` / secret key in the website.
3. Commit and push. Vercel/GitHub Pages will redeploy automatically.

## 4. First admin login
Open `/admin.html` and sign in with the email and password from step 2. If the products table is empty, the catalog from `products.js` is added automatically.

---

## 5. Order email notifications (same email as before)
Every new order still emails you, using a tiny Apps Script mailer (free, uses your Gmail).
1. Follow the setup steps at the top of `google-apps-script/OrderEmailNotifier.gs`. Make a **new** Apps Script project for it, not your old backend.
2. Run the `insert into private.config …` query from that file in the Supabase SQL Editor.
3. Place a test order. The email arrives within a few seconds. If email isn't set up, orders still work; you just don't get the email.

## 6. Turn off the old Apps Script backend
Once the site runs on Supabase, open your old Apps Script project → **Deploy → Manage deployments → Archive**. Its URL was public in this repo, so leaving it live lets anyone keep writing to your sheets. Keep the spreadsheets themselves as a backup.

---

## Moving your data from Google Sheets
Do this after step 1 and before you start taking new orders.

Supabase's CSV upload only accepts column headers made of letters, numbers, `-` and `_`. Your sheet headers have spaces and `/`, so change **row 1** of each tab before downloading. Lowercase everything and use `_` instead of spaces.

| Tab | Upload into | Row 1 must be |
|---|---|---|
| Orders | `import_orders` | `timestamp, order_id, full_name, contact_number, scent, scent_id, quantity, delivery_meetup_location, payment_method, notes, price_per_bottle, estimated_total, status, items_json` |
| Products | `import_products` | `id, name, category, description, image_url, price, stock, badges, active, profiles, longevity, projection, strength, time, occasion, long_description, top_notes, heart_notes, base_notes, application, sort_order` |
| Promotions | `import_promotions` | `id, name, type, min_qty, fixed_total, percent_off, active` |
| Site Settings | `import_site_settings` | `key, value` |
| Admin Audit | `import_admin_audit` | `timestamp, actor, action` |
| Reviews (reviews spreadsheet) | `import_reviews` | `timestamp, review_id, customer_name, scent, scent_id, rating, review, photo_url, status` |

To avoid breaking your old site while it's still live, use **File → Make a copy** of each spreadsheet and rename the headers in the copy.

1. In **SQL Editor**, run `supabase/import-step1-staging.sql`.
2. In each tab, go to **File → Download → Comma-separated values (.csv)**. Make sure nothing is typed in the columns after the last header.
3. **Table Editor →** open each `import_*` table **→ Insert → Import data from CSV**.
4. In **SQL Editor**, run `supabase/import-step2-convert.sql`. It shows the counts, lists skipped product rows, and deletes the import tables.

What it keeps:
- **Order IDs, statuses, totals, items and dates.** Old IDs still work in Track Order, and phone numbers get back the leading 0 that Sheets removed.
- **Products, including IDs with spaces like "Clinique Happy".** The sheet overwrites the built-in catalog, and a blank Stock means unlimited.
- **Promotions** with the same IDs, **homepage settings** and **audit history**.
- **Reviews.** Only **Approved** ones are shown. Old `drive.google.com` photo links are converted so they display. Keep the Drive folder and its sharing as they are.

If dates come out wrong (day and month swapped), change `'ISO, MDY'` to `'ISO, DMY'` at the top of step 2.

---|---|---|
   | Main (orders) spreadsheet | Orders | `import_orders` |
   | | Products | `import_products` |
   | | Promotions | `import_promotions` |
   | | Site Settings | `import_site_settings` |
   | | Admin Audit | `import_admin_audit` |
   | Reviews spreadsheet | Reviews | `import_reviews` |

3. **Table Editor →** open each `import_*` table **→ Insert → Import data from CSV** and upload the matching file. The column names already match your sheets.
4. In **SQL Editor**, run `supabase/import-step2-convert.sql`. It shows how many rows were imported, lists any product rows it skipped, and deletes the import tables.

What it keeps:
- **Order IDs, statuses, totals, items and dates.** Old order IDs still work in Track Order.
- **Products.** Your sheet overwrites the built-in catalog, so prices, stock and badges are exactly as in the sheet. A blank Stock still means unlimited.
- **Promotions,** including the same IDs (like `two-bottle`).
- **Reviews.** Only ones with Status **Approved** are shown. Pending ones wait in the new Reviews tab.
- **Review photos stay in your Google Drive folder,** so don't delete that folder or change its sharing.
- **Homepage settings and the admin audit history.**

If dates come out wrong (day and month swapped), your sheet uses day/month format. Change `'ISO, MDY'` to `'ISO, DMY'` at the top of step 2 and run it again.

---

## What changed from Google Apps Script

**Security**
- Admin login uses Supabase Auth. The hardcoded password and admin key are gone, and no password is stored in the browser.
- Row Level Security: customers can only read products, active promotions, approved reviews, and settings. Orders, the audit log, and all edits are admin-only.
- **Order totals are calculated by the database.** It uses the real product prices and promotions, so a total can't be changed in the browser.
- Order tracking needs the Order ID **and** the matching contact number, and only shows the customer's first name.
- Basic spam limits: at most 5 orders per phone number per 10 minutes. Review photos must be JPEGs under 2 MB.

**Inventory**
- Stock is checked and reduced when an order is placed, and an order is refused if there isn't enough stock.
- Setting an order to **Cancelled** puts the bottles back in stock.

**Admin panel**
- New orders appear instantly (Supabase Realtime), with no 15-second polling.
- New **Reviews** tab to approve, hide, or delete customer reviews.
- The audit log is written by the database itself, so every admin change is recorded.
- Order IDs use the same format as before: `AE-20261005-143012-7F3A9C`.

**Kept the same as your Apps Script**
- The same order rules: up to 100 bottles per scent, stock is checked before saving, and the same "only N bottle(s) in stock" message.
- The same review rules: name, scent, rating, review and photo are required, up to 600 characters, saved as Pending until approved, and the newest 30 approved reviews are shown.
- The same dashboard numbers. Top 10 products include ones with 0 sales.
- The same order email layout.
- One deliberate difference: a fixed-total promo is only applied when it's lower than the regular price, which is what the cart already showed customers. The old script could charge the promo total even when it was higher.
- Exported order CSVs are protected from spreadsheet-formula tricks, like the old `clean_()` function did.

**Speed and reliability**
- No more Apps Script cold starts, 404 retries, or JSONP.

## Admin tools
After updating the site, run `supabase/schema.sql` once more in the SQL Editor. It's safe to re-run, and it adds what these tools need.

- **Product photos:** in Products → Edit, click **Upload photo**. Big photos are resized automatically and stored in Supabase Storage (the `product-images` bucket). Click **Save Product** afterwards.
- **Quick stock:** use **− / +** next to the stock number, or **Restock** to add several bottles at once. For unlimited (∞) products, **Set** starts tracking stock.
- **Revenue chart:** on the Dashboard. It follows the date range and groups by day, week or month depending on how long the range is.
- **Low-stock email:** you get an email when a product drops to the number in **Homepage → Email me when stock reaches** (default 1), and again when it sells out. It uses the same Apps Script mailer as order emails, so update `OrderEmailNotifier.gs` in Apps Script (**Deploy → Manage deployments → Edit → New version**).
- **Backup:** click **⬇ Download backup** in the sidebar to get one Excel file with Orders, Products, Promotions, Reviews, Audit Log and Settings.

## Orders and payments
After updating, run `supabase/schema.sql` once more. It's safe, and it adds the payment and timeline fields. Orders that were already **Completed** are marked **Paid** in full automatically.

- **Tabs:** **Needs action** shows only open orders (New, Confirmed, Preparing, Out for Delivery), with counts. Filter by payment with the **All payments** dropdown.
- **Next step:** one button per order moves it along: Confirm → Start preparing → Out for delivery → Mark completed.
- **Order details:** click any order to see the address, payment method, notes, items with prices, the timeline (who changed what and when) and whether it's a repeat customer. **Cancel order** asks before cancelling, because it puts the stock back. **Change status…** fixes mistakes.
- **Payment:** set **Unpaid / Partial / Paid / Refunded**, the **amount received**, the GCash reference and a note. If a customer paid less than the total (for example a suki discount given outside the website), enter what they actually paid. The difference shows as a discount, and the Dashboard **Revenue** counts the real amount received. **To collect** shows money still owed.
- **New-order alert:** when a new order arrives while the admin is open, you hear a chime, the **Orders** tab shows a badge with the number of New orders, and the browser tab title shows a count.

## Vouchers, restocks and profit

- **Vouchers** (admin → Vouchers): % off (with an optional ₱ cap) or ₱ off, minimum order, start/end date, total uses, uses per customer. A voucher is never combined with a promo — the customer automatically gets whichever discount is bigger. "Copy link" gives a link like `…/index.html?voucher=SUKI50#order` that fills in the code.
- **Restocks** (admin → Restocks): record each batch that arrives (bottles, cost per bottle, supplier). Stock goes up and the product's average cost (puhunan) is updated automatically. "Undo" removes a wrong entry and takes the bottles back out.
- **Profit & Reports**: sales after discounts − cost of bottles sold, per product and per month. Download the month as Excel or PDF. Each new order remembers the cost at the time it was placed; older orders use the product's current cost.
- **Favorites** (customer site): the ♡ in the header opens the saved list, with "Add all to cart" and "Share list".
- Cost is admin-only. Keep **Authentication → Sign In / Providers → Allow new users to sign up** turned OFF so only your admin accounts exist.

## Checkout, payment details and admin shortcuts

- **Checkout** is now 3 steps: Cart → Details → Review. After ordering, GCash customers see the amount, the GCash number (with Copy buttons) and a **Send screenshot via Messenger** button. The same instructions show in Track Order while the order is unpaid.
- Set the **GCash number, account name and Messenger link** in admin → *Homepage & Payment* → Payment details. Messenger link format: `https://m.me/yourpagename`.
- **Ctrl+K** (or the Search button / `/` key) in the admin finds orders, customers, products, vouchers, pages and actions.
- **Orders**: tick several orders to change their status or mark them as paid at once.
- **Restocks → Stock & cost**: click a cost to edit it inline; Enter saves and jumps to the next product without a cost.
- The admin remembers the last screen and filters on that device.
- **Install the admin as an app**: on Android/desktop Chrome use "Install admin app" (sidebar or More menu); on iPhone use Safari → Share → Add to Home Screen. Works on the live https site (Vercel).

## Homepage extras (logo, Shop by Feel, Scent of the Week, welcome offer)

After updating the files, **run `supabase/schema.sql` again** in Supabase → SQL Editor (safe to re-run). It adds the public store numbers, the welcome list and the "first order only" voucher option.

- **Logo** — `assets/images/ae-logo.svg` (gold in dark mode, black in light mode); `favicon.svg` and the admin app icons use it too.
- **Shop by Feel** — weather (heat / cool evenings / any) and accord tiles. Weather is worked out from each scent's profiles; change any in Admin → Homepage & Payment → *Shop by weather*.
- **Scent of the Week** — automatic (best seller of the last 7 days) or pick one, with an optional note.
- **Trust strip** — real bottles sold, rating and customers. Add sales from before the website in *Bottles sold before the website*.
- **Welcome offer** — create a voucher (e.g. WELCOME10) with **First order only** on, then choose it in *Welcome offer*. People who ask for the code appear in Admin → **Welcome List** (copy or download as CSV).
- **Brand film** — `assets/video/` (wide 16:9 for desktop, 4:5 for phones; WebM + MP4). Plays muted when scrolled into view, tap to pause. Replace the files with the same names to change it.
- **For Him / For Her pages** — the homepage shows two line cards plus best sellers; the full list (search, scent and weather filters, sort) opens at `index.html?line=men` and `index.html?line=women`.
- **Collections** — the new *Everyday* and *Hidden Gem* badges get their own homepage rows.

## Manual orders, FAQ and the bag

Run `supabase/schema.sql` again after updating (adds the order **source** and the manual-order function).

- **Manual orders** — Admin → Orders → **+ New order** for Facebook, Instagram, TikTok, walk-in, reseller… sales. Price per bottle can be changed, a discount added, the date set in the past, and "Take from stock" turned off for bottles already counted. They appear in Orders (with a source badge and filter), the profit report, CSV and the Excel backup. No order email is sent for these.
- **Bag** — the checkout now opens as a window from the bag icon, "View bag", the mobile checkout bar, or any `#order` link.
- **Customer ratings in reviews** — optional "How long did it last?" and "How strong was the scent trail?". Shown in the scent popup ("What customers say") and on each review. Needs the latest `supabase/schema.sql`.
- **How to order + FAQ** — new section near the bottom (also in the menu). Edit the questions in Admin → Homepage & Payment → **FAQ**; "Reset to the default questions" brings back the built-in ones. Check the delivery times there and change them to yours.

## Sizes (50ml + 20ml)

Run `supabase/add-sizes.sql` once in Supabase → SQL Editor (safe to re-run), then push the updated files.

- **Add a 20ml:** Admin → Products → **+ 20ml** next to the 50ml. Type only the price, stock and cost (puhunan). The photo, notes, description and badges are copied from the 50ml automatically, and follow it whenever you edit the 50ml.
- A 20ml is its own product row linked to the 50ml (`parent_id`), so stock, restocks, cost, profit reports, low-stock emails, manual orders and order history all work per size, like any product. Its name is shown as "Scent (20ml)" in orders and reports.
- **Customer site:** one card per scent with a **20ml | 50ml** picker; price, stock and Add to bag follow the size picked. The Discover popup has the same picker. Reviews belong to the scent.
- Edit scent info (photo, notes, badges...) on the **50ml**, not on the 20ml. The 20ml copies the 50ml.
- To delete a scent that has a 20ml, delete the 20ml first.
- Promos count bottles regardless of size (see "Promotions" note in the project chat): a "2 bottles for ₱X" promo only applies when ₱X is lower than the cart's normal total.

## Day-to-day
- **Add staff admin:** create the user (step 2.1), then run the `insert into public.admins …` query.
- **Remove staff admin:** `delete from public.admins where email = 'them@example.com';`
- **Reset an admin password:** Authentication → Users → … → Send password recovery, or set a new one there.
- **Backups:** Supabase → Database → Backups. On the Free plan, you can also download CSVs from the Table Editor.
- **Free plan note:** Supabase pauses free projects after about a week with no activity. Normal site traffic keeps it awake. If it does pause, open the dashboard and click **Restore**.

## Hosting (Vercel)
Leave Root Directory blank. No build command or output directory is needed.
