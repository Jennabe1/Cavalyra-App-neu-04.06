
# Cavalyra Android APK – Umstellung auf eigenständige Version (Sideload)

Ziel: Android-APK ohne Google-Play-Abhängigkeit, funktional identisch zur iOS-Version, mit Paddle-Abos, automatischer Update-Prüfung, optionalem Cloud-Backup und lokalem Onboarding-Hinweis.

## 1. Bestandsaufnahme (bereits vorhanden, wiederverwendbar)

- **Paddle Web-Integration:** `netlify/functions/check-license.js` prüft Paddle-Abos serverseitig anhand E-Mail (Preis-IDs `pri_01ksnccs23fwwm0qctdydb93xz` monatlich, `pri_01ksncrwd2eza9njhn22ah20mc` jährlich). Wird 1:1 als Lizenzprüf-Endpoint für die APK weiterverwendet.
- **Paddle-Checkout:** Paddle.js (v2) wird bereits im Web genutzt (Paddle Retain). Für die APK wird der Checkout in einem In-App-Browser (Capacitor Browser Plugin) auf einer bestehenden Paddle-Checkout-URL geöffnet.
- **Cloud-Backup / Supabase Sync:** `public/cloud/cavalyra-sync-engine.js` + `cavalyra-sync-ui.js` + `cavalyra-cloud.js` — komplett plattformunabhängig, funktioniert außerhalb Play Store bereits.
- **Body Scanner + GPS + Kurse:** Web-basiert in `index.html`, plattformidentisch. Kein Delta zwischen iOS und Android nötig – nur Feature-Gates prüfen.
- **Billing-Abstraktion:** `public/billing/cavalyra-billing.js` kennt bereits `isAndroidApp() / isIOSApp() / isNativeApp()`. Aktuell Android-Zweig = Cordova Purchase (Google Play Billing). Dieser Zweig wird durch einen Paddle-Zweig ersetzt.

## 2. Änderungen

### 2.1 Google-Play-Abhängigkeiten entfernen
- `cordova-plugin-purchase` aus `package.json` entfernen.
- `com.android.billingclient:billing` aus `android/app/capacitor.build.gradle` entfernen (autogen — wird nach `cap sync` neu geschrieben, deshalb Plugin-Entfernung reicht).
- Alle `store.register/when/initialize`-Codepfade im Android-Zweig von `cavalyra-billing.js` entfernen. iOS-Zweig (StoreKit via cordova-plugin-purchase) bleibt unverändert.

### 2.2 Paddle-Integration für Android
- Neuer Zweig in `cavalyra-billing.js`:
  - `startProPurchase()` auf Android → öffnet Paddle-Checkout-URL im Capacitor `Browser` Plugin. E-Mail des angemeldeten Cloud-Nutzers wird als `customer_email`-Query mitgegeben; Fallback: Prompt für E-Mail.
  - Nach Rückkehr aus dem Browser: `refreshLicense()` ruft `netlify/functions/check-license` mit dieser E-Mail auf und setzt `applyProState(true/false, "paddle", ...)`.
  - `restorePurchases()` = manueller Aufruf desselben Endpunkts.
- Lizenzprüfung beim App-Start:
  - Wenn Cloud-Account aktiv → prüfe automatisch via `check-license` (E-Mail aus Supabase Session).
  - Ohne Cloud-Account → Free, bis der Nutzer die E-Mail einträgt (Paddle-Kauf-Bestätigung).
- Lizenz-Cache in Supabase-Tabelle `licenses` (existiert bereits: 7 Spalten): E-Mail, Paddle Customer ID, Status, Tarif, valid_until, purchased_at, trial. Update über Supabase Client aus `cavalyra-cloud.js` nach jedem `check-license`-Erfolg. Keine reine Local-Speicherung mehr.

### 2.3 Onboarding-Hinweis
- Einmaliger Modal in `index.html`, geflagged via `localStorage.getItem('cavalyra:onboarding:v1')`.
- Text wie im Briefing; Button „Verstanden" schreibt Flag.
- Erscheint auf allen Plattformen (nicht Android-only) – dokumentiere das.

