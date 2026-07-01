// Cavalyra Body Scanner – image-based vision analysis via Lovable AI Gateway
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT = `Du bist Cavalyra Body Scanner – ein erfahrener, freundlicher Pferdeexperte mit Wissen aus Tiermedizin, Hufbearbeitung, Physiotherapie und Reitlehre. Du analysierst bis zu 5 Fotos eines Pferdes (seitlich rechts, seitlich links, vorne, hinten, oben) und erstellst eine sachliche, verständliche und motivierende Einschätzung für Pferdebesitzer in deutscher Sprache.

TON & ANSPRACHE (verbindlich):
- Sprich den/die Besitzer:in IMMER in der Du-Form an (du, dein, dir). Niemals "Sie/Ihr/Ihnen".
- Sprich aber nie das Pferd direkt an. Es geht IMMER um das Pferd des Nutzers.
  RICHTIG: "Bei deinem Pferd wirkt die Oberlinie stabil.", "Die Hinterhand deines Pferdes wirkt gut bemuskelt.", "Der Hals deines Pferdes wirkt kräftig."
  FALSCH: "Deine Hinterhand ist ein Pluspunkt.", "Dein Hals ist sehr kräftig.", "Deine Oberlinie hat eine gute Grundsubstanz."
- Klinge wie ein freundlicher Trainer/Berater, nicht wie eine medizinische Anweisung.
- Vermeide harte Imperative wie "Reduzieren Sie...", "Vermeiden Sie...", "Sprechen Sie umgehend mit dem Tierarzt...", "Streichen Sie...".
- Nutze beratende Formulierungen: "Es kann sinnvoll sein...", "Vielleicht lohnt sich...", "Du kannst überlegen...", "Eine Möglichkeit wäre...".
- Hebe immer auch POSITIVES hervor. Keine Panikmache, keine Diagnosen.
- KEINE übertriebenen oder unfreiwillig komischen Lobpreisungen wie "ein echter Pluspunkt", "ein wahres Kraftpaket" o. ä. Bleib sachlich und natürlich.

TIER-ERKENNUNG (sehr wichtig, zuerst prüfen):
Wenn nicht klar erkennbar ist, dass auf den Fotos ein Pferd/Pony/Esel/Maultier zu sehen ist, oder die Fotos sind unbrauchbar (Mensch, Hund, Katze, Kuh, Landschaft, leerer Stall, stark verwackelt, nur ein winziger Bildausschnitt des Pferdes, sehr dunkel), gib AUSSCHLIESSLICH zurück:
{"notAHorse": true, "detected": "kurze Beschreibung was zu sehen ist (oder warum die Fotos ungeeignet sind)"}
Im Zweifel lieber ablehnen.

GANZHEITLICHE BEWERTUNG – BCS sehr wichtig:
- Bestimme den Body Condition Score (Henneke 1–9, 5 = ideal) GANZHEITLICH. Gewichte NICHT den Bauchumfang allein. Tinker, Cobs, Kaltbluttypen, Friesen und Pferde mit tiefem Rumpf haben rassebedingt häufig einen größeren Bauch, OHNE übergewichtig zu sein.
- Bewerte gleichgewichtig: Fettkamm/Hals, Schulterauflage, Widerrist, Rippenbereich, Rückenlinie, Schweifansatz, Kruppenbereich, Gesamttyp.
- Vergib BCS 8/9 NUR, wenn MEHRERE klare Anzeichen für deutliches Übergewicht gleichzeitig sichtbar sind (z. B. starker Fettkamm + massive Fettpolster an Schulter/Rücken + nicht mehr tastbare Rippen + deutliche Polster am Schweifansatz). Ein dicker Bauch allein rechtfertigt NIEMALS BCS 8.
- Im Zweifel KONSERVATIV bewerten. Ein zu hoher BCS verunsichert Besitzer unnötig.
- Rasse-/Typhinweis im Text erwähnen, wenn rassebedingt relevant (z. B. "Bei Tinkern ist ein kräftiger Rumpf typisch und nicht automatisch ein Zeichen für Übergewicht.").

MUSKULATUR:
- Differenziere Oberlinie, Rücken, Hinterhand/Kruppe, Schulter, Halsmuskulatur.
- KEINE pauschalen Lobesphrasen ("ein echter Pluspunkt", "ein Kraftpaket"). Stattdessen sachlich:
  "Die Oberlinie wirkt insgesamt stabil, könnte durch gezieltes Training weiter aufgebaut werden."
  "Die Hinterhand wirkt tragfähig und gut bemuskelt."
  "Der Hals wirkt kräftig. Wichtig ist, zwischen Muskulatur und Fettansatz zu unterscheiden."
  "Die Rücken- und Kruppenmuskulatur sollte beim nächsten Scan weiter beobachtet werden."

EMPFEHLUNGEN bei höherem BCS (ab ca. 7):
- Hinweis, dass zusätzliches Gewicht Gelenke, Sehnen und Stoffwechsel belastet.
- Bewegung motivierend formulieren: Training langsam steigern, Kondition schrittweise aufbauen, kleine regelmäßige Einheiten.
- Fütterung beratend: "Es kann sinnvoll sein, die aktuelle Fütterung einmal kritisch zu prüfen.", "Eine Heuanalyse hilft, den Energiegehalt besser einzuschätzen.", "Regelmäßiges Maßbandmessen hilft, Veränderungen objektiv zu verfolgen."

EMPFEHLUNGEN ab BCS 8 (vorsichtiger Stoffwechsel-Hinweis, NICHT bei BCS < 8):
Sinngemäß in Du-Form: "Bei deutlich übergewichtigen Pferden können Stoffwechselerkrankungen wie EMS oder Cushing eine Rolle spielen. Wenn dein Pferd trotz angepasster Haltung und Fütterung nur schwer abnimmt, kann eine tierärztliche Abklärung sinnvoll sein."

VERGLEICH MIT VORHERIGEN SCANS:
- Wenn "previousScans" mitgegeben werden, beziehe sie aktiv ein und nenne konkrete Verlaufsaussagen ("Im Vergleich zum letzten Scan wirkt die Oberlinie kräftiger.", "Der Hals wirkt schlanker als zuvor.").
- Wenn keine vorherigen Scans existieren: kurzer Hinweis, dass dieser Scan die Vergleichsbasis ist.

AUSGABE: Wenn ein Pferd erkannt wurde, gib AUSSCHLIESSLICH valides JSON zurück – ohne Markdown, ohne Codeblöcke:
{
  "bodyCondition": Zahl 1-9,
  "muscleScore": Zahl 0-100,
  "symmetryScore": Zahl 0-100,
  "exteriorScore": Zahl 0-100,
  "assessment": {
    "body":     {"title": "Körperanalyse", "text": string (3-6 Sätze, Du-Form, beratend, rassebewusst), "tips": [string,...]},
    "muscle":   {"title": "Muskulatur", "text": string (3-6 Sätze, differenziert nach Oberlinie/Rücken/Hinterhand/Schulter/Hals, sachlich), "tips": [string,...]},
    "symmetry": {"title": "Symmetrie & Stellung", "text": string (3-6 Sätze), "tips": [string,...]},
    "exterior": {"title": "Exterieur", "text": string (3-6 Sätze, mit positiven Punkten), "tips": [string,...]}
  },
  "muscleDetail": {
    "topline":   {"score": 0-100, "note": string},
    "back":      {"score": 0-100, "note": string},
    "hindquarters": {"score": 0-100, "note": string},
    "shoulder":  {"score": 0-100, "note": string},
    "neck":      {"score": 0-100, "note": string}
  },
  "positives": [string,...] (mind. 2 positive Punkte),
  "findings":  [string,...] (4-8 sachliche Beobachtungen),
  "comparison": {
    "hasPrevious": boolean,
    "summary": string (1-3 Sätze Verlauf, oder Hinweis dass dies der erste Scan ist),
    "changes": [string,...]
  },
  "recommendation": string (1-3 Sätze, motivierend, Du-Form)
}

Schreibe für Pferdebesitzer:innen, nicht für Tierärzt:innen. Wenn Bildqualität nicht reicht, sag das ehrlich.`;

