import source from "./deep-indigo.css?raw";
import sakuraSource from "./sakura-blush.css?raw";
import {
  Design,
  indigo,
  sakura,
  presets,
  rgb,
  Selection,
  Tokens,
  validateSelection,
} from "./model";

// Preserve the supplied v6.3 layout/selector fixes in one source, deriving its
// secondary shades from the nearest semantic anchor (no runtime color-mix).
function recolor(
  channels: number[],
  tokens: Tokens,
  referenceTokens: Tokens,
): number[] {
  const anchors: [number[], keyof Tokens][] = [
    [rgb(referenceTokens.accent), "accent"],
    [rgb(referenceTokens === indigo ? "#4657d6" : "#df5993"), "highlight"],
    [rgb(referenceTokens.highlight), "highlight"],
    [rgb(referenceTokens.background), "background"],
    [rgb(referenceTokens.surface), "surface"],
    [rgb(referenceTokens.surfaceRaised), "surfaceRaised"],
    [rgb(referenceTokens.text), "text"],
    [rgb(referenceTokens.textMuted), "textMuted"],
    [rgb(referenceTokens.border), "border"],
  ];
  // Pure black/white shadow and texture colors remain neutral.
  if (channels.every((x) => x === 0) || channels.every((x) => x === 255))
    return channels;
  const [base, key] = anchors.sort(
    (a, b) => distance(channels, a[0]) - distance(channels, b[0]),
  )[0];
  const target = rgb(tokens[key]);
  const reference = rgb(referenceTokens[key]);
  return channels.map((v, i) =>
    Math.max(
      0,
      Math.min(
        255,
        Math.round(
          v +
            (target[i] - reference[i]) * (base[i] / Math.max(1, reference[i])),
        ),
      ),
    ),
  );
}
function distance(a: number[], b: number[]) {
  return a.reduce((n, v, i) => n + (v - b[i]) ** 2, 0);
}
export function designFor(s: Selection): Design {
  return s.mode === "preset"
    ? {
        tokens: presets.find((p) => p.id === s.presetId)!.tokens,
        effects: { gradient: 100, blur: 12, radius: 14, reducedMotion: true },
      }
    : s;
}
export function generateCSS(input: Selection): string {
  const s = validateSelection(input);
  if (s.mode === "original" || s.mode === "imported") return "";
  const { tokens, effects } = designFor(s);
  const isSakura = s.presetId === "sakura-blush";
  if (isSakura && s.mode === "preset") return sakuraSource;
  const referenceTokens = isSakura ? sakura : indigo;
  const variables: string[] = [];
  const cache = new Map<string, string>();
  const css = (isSakura ? sakuraSource : source)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(
      /#[0-9a-f]{6}\b|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+(?:\s*,\s*[\d.]+)?\s*\)/gi,
      (literal) => {
        if (cache.has(literal)) return cache.get(literal)!;
        const parts = literal.startsWith("#")
          ? rgb(literal)
          : literal.match(/[\d.]+/g)!.map(Number);
        const color = recolor(parts.slice(0, 3), tokens, referenceTokens);
        const alpha = parts.length === 4 ? parts[3] : 1;
        const accented =
          Math.max(...parts.slice(0, 3)) - Math.min(...parts.slice(0, 3)) > 50;
        const value = `rgba(${color.join(",")},${Math.min(1, alpha * (accented && alpha < 1 ? effects.gradient / 100 : 1))})`;
        const name = `--ytmd-tone-${cache.size}`;
        variables.push(`${name}:${value} !important;`);
        cache.set(literal, `var(${name})`);
        return `var(${name})`;
      },
    )
    .replace(
      /blur\(([\d.]+)px\)/g,
      (_, size) => `blur(${((Number(size) * effects.blur) / 12).toFixed(2)}px)`,
    )
    .replace(/border-radius:\s*([\d.]+)px/g, (all, size) =>
      Number(size) >= 100
        ? all
        : `border-radius: ${((Number(size) * effects.radius) / 14).toFixed(2)}px`,
    );
  const sakuraBorders = isSakura
    ? `\n:root{--sb-border:rgba(${rgb(tokens.border).join(",")},0.18)!important;--sb-border-strong:rgba(${rgb(tokens.border).join(",")},0.34)!important;}`
    : "";
  return (
    `/* YTMD Theme Studio — derived from supplied ${isSakura ? "Sakura Blush v1" : "Deep Indigo v6.3"} */\n:root{${variables.join("")}}\n${css}\n` +
    sakuraBorders +
    (effects.reducedMotion
      ? "@media (prefers-reduced-motion: reduce){html body *,html body *::before,html body *::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}"
      : "")
  );
}

export const MAX_CSS_BYTES = 1024 * 1024;
export function validateCSS(css: string): void {
  // Conservative policy: imported/linked CSS is self-contained. Decode escapes
  // and strip comments before checking to catch escaped url/import spellings.
  const decoded = css
    .replace(/\\([0-9a-f]{1,6})\s?|\\([^\r\n])/gi, (_, hex, escaped) =>
      hex
        ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff))
        : escaped,
    )
    .replace(/\/\*[\s\S]*?\*\//g, "");
  if (
    /@import\b|url\s*\(|image-set\s*\(|expression\s*\(|javascript\s*:|-moz-binding|(?<![\w-])behavior\s*:/i.test(
      decoded,
    )
  )
    throw new Error(
      "CSS must be self-contained: @import, url(), image-set() and executable references are not supported. Remove external/local resources and try again.",
    );
  if (css.includes("\0")) throw new Error("Invalid CSS text");
}
