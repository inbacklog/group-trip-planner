# Project China / Group Trip Planner — μικρή διόρθωση v3.1

## Τι ανεβάζεις

Το ZIP είναι **μικρή ενημέρωση επάνω στην ήδη εγκατεστημένη v3**. Δεν είναι ολόκληρη εφαρμογή και δεν αντικαθιστά το repository.

Περιέχει ακριβώς τρία τροποποιημένα αρχεία και αυτόν τον οδηγό:

```text
src/
  App.tsx
tests/
  browser/
    activity-collaboration.spec.ts
    onboarding.spec.ts
FIX_V3_1_EL.md
```

Βάση σύγκρισης: `inbacklog/group-trip-planner`, commit `48fe2354fb72f3efbbe411c68f5a9f135483e9a8` (`v3 fix`). Επιβεβαιώθηκαν μέσω GitHub τα blob hashes και των τριών αρχείων πριν τη διόρθωση. Αν έχεις αλλάξει τα ίδια αρχεία σε νεότερο commit, συγχώνευσε το diff αντί να αντικαταστήσεις τις νεότερες αλλαγές.

## Εγκατάσταση — χωρίς αλλαγή Supabase

1. Στα Windows: δεξί κλικ στο ZIP → **Εξαγωγή όλων**. Άνοιξε τον φάκελο που δημιουργήθηκε.
2. Στο υπάρχον repository `inbacklog/group-trip-planner`, branch **main**, άνοιξε **Add file → Upload files**. Σύρε **τους φακέλους `src` και `tests` ολόκληρους** από τον αποσυμπιεσμένο φάκελο. Πρόσθεσε και το `FIX_V3_1_EL.md` για να μείνει η τεκμηρίωση. Μην σύρεις το ZIP ή τον εξωτερικό φάκελο της εξαγωγής.
3. Πριν κάνεις commit, επιβεβαίωσε ότι εμφανίζονται ακριβώς `src/App.tsx`, `tests/browser/activity-collaboration.spec.ts` και `tests/browser/onboarding.spec.ts`. Όχι σκέτα `App.tsx` ή `activity-collaboration.spec.ts`. Ενδεικτικό μήνυμα commit: `Fix v3 browser checks and stop field label`.
4. Περίμενε **πράσινο Actions → Checks για το νέο commit**. Μην χρησιμοποιήσεις απλώς Re-run στην παλιά αποτυχημένη εκτέλεση: αυτό θα ελέγξει ξανά τον παλιό κώδικα. Δεν παρακάμπτουμε τα checks.
5. Μόνο αφού περάσουν οι έλεγχοι: **Actions → Publish GitHub Pages (manual) → Run workflow → main → Run workflow**. Μετά το επιτυχημένο deploy ανανέωσε τη σελίδα με `Ctrl + F5`.

Δεν ξανατρέχεις `003`, `001`, `002` ή `INSTALL_ALL.sql`. Δεν αλλάζεις API keys ή συνδέσεις. Η v3.1 δεν περιέχει ούτε απαιτεί SQL. Τυχόν προηγούμενα αρχεία που ανέβηκαν χύμα στη ρίζα δεν χρησιμοποιούνται από το frontend· δεν χρειάζεται να τα διαγράψεις για αυτή τη διόρθωση. Δεν διαγράφεις κανένα φάκελο ή αρχείο της εφαρμογής.

## Τι διορθώθηκε

### 1. Δύο παλιά αναμενόμενα μηνύματα

Το test σύγκρουσης περίμενε «Έγινε αλλαγή από άλλο μέλος», ενώ η v3 εμφανίζει «Έγινε νεότερη αλλαγή από άλλο μέλος ή άλλη συσκευή.». Το test ελέγχει πλέον τη νέα διατύπωση και την οδηγία ανανέωσης. Προστέθηκε επίσης έλεγχος ότι το μη αποθηκευμένο σχόλιο παραμένει μετά τη σύγκρουση. Διατηρούνται οι έλεγχοι `p_expected_version`, ιδιοκτησίας σχολίων και εμφάνισης της νέας έκδοσης μετά το refresh.

Το onboarding test περίμενε «Η βάση δεδομένων δεν είναι έτοιμη», ενώ η v3 εμφανίζει σαφή οδηγία για εφαρμογή μόνο νέων migrations. Τώρα ελέγχει αυτήν την οδηγία, μαζί με την προειδοποίηση ότι το `INSTALL_ALL.sql` είναι μόνο για νέα εγκατάσταση. Διατηρούνται οι έλεγχοι απουσίας demo/ομάδων και παρουσίας Retry.

**Το μήνυμα βάσης στο συγκεκριμένο log παράγεται σκόπιμα από το mock `failGroups: true`. Δεν αποτελεί αποτέλεσμα διάγνωσης του πραγματικού Supabase του χρήστη.**

