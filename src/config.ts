// ============================================================================
// Cavalyra – zentrale Konfiguration
// ============================================================================
// REVIEW_MODE: Wenn true, sind alle Premium-/Pro-Funktionen ohne Zahlung
// oder Login freigeschaltet. Ausschließlich für App-Store- und Google-Play-
// Review-Zwecke. In Produktion muss dieser Wert auf false stehen.
//
// Diese Datei ist die EINZIGE Stelle im Code, an der REVIEW_MODE definiert wird.
// Alle anderen Stellen greifen über das globale
// window.CAVALYRA_REVIEW_MODE-Flag oder die exportierte hasProAccess-Funktion zu.
// ============================================================================
export const REVIEW_MODE = true;

// Sofort global verfügbar machen, damit auch Scripts, die nicht von Vite
// gebündelt werden (z. B. /billing/cavalyra-billing.js), den Wert lesen können.
try {
  (window as any).CAVALYRA_REVIEW_MODE = REVIEW_MODE;
  console.log("[CavalyraConfig] REVIEW_MODE =", REVIEW_MODE);
} catch (_e) {
  // Sicherheitshalber ignorieren, falls window nicht verfügbar ist.
}

/** Zentrale Pro-Zugriffsprüfung. */
export function hasProAccess(userIsPro: boolean): boolean {
  return REVIEW_MODE || userIsPro;
}
