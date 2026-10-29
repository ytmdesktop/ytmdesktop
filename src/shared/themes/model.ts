export const colorKeys = [
  'accent',
  'highlight',
  'background',
  'surface',
  'surfaceRaised',
  'text',
  'textMuted',
  'border',
] as const;
export type Tokens = Record<(typeof colorKeys)[number], string>;
export type Effects = {
  gradient: number;
  blur: number;
  radius: number;
  reducedMotion: boolean;
};
export type Design = { tokens: Tokens; effects: Effects };
export type Selection = Design & {
  mode: 'original' | 'preset' | 'custom' | 'imported';
  presetId: string;
  importId: string | null;
  overrides: boolean;
};
export type ImportedTheme = { id: string; name: string };
export type ThemeState = {
  version: 1;
  selection: Selection;
  custom: Selection;
  imports: ImportedTheme[];
};
export type ThemeSnapshot = ThemeState & {
  error: string | null;
  legacyEnabled: boolean;
  previewing: boolean;
};
export type ThemeResult = {
  ok: boolean;
  state?: ThemeSnapshot;
  error?: string;
  cancelled?: boolean;
};
export type ThemeAPI = {
  get(): Promise<ThemeResult>;
  preview(selection: Selection): Promise<ThemeResult>;
  apply(selection: Selection): Promise<ThemeResult>;
  cancel(): Promise<ThemeResult>;
  importCSS(): Promise<ThemeResult>;
  rename(id: string, name: string): Promise<ThemeResult>;
  remove(id: string): Promise<ThemeResult>;
  exportCSS(selection: Selection): Promise<ThemeResult>;
};

export const indigo: Tokens = {
  accent: '#192586',
  highlight: '#6f7cff',
  background: '#050713',
  surface: '#0b0f25',
  surfaceRaised: '#12172e',
  text: '#f4f6ff',
  textMuted: '#c5cbea',
  border: '#717eff',
};
export const effects: Effects = {
  gradient: 100,
  blur: 12,
  radius: 14,
  reducedMotion: true,
};
export const presets = [
  ['deep-indigo', 'Deep Indigo', '#192586', '#6f7cff'],
  ['youtube-red', 'YouTube Red', '#ff0033', '#ff829b'],
  ['ocean-blue', 'Ocean Blue', '#1976d2', '#73caff'],
  ['emerald', 'Emerald Green', '#159a6c', '#76e7bd'],
  ['royal-purple', 'Royal Purple', '#7e57c2', '#c4a2ff'],
  ['golden-amber', 'Golden Amber', '#d4a017', '#ffe19a'],
  ['rose', 'Rose Pink', '#e94f93', '#ffb4d6'],
  ['slate', 'Slate / Monochrome', '#718096', '#cbd5e0'],
].map(([id, name, accent, highlight]) => ({
  id,
  name,
  tokens:
    id === 'deep-indigo'
      ? { ...indigo }
      : {
          accent,
          highlight,
          background: mix(accent, '#000000', 0.94),
          surface: mix(accent, '#000000', 0.86),
          surfaceRaised: mix(accent, '#101018', 0.82),
          text: '#f4f6ff',
          textMuted: mix(highlight, '#ffffff', 0.55),
          border: highlight,
        },
}));

export function rgb(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
export function mix(a: string, b: string, amount: number): string {
  return (
    '#' +
    rgb(a)
      .map((v, i) =>
        Math.round(v * (1 - amount) + rgb(b)[i] * amount)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
export function defaultSelection(): Selection {
  return {
    mode: 'original',
    presetId: 'deep-indigo',
    importId: null,
    tokens: { ...indigo },
    effects: { ...effects },
    overrides: true,
  };
}
export function validateSelection(value: unknown): Selection {
  if (!value || typeof value !== 'object')
    throw new Error('Invalid theme selection');
  const s = value as Selection;
  if (
    !['original', 'preset', 'custom', 'imported'].includes(s.mode) ||
    !presets.some((p) => p.id === s.presetId)
  )
    throw new Error('Unknown theme');
  if (
    s.importId !== null &&
    (typeof s.importId !== 'string' || !/^[a-f0-9]{64}$/.test(s.importId))
  )
    throw new Error('Invalid imported theme ID');
  if (typeof s.overrides !== 'boolean' || !s.tokens || !s.effects)
    throw new Error('Invalid theme options');
  for (const k of colorKeys)
    if (typeof s.tokens[k] !== 'string' || !/^#[0-9a-f]{6}$/i.test(s.tokens[k]))
      throw new Error(`${k}: use a six-digit HEX color`);
  for (const [key, max] of [
    ['gradient', 150],
    ['blur', 30],
    ['radius', 32],
  ] as const) {
    if (
      !Number.isFinite(s.effects[key]) ||
      s.effects[key] < 0 ||
      s.effects[key] > max
    )
      throw new Error(`Invalid ${key}`);
  }
  if (typeof s.effects.reducedMotion !== 'boolean')
    throw new Error('Invalid motion preference');
  return {
    mode: s.mode,
    presetId: s.presetId,
    importId: s.importId,
    overrides: s.overrides,
    tokens: Object.fromEntries(
      colorKeys.map((k) => [k, s.tokens[k].toLowerCase()]),
    ) as Tokens,
    effects: {
      gradient: s.effects.gradient,
      blur: s.effects.blur,
      radius: s.effects.radius,
      reducedMotion: s.effects.reducedMotion,
    },
  };
}
// Old customCSS preferences remain untouched; their existing enabled flag controls overrides.
export function normalizeState(value: unknown): ThemeState {
  const fallback: ThemeState = {
    version: 1,
    selection: defaultSelection(),
    custom: { ...defaultSelection(), mode: 'custom' },
    imports: [],
  };
  if (!value || typeof value !== 'object') return fallback;
  const state = value as ThemeState;
  const imports = Array.isArray(state.imports)
    ? state.imports.filter(
        (x) =>
          x &&
          /^[a-f0-9]{64}$/.test(x.id) &&
          typeof x.name === 'string' &&
          x.name.length > 0 &&
          x.name.length <= 80,
      )
    : [];
  try {
    const selection = validateSelection(state.selection);
    if (
      selection.mode === 'imported' &&
      !imports.some((x) => x.id === selection.importId)
    )
      selection.mode = 'original';
    let custom = fallback.custom;
    try {
      custom = {
        ...validateSelection(
          state.custom ??
            (selection.mode === 'custom' ? selection : fallback.custom),
        ),
        mode: 'custom',
      };
    } catch {
      /* retain valid selection when saved editor data is invalid */
    }
    return {
      version: 1,
      selection,
      custom,
      imports: imports
        .filter((x, i) => imports.findIndex((y) => y.id === x.id) === i)
        .map((x) => ({ id: x.id, name: x.name })),
    };
  } catch {
    return { ...fallback, imports };
  }
}
export function contrast(a: string, b: string): number {
  const luminance = (hex: string) =>
    rgb(hex)
      .map((x) => x / 255)
      .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
      .reduce((v, n, i) => v + n * [0.2126, 0.7152, 0.0722][i], 0);
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
