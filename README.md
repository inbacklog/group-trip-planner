# Group Trip Planner

Εφαρμογή για ταξίδια ανεξάρτητων παρεών, με React, TypeScript, Vite και Supabase. Repository: [`inbacklog/group-trip-planner`](https://github.com/inbacklog/group-trip-planner).

**[Άνοιγμα εφαρμογής](https://inbacklog.github.io/group-trip-planner/)** · [Πολιτική απορρήτου](https://inbacklog.github.io/group-trip-planner/privacy.html). Η σύνδεση Google είναι ενεργή· τα ταξίδια εμφανίζονται μόνο στα μέλη της αντίστοιχης ιδιωτικής ομάδας.

Η δική μας Κίνα ανήκει στην ιδιωτική ομάδα μας. Νέος χρήστης ξεκινά χωρίς δεδομένα και επιλέγει κενό ταξίδι ή το «Βασικό πρότυπο Κίνας»: μόνο **Σαγκάη και Πεκίνο**, χωρίς προτάσεις, κρατήσεις, ημερομηνίες ή μέλη από το πραγματικό ταξίδι. Πρόσβαση σε υπάρχουσα παρέα αποκτά με αποδοχή πρόσκλησης.

## Τοπική εκκίνηση

Χρειάζεται Node.js 24+ και pnpm 11.19.0, όπως ορίζει το `package.json`. Η εγκατάσταση χρησιμοποιεί το `pnpm-lock.yaml`.

```powershell
pnpm install --frozen-lockfile
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
pnpm run dev
```

Αν υπάρχει ήδη `.env.local`, διατήρησέ το. Συμπλήρωσε τα `VITE_SUPABASE_URL` και `VITE_SUPABASE_PUBLISHABLE_KEY`. Για τοπική ανάπτυξη το `VITE_BASE_PATH` μπορεί να είναι `/`. Για GitHub Pages είναι `/group-trip-planner/`. Το `.env.local` εξαιρείται από το Git. Τα πεδία `VITE_*` συμπεριλαμβάνονται στο browser build: βάζουμε μόνο publishable key, ποτέ secret/service-role key ή database password.

Η σύνδεση χρειάζεται το schema και τις ρυθμίσεις Auth στο [DEPLOYMENT](docs/DEPLOYMENT.md). Η ύπαρξη URL/key δεν σημαίνει ότι έχει εφαρμοστεί η migration ή ότι έχει ελεγχθεί το hosted project.

## Λειτουργίες

Email/Google Auth, ιδιωτικές ομάδες, πολλά ταξίδια, προαιρετικό πρότυπο δύο στάσεων, προσκλήσεις, ονόματα μελών, συμμετοχή ανά ταξίδι και ιδιωτική εισαγωγή περιεχομένου. Οι προτάσεις έχουν πλούσιες πληροφορίες/πηγές, προσωπικές προτιμήσεις με προτεραιότητα, σύνοψη της παρέας και σχόλια. Το ημερήσιο πρόγραμμα υποστηρίζει σχετικές ημέρες χωρίς υποχρεωτικές ημερομηνίες, ώρες/διάρκεια, εναλλακτικές, υποομάδες, εγκρίσεις συγκεκριμένης έκδοσης και εξαγωγή JSON/HTML για offline χρήση. Η κατάσταση υλοποίησης και ελέγχων καταγράφεται στο [PROGRESS](docs/PROGRESS.md).

Το πραγματικό ιδιωτικό αρχείο διατηρείται εκτός Git. Ο adapter `project-china-private-handoff-v1` διατηρεί όλα τα αρχικά πεδία, πηγές και πρόχειρες ημέρες ως στοιχεία αναφοράς. Δεν κατασκευάζει ψήφους ή εγκρίσεις από παλιές σημειώσεις. Η εισαγωγή στο πραγματικό Supabase εκκρεμεί. Το πλήρες μοντέλο κόστους/κρατήσεων, το ιστορικό επαναφοράς εκδόσεων και η αυτόματη βελτιστοποίηση διαδρομών δεν περιλαμβάνονται στην τρέχουσα έκδοση.

Για πρώτη εγκατάσταση εκτέλεσε **μόνο το πλήρες [`supabase/INSTALL_ALL.sql`](supabase/INSTALL_ALL.sql)**, που περιλαμβάνει και τις δύο migrations σε μία συναλλαγή. [Σύντομες οδηγίες](docs/SUPABASE_FIRST_INSTALL_EL.md). Δεν χρειάζεται να τρέξεις πρώτα το παλιό αρχείο. Google provider/redirects και πραγματικά hosted tests παραμένουν ξεχωριστά βήματα.

## Έλεγχοι και τεκμηρίωση

```powershell
pnpm run typecheck
pnpm test
pnpm run test:database
pnpm run build
pnpm run test:browser
```

Τα αποτελέσματα και τα όρια κάλυψης καταγράφονται στο [TEST_REPORT](docs/TEST_REPORT.md). Τοπικοί έλεγχοι PostgreSQL και browser mocks δεν αντικαθιστούν δοκιμή Supabase Auth/PostgREST με διαφορετικούς πραγματικούς λογαριασμούς.

- [Αρχιτεκτονική](docs/ARCHITECTURE.md) και [συμβόλαιο βάσης/import](docs/DB_CONTRACT.md)
- [Πρόσβαση και ασφάλεια](docs/SECURITY.md)
- [Supabase και δημοσίευση](docs/DEPLOYMENT.md)
- [Ιδιωτικό import και μετάβαση](docs/MIGRATION.md)
- [Απογραφή αρχικού υλικού](docs/LEGACY_AUDIT.md)
