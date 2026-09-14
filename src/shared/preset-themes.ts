export interface ThemePalette {
  background: string;
  backgroundSecondary: string;
  backgroundTertiary: string;
  accent: string;
  text: string;
  textSecondary: string;
  playerBar: string;
  hover: string;
}

export interface PresetTheme {
  id: string;
  name: string;
  description: string;
  palette: ThemePalette;
  css: string;
}

function generateThemeCSS(p: ThemePalette, extraCSS = ""): string {
  return `
ytmusic-app {
  --ytmusic-general-background-a: ${p.background} !important;
  --ytmusic-general-background-b: ${p.backgroundSecondary} !important;
  --ytmusic-general-background-c: ${p.backgroundTertiary} !important;
  --ytmusic-brand-background-solid: ${p.background} !important;
  --ytmusic-text-primary: ${p.text} !important;
  --ytmusic-text-secondary: ${p.textSecondary} !important;
  --ytmusic-color-white1: ${p.text} !important;
  --ytmusic-color-white2: ${p.textSecondary} !important;
  --ytmusic-color-white3: ${p.textSecondary} !important;
  --ytmusic-color-white4: ${p.textSecondary} !important;
  --ytmusic-selected-indicator-color: ${p.accent} !important;
}

html,
body {
  background-color: ${p.background} !important;
  color: ${p.text} !important;
}

ytmusic-app,
ytmusic-app-layout,
#layout,
#main-panel,
ytmusic-browse-response,
ytmusic-search-page,
ytmusic-tabbed-search-results-renderer,
ytmusic-section-list-renderer,
#contents.ytmusic-section-list-renderer,
ytmusic-player-page,
#player-page,
ytmusic-two-column-browse-results-renderer,
ytmusic-two-column-browse-results-renderer #primary,
ytmusic-two-column-browse-results-renderer #secondary {
  background-color: ${p.background} !important;
}

ytmusic-player-bar,
#player-bar-background {
  background-color: ${p.playerBar} !important;
}

#nav-bar-background,
ytmusic-app-layout > #nav-bar-background,
div#nav-bar-background,
ytmusic-nav-bar,
ytmusic-nav-bar .center-content,
ytmusic-pivot-bar-renderer {
  background-color: ${p.background} !important;
}

ytmusic-app-layout > [slot=nav-bar] {
  width: 100vw !important;
}

ytmusic-tabs,
ytmusic-tabs #tabs.tab-container {
  background-color: ${p.background} !important;
}

ytmusic-tabs .tab {
  color: ${p.textSecondary} !important;
}

ytmusic-tabs .tab.selected,
ytmusic-tabs .tab[selected] {
  color: ${p.text} !important;
}

tp-yt-app-drawer,
tp-yt-app-drawer#guide-wrapper,
#guide-wrapper,
ytmusic-guide-renderer,
#guide-content {
  background-color: ${p.backgroundSecondary} !important;
}

ytmusic-header-renderer,
#header-bar {
  background-color: ${p.background} !important;
}

ytmusic-search-box[is-bauhaus-sidenav-enabled] .search-container {
  background-color: ${p.backgroundSecondary} !important;
  border-color: ${p.backgroundTertiary} !important;
}

ytmusic-search-box input.style-scope {
  color: ${p.text} !important;
}

ytmusic-card-shelf-renderer,
ytmusic-immersive-carousel-renderer {
  background-color: ${p.backgroundSecondary} !important;
}

tp-yt-paper-dialog,
tp-yt-paper-listbox {
  background-color: ${p.backgroundSecondary} !important;
  color: ${p.text} !important;
}

ytmusic-responsive-list-item-renderer:hover {
  background-color: ${p.hover} !important;
}

*::-webkit-scrollbar {
  background-color: ${p.background} !important;
}

*::-webkit-scrollbar-track {
  background-color: ${p.background} !important;
}

*::-webkit-scrollbar-thumb {
  background-color: ${p.backgroundTertiary} !important;
}
${extraCSS}`.trim();
}

function defineTheme(id: string, name: string, description: string, palette: ThemePalette, extraCSS = ""): PresetTheme {
  return { id, name, description, palette, css: generateThemeCSS(palette, extraCSS) };
}

export const PRESET_THEMES: PresetTheme[] = [
  defineTheme("amoled-dark", "AMOLED Dark", "Pure black for OLED screens", {
    background: "#000000",
    backgroundSecondary: "#0a0a0a",
    backgroundTertiary: "#141414",
    accent: "#ff0000",
    text: "#ffffff",
    textSecondary: "#aaaaaa",
    playerBar: "#000000",
    hover: "#1a1a1a"
  }),
  defineTheme("dark", "Dark", "Warm, refined dark theme", {
    background: "#181818",
    backgroundSecondary: "#222222",
    backgroundTertiary: "#333333",
    accent: "#ff4444",
    text: "#e8e8e8",
    textSecondary: "#999999",
    playerBar: "#181818",
    hover: "#2a2a2a"
  }),
  defineTheme("catppuccin-mocha", "Catppuccin Mocha", "Warm dark with pastel accents", {
    background: "#1e1e2e",
    backgroundSecondary: "#313244",
    backgroundTertiary: "#45475a",
    accent: "#cba6f7",
    text: "#cdd6f4",
    textSecondary: "#a6adc8",
    playerBar: "#181825",
    hover: "#313244"
  }),
  defineTheme("dracula", "Dracula", "Classic purple-accented dark theme", {
    background: "#282a36",
    backgroundSecondary: "#44475a",
    backgroundTertiary: "#6272a4",
    accent: "#bd93f9",
    text: "#f8f8f2",
    textSecondary: "#bfbfbf",
    playerBar: "#21222c",
    hover: "#44475a"
  }),
  defineTheme("nord", "Nord", "Cool arctic blue palette", {
    background: "#2e3440",
    backgroundSecondary: "#3b4252",
    backgroundTertiary: "#434c5e",
    accent: "#88c0d0",
    text: "#eceff4",
    textSecondary: "#d8dee9",
    playerBar: "#2e3440",
    hover: "#3b4252"
  }),
  defineTheme("gruvbox-dark", "Gruvbox Dark", "Retro warm dark theme", {
    background: "#282828",
    backgroundSecondary: "#3c3836",
    backgroundTertiary: "#504945",
    accent: "#fe8019",
    text: "#ebdbb2",
    textSecondary: "#a89984",
    playerBar: "#1d2021",
    hover: "#3c3836"
  }),
  defineTheme("rose-pine", "Rose Pine", "Muted dark with rose accents", {
    background: "#191724",
    backgroundSecondary: "#1f1d2e",
    backgroundTertiary: "#26233a",
    accent: "#ebbcba",
    text: "#e0def4",
    textSecondary: "#908caa",
    playerBar: "#191724",
    hover: "#26233a"
  })
];

export function getPresetThemeById(id: string): PresetTheme | undefined {
  return PRESET_THEMES.find(t => t.id === id);
}
