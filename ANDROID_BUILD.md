# Cavalyra – Android App (Capacitor) – Play-Store-Anleitung

Die App wurde mit **Capacitor 8** in eine native Android-App verpackt. Alle Funktionen der PWA (Auth, Body-Scan, Supabase, Edge-Funktionen, Push-/Network-/Haptics-/Share-APIs) bleiben erhalten – das Frontend läuft 1:1 im nativen WebView.

Der Pro-Bereich wird in der Android-App **ausschließlich über Google Play Billing** freigeschaltet. Im Web bleibt der bestehende Paddle-Flow unverändert. Im Android-Build werden **keine Paddle-Links, Pricing-Links oder Customer-Portal-Links** angezeigt – Pflicht für die Zulassung im Play Store.

---

## 1. Voraussetzungen (lokal)

- Node.js 18+ und npm/bun
- **Android Studio** (neueste Version) inkl. Android SDK 34+
- JDK 17
- **Google Play Developer Account** (~25 USD einmalig)

## 2. Projekt vorbereiten

```bash
# 1. Repo per "Export to GitHub" exportieren, dann lokal clonen
git clone <dein-repo>
cd <projekt>

# 2. Abhängigkeiten installieren
npm install

# 3. Web-Build erzeugen (liefert dist/)
npm run build

# 4. Android-Plattform hinzufügen (nur beim ersten Mal)
npx cap add android

# 5. Web-Assets in das Android-Projekt syncen
#    (dabei wird auch cordova-plugin-purchase automatisch eingebunden)
npx cap sync android
```

> Nach jedem `git pull` oder Code-Update: `npm run build && npx cap sync android`.

## 3. App in Android Studio öffnen

```bash
npx cap open android
```

### App-Identität (in `capacitor.config.ts`)
- **App-ID / Package-Name:** `app.lovable.e59b0fff3a8b4ae2bcd6fb60e231b1fd`
  - Für den Play Store empfohlen: in `capacitor.config.ts` UND `android/app/build.gradle` (`applicationId`) auf z. B. `de.cavalyra.app` ändern – muss eindeutig sein und kann **nach Veröffentlichung nicht mehr geändert werden**.
- **App-Name:** Cavalyra
- **Version:** in `android/app/build.gradle` → `versionCode` / `versionName` pflegen.

## 4. App-Icons & Splashscreen

Der Android-Splash ist fest auf Cavalyra-Branding gesetzt:

- Hintergrund: `#5C3540`
- Android 12+: `windowSplashScreenAnimatedIcon` nutzt `@drawable/splash_logo` mit transparentem Hintergrund.
- Android 11 und älter: `AppTheme.NoActionBarLaunch` nutzt `@drawable/splash` mit Cavalyra-Pferd auf `#5C3540`.
- Adaptive Icons nutzen Cavalyra-Foreground und `@color/ic_launcher_background` (`#5C3540`).
- Die alten grünen/blauen Android-Standard-Platzhalter wurden aus den Launcher-/Splash-Ressourcen entfernt.

Nach Änderungen an Web- oder Android-Ressourcen immer lokal ausführen:

```bash
npm run build
npx cap sync android
```

Optional zum kompletten Neugenerieren der Assets:

```bash
npm install -D @capacitor/assets
npx capacitor-assets generate --android \
  --iconBackgroundColor "#5c3540" \
  --splashBackgroundColor "#5c3540"
```

Voraussetzung: `resources/icon.png` (1024×1024) und `resources/splash.png` (2732×2732) anlegen. Danach prüfen, dass keine Ressourcen wieder auf Android-Standardwerte (`#3DDC84`, blaues Standard-Icon, Platzhalter-Foreground) zeigen.

### PWA-Installation

Die frühere Browser-/PWA-Installation wird nicht mehr angeboten. Cavalyra wird für Android über den Google Play Store installiert; der Profil-Button „Cavalyra App installieren" und die zugehörige PWA-Install-Logik sind entfernt.

---

## 5. Google Play Billing – Abo einrichten

Die App registriert beim Start ein Abo mit der Produkt-ID **`cavalyra_pro_monthly`** über das Cordova-Plugin `cordova-plugin-purchase` (Google Play Billing Library v6+). Es wird **kein** RevenueCat verwendet.

### 5.1 In der Google Play Console
1. App in der Play Console anlegen (Schritt 7 unten).
2. **Monetarisierung → Produkte → Abos → Abo erstellen**
3. **Produkt-ID:** `cavalyra_pro_monthly` (exakt so!)
4. Name, Beschreibung, Abrechnungszeitraum (monatlich), Preis(e) je Land setzen.
5. **Basis-Angebot** aktivieren.
6. Abo speichern und **aktivieren**.

> Das Abo erscheint erst dann in der App, wenn:
> - die App mit derselben `applicationId` und einem **signierten** Build im **internen Test-Track** liegt,
> - das Test-Konto auf dem Gerät als **Lizenz-Tester** hinterlegt ist
>   (Play Console → Einstellungen → Lizenztests).

### 5.2 Lokal testen
- Test-Gerät mit dem Google-Konto eines Lizenz-Testers anmelden.
- Mindestens einmal die signierte App über den internen Test-Track installieren.
- App öffnen → Profil → Pro → **„Pro abonnieren"** → Google-Play-Kauf-Dialog erscheint.
- **„Käufe wiederherstellen"** stellt einen aktiven Pro-Status wieder her.

