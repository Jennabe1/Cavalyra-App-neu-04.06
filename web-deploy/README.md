# Cavalyra – Deep-Link / App-Link Deployment

Diese Dateien gehören auf die Domain **https://cavalyra.de** (nicht in die App), damit Android nach dem Paddle-Checkout zuverlässig in die App zurückkehrt.

## 1) Return-Seite

Datei: `return/index.html` → veröffentlichen unter:

```
https://cavalyra.de/return
```

Verhalten:
- Android mit verifiziertem App Link → öffnet direkt die App (`MainActivity` fängt `https://cavalyra.de/return` ab, siehe `AndroidManifest.xml`, `autoVerify="true"`).
- Fallback (Browser, iOS, nicht verifiziert) → Seite leitet automatisch nach ~400 ms auf `cavalyra://return` weiter und zeigt einen "Zurück zur App"-Button.

## 2) Digital Asset Links (Pflicht für autoVerify)

Datei: `.well-known/assetlinks.json` → veröffentlichen unter:

```
https://cavalyra.de/.well-known/assetlinks.json
```

Bedingungen:
- Muss **über HTTPS** ohne Redirect erreichbar sein.
- Content-Type: `application/json`.
- Der SHA-256-Fingerprint muss **exakt** dem Signing-Key entsprechen, mit dem die APK/AAB signiert ist. Wenn Play App Signing aktiv ist: den Fingerprint aus der Play Console (Setup → App Integrity → App Signing) eintragen. Für Sideload-Builds zusätzlich den Upload-Key-Fingerprint eintragen (mehrere Einträge im Array sind erlaubt).

Prüfen nach Deployment:

```
https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://cavalyra.de&relation=delegate_permission/common.handle_all_urls
```

## 3) Bereits in der App konfiguriert

`android/app/src/main/AndroidManifest.xml` enthält bereits:
- `cavalyra://` Custom-Scheme Intent-Filter
- `https://cavalyra.de/return` App-Link Intent-Filter mit `android:autoVerify="true"`
- `MainActivity` mit `launchMode="singleTask"` (App wird nicht doppelt gestartet)

`public/billing/cavalyra-billing.js` triggert bei App-Resume automatisch `refreshLicenseFromServer()`.

## Ergebnis

Nach erfolgreichem Paddle-Checkout leitet Paddle auf `https://cavalyra.de/return`. Android öffnet die App direkt (App Link) oder die Fallback-Seite ruft `cavalyra://return` auf → App kommt in den Vordergrund → Lizenz wird automatisch neu geprüft → Pro ist freigeschaltet.
