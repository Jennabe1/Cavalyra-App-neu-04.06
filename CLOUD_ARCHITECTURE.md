# Cavalyra Cloud Architecture (v2 – Final)

> Ziel: eine langfristig wartbare Offline-First-Architektur mit optionaler
> Cloud-Synchronisation über Supabase (Lovable Cloud). Alle Änderungen sind
> **additiv** – die bestehende App-Logik (GPS-Tracker, Kalender, Dashboard,
> Pferdebuch, Body Scanner, PDF-Erstellung, Billing, Capacitor)
> bleibt funktional unverändert.

---

## 1. Überblick

```
        ┌──────────────────────────┐
        │        Cavalyra App      │
        │  (Web / iOS / Android)   │
        └──────────┬───────────────┘
                   │  localStorage   (Offline-First State)
                   │  IndexedDB      (Outbox, Backup, Log, Image-Cache)
                   │
                   │  window.save()  ─── Hook (Primär)
                   │  localStorage.setItem ─── Proxy (Sicherheitsnetz)
                   │
                   ▼
        ┌──────────────────────────┐
        │  cavalyra-sync-engine.js │
        │  (Delta-Sync + Uploads)  │
        └──────────┬───────────────┘
                   │  REST + Realtime + Storage
                   ▼
        ┌──────────────────────────┐
        │       Supabase           │
        │  Auth │ Postgres │ RLS   │
        │  Storage Buckets         │
        │  Edge Functions          │
        └──────────────────────────┘
```

## 2. Datenbankstruktur

| Tabelle              | Zweck                                      | Kernfelder                                                   |
|----------------------|--------------------------------------------|--------------------------------------------------------------|
| `horses`             | Pferdestammdaten                            | name, breed, birthdate, color, discipline, image_path        |
| `calendar_events`    | Termine & Aktivitäten                       | horse_id, type, date, title, meta, notes                     |
| `rides`              | GPS-Ausritte                                | horse_id, date, duration_sec, distance_m, avg_speed, path    |
| `body_scan_history`  | Body-Scanner Ergebnisse                    | horse_id, date, bcs, summary, result, image_paths            |
| `horse_journal`      | Pferdebuch-Einträge                         | horse_id, category, date, next_date, title, notes            |
| `course_progress`    | Kursfortschritt                             | horse_id, course_id, progress                                |
| `profile_values`     | Nutzerspezifische Key/Value (z.B. active)   | key, value                                                   |
| `horse_members`      | Vorbereitung Sharing (Reitbeteiligungen)   | horse_id, member_user_id, role                               |
| `sync_conflicts`     | Audit-Log für Merge-Konflikte              | table_name, row_id, field, server_value, client_value, chosen|

Alle Sync-Tabellen haben zusätzlich:
- `id UUID PRIMARY KEY` (deterministisch via UUIDv5 aus lokalen Legacy-IDs)
- `user_id UUID` (RLS)
- `created_at`, `updated_at`
- `deleted_at` (Soft-Delete)
- `version BIGINT` (monotone Version aus `sync_version_seq`)
- `field_meta JSONB` (pro Feld Zeitstempel für Field-LWW)

## 3. Storage Buckets

| Bucket            | Public | Pfad-Muster                          |
|-------------------|--------|--------------------------------------|
| `horse-media`     | ❌     | `{user_id}/{horse_id}/cover.jpg`     |
| `body-scan-media` | ❌     | `{user_id}/{scan_id}/{index}.jpg`    |

RLS auf `storage.objects` erlaubt nur `owner = auth.uid()` und schränkt zusätzlich
den Pfad auf den `{user_id}/`-Präfix ein.

## 4. Row Level Security

Alle Sync-Tabellen erzwingen `auth.uid() = user_id` für SELECT, INSERT, UPDATE
und DELETE. Für die geplante Freigabe an Reitbeteiligungen/Trainer greift
zusätzlich `horse_members` (`role IN ('viewer','editor')`).

## 5. Trigger & Funktionen

- `tg_set_sync_meta` – setzt `updated_at` und weist eine neue globale Version
  aus `sync_version_seq` zu (Delta-Sync-Fundament).
- `sync_upsert_row(p_table, p_row, p_base_version)` – SECURITY DEFINER RPC:
  - prüft `user_id`
  - führt **Field-Level Last-Write-Wins** anhand `field_meta` durch
  - loggt Konflikte nach `sync_conflicts`
  - garantiert Optimistic Concurrency (Base-Version)
- `set_updated_at` – Standard-`updated_at` Trigger für Legacy-Tabellen.

## 6. Edge Functions

| Function           | Zweck                                                             |
|--------------------|-------------------------------------------------------------------|
| `body-scan-analyze`| Gemini-Aufruf mit serverseitigem Retry + Vorvalidierung            |
| `delete-account`   | DSGVO-Löschung: alle Rows, alle Storage-Objekte, Auth-Nutzer       |

## 7. Client-Sync-Engine (`public/cloud/cavalyra-sync-engine.js`)

### 7.1 Change-Detection
- **Primär:** `window.save(k, v)` wird gehookt → jede App-Schreibung markiert
  den Key als *dirty*.
- **Sicherheitsnetz:** `localStorage.setItem` wird geproxied → auch direkte
  Zugriffe (Legacy-Code) werden erfasst.
- Interne Keys (`license`, `pro_unlocked`, `theme`, …) sind auf einer Ignore-Liste.

