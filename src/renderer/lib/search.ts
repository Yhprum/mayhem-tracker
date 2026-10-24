// Text as a search compares it: no case, accents, punctuation, symbols, or
// spaces, and full-width letters read as their ordinary forms. "José#BR1" then
// answers to "jose br1", and "Kai'Sa" to "kaisa".
function fold(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\p{M}\p{P}\p{S}\p{Z}]/gu, "")
    .toLowerCase();
}

// Whether `text` holds what was typed into a search box
export function matchesSearch(text: string, query: string): boolean {
  return fold(text).includes(fold(query));
}
