/**
 * The occupant chip, rendered from the two fields the server already computed
 * and nothing else.
 *
 * ── WHY THIS FILE IS SO SMALL, WHICH IS THE POINT ───────────────────────────
 *
 * A rooming board's chip has to satisfy two things at once: two travellers
 * sitting side by side in one room must be tellable apart at a glance, and the
 * SAME traveller must look the same everywhere they appear — the board today,
 * the seating grid later. Both are properties of the traveller, so both are
 * computed once, server-side, and published as `glyph` (initials) and `tone`
 * (a token like `"male.3"`).
 *
 * So there is no client-side colour maths here: no hashing a traveller id, no
 * palette lookup keyed on gender, no "pick a colour from this list by index".
 * Every one of those would be a second, independent implementation of a canon
 * the engine already owns, and two implementations of a canon is exactly how
 * the same person ends up two colours in two screens.
 *
 * `tone` is a TOKEN and never a hex, which is the other half of the split: the
 * engine owns the identity, the consumer owns the brand. This function turns
 * the token into a class name; `browser/styles.css` is where the actual colour
 * values live, because they belong to whoever owns the design, not to the API.
 */

/** The two halves of a tone token, e.g. `"male.3"` → `{ family: 'male', shade: 3 }`. */
export interface ToneToken {
  readonly family: string;
  readonly shade: number;
}

/**
 * Reads a tone token. Returns `undefined` rather than throwing or guessing on
 * anything that is not one — including a hex, which is the specific mistake
 * worth failing loudly on, because a hex arriving here would mean the engine
 * had started shipping brand colour and this whole split had quietly collapsed.
 *
 * Deliberately not validated against a list of known families or a shade
 * range: this file must not carry a second copy of the engine's vocabulary
 * (that is the thing it exists to avoid). It reads the token's SHAPE, and the
 * simulator's step 19 is where the vocabulary itself is asserted.
 */
export function parseToneToken(tone: string): ToneToken | undefined {
  const match = /^([a-z]+)\.(\d+)$/.exec(tone);
  if (match === null) {
    return undefined;
  }
  const [, family, shade] = match;
  if (family === undefined || shade === undefined) {
    return undefined;
  }
  return { family, shade: Number(shade) };
}

export interface OccupantChip {
  /** Rendered verbatim from the server's `glyph` — never re-derived from the name. */
  readonly glyph: string;
  /**
   * The token's two coordinates as two CSS classes:
   * `"male.3"` → `"tone-family-male tone-shade-3"`.
   *
   * Two rather than one (`tone-male-3`) because the token genuinely has two
   * independent halves, and splitting them is what keeps the consumer's palette
   * small: `browser/styles.css` maps four families to four hues and eight shades
   * to eight lightnesses — twelve rules — instead of thirty-two flat colours
   * that a designer then has to keep consistent by hand. The mapping stays a
   * pure rename of what the server said; no arithmetic on the shade number
   * happens here or anywhere in TypeScript.
   */
  readonly toneClass: string;
}

/**
 * Turns a server-supplied occupant mark into the two values a chip renders
 * with. Takes the mark's two fields rather than a whole `Occupant`, so that
 * nothing here can reach a name, a gender, or a traveller id and be tempted to
 * derive anything from them.
 *
 * An unreadable token falls back to a single neutral class rather than throwing:
 * a chip must still appear, because a traveller silently missing from a rooming
 * board is discovered at a hotel desk at 11pm. The fallback is visibly neutral,
 * not a guessed colour.
 */
export function occupantChip(mark: { readonly glyph: string; readonly tone: string }): OccupantChip {
  const token = parseToneToken(mark.tone);
  return {
    glyph: mark.glyph,
    toneClass:
      token === undefined
        ? 'tone-unreadable'
        : `tone-family-${token.family} tone-shade-${String(token.shade)}`,
  };
}