### 2.4 GPS Tracker dauerhaft kostenlos
- Prüfen: `requireProAccess`-Aufrufe im GPS-Flow bereits entfernt (siehe v87). Nochmals verifizieren.

### 2.5 Body Scanner Parität
- Kein plattformspezifischer Code im Body Scanner. Verifikation durch Code-Review; keine Änderungen erwartet.

### 2.6 Automatische Update-Prüfung
- Endpoint: `https://cavalyra.com/android/version.json` (Format wie im Briefing).
- Neue Datei `public/updater/cavalyra-android-updater.js`:
  - Nur aktiv wenn `Capacitor.getPlatform() === 'android'`.
  - Beim App-Start: `fetch(version.json)`; wenn `versionCode > installedVersionCode` → Modal mit Changelog + Buttons „Jetzt herunterladen" / „Später".
  - Download: öffnet `apk`-URL im Capacitor `Browser` (Nutzer bestätigt Installation via Android-System-Dialog). Voraussetzung: „Installation aus unbekannten Quellen" (dokumentieren).
  - `installedVersionCode` aus `capacitor.config.ts` bzw. hartkodiert im Skript (per Build synchronisiert).
- APK-Dateinamen versioniert (`Cavalyra-1.x.y.apk`) – Verantwortung des Deployers, dokumentieren in `ANDROID_BUILD.md`.

### 2.7 UI-Bereinigung
- „Abo verwalten" auf Android: Link zu `https://cavalyra.com/konto` (Paddle Customer Portal). Kein Play-Store-Link.
- Paddle/Preis-Hinweise auf Android wieder sichtbar (waren wegen Play-Compliance ausgeblendet).

## 3. Dokumentation
- `ANDROID_BUILD.md` aktualisieren: Sideload-APK-Bau, Signing, `version.json`-Format, APK-Namensschema, Paddle-Konfiguration, Entfernung Play-Billing-Doku.

## 4. Nicht angetastet
- iOS-Build & StoreKit-Flow
- Cloud-Sync-Engine
- Body Scanner-Logik, GPS-Logik, Kurse
- Supabase-Schema (Tabelle `licenses` existiert bereits)
- Web/PWA Paddle-Flow

## 5. Technische Details

- Capacitor Browser Plugin: `bun add @capacitor/browser`
- Paddle-Checkout-Rückkehr: Deep-Link `de.cavalyra.app://paddle-return` via `AndroidManifest.xml` Intent-Filter → triggert `refreshLicense()`.
- Automatische Startup-Lizenzprüfung nutzt eingebauten Supabase-Client falls Cloud-Login aktiv; bei Offline → letzte gecachte Lizenz aus Supabase (falls verfügbar) oder localStorage-Fallback (nur Anzeige-Cache, nicht die Wahrheit).
- Update-Check tolerant gegen Offline (`try/catch`, kein Modal bei Fehler).

## 6. Test-Checkliste
Installation, Start, Kamera-Permission, Body Scanner Full Run, GPS Ride Start/Save, Cloud-Registrierung + E-Mail-Verifizierung, Paddle-Kauf-Flow (Sandbox), Lizenz-Refresh nach Kauf, Restore nach Neuinstallation (via E-Mail), Offline-Modus, Update-Dialog mit gefaktem `version.json`, Rollback auf ältere APK.

## Umfang

- Neue Dateien: `public/updater/cavalyra-android-updater.js`, Onboarding-Modal (in `index.html`).
- Geänderte Dateien: `public/billing/cavalyra-billing.js`, `index.html`, `package.json`, `capacitor.config.ts`, `android/app/src/main/AndroidManifest.xml`, `ANDROID_BUILD.md`, evtl. `netlify/functions/check-license.js` (CORS bereits offen, nichts zu tun).
- Entfernt: `cordova-plugin-purchase` (Android-Nutzung), Play-Billing-Referenzen.

Nach Freigabe setze ich das in einem Rutsch um und liefere eine neue vollständige ZIP.
