# Cavalyra – Android APK (Sideload)

Die Android-Version wird **nicht** über den Google Play Store verteilt, sondern
als eigenständige APK direkt von cavalyra.de. Dadurch entfallen sämtliche
Play-Store-Abhängigkeiten (Google Play Billing, Play Console, Review-Prozess).

Bezahlungen laufen im Android-Build – genau wie im Web – über **Paddle**.
Die App öffnet dafür den Paddle-Checkout in einem In-App-Browser und prüft
den Pro-Status anschließend serverseitig über die Netlify-Function
`/.netlify/functions/check-license`.

---

## 1. Voraussetzungen

- Node.js 18+, npm oder bun
- Android Studio (aktuell) inkl. Android SDK 34+
- JDK 17

## 2. Build

```bash
npm install
npm run build            # erzeugt dist/
npx cap add android      # nur beim ersten Mal
npx cap sync android     # nach jeder Änderung
npx cap open android     # Android Studio öffnen
```

App-Identität in `capacitor.config.ts` und `android/app/build.gradle`:

- `applicationId`: `de.cavalyra.app`
- `versionCode` / `versionName` in `android/app/build.gradle` pflegen
- Änderungen an `versionCode` müssen auch in
  `public/updater/cavalyra-android-updater.js` (`CURRENT_VERSION_CODE`)
  nachgezogen werden, damit die Update-Prüfung korrekt funktioniert.

## 3. Signierte Release-APK bauen

1. Signing-Key erstellen (einmalig):
   ```bash
   keytool -genkey -v -keystore cavalyra-release.keystore \
     -alias cavalyra -keyalg RSA -keysize 2048 -validity 10000
   ```
2. `android/key.properties` anlegen:
   ```
   storePassword=…
   keyPassword=…
   keyAlias=cavalyra
   storeFile=/absoluter/pfad/cavalyra-release.keystore
   ```
3. Signing in `android/app/build.gradle` konfigurieren (siehe Vorversion
   dieses Dokuments in der Git-Historie).
4. In Android Studio: **Build → Generate Signed APK → release**.
   Ergebnis: `android/app/build/outputs/apk/release/app-release.apk`.

## 4. Verteilung

APK-Datei zusammen mit einer aktualisierten `version.json` auf
`https://cavalyra.de/download/` bereitstellen:

```json
{
  "versionCode": 12,
  "versionName": "2.1",
  "apkUrl": "https://cavalyra.de/download/cavalyra-2.1.apk",
  "changelog": "Neue Body-Scanner-Optimierungen, Bugfixes."
}
```

Die App prüft diese Datei beim Start und alle 6 Stunden im Hintergrund. Ist
`versionCode` größer als der installierte Wert, blendet sie einen
Update-Hinweis ein und öffnet auf Klick die APK-URL im System-Browser. Der
Nutzer muss anschließend die Installation aus unbekannten Quellen erlauben
(Android-Dialog erscheint automatisch, `REQUEST_INSTALL_PACKAGES` ist in der
`AndroidManifest.xml` bereits eingetragen).

## 5. Pro-Freischaltung (Paddle)

- Nutzer tippt in der App auf **„Kostenlos testen"** → App öffnet
  `https://cavalyra.de/#preise` im In-App-Browser (Capacitor Browser).
- Nach abgeschlossenem Paddle-Checkout kehrt der Nutzer zur App zurück. Beim
  Resume-Event ruft die App automatisch die Netlify-Function
  `check-license` mit der Konto-E-Mail auf und schaltet Pro frei, sobald
  Paddle den Kauf bestätigt.
- **„Käufe wiederherstellen"** fragt (falls nötig) die Paddle-E-Mail ab und
  löst dieselbe Serverprüfung erneut aus.
- Der Google-Play-Billing-Pfad (`cordova-plugin-purchase`) ist im
  Android-Build **deaktiviert**. Das Plugin bleibt nur wegen iOS installiert
  und wird auf Android nicht mehr initialisiert.

## 6. Daten & Cloud-Backup

Die App bleibt vollständig Offline-First. Optional kann der Nutzer im
Profil ein kostenloses Cavalyra-Konto anlegen, dann synchronisiert die
Cloud-Sync-Engine seine Daten (inkl. Body-Scan-Bildern) mit Supabase.
Ohne Cloud-Konto bleiben alle Daten lokal.
