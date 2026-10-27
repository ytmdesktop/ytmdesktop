<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import { colorKeys, contrast, defaultSelection, effects, presets, Selection, ThemeResult, ThemeSnapshot, validateSelection } from "~shared/themes/model";

const api = window.ytmd.themes;
const snapshot = ref<ThemeSnapshot | null>(null);
const draft = ref<Selection>(defaultSelection());
const editing = ref(false);
const busy = ref(false);
const message = ref("");
const names = ref<Record<string, string>>({});
let timer: ReturnType<typeof setTimeout>;
let alive = true;
let sequence = 0;
const labels = {
  accent: "Accent",
  highlight: "Highlight",
  background: "Background",
  surface: "Surface",
  surfaceRaised: "Raised surface",
  text: "Primary text",
  textMuted: "Secondary text",
  border: "Border"
};
const active = computed(() => {
  const s = snapshot.value?.selection;
  if (!s) return "Loading…";
  if (s.mode === "preset") return presets.find(p => p.id === s.presetId)?.name;
  if (s.mode === "imported") return snapshot.value?.imports.find(x => x.id === s.importId)?.name;
  return s.mode === "custom" ? "My custom theme" : "Original";
});
const invalid = computed(() => {
  try {
    validateSelection(draft.value);
    return "";
  } catch (e) {
    return (e as Error).message;
  }
});
const lowContrast = computed(
  () =>
    !invalid.value &&
    (contrast(draft.value.tokens.text, draft.value.tokens.background) < 4.5 || contrast(draft.value.tokens.textMuted, draft.value.tokens.surface) < 4.5)
);
function accept(result: ThemeResult, syncDraft = false) {
  if (!alive) return;
  if (result.state) {
    snapshot.value = result.state;
    names.value = Object.fromEntries(result.state.imports.map(x => [x.id, x.name]));
    if (syncDraft) {
      draft.value = structuredClone(result.state.selection);
      if (draft.value.mode === "preset") {
        draft.value.tokens = { ...presets.find(p => p.id === draft.value.presetId).tokens };
        draft.value.effects = { ...effects };
      }
    }
  }
  message.value = result.ok ? (result.state?.error ?? "") : (result.error ?? "Theme operation failed");
}
async function run(action: () => Promise<ThemeResult>, syncDraft = true) {
  clearTimeout(timer);
  sequence++;
  busy.value = true;
  try {
    accept(await action(), syncDraft);
  } catch (e) {
    message.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
function preview() {
  editing.value = true;
  clearTimeout(timer);
  const request = ++sequence;
  if (invalid.value) return;
  const selection = JSON.parse(JSON.stringify(draft.value));
  timer = setTimeout(async () => {
    try {
      const result = await api.preview(selection);
      if (request === sequence) accept(result);
    } catch (e) {
      if (request === sequence) message.value = (e as Error).message;
    }
  }, 180);
}
async function selectPreset(id: string) {
  const selection = { ...defaultSelection(), mode: "preset" as const, presetId: id, overrides: snapshot.value?.selection.overrides ?? true };
  await run(() => api.apply(selection));
  editing.value = false;
}
function copyPreset(id: string) {
  draft.value = {
    ...defaultSelection(),
    mode: "custom",
    presetId: id,
    tokens: { ...presets.find(p => p.id === id).tokens },
    overrides: snapshot.value?.selection.overrides ?? true
  };
  preview();
}
function resetDraft() {
  draft.value.tokens = { ...presets.find(p => p.id === draft.value.presetId).tokens };
  draft.value.effects = { ...effects };
  draft.value.mode = "custom";
  preview();
}
async function cancel() {
  await run(() => api.cancel());
  editing.value = false;
}
async function apply() {
  await run(() => api.apply(JSON.parse(JSON.stringify(draft.value))));
  editing.value = false;
}
async function original() {
  await run(() => api.apply({ ...defaultSelection(), overrides: false }));
  editing.value = false;
}
async function activateImport(id: string) {
  await run(() => api.apply({ ...defaultSelection(), mode: "imported", importId: id, overrides: false }));
  editing.value = false;
}
function editSaved() {
  draft.value = JSON.parse(JSON.stringify(snapshot.value.custom));
  preview();
}
onMounted(() => run(() => api.get()));
onBeforeUnmount(() => {
  alive = false;
  clearTimeout(timer);
  sequence++;
  void api.cancel().catch(() => {});
});
</script>

<template>
  <section class="themes" aria-label="Theme Studio">
    <header class="theme-heading">
      <div>
        <p class="eyebrow">YOUR MUSIC, YOUR COLORS</p>
        <h1>Theme Studio</h1>
        <p>Eight palettes. One continuous canvas.</p>
      </div>
    </header>
    <div class="status">
      <span
        >Active: <strong>{{ active }}</strong></span
      ><button :disabled="busy" @click="original">Restore original</button>
    </div>
    <p class="hint">
      Theme layer → optional linked CSS overrides. Original restores the official appearance and disables the override layer without deleting your file.
    </p>
    <p v-if="message" class="notice" role="alert">{{ message }}</p>
    <div class="gallery">
      <article
        v-for="preset in presets"
        :key="preset.id"
        class="card"
        :class="{ selected: snapshot?.selection.mode === 'preset' && snapshot.selection.presetId === preset.id }"
      >
        <div
          class="swatch"
          :style="{ background: `radial-gradient(ellipse at top right, ${preset.tokens.accent}, ${preset.tokens.background} 80%)`, color: preset.tokens.text }"
          aria-hidden="true"
        >
          <span class="mini-line" :style="{ background: preset.tokens.highlight }"></span
          ><span class="mini-disc" :style="{ background: preset.tokens.surfaceRaised, borderColor: preset.tokens.highlight }">♪</span
          ><span class="mini-line"></span>
        </div>
        <h2>{{ preset.name }} <span v-if="snapshot?.selection.mode === 'preset' && snapshot.selection.presetId === preset.id" class="badge">Active</span></h2>
        <div class="actions">
          <button :disabled="busy" @click="selectPreset(preset.id)">Apply</button><button :disabled="busy" @click="copyPreset(preset.id)">Edit a copy</button>
        </div>
      </article>
    </div>
    <section class="editor" aria-label="Custom theme editor">
      <button :disabled="busy || !snapshot" @click="editSaved">Load my saved custom theme</button>
      <h2>My custom theme <span v-if="editing" class="badge">Unsaved preview</span></h2>
      <p class="hint">Edit a copy of a palette, or adjust these colors. Cancel, leaving this tab or closing settings restores your saved theme.</p>
      <div
        class="editor-preview"
        :style="{ background: draft.tokens.background, color: draft.tokens.text, borderColor: draft.tokens.border, borderRadius: draft.effects.radius + 'px' }"
      >
        <span class="preview-art" :style="{ background: `linear-gradient(135deg, ${draft.tokens.accent}, ${draft.tokens.highlight})` }">♪</span>
        <div>
          <strong>Your next favorite</strong>
          <p :style="{ color: draft.tokens.textMuted }">A palette that follows your music</p>
        </div>
      </div>
      <div class="colors">
        <label v-for="key in colorKeys" :key="key"
          >{{ labels[key]
          }}<span class="color-inputs"
            ><input
              v-model="draft.tokens[key]"
              :aria-label="labels[key] + ' picker'"
              type="color"
              :disabled="busy"
              @input="
                draft.mode = 'custom';
                preview();
              " /><input
              v-model="draft.tokens[key]"
              :aria-label="labels[key] + ' HEX'"
              type="text"
              maxlength="7"
              spellcheck="false"
              :disabled="busy"
              @input="
                draft.mode = 'custom';
                preview();
              " /></span
        ></label>
      </div>
      <div class="effects">
        <label
          >Gradient intensity · {{ draft.effects.gradient }}%<input
            v-model.number="draft.effects.gradient"
            type="range"
            min="0"
            max="150"
            :disabled="busy"
            @input="
              draft.mode = 'custom';
              preview();
            "
        /></label>
        <label
          >Surface blur · {{ draft.effects.blur
          }}<input
            v-model.number="draft.effects.blur"
            type="range"
            min="0"
            max="30"
            :disabled="busy"
            @input="
              draft.mode = 'custom';
              preview();
            "
        /></label>
        <label
          >Corner radius · {{ draft.effects.radius
          }}<input
            v-model.number="draft.effects.radius"
            type="range"
            min="0"
            max="32"
            :disabled="busy"
            @input="
              draft.mode = 'custom';
              preview();
            "
        /></label>
      </div>
      <label class="check"
        ><input
          v-model="draft.effects.reducedMotion"
          type="checkbox"
          :disabled="busy"
          @change="
            draft.mode = 'custom';
            preview();
          "
        />
        Respect reduced motion</label
      >
      <label class="check"
        ><input v-model="draft.overrides" type="checkbox" :disabled="busy" @change="preview" /> Include linked CSS overrides (configured in Appearance)</label
      >
      <p class="hint">
        Linked file: {{ snapshot?.legacyEnabled ? "enabled in Appearance" : "disabled in Appearance" }}. An imported primary theme replaces the preset, not the
        settings interface.
      </p>
      <p v-if="invalid" class="notice" role="alert">{{ invalid }}</p>
      <p v-else-if="lowContrast" class="notice" role="status">Low text contrast: aim for at least 4.5:1 against the background and surface.</p>
      <div class="actions">
        <button :disabled="busy || !!invalid || !editing" @click="apply">Apply changes</button
        ><button :disabled="busy || !editing" @click="cancel">Cancel</button><button :disabled="busy" @click="resetDraft">Restore preset</button
        ><button
          :disabled="busy || !!invalid || !['custom', 'preset'].includes(draft.mode)"
          @click="run(() => api.exportCSS(JSON.parse(JSON.stringify(draft))), false)"
        >
          Export CSS
        </button>
      </div>
    </section>
    <section class="library" aria-label="Imported CSS library">
      <div class="status">
        <h2>Imported CSS</h2>
        <button :disabled="busy" @click="run(() => api.importCSS(), false)">Import CSS…</button>
      </div>
      <p class="hint">
        UTF-8 .css, up to 1 MiB. A managed copy is stored; your original is never deleted. For privacy, @import, url() and image-set() references are rejected,
        including local, remote and data resources. Self-contained CSS can style the player freely.
      </p>
      <p v-if="!snapshot?.imports.length" class="empty">Bring your own CSS to make it yours.</p>
      <div v-for="entry in snapshot?.imports ?? []" :key="entry.id" class="import-row">
        <input v-model="names[entry.id]" :aria-label="'Name for ' + entry.name" maxlength="80" :disabled="busy" />
        <span v-if="snapshot?.selection.mode === 'imported' && snapshot.selection.importId === entry.id" class="badge">Active</span>
        <button :disabled="busy" @click="run(() => api.rename(entry.id, names[entry.id]), false)">Rename</button
        ><button :disabled="busy" @click="activateImport(entry.id)">Apply</button
        ><button :disabled="busy" @click="run(() => api.remove(entry.id))">Remove</button>
      </div>
      <p class="hint">Restore original deactivates imported themes. Remove only removes the library entry; its managed copy remains recoverable on disk.</p>
    </section>
  </section>
</template>

<style scoped>
.themes {
  max-width: 920px;
  margin: auto;
  padding: 0 4px 28px;
  color: #edf0f8;
}
h1 {
  font-size: 28px;
  margin: 4px 0 10px;
}
h2 {
  font-size: 16px;
  margin: 10px 0;
}
.eyebrow {
  color: #a7b5f7;
  font-size: 10px;
  letter-spacing: 2px;
  font-weight: 700;
}
.theme-heading p:not(.eyebrow),
.hint {
  color: #b7bfd2;
  font-size: 12px;
  line-height: 1.6;
}
.status,
.actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.status {
  padding: 12px 0;
}
.actions {
  justify-content: flex-start;
}
button {
  border: 1px solid #586381;
  border-radius: 7px;
  background: #26304b;
  color: #f4f6ff;
  padding: 7px 12px;
  cursor: pointer;
  font-size: 12px;
}
button:hover {
  background: #364464;
}
button:disabled {
  opacity: 0.45;
  cursor: default;
}
button:focus-visible,
input:focus-visible {
  outline: 2px solid #9eafff;
  outline-offset: 3px;
}
.gallery {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin: 18px 0 26px;
}
.card {
  background: #181d2a;
  padding: 10px;
  border: 1px solid #343c53;
  border-radius: 12px;
}
.selected {
  border-color: #a4b4ff;
}
.swatch {
  height: 95px;
  padding: 12px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 10px;
  overflow: hidden;
}
.mini-disc {
  width: 46px;
  height: 46px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border: 1px solid;
  border-radius: 50%;
  font-size: 24px;
}
.mini-line {
  height: 5px;
  width: 35px;
  border-radius: 3px;
  background: currentColor;
  opacity: 0.7;
}
.badge {
  font-size: 10px;
  color: #d6dfff;
  background: #35466d;
  border-radius: 8px;
  padding: 3px 6px;
}
.editor,
.library {
  border-top: 1px solid #343c53;
  padding: 14px 0;
  margin-top: 12px;
}
.editor-preview {
  padding: 18px;
  border: 1px solid;
  display: flex;
  align-items: center;
  gap: 15px;
  margin: 14px 0;
}
.editor-preview p {
  margin: 7px 0 0;
  font-size: 12px;
}
.preview-art {
  width: 56px;
  height: 56px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  font-size: 30px;
}
.colors {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.colors label,
.effects label {
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.color-inputs {
  display: flex;
  gap: 6px;
}
input[type="text"],
.import-row input {
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #56617b;
  color: #f4f6ff;
  background: #181d2a;
  padding: 8px;
  border-radius: 6px;
}
input[type="color"] {
  width: 36px;
  height: 33px;
  padding: 2px;
  background: transparent;
  border: 0;
  flex-shrink: 0;
}
.effects {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin: 20px 0;
}
.check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  margin: 12px 0;
}
.notice {
  color: #ffdc96;
  font-size: 12px;
  padding: 10px;
  border-left: 3px solid #b48c40;
  background: #30291c;
}
.empty {
  color: #bac5dc;
  padding: 22px 0;
  font-size: 13px;
}
.import-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 10px 0;
  flex-wrap: wrap;
}
.import-row input {
  flex: 1;
  min-width: 120px;
}
@media (max-width: 500px) {
  .effects {
    grid-template-columns: 1fr;
  }
}
</style>