### 2. Ακριβής σύνδεση της ετικέτας «Στάση» με το select

Το εσωτερικό label περιείχε και τα κείμενα των επιλογών. Στην απομονωμένη αναπαραγωγή το `getByLabel("Στάση", { exact: true })` δεν έβρισκε στοιχείο. Το κείμενο της ετικέτας έχει πλέον μοναδικό React `useId()` και συνδέεται με `aria-labelledby` στο select. Η αυτόματη επιλογή στάσης και το πεδίο αποθήκευσης παραμένουν ίδια. Το υπάρχον v3 test δεν χαλαρώνει: εξακολουθεί να ζητά ακριβώς «Στάση» και το συγκεκριμένο ID της επιλεγμένης πόλης.

### 3. Ολοκλήρωση αυτόματης ανανέωσης πριν από τη δοκιμή ανάκλησης

Μετά τη διαγραφή σχολίου η εφαρμογή ξαναφορτώνει το snapshot και προσωρινά δεν εμφανίζει κανένα σχόλιο. Το test θεωρούσε αυτήν την προσωρινή απουσία απόδειξη ολοκλήρωσης, ανακαλούσε πρόωρα την πρόσβαση και επιχειρούσε click στο refresh ενώ η εφαρμογή ήδη έκλεινε το ιδιωτικό παράθυρο.

Πλέον το test περιμένει επιβεβαίωση διαγραφής, ενεργό refresh, την επανεμφάνιση του δικού μας σχολίου και ακριβώς ένα εναπομείναν σχόλιο. Μετά ανακαλεί την πρόσβαση και ελέγχει ότι το ιδιωτικό παράθυρο, τα σχόλια και η ενότητα συζήτησης αφαιρούνται. Δεν προστέθηκαν αυθαίρετα timeouts, `force` clicks, `skip`, retries ή παρακάμψεις ασφάλειας. Η παραγωγική λογική ανάκλησης πρόσβασης δεν άλλαξε.

## Τι ελέγχθηκε πραγματικά εδώ

- TypeScript: `node node_modules/typescript/bin/tsc -b` — **επιτυχία**.
- Unit/database: `node --experimental-strip-types --test tests/*.test.mjs` — **63/63 επιτυχία**, κανένα skip. Οι δοκιμές βάσης χρησιμοποιούν το υπάρχον PGlite με συνθετικές ταυτότητες, όχι το παραγωγικό Supabase.
- Playwright αναγνώριση δοκιμών: `node node_modules/@playwright/test/cli.js test --list` — **92 tests σε 9 αρχεία**. Αυτό είναι καταγραφή/φόρτωση tests, όχι επιτυχής εκτέλεση 92 browser tests.
- Απομονωμένη δοκιμή DOM σε πραγματικό Chromium: η παλιά ακριβής ετικέτα έδινε 0 στοιχεία, η διορθωμένη 1 και τη σωστή τιμή. Ελέγχθηκαν πλάτη desktop/mobile. Αυτό δεν υποκαθιστά το end-to-end test όλης της εφαρμογής.
- Τοπικό runtime: Node 22.16.0, με το ειδικό flag για TypeScript imports. Το υπάρχον GitHub CI εξακολουθεί να χρησιμοποιεί Node 24. Δεν άλλαξαν engines, package.json, lockfile ή workflows.

**Δεν ολοκληρώθηκαν production Vite build και end-to-end suite στο παρόν περιβάλλον.** Το build σταματά επειδή λείπει το Linux native dependency `@rollup/rollup-linux-x64-gnu` από τις τοπικά διαθέσιμες εξαρτήσεις. Η λήψη εξαρτήσεων δεν ήταν διαθέσιμη. Η πλοήγηση Chromium στο localhost εμποδίζεται με `ERR_BLOCKED_BY_ADMINISTRATOR`. Δεν επιχειρήθηκε παράκαμψη. Απαιτείται πράσινο GitHub Checks μετά το upload, με την υπάρχουσα καθαρή εγκατάσταση εξαρτήσεων.

Δεν έγινε GitHub write, merge, deploy, SQL εκτέλεση ή πρόσβαση σε πραγματικά ταξιδιωτικά δεδομένα.

## Τεχνικές πηγές

- React, useId: https://react.dev/reference/react/useId
- Playwright, locators: https://playwright.dev/docs/locators
- Playwright, assertions: https://playwright.dev/docs/test-assertions
- GitHub, upload: https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository
- GitHub, manual workflow: https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow

## Ακριβές diff