### 5.3 Code-Hooks (zur Übersicht)
- `public/billing/cavalyra-billing.js` enthält die Plattform-Abstraktion:
  - `CavalyraBilling.isAndroidApp()` / `isWeb()` / `isNativeApp()`
  - `CavalyraBilling.checkProStatus()` – beim App-Start automatisch
  - `CavalyraBilling.startProPurchase()` – Button „Pro abonnieren"
  - `CavalyraBilling.restorePurchases()` – Button „Käufe wiederherstellen"
- Bei aktivem Abo wird `state.license = { status:"pro", pro:true, source:"google_play" }` gesetzt, sodass die bestehende Funktion `isProUser()` unverändert weiter funktioniert.
- Die Struktur ist plattform-agnostisch aufgebaut – iOS via Apple In-App Purchase kann später ohne Eingriff in die übrige Pro-Logik ergänzt werden (gleiches Plugin, Plattform `APPLE_APPSTORE`).

---

## 6. Release-Build (AAB für Play Store)

### 6.1 Signing-Key erstellen (einmalig)

```bash
keytool -genkey -v -keystore cavalyra-release.keystore \
  -alias cavalyra -keyalg RSA -keysize 2048 -validity 10000
```

`cavalyra-release.keystore` an **sicheren Ort** legen (Verlust = keine App-Updates mehr möglich!). Empfehlung: zusätzlich **Play App Signing** in der Play Console aktivieren – dann verwaltet Google den finalen Signing-Key.

### 6.2 `android/key.properties` anlegen

```
storePassword=DEIN_PW
keyPassword=DEIN_PW
keyAlias=cavalyra
storeFile=/absoluter/pfad/cavalyra-release.keystore
```

### 6.3 `android/app/build.gradle` ergänzen

```gradle
def keystorePropertiesFile = rootProject.file("key.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

android {
    ...
    signingConfigs {
        release {
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
            storeFile file(keystoreProperties['storeFile'])
            storePassword keystoreProperties['storePassword']
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled true
            shrinkResources true
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
}
```

### 6.4 AAB bauen

In Android Studio:
**Build → Generate Signed Bundle / APK → Android App Bundle → release**

Ergebnis: `android/app/build/outputs/bundle/release/app-release.aab`

---

## 7. Play Store Eintrag & Veröffentlichung

1. <https://play.google.com/console> → **App erstellen** (Name „Cavalyra", Sprache Deutsch, kostenlos).
2. **Store-Eintrag** ausfüllen:
   - Kurzbeschreibung & Langbeschreibung
   - Screenshots 1080×1920 (mind. 2 Telefon-Screens)
   - Feature-Grafik 1024×500
   - App-Icon 512×512
   - Kategorie: Sport / Lifestyle
   - Support-E-Mail
3. **Datenschutzerklärung-URL** angeben (Pflicht).
4. **App-Inhalte / Fragebögen** ausfüllen:
   - **Datensicherheit** (welche Daten werden erhoben/geteilt – Body-Scan-Fotos, Konto-E-Mail, GPS, etc.)
   - **Werbe-IDs** (Cavalyra: nein)
   - **Zielgruppe & Inhalt** (Erwachsene)
   - **Inhaltsbewertung** (Fragebogen)
   - **Berechtigungen** (Kamera, Standort, Speicher begründen)
   - **Government-App** / **Finanzdienstleister** etc. → nein
5. **Abos** unter Monetarisierung anlegen, falls noch nicht geschehen (Produkt-ID `cavalyra_pro_monthly`, siehe Abschnitt 5.1).
6. **Interner Test** → Tester (Lizenz-Tester-Konto!) einladen → AAB hochladen → testen.
7. Erst nach erfolgreichem internen Test: **Produktion → Neues Release** → AAB hochladen → Release-Notes → **prüfen und veröffentlichen**.

Erste Prüfung dauert i. d. R. 1–7 Tage.

---

## 8. Live-Reload während Entwicklung (optional)

In `capacitor.config.ts` den `server.url`-Block aktivieren (auskommentierter Block). **Vor Release wieder deaktivieren**, sonst lädt die installierte App aus der Lovable-Sandbox statt offline aus `dist/`.

## 9. Updates ausliefern

1. `versionCode` (+1) und `versionName` in `android/app/build.gradle` erhöhen
2. `npm run build && npx cap sync android`
3. Neues signiertes AAB bauen und im Play Console als neues Release hochladen.

---

## 10. Wichtige Hinweise zur Play-Store-Compliance

- **Keine externen Bezahlhinweise** in der Android-App. Die App blendet im Android-Build automatisch alle Paddle-/Pricing-Links aus.
- **Abo-Verwaltung** verweist auf Google Play → Konto → Abos (keine Links auf paddle.com / cavalyra.de Preise).
- **Datenschutzerklärung** muss Body-Scan-Bilder, Supabase-Datenverarbeitung und Google-Play-Billing erwähnen.
- **Lizenz-Tester** verwenden, solange das Abo noch nicht im Produktions-Track ist – sonst meldet die App „Pro-Abo aktuell nicht verfügbar".