### 7.2 Delta-Sync
Nach 1,5 s Debounce werden alle dirty Bereiche in Entities gemappt und via
`sync_upsert_row` einzeln übertragen. Der Server entscheidet:
- Base-Version ≥ Client → **konfliktfreies Update**
- Base-Version < Client → **Field-Level-Merge** (jüngerer Zeitstempel gewinnt),
  Konflikte werden in `sync_conflicts` protokolliert.

### 7.3 Migration (einmalig, idempotent)
1. Vor der Migration wird ein vollständiger Snapshot aller `cavalyra_*`-Keys in
   IndexedDB `backup` gespeichert.
2. Legacy-IDs (`horse-1`, `ev1`, …) werden über **UUIDv5** mit festem Namespace
   deterministisch in UUIDs umgewandelt → wiederholte Migrationen erzeugen
   **niemals Duplikate**.
3. Alle Entities werden mittels `sync_upsert_row` hochgeladen.
4. Bilder werden in Supabase Storage geladen; nur die Pfade wandern in die DB.
5. Nach Erfolg wird `cavalyra_cloud_migrated_v2 = "1"` gesetzt.
6. Bei Fehler wird das lokale Backup automatisch wiederhergestellt.

### 7.4 Bilder (B3)
- Lokal bleiben **DataURLs** im State → volle Offline-Funktion.
- Bei Sync wird DataURL → Blob → Storage hochgeladen.
- In den Tabellen stehen **ausschließlich Pfade** (`image_path`, `image_paths`).
- Beim Restore wird jeder Pfad via *signed URL* geholt, als DataURL im
  IndexedDB-Cache (`images` store) abgelegt und lokal wieder verfügbar gemacht.

### 7.5 Realtime
Ein WebSocket abonniert alle Sync-Tabellen (RLS scoped). Empfangene
`postgres_changes` triggern einen erneuten `pushChanges()`, was auch als
implizites Pull für andere Geräte reicht (die App lädt beim Start neu).

### 7.6 Sync-Log
Alle Sync-Ereignisse (upsert, upload, migrate, error) werden in IndexedDB
`log` gespeichert. Über `CavalyraSync.getLog()` / `clearLog()` abrufbar
(intern, nicht Nutzer-sichtbar).

## 8. Profil-UI (`public/cloud/cavalyra-sync-ui.js`)

Zeigt im Profil-Screen:
- Aktiv/Deaktiviert
- Aktueller Nutzer
- Letzte Synchronisation
- Aktueller Zustand (idle, syncing, restoring, error)
- Buttons: „Jetzt synchronisieren“, „Aus Cloud wiederherstellen“, „Abmelden“
- Registrierung/Login bei nicht angemeldeten Nutzern

## 9. Sequenzdiagramme

### Neue lokale Änderung
```
User → App: Pferd anlegen
App → save("horses", …): localStorage.setItem
save-Hook → markDirty("horses")
markDirty → scheduleSync (1.5s Debounce)
scheduleSync → collectEntities → sync_upsert_row (pro Zeile)
Supabase → RLS + Field-LWW → OK / conflict
```

### Wiederherstellung auf neuem Gerät
```
User → App: „Aus Cloud wiederherstellen"
App → GET /rest/v1/{tables}
App → Rebuild state -> localStorage
App → Für jedes image_path: signed URL → DataURL → IDB-Cache
App → location.reload()
```

### Migration
```
Login → migrateIfNeeded (Flag prüfen)
Snapshot → IndexedDB "backup"
collectEntities (UUIDv5) → sync_upsert_row
uploadPendingImages
Flag setzen "cavalyra_cloud_migrated_v2 = 1"
```

## 10. Zukunftssicherheit

- Mehrere Geräte: bereits über RLS + Realtime + Version abgedeckt.
- Mehrere Pferde: die Datenmodelle sind pro `horse_id` skaliert.
- **Reitbeteiligungen / Trainer / Tierärzte / Familienkonten**: `horse_members`
  ist vorhanden. Neue RLS-Policies können `horse_id IN (SELECT … FROM horse_members WHERE member_user_id = auth.uid())` ergänzen.
- **Cloud-Sharing**: pro Datensatz kann via `horse_members.role` gestuft werden.
- Weitere Features fügen einfach eine neue Tabelle nach demselben Muster hinzu
  – kein Refactor an bestehendem Code nötig.

## 11. Abweichungen vom ursprünglichen Konzept

- **Kein IndexedDB als Primärstore.** Der lokale State bleibt im
  `localStorage` – so bleibt der gesamte bestehende App-Code unangetastet.
  IndexedDB wird ausschließlich für Outbox, Sicherheits-Backup, Image-Cache
  und Sync-Log verwendet. Damit erfüllen wir die Vorgabe „bestehende Funktionen
  nicht refaktorisieren“ konsequent.
- **Kein separater Supabase-JS-Client im Bundle.** Der Engine spricht die
  REST-, Auth- und Storage-Endpunkte direkt an – kleiner Fußabdruck, keine
  zusätzlichen Build-Schritte, einfacher wartbar.

Beide Entscheidungen wurden bewusst getroffen, weil die App bereits stabil auf
`localStorage` läuft und Änderungen daran ein Risiko für die Stabilität von
GPS-Tracker, Kalender, Body Scanner & Co. wären.