```diff
--- a/src/App.tsx
+++ b/src/App.tsx
@@ -1,5 +1,6 @@
 import {
   useEffect,
+  useId,
   useRef,
   useState,
   useSyncExternalStore,
@@ -2501,6 +2502,7 @@
   onClose: () => void;
   onSaved: () => void;
 }) {
+  const stopLabelId = useId();
   const [title, setTitle] = useState(item?.title ?? "");
   const [description, setDescription] = useState(item?.description ?? "");
   const [why, setWhy] = useState(item?.why_visit ?? "");
@@ -2556,8 +2558,12 @@
           />
         </label>
         <label>
-          Στάση
-          <select value={stopId} onChange={(e) => setStopId(e.target.value)}>
+          <span id={stopLabelId}>Στάση</span>
+          <select
+            aria-labelledby={stopLabelId}
+            value={stopId}
+            onChange={(e) => setStopId(e.target.value)}
+          >
             <option value="">Χωρίς συγκεκριμένη στάση</option>
             {stops.map((s) => (
               <option key={s.id} value={s.id}>
--- a/tests/browser/activity-collaboration.spec.ts
+++ b/tests/browser/activity-collaboration.spec.ts
@@ -457,7 +457,16 @@
   await section
     .getByRole("button", { name: "Αποθήκευση σχολίου", exact: true })
     .click();
-  await expect(section.getByRole("alert")).toContainText("Έγινε αλλαγή από άλλο μέλος");
+  await expect(section.getByRole("alert")).toContainText(
+    "Έγινε νεότερη αλλαγή από άλλο μέλος ή άλλη συσκευή.",
+  );
+  await expect(section.getByRole("alert")).toContainText(
+    "Ανανέωσε τα στοιχεία και έλεγξε τις αλλαγές πριν αποθηκεύσεις ξανά.",
+  );
+  // A conflict must retain this tab's unsaved draft until explicit refresh.
+  await expect(
+    section.getByLabel("Επεξεργασία σχολίου", { exact: true }),
+  ).toHaveValue("Αλλαγή από αυτή την καρτέλα.");
   expect(state.mutations.at(-1)?.body.p_expected_version).toBe(1);
   await section
     .getByRole("button", {
@@ -485,20 +494,34 @@
   await section
     .getByRole("button", { name: "Διαγραφή σχολίου", exact: true })
     .click();
+  const refreshButton = section.getByRole("button", {
+    name: "Ανανέωση προτιμήσεων και σχολίων",
+    exact: true,
+  });
+  // A successful mutation starts an automatic snapshot reload. During that
+  // reload *all* comments are temporarily absent, so disappearance alone is
+  // not proof that deletion has finished. Let that reload settle before
+  // simulating revocation; otherwise it may correctly close the dialog before
+  // the test has a chance to click the manual refresh button.
+  await expect(
+    section.getByRole("status").filter({ hasText: "Το σχόλιο διαγράφηκε." }),
+  ).toBeVisible();
+  await expect(refreshButton).toBeEnabled();
+  await expect(section.locator(".comment-list")).toBeVisible();
+  await expect(section.locator(".activity-comment")).toHaveCount(1);
+  await expect(
+    section.getByText("Το αρχικό μου σχόλιο.", { exact: true }),
+  ).toBeVisible();
   await expect(
     section.getByText("Μήπως να πάμε το πρωί;", { exact: true }),
   ).toHaveCount(0);
+  expect(state.mutations).toHaveLength(1);
   expect(state.mutations[0].body).toEqual({
     p_comment_id: OTHER_COMMENT_ID,
     p_expected_version: 1,
   });
   state.loseAccess = true;
-  await section
-    .getByRole("button", {
-      name: "Ανανέωση προτιμήσεων και σχολίων",
-      exact: true,
-    })
-    .click();
+  await refreshButton.click();
   await expect(page.getByRole("dialog")).toHaveCount(0);
   await expect(
     page.getByText("Το αρχικό μου σχόλιο.", { exact: true }),
--- a/tests/browser/onboarding.spec.ts
+++ b/tests/browser/onboarding.spec.ts
@@ -304,8 +304,13 @@
 }) => {
   await installFixture(page, { signedIn: true, failGroups: true });
   await page.goto("/");
-  await expect(page.getByRole("alert")).toContainText(
-    "Η βάση δεδομένων δεν είναι έτοιμη",
+  const alert = page.getByRole("alert");
+  await expect(alert).toContainText("Λείπει ενημέρωση της βάσης.");
+  await expect(alert).toContainText(
+    "Σε υπάρχουσα εφαρμογή εφαρμόζεις μόνο τα νέα migrations",
+  );
+  await expect(alert).toContainText(
+    "Το supabase/INSTALL_ALL.sql είναι μόνο για εντελώς νέα εγκατάσταση.",
   );
   await expect(page.locator(".group-card")).toHaveCount(0);
   await expect(
```
