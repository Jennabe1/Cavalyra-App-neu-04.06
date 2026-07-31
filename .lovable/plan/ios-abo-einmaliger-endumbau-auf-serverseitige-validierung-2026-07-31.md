# iOS-Abo: einmaliger Endumbau auf serverseitige Validierung

Ziel: Ein einziger, endgültiger Validierungspfad nach offizieller `cordova-plugin-purchase` v13-Architektur und Apples App Store Server API. Danach keine weiteren Umbauten.

## Warum überhaupt eine Änderung nötig ist

Lokale Apple-Receipts enthalten kein `expirationDate`. Die aktuelle strenge Ablaufprüfung kann deshalb nie ein aktives Abo bestätigen. Laut offizieller v13-Dokumentation ist ein Validator (eigener Server oder Iaptic) für Auto-Renewable Subscriptions zwingend vorgesehen. Der aktuelle lokale Dummy-Validator (`store.validator` gibt immer `ok:true` mit unverschlüsseltem Receipt zurück) kann kein Ablaufdatum liefern. Das ist die einzige technisch zwingende Lücke.

## Dateien, die geändert werden

| Datei | Änderung | Grund |
|---|---|---|
| `supabase/functions/validate-ios-receipt/index.ts` (neu) | Vollständiger Validator: nimmt `transactionId` + `installation_id` (+ optional JWT), signiert ES256-JWT für App Store Connect, fragt Apple App Store Server API (`/inApps/v1/subscriptions/{originalTransactionId}`) ab, liest `status`, `expiresDate`, `autoRenewStatus`, `revocationDate`, schreibt Ergebnis in `public.licenses` und antwortet im v13-`ValidatorResponse`-Format (`ok`, `data.collection[]` mit `expiryDate`, `isExpired`). Sandbox-Fallback automatisch. | Einzige Quelle für Ablaufdatum/Renewal-Status. Deckt Verlängerung, Ablauf, Kündigung, Restore ab. |
| `supabase/config.toml` | `[functions.validate-ios-receipt] verify_jwt = false` | Kauf muss auch ohne Cloud-Konto validierbar sein (bestehendes Prinzip: `installation_id`). |
| `public/billing/cavalyra-billing.js` | 1. `store.validator` = URL/Funktion, die die neue Edge Function aufruft (Dummy entfällt vollständig). 2. `.approved()` ruft nur noch `transaction.verify()` — kein optimistischer Unlock mehr. 3. `.verified()` schaltet frei anhand des Server-`expiryDate` und ruft `receipt.finish()`. 4. `.unverified()` und `.finished()` ergänzt (offizielles Muster). 5. `syncIosStore()` bewertet Entitlement anhand des zuletzt vom Server bestätigten `validUntil` statt lokaler Receipt-Heuristik; `transactionLooksActive()` wird auf diese Quelle reduziert. | Offizielle v13-Kette `approved → verify → verified → finish`. Beseitigt die Heuristik, die die Widersprüche verursacht hat. |

## Dateien, die unverändert bleiben

- `index.html` (inkl. `hasProAccess()`, `licenseEntitlementActive()`, `ensureLicenseCompleteness()`, `LicenseExpiryWatch`, komplette UI, Navigation, Body Scanner, GPS, Kurse)
- `public/cloud/*` (Sync-Engine, Rate-Limit-Logik)
- Android/Paddle-Pfad: `create-paddle-checkout`, `paddle-webhook`, `check-license`, `openProWebsite()`
- Datenbankschema — `public.licenses` hat bereits `status`, `expires_at`, `installation_id`, `customer_id`, `subscription_id`, `source`. **Keine Migration nötig.**
- iOS-Build-Konfiguration, Icons, Splash, Codemagic

## Bestehende Logik, die erhalten bleibt

- Ein einziger Lizenzstatus (Pro / Nicht-Pro), eine einzige Entscheidungsstelle: `licenseEntitlementActive()` in `index.html`.
- `applyProState()` bleibt der einzige Schreibpfad; keine neuen Statuswerte, keine neuen Quellen (`source` bleibt `app_store` bzw. `paddle`).
- Offline: der zuletzt serverseitig validierte `validUntil` bleibt lokal gespeichert und gilt weiter, bis das Datum abläuft. Kein Netz = kein Statusverlust.
- Android bleibt vollständig unberührt.

## Benötigte Apple-Zugangsdaten (Supabase Secrets)

- `APPLE_ISSUER_ID` (App Store Connect → Integrations → Keys)
- `APPLE_KEY_ID`
- `APPLE_PRIVATE_KEY` (Inhalt der `.p8`-Datei, In-App-Purchase-Key)
- `APPLE_BUNDLE_ID` = `de.cavalyra.app`

Ohne diese vier Werte kann die Function nicht arbeiten — ich frage sie nach deiner Freigabe genau einmal ab.

## Abgedeckte Fälle nach dem Umbau

| Fall | Mechanismus |
|---|---|
| Neuer Kauf | `approved → verify → Edge Function → verified` mit echtem `expiryDate` |
| Kauf wiederherstellen | `store.restorePurchases()` → Receipt → derselbe Validator |
| Automatische Verlängerung | App-Start/Resume → Validator → neues `expiresDate` von Apple |
| Ablauf | Apple `status=2/expired` → `isExpired` → Demotion an der einen Entscheidungsstelle |
| Kündigung + Ablauf | Apple liefert `autoRenewStatus=0` und `expiresDate`; Pro bleibt bis Ablauf, danach Demotion |
| App-Neustart | Validierung erneut über Receipt; bis Antwort gilt der gecachte `validUntil` |
| Offline nach erfolgreicher Validierung | Gecachter `validUntil` entscheidet, keine Demotion ohne Serverurteil |

## Technische Einschätzung

Ich bin mit hoher Sicherheit überzeugt, dass diese Lösung vollständig ist: sie folgt exakt dem dokumentierten v13-Validator-Muster und nutzt Apples offizielle Server-API als einzige Wahrheit. Einzige externe Voraussetzung: gültiger In-App-Purchase-API-Key. Ohne die Secrets kann ich die Function schreiben, aber nicht scharf schalten.
