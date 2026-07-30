import { SECTION_ALIASES } from "./section-aliases.js";

export class HeadingNormalizer {
  public normalize(heading: string): string | null {
    const normalized = this.clean(heading);

    let partialMatch: string | null = null;

    for (const [canonical, aliases] of Object.entries(SECTION_ALIASES)) {
      for (const alias of aliases) {
        const cleanedAlias = this.clean(alias);

        // 1. Exact match (highest priority)
        if (normalized === cleanedAlias) {
          return canonical;
        }

        // 2. Prefix match
        if (
          partialMatch === null &&
          normalized.startsWith(cleanedAlias)
        ) {
          partialMatch = canonical;
        }

        // 3. Contains match (lowest priority)
        if (
          partialMatch === null &&
          normalized.includes(cleanedAlias)
        ) {
          partialMatch = canonical;
        }
      }
    }

    return partialMatch;
  }

  private clean(text: string): string {
    return text
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^\w\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
}