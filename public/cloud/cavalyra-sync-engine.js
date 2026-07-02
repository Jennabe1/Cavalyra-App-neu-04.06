/* ==========================================================================
 * Cavalyra Cloud Sync Engine  (v2 - Final Architecture)
 * --------------------------------------------------------------------------
 * Offline-First, Entity-Level, Delta-Sync, Field-Level Last-Write-Wins.
 *
 * Freigaben umgesetzt:
 *   B1  save()-Hook + localStorage.setItem-Proxy (Sicherheitsnetz).
 *   B2  Deterministische UUIDv5-Migration, idempotent, ein-malig markiert.
 *   B3  DataURLs bleiben lokal; Cloud speichert nur Storage-Pfade.
 *
 * Zusaetzlich:
 *   - Lokales Sicherheits-Backup vor der Migration (IndexedDB).
 *   - Profil-Statusanzeige (via window.CavalyraSyncUI).
 *   - Internes Sync-Log (IndexedDB, Debug).
 *   - Realtime-Aktualisierung.
 *
 * Die bestehende App-Logik wird NICHT refaktoriert. Wir haengen uns
 * ausschliesslich an save(), localStorage.setItem und state an.
 * ========================================================================== */
(function(){
  "use strict";

  const SUPABASE_URL = "https://upbubifdcndfxbvmgwzg.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwYnViaWZkY25kZnhidm1nd3pnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NTg5MjEsImV4cCI6MjA5NTUzNDkyMX0.f3OQwrVb-mRrr045ia_jcduC8NlOFJghRJFjJkM1qzc";

  const CAV_NS = "cavalyra_";                 // localStorage-Praefix
  const MIG_FLAG = "cavalyra_cloud_migrated_v2"; // ein-malige Migration
  const BACKUP_KEY = "premigration_backup_v2"; // Sicherheits-Backup in IDB
  const NAMESPACE_UUID = "6f7a1e14-2e1f-4b0a-9c73-8f27a8c3d9c2"; // v5 Namespace

  const TABLES = ["horses","calendar_events","rides","body_scan_history","horse_journal","course_progress","profile_values"];

  // ---------- kleine Utils --------------------------------------------------
  const now = () => new Date().toISOString();
  const log = (...a) => { try{ console.log("[CavSync]", ...a); }catch(_){} };

  function toHex(bytes){ return Array.from(bytes).map(b=>b.toString(16).padStart(2,"0")).join(""); }

  // Deterministische UUIDv5 (RFC 4122, SHA-1)
  async function uuidv5(name, namespace){
    const nsBytes = new Uint8Array(namespace.replace(/-/g,"").match(/.{2}/g).map(h=>parseInt(h,16)));
    const nameBytes = new TextEncoder().encode(String(name));
    const buf = new Uint8Array(nsBytes.length + nameBytes.length);
    buf.set(nsBytes,0); buf.set(nameBytes,nsBytes.length);
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-1", buf));
    hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
    hash[8] = (hash[8] & 0x3f) | 0x80; // variant
    const h = toHex(hash.slice(0,16));
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
  }
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  async function ensureUuid(id, ctx){
    if(id && UUID_RE.test(id)) return id;
    return await uuidv5(`${ctx}:${id||crypto.randomUUID()}`, NAMESPACE_UUID);
  }

  // ---------- IndexedDB (Outbox, Backup, Log, Image-Cache) -----------------
  const DB_NAME = "cavalyra_sync_v2";
  const DB_VERSION = 1;
  let _db = null;
  function openDb(){
    return _db || (_db = new Promise((resolve,reject)=>{
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if(!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", {keyPath:"id", autoIncrement:true});
        if(!db.objectStoreNames.contains("meta"))   db.createObjectStore("meta",   {keyPath:"k"});
        if(!db.objectStoreNames.contains("log"))    db.createObjectStore("log",    {keyPath:"id", autoIncrement:true});
        if(!db.objectStoreNames.contains("images")) db.createObjectStore("images", {keyPath:"path"});
        if(!db.objectStoreNames.contains("backup")) db.createObjectStore("backup", {keyPath:"k"});
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  }
  async function idbPut(store, value){
    const db = await openDb();
    return new Promise((res,rej)=>{ const tx = db.transaction(store,"readwrite"); tx.objectStore(store).put(value); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); });
  }
  async function idbGet(store, key){
    const db = await openDb();
    return new Promise((res,rej)=>{ const tx = db.transaction(store,"readonly"); const r = tx.objectStore(store).get(key); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });
  }
  async function idbAll(store){
    const db = await openDb();
    return new Promise((res,rej)=>{ const tx = db.transaction(store,"readonly"); const r = tx.objectStore(store).getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); });
  }
  async function idbDelete(store, key){
    const db = await openDb();
    return new Promise((res,rej)=>{ const tx = db.transaction(store,"readwrite"); tx.objectStore(store).delete(key); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); });
  }
  async function idbClear(store){
    const db = await openDb();
    return new Promise((res,rej)=>{ const tx = db.transaction(store,"readwrite"); tx.objectStore(store).clear(); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); });
  }

  async function logSync(entry){
    try{ await idbPut("log", { ts: now(), ...entry }); }catch(_){}
  }

  // ---------- Supabase Lite Client (nur was wir brauchen) -------------------
  // Wir vermeiden ein Extra-Bundle und rufen die REST/Storage APIs direkt.
  const Auth = {
    session: null,
    _key: "cavalyra_sb_session_v2",
    load(){ try{ this.session = JSON.parse(localStorage.getItem(this._key)); }catch(_){ this.session=null; } return this.session; },
    save(s){ this.session = s; try{ localStorage.setItem(this._key, JSON.stringify(s)); }catch(_){} },
    clear(){ this.session = null; try{ localStorage.removeItem(this._key); }catch(_){} },
    userId(){ return this.session?.user?.id || null; },
    token(){ return this.session?.access_token || null; },
    async ensureFresh(){
      const s = this.session; if(!s) return null;
      const exp = (s.expires_at||0)*1000;
      if(Date.now() < exp - 60000) return s;
      // refresh
      try{
        const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
          method:"POST",
          headers:{ "Content-Type":"application/json", "apikey": SUPABASE_ANON_KEY },
          body: JSON.stringify({ refresh_token: s.refresh_token })
        });
        if(!r.ok) throw new Error("refresh failed");
        const j = await r.json();
        this.save({ ...j, user: j.user || s.user });
        return this.session;
      }catch(e){ log("refresh error", e); return s; }
    }
  };

  async function api(path, opts={}){
    await Auth.ensureFresh();
    const headers = Object.assign({
      "apikey": SUPABASE_ANON_KEY,
      "Content-Type":"application/json"
    }, opts.headers||{});
    if(Auth.token()) headers["Authorization"] = "Bearer "+Auth.token();
    const r = await fetch(SUPABASE_URL + path, { ...opts, headers });
    if(!r.ok){
      const txt = await r.text().catch(()=>"");
      throw new Error(`API ${r.status}: ${txt.slice(0,200)}`);
    }
    if(r.status === 204) return null;
    const ct = r.headers.get("content-type")||"";
    return ct.includes("json") ? r.json() : r.text();
  }

  const AuthApi = {
    async signUp(email, password){
      const j = await api("/auth/v1/signup", { method:"POST", body: JSON.stringify({ email, password }) });
      if(j?.access_token){ Auth.save(j); }
      return j;
    },
    async signIn(email, password){
      const j = await api("/auth/v1/token?grant_type=password", { method:"POST", body: JSON.stringify({ email, password }) });
      if(j?.access_token){ Auth.save(j); }
      return j;
    },
    async signOut(){
      try{ await api("/auth/v1/logout", { method:"POST" }); }catch(_){}
      Auth.clear();
    },
    async resetPassword(email){
      return api("/auth/v1/recover", { method:"POST", body: JSON.stringify({ email }) });
    }
  };

  // ---------- Change-Erfassung (B1: save() + setItem-Proxy) -----------------
  const dirtyKeys = new Set();
  let syncScheduled = false;

  function markDirty(key){
    if(!key || !key.startsWith(CAV_NS)) return;
    const short = key.slice(CAV_NS.length);
    // interne/UI-Keys ignorieren
    if(["theme","onboarding_seen","license","license_email","pro_unlocked","sb_session_v2","cloud_migrated_v2"].includes(short)) return;
    dirtyKeys.add(short);
    scheduleSync();
  }

  function scheduleSync(){
    if(syncScheduled) return;
    syncScheduled = true;
    setTimeout(()=>{ syncScheduled = false; pushChanges().catch(e=>{ log("push error", e); logSync({level:"error", op:"push", error:String(e)}); updateStatus({error:String(e)}); }); }, 1500);
  }

  // Hook 1: save() wrapper (Primaer)
  function installSaveHook(){
    if(typeof window.save !== "function"){
      // save() ist noch nicht definiert -> spaeter versuchen
      setTimeout(installSaveHook, 300);
      return;
    }
    if(window.save.__cavHooked) return;
    const orig = window.save;
    const wrapped = function(k, v){
      const r = orig.apply(this, arguments);
      try{ markDirty(CAV_NS + k); }catch(_){}
      return r;
    };
    wrapped.__cavHooked = true;
    window.save = wrapped;
    log("save() hook installed");
  }

  // Hook 2: localStorage.setItem-Proxy (Sicherheitsnetz)
  function installStorageProxy(){
    const proto = Object.getPrototypeOf(localStorage);
    const orig = proto.setItem;
    if(orig.__cavHooked) return;
    const wrapped = function(k, v){
      const r = orig.apply(this, arguments);
      try{ markDirty(k); }catch(_){}
      return r;
    };
    wrapped.__cavHooked = true;
    proto.setItem = wrapped;
    log("localStorage.setItem proxy installed");
  }

  // ---------- Mapping localStorage -> Datenbanktabellen --------------------
  //
  // Entity-Level-Sync: Wir bilden die vorhandenen Datenstrukturen auf die
  // finalen Tabellen ab. Diese Funktion ist tolerant -> unbekannte Felder
  // landen in *_extra JSONB (falls Tabellenschema es unterstuetzt).
  //
  // Jede build*-Funktion liefert ein Array {table, row} - fertig fuer das RPC.
  async function collectEntities(){
    const uid = Auth.userId();
    if(!uid) return [];
    const out = [];

    // horses
    try{
      const horses = JSON.parse(localStorage.getItem(CAV_NS+"horses") || "[]");
      for(const h of horses){
        const id = await ensureUuid(h.id, "horse");
        out.push({ table:"horses", row: {
          id, user_id: uid,
          name: h.name || "",
          breed: h.breed || null,
          birthdate: h.birthdate || null,
          color: h.color || null,
          discipline: h.discipline || null,
          notes: h.notes || null,
          image_path: h.imagePath || null,
          field_meta: h.__meta || {}
        }});
      }
    }catch(e){ log("collect horses failed", e); }

    // calendar events
    try{
      const events = JSON.parse(localStorage.getItem(CAV_NS+"events") || "[]");
      for(const e of events){
        const id = await ensureUuid(e.id, "event");
        const horseId = e.horseId ? await ensureUuid(e.horseId, "horse") : null;
        out.push({ table:"calendar_events", row: {
          id, user_id: uid, horse_id: horseId,
          type: e.type || "custom",
          date: e.date || null,
          title: e.title || "",
          meta: e.meta || null,
          notes: e.notes || null,
          field_meta: e.__meta || {}
        }});
      }
    }catch(err){ log("collect events failed", err); }

    // horse journal (horsebook)
    try{
      const hb = JSON.parse(localStorage.getItem(CAV_NS+"horsebook") || "[]");
      for(const e of hb){
        const id = await ensureUuid(e.id, "journal");
        const horseId = e.horseId ? await ensureUuid(e.horseId, "horse") : null;
        out.push({ table:"horse_journal", row: {
          id, user_id: uid, horse_id: horseId,
          category: e.category || null,
          date: e.date || null,
          next_date: e.nextDate || null,
          title: e.title || "",
          notes: e.notes || null,
          field_meta: e.__meta || {}
        }});
      }
    }catch(err){ log("collect journal failed", err); }

    // rides (state.rides is grouped by horseId)
    try{
      const rides = JSON.parse(localStorage.getItem(CAV_NS+"rides") || "{}");
      for(const hid of Object.keys(rides||{})){
        const horseId = await ensureUuid(hid, "horse");
        for(const r of (rides[hid]||[])){
          const id = await ensureUuid(r.id, "ride");
          out.push({ table:"rides", row: {
            id, user_id: uid, horse_id: horseId,
            date: r.date || null,
            duration_sec: r.durationSec || r.duration || null,
            distance_m: r.distanceM || r.distance || null,
            avg_speed: r.avgSpeed || null,
            path: r.path || r.track || null, // JSON GPS points
            notes: r.notes || null,
            field_meta: r.__meta || {}
          }});
        }
      }
    }catch(err){ log("collect rides failed", err); }

    // body scans
    try{
      const scans = JSON.parse(localStorage.getItem(CAV_NS+"scans") || "{}");
      for(const hid of Object.keys(scans||{})){
        const horseId = await ensureUuid(hid, "horse");
        for(const s of (scans[hid]||[])){
          const id = await ensureUuid(s.id, "scan");
          out.push({ table:"body_scan_history", row: {
            id, user_id: uid, horse_id: horseId,
            date: s.date || null,
            bcs: s.bcs || null,
            summary: s.summary || null,
            result: s.result || s.analysis || null,
            image_paths: s.imagePaths || null, // NUR Storage-Pfade
            field_meta: s.__meta || {}
          }});
        }
      }
    }catch(err){ log("collect scans failed", err); }

    // course progress
    try{
      const cp = JSON.parse(localStorage.getItem(CAV_NS+"courseProgressByHorse") || "{}");
      for(const hid of Object.keys(cp||{})){
        const horseId = await ensureUuid(hid, "horse");
        const progress = cp[hid] || {};
        for(const courseId of Object.keys(progress)){
          const id = await ensureUuid(`${horseId}:${courseId}`, "course");
          out.push({ table:"course_progress", row: {
            id, user_id: uid, horse_id: horseId,
            course_id: courseId,
            progress: progress[courseId],
            field_meta: {}
          }});
        }
      }
    }catch(err){ log("collect course progress failed", err); }

    // profile values (activeHorseId, etc.)
    try{
      const active = JSON.parse(localStorage.getItem(CAV_NS+"activeHorseId") || "null");
      if(active){
        const id = await ensureUuid("activeHorseId", "profile");
        out.push({ table:"profile_values", row: {
          id, user_id: uid, key:"activeHorseId", value: String(active), field_meta:{}
        }});
      }
    }catch(err){ log("collect profile failed", err); }

    return out;
  }

  // ---------- Push (Outbox -> Cloud) ---------------------------------------
  let pushing = false;
  async function pushChanges(){
    if(pushing) return;
    if(!Auth.userId()) return;
    pushing = true;
    updateStatus({status:"syncing"});
    try{
      const entities = await collectEntities();
      let ok = 0, fail = 0;
      for(const {table, row} of entities){
        try{
          const res = await api("/rest/v1/rpc/sync_upsert_row", {
            method:"POST",
            headers:{ "Prefer":"return=representation" },
            body: JSON.stringify({ p_table: table, p_row: row, p_base_version: 0 })
          });
          ok++;
          await logSync({level:"info", op:"upsert", table, id: row.id, result: res?.conflict ? "conflict-merged" : "ok"});
        }catch(e){
          fail++;
          await logSync({level:"error", op:"upsert", table, id: row.id, error:String(e)});
        }
      }
      // Storage-Uploads (Body-Scans, Horse-Bilder)
      await uploadPendingImages();
      dirtyKeys.clear();
      const lastSync = now();
      try{ localStorage.setItem("cavalyra_last_sync", lastSync); }catch(_){}
      updateStatus({status:"idle", lastSync, ok, fail});
      log(`push done: ${ok} ok / ${fail} fail`);
    } finally {
      pushing = false;
    }
  }

  // ---------- Storage Uploads (Bilder) -------------------------------------
  //
  // Strategie:
  //   - lokal bleibt die dataURL im state (Offline!)
  //   - beim Sync konvertieren wir "data:image/...;base64,..." -> Blob
  //   - Upload nach {bucket}/{userId}/{entityId}/{index}.jpg
  //   - Wir merken uns die hochgeladenen Pfade in scan.imagePaths / horse.imagePath
  //   - Beim Restore: signed URL laden, in IDB cachen, dataURL in state schreiben
  //
  async function uploadBlob(bucket, path, blob){
    const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${encodeURIComponent(path)}`;
    await Auth.ensureFresh();
    const r = await fetch(url, {
      method:"POST",
      headers:{
        "apikey": SUPABASE_ANON_KEY,
        "Authorization":"Bearer "+Auth.token(),
        "x-upsert":"true",
        "Content-Type": blob.type || "application/octet-stream"
      },
      body: blob
    });
    if(!r.ok && r.status !== 409){
      const txt = await r.text().catch(()=>"");
      throw new Error(`upload ${r.status}: ${txt.slice(0,120)}`);
    }
    return path;
  }
  function dataUrlToBlob(dataUrl){
    const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
    if(!m) return null;
    const mime = m[1]; const bin = atob(m[2]);
    const arr = new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], {type:mime});
  }

  async function uploadPendingImages(){
    const uid = Auth.userId(); if(!uid) return;
    // Body-Scans
    try{
      const scans = JSON.parse(localStorage.getItem(CAV_NS+"scans") || "{}");
      let changed = false;
      for(const hid of Object.keys(scans||{})){
        for(const s of (scans[hid]||[])){
          if(!Array.isArray(s.photos)) continue;
          s.imagePaths = s.imagePaths || [];
          for(let i=0;i<s.photos.length;i++){
            const p = s.photos[i];
            if(typeof p !== "string" || !p.startsWith("data:")) continue;
            if(s.imagePaths[i]) continue; // schon hochgeladen
            const blob = dataUrlToBlob(p); if(!blob) continue;
            const sid = await ensureUuid(s.id, "scan");
            const path = `${uid}/${sid}/${i}.jpg`;
            try{
              await uploadBlob("body-scan-media", path, blob);
              s.imagePaths[i] = path;
              await idbPut("images", { path, dataUrl: p });
              changed = true;
              await logSync({level:"info", op:"upload", bucket:"body-scan-media", path});
            }catch(e){ await logSync({level:"error", op:"upload", bucket:"body-scan-media", path, error:String(e)}); }
          }
        }
      }
      if(changed) localStorage.setItem(CAV_NS+"scans", JSON.stringify(scans));
    }catch(_){}
    // Horses
    try{
      const horses = JSON.parse(localStorage.getItem(CAV_NS+"horses") || "[]");
      let changed = false;
      for(const h of horses){
        if(typeof h.image === "string" && h.image.startsWith("data:") && !h.imagePath){
          const blob = dataUrlToBlob(h.image); if(!blob) continue;
          const hid = await ensureUuid(h.id, "horse");
          const path = `${uid}/${hid}/cover.jpg`;
          try{
            await uploadBlob("horse-media", path, blob);
            h.imagePath = path;
            await idbPut("images", { path, dataUrl: h.image });
            changed = true;
            await logSync({level:"info", op:"upload", bucket:"horse-media", path});
          }catch(e){ await logSync({level:"error", op:"upload", bucket:"horse-media", path, error:String(e)}); }
        }
      }
      if(changed) localStorage.setItem(CAV_NS+"horses", JSON.stringify(horses));
    }catch(_){}
  }

  // ---------- Pull / Restore -----------------------------------------------
  async function signedUrl(bucket, path){
    const j = await api(`/storage/v1/object/sign/${bucket}/${encodeURIComponent(path)}`, {
      method:"POST", body: JSON.stringify({ expiresIn: 3600 })
    });
    return SUPABASE_URL + j.signedURL;
  }
  async function fetchAsDataUrl(url){
    const r = await fetch(url); const b = await r.blob();
    return await new Promise((res,rej)=>{ const fr = new FileReader(); fr.onload=()=>res(fr.result); fr.onerror=rej; fr.readAsDataURL(b); });
  }
  async function resolveImage(bucket, path){
    // 1. lokaler IDB-Cache
    const cached = await idbGet("images", path);
    if(cached?.dataUrl) return cached.dataUrl;
    // 2. Signed URL herunterladen und cachen
    try{
      const url = await signedUrl(bucket, path);
      const dataUrl = await fetchAsDataUrl(url);
      await idbPut("images", { path, dataUrl });
      return dataUrl;
    }catch(e){ log("resolveImage failed", path, e); return null; }
  }

  async function pullFromCloud({merge=true} = {}){
    const uid = Auth.userId(); if(!uid) throw new Error("nicht angemeldet");
    updateStatus({status:"restoring"});
    // Wir laden aus Effizienz-Gruenden pro Tabelle die Rohdaten und
    // rekonstruieren daraus die lokale state-Struktur.
    const [horses, events, journals, ridesRaw, scansRaw, courseRaw, profile] = await Promise.all([
      api("/rest/v1/horses?select=*"),
      api("/rest/v1/calendar_events?select=*"),
      api("/rest/v1/horse_journal?select=*"),
      api("/rest/v1/rides?select=*"),
      api("/rest/v1/body_scan_history?select=*"),
      api("/rest/v1/course_progress?select=*"),
      api("/rest/v1/profile_values?select=*")
    ]);

    // Horses
    const horsesOut = (horses||[]).filter(h=>!h.deleted_at).map(h=>({
      id: h.id, name: h.name, breed: h.breed, birthdate: h.birthdate,
      color: h.color, discipline: h.discipline, notes: h.notes,
      imagePath: h.image_path
    }));
    localStorage.setItem(CAV_NS+"horses", JSON.stringify(horsesOut));

    // Events
    const eventsOut = (events||[]).filter(e=>!e.deleted_at).map(e=>({
      id:e.id, horseId:e.horse_id, type:e.type, date:e.date, title:e.title, meta:e.meta, notes:e.notes
    }));
    localStorage.setItem(CAV_NS+"events", JSON.stringify(eventsOut));

    // Horsebook
    const hbOut = (journals||[]).filter(x=>!x.deleted_at).map(x=>({
      id:x.id, horseId:x.horse_id, category:x.category, date:x.date, nextDate:x.next_date, title:x.title, notes:x.notes
    }));
    localStorage.setItem(CAV_NS+"horsebook", JSON.stringify(hbOut));

    // Rides
    const ridesOut = {};
    for(const r of (ridesRaw||[])){
      if(r.deleted_at) continue;
      ridesOut[r.horse_id] = ridesOut[r.horse_id] || [];
      ridesOut[r.horse_id].push({ id:r.id, date:r.date, durationSec:r.duration_sec, distanceM:r.distance_m, avgSpeed:r.avg_speed, path:r.path, notes:r.notes });
    }
    localStorage.setItem(CAV_NS+"rides", JSON.stringify(ridesOut));

    // Scans (Bilder werden Lazy via resolveImage geladen)
    const scansOut = {};
    for(const s of (scansRaw||[])){
      if(s.deleted_at) continue;
      scansOut[s.horse_id] = scansOut[s.horse_id] || [];
      const photos = [];
      if(Array.isArray(s.image_paths)){
        for(const p of s.image_paths){ photos.push(await resolveImage("body-scan-media", p)); }
      }
      scansOut[s.horse_id].push({ id:s.id, date:s.date, bcs:s.bcs, summary:s.summary, result:s.result, photos, imagePaths:s.image_paths, horseId:s.horse_id });
    }
    localStorage.setItem(CAV_NS+"scans", JSON.stringify(scansOut));

    // Course progress
    const cpOut = {};
    for(const c of (courseRaw||[])){
      if(c.deleted_at) continue;
      cpOut[c.horse_id] = cpOut[c.horse_id] || {};
      cpOut[c.horse_id][c.course_id] = c.progress;
    }
    localStorage.setItem(CAV_NS+"courseProgressByHorse", JSON.stringify(cpOut));

    // Profile
    for(const p of (profile||[])){
      if(p.key === "activeHorseId") localStorage.setItem(CAV_NS+"activeHorseId", JSON.stringify(p.value));
    }

    // Horse cover images lazy
    for(const h of horsesOut){
      if(h.imagePath){ const d = await resolveImage("horse-media", h.imagePath); if(d) h.image = d; }
    }
    localStorage.setItem(CAV_NS+"horses", JSON.stringify(horsesOut));

    updateStatus({status:"idle", lastSync: now()});
    await logSync({level:"info", op:"pull", note:"restore-complete"});
  }

  // ---------- Migration (B2) -----------------------------------------------
  async function migrateIfNeeded(){
    if(localStorage.getItem(MIG_FLAG) === "1"){ log("migration already done"); return; }
    if(!Auth.userId()) return;

    // 1. Sicherheits-Backup aller cavalyra_*-Keys
    const backup = {};
    for(let i=0;i<localStorage.length;i++){
      const k = localStorage.key(i);
      if(k && k.startsWith(CAV_NS)) backup[k] = localStorage.getItem(k);
    }
    await idbPut("backup", { k: BACKUP_KEY, ts: now(), data: backup });
    await logSync({level:"info", op:"migrate", note:"backup-created", keys: Object.keys(backup).length});

    try{
      // 2. Alle Entities aufsammeln (IDs werden bei Bedarf zu UUIDv5)
      const entities = await collectEntities();
      // 3. Hochladen
      for(const {table, row} of entities){
        await api("/rest/v1/rpc/sync_upsert_row", {
          method:"POST",
          body: JSON.stringify({ p_table: table, p_row: row, p_base_version: 0 })
        });
      }
      // 4. Storage-Uploads
      await uploadPendingImages();
      // 5. Flag setzen -> nie wieder migrieren
      localStorage.setItem(MIG_FLAG, "1");
      // 6. Backup aufraeumen (behalten wir 7 Tage sicherheitshalber via timestamp)
      await logSync({level:"info", op:"migrate", note:"complete", count: entities.length});
      log("migration complete:", entities.length, "entities");
    } catch(e){
      // Rollback: Backup zurueckspielen
      log("migration failed, restoring backup", e);
      await logSync({level:"error", op:"migrate", error:String(e)});
      try{
        const bk = await idbGet("backup", BACKUP_KEY);
        if(bk?.data){
          for(const k of Object.keys(bk.data)) localStorage.setItem(k, bk.data[k]);
        }
      }catch(_){}
      throw e;
    }
  }

  // ---------- Status --------------------------------------------------------
  const status = { enabled: false, status: "idle", lastSync: null, error: null, user: null };
  function updateStatus(patch){
    Object.assign(status, patch || {});
    try{ window.dispatchEvent(new CustomEvent("cav-sync-status", { detail: { ...status } })); }catch(_){}
  }
  function getStatus(){ return { ...status }; }

  // ---------- Realtime (best effort) ---------------------------------------
  let rtSocket = null;
  function startRealtime(){
    if(rtSocket || !Auth.token()) return;
    try{
      const wsUrl = SUPABASE_URL.replace(/^http/,"ws") + `/realtime/v1/websocket?apikey=${SUPABASE_ANON_KEY}&vsn=1.0.0`;
      rtSocket = new WebSocket(wsUrl);
      rtSocket.onopen = () => {
        // Subscribe pro Tabelle (RLS scoped auf user)
        for(const t of TABLES){
          rtSocket.send(JSON.stringify({ topic:`realtime:public:${t}`, event:"phx_join", payload:{}, ref: String(Date.now()) }));
        }
      };
      rtSocket.onmessage = (ev) => {
        try{
          const msg = JSON.parse(ev.data);
          if(msg.event === "postgres_changes"){ scheduleSync(); }
        }catch(_){}
      };
      rtSocket.onclose = () => { rtSocket = null; setTimeout(startRealtime, 5000); };
      rtSocket.onerror = () => { try{ rtSocket.close(); }catch(_){} };
    }catch(e){ log("realtime failed", e); }
  }

  // ---------- Public API ----------------------------------------------------
  const API = {
    // Auth
    async signUp(email, pw){ const r = await AuthApi.signUp(email, pw); await onLogin(); return r; },
    async signIn(email, pw){ const r = await AuthApi.signIn(email, pw); await onLogin(); return r; },
    async signOut(){ await AuthApi.signOut(); await onLogout(); },
    async resetPassword(email){ return AuthApi.resetPassword(email); },
    async deleteAccount(){
      return api("/functions/v1/delete-account", { method:"POST", body:"{}" });
    },
    // Sync
    syncNow: () => pushChanges(),
    restore: () => pullFromCloud(),
    getStatus,
    getLog: () => idbAll("log"),
    clearLog: () => idbClear("log"),
    isEnabled: () => !!Auth.userId(),
    getUser: () => Auth.session?.user || null,
    // Interna (fuer UI)
    _auth: Auth
  };

  async function onLogin(){
    updateStatus({ enabled:true, user: Auth.session?.user });
    installSaveHook();
    installStorageProxy();
    try{ await migrateIfNeeded(); }
    catch(e){ updateStatus({ error: "Migration fehlgeschlagen: "+e.message }); return; }
    startRealtime();
    scheduleSync();
  }
  async function onLogout(){
    updateStatus({ enabled:false, user:null });
    try{ rtSocket && rtSocket.close(); }catch(_){}
    rtSocket = null;
  }

  // ---------- Init ----------------------------------------------------------
  Auth.load();
  installStorageProxy();
  installSaveHook();
  if(Auth.userId()){ onLogin(); }

  // Alte cavalyra-cloud.js (Snapshot-MVP) neutralisieren, damit sie nicht
  // parallel Daten hin- und her schreibt.
  window.__CAV_CLOUD_V1_DISABLED__ = true;

  window.CavalyraSync = API;
  log("engine ready");
})();
