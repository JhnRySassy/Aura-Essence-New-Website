CARD PROFILES (first 3 profiles instead of the short description)

Two files changed. Same paths as in your repo:
  assets/js/app.js
  assets/css/redesign.css

Option A (simple): copy the two files into your project, replacing the old ones.
Option B (safer if you changed these files after commit 1b0c5a6):
  in the project folder run:   git apply card-profiles.patch
  (if it says the patch does not apply, use Option A or tell me.)

Then:
  git add assets/js/app.js assets/css/redesign.css
  git commit -m "Product card: show first 3 profiles instead of description"
  git push