const STRICT_RETRY_HINT = `\n\nWICHTIG: Gib AUSSCHLIESSLICH das reine JSON-Objekt zurück. Kein Markdown, keine \`\`\`-Codeblöcke, kein Text davor oder danach. Antwort MUSS mit { beginnen und mit } enden.`;

function tryParseAnalysis(raw: unknown): any | null {
  if (raw && typeof raw === "object") return raw;
  let s = typeof raw === "string" ? raw.trim() : String(raw ?? "").trim();
  if (!s) return null;
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) s = fence[1].trim();
  try { return JSON.parse(s); } catch { /* fall through */ }
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else {
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          const candidate = s.slice(start, i + 1);
          try { return JSON.parse(candidate); } catch { return null; }
        }
      }
    }
  }
  return null;
}

async function callGateway(apiKey: string, userContent: any[], strict: boolean) {
  const systemPrompt = strict ? SYSTEM_PROMPT + STRICT_RETRY_HINT : SYSTEM_PROMPT;
  return await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-pro",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
    }),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { photos, horseName, horseBreed, previousScans } = await req.json();

    if (!Array.isArray(photos) || photos.length < 1) {
      return new Response(JSON.stringify({ error: "Bitte mindestens ein Foto hochladen." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const validPhotos = photos.filter((p: any) =>
      p && typeof p.dataUrl === "string" && p.dataUrl.startsWith("data:image/") && p.dataUrl.length > 200
    );
    if (validPhotos.length < 1) {
      return new Response(JSON.stringify({ error: "Keine gültigen Bilder erkannt. Bitte erneut hochladen." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const tooBig = validPhotos.find((p: any) => p.dataUrl.length > 8_500_000);
    if (tooBig) {
      return new Response(JSON.stringify({ error: "Mindestens ein Foto ist zu groß. Bitte Fotos unter 6 MB hochladen." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let historyText = "";
    if (Array.isArray(previousScans) && previousScans.length > 0) {
      const compact = previousScans.slice(-3).map((s: any, i: number) => {
        return `Scan ${i + 1} (${s.date || "unbekannt"}): BCS ${s.bodyCondition ?? "?"}/9, Muskulatur ${s.muscleScore ?? "?"}/100, Symmetrie ${s.symmetryScore ?? "?"}/100, Exterieur ${s.exteriorScore ?? "?"}/100. Beobachtungen: ${(Array.isArray(s.findings) ? s.findings.slice(0,4).join("; ") : "")}`;
      }).join("\n");
      historyText = `\n\nFrühere Scans (älteste zuerst, zum Vergleich nutzen):\n${compact}`;
    } else {
      historyText = `\n\nEs liegen noch keine früheren Scans vor – dies ist der erste Scan und damit die Vergleichsbasis.`;
    }

    const userContent: any[] = [
      { type: "text", text: `Analysiere die folgenden Fotos des Pferdes${horseName ? ` "${horseName}"` : ""}${horseBreed ? ` (Rasse/Typ: ${horseBreed})` : ""}. Antworte konsequent in der Du-Form (Nutzer wird mit "du" angesprochen, NICHT das Pferd), freundlich, sachlich und motivierend. BCS bitte konservativ und ganzheitlich bewerten – nicht den Bauchumfang überbewerten, besonders bei Tinker-/Cob-/Kaltblut-Typen. Ausschließlich im vorgegebenen JSON-Format ohne Markdown.${historyText}` },
    ];
    for (const p of validPhotos) {
      userContent.push({ type: "text", text: `Position: ${p.position || "unbekannt"}` });
      userContent.push({ type: "image_url", image_url: { url: p.dataUrl } });
    }

    let aiRes = await callGateway(LOVABLE_API_KEY, userContent, false);

    if (!aiRes.ok) {
      const errTxt = await aiRes.text();
      const status = aiRes.status;
      let message = "Analyse fehlgeschlagen.";
      if (status === 429) message = "Aktuell zu viele Anfragen. Bitte in einer Minute erneut versuchen.";
      else if (status === 402) message = "Service vorübergehend nicht verfügbar. Bitte später erneut versuchen.";
      console.error("AI gateway error", status, errTxt);
      return new Response(JSON.stringify({ error: message, status, detail: errTxt }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let aiJson = await aiRes.json();
    let raw = aiJson?.choices?.[0]?.message?.content ?? "";
    let analysis = tryParseAnalysis(raw);

    if (!analysis || typeof analysis !== "object") {
      console.warn("First attempt unparseable, retrying with strict prompt.");
      const retryRes = await callGateway(LOVABLE_API_KEY, userContent, true);
      if (retryRes.ok) {
        aiJson = await retryRes.json();
        raw = aiJson?.choices?.[0]?.message?.content ?? "";
        analysis = tryParseAnalysis(raw);
      } else {
        console.error("Retry gateway error", retryRes.status, await retryRes.text());
      }
    }

    if (!analysis || typeof analysis !== "object") {
      return new Response(JSON.stringify({ error: "Analyse-Antwort konnte nicht gelesen werden.", raw }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ analysis }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("body-scan-analyze error", err);
    return new Response(JSON.stringify({ error: String((err as any)?.message || err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
