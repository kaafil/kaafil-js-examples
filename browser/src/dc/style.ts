import type * as React from 'react';

// The design's markup carries every style as an inline `style="a:b;c:d"`
// string (see browser/.design/template.html). `s()` parses that string into
// the React.CSSProperties object React expects, once per distinct string —
// it is called on every render for ~600 elements, so both the parse cost
// and the object identity are memoised: the same input string always
// returns the exact same (frozen) object, which also keeps React from
// treating an unchanged style as a new prop.
const cache = new Map<string, React.CSSProperties>();

function kebabToCamel(prop: string): string {
  // Custom properties (--foo) are passed through untouched — camel-casing
  // a custom property name would change its identity.
  if (prop.startsWith('--')) return prop;
  return prop.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

function parse(css: string): React.CSSProperties {
  const out: Record<string, string> = {};
  // Split on ';' at the top level only. Declaration values can themselves
  // contain ';'-free but colon-bearing content (url(...), data:, time
  // values) so we must NOT split values — only split declarations here.
  const decls = css.split(';');
  for (const raw of decls) {
    const decl = raw.trim();
    if (decl === '') continue; // empty / whitespace-only entries, trailing ';'
    const colonIndex = decl.indexOf(':');
    if (colonIndex === -1) continue; // malformed declaration, ignore
    const prop = decl.slice(0, colonIndex).trim();
    const value = decl.slice(colonIndex + 1).trim();
    if (prop === '' || value === '') continue;
    out[kebabToCamel(prop)] = value;
  }
  return Object.freeze(out) as React.CSSProperties;
}

export function s(css: string): React.CSSProperties {
  const cached = cache.get(css);
  if (cached !== undefined) return cached;
  const parsed = parse(css);
  cache.set(css, parsed);
  return parsed;
}

// The design occasionally concatenates conditional declaration fragments
// (e.g. a base style plus a state-dependent one) before handing the result
// to the style parser. `sx` joins the truthy parts with ';' and parses the
// result through the same memoised path as `s`.
export function sx(...parts: (string | false | null | undefined)[]): React.CSSProperties {
  return s(parts.filter((p): p is string => Boolean(p)).join(';'));
}
