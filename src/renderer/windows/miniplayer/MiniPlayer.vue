<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { PlayerState, RepeatMode, VideoState } from "~shared/player-state";

const state = ref<PlayerState | null>(null);

const localProgress = ref(0);
let ticker: ReturnType<typeof setInterval> | null = null;

// After a user seek, main keeps reporting the pre-seek progress for ~1s until YTM actually
// jumps. Trusting those stale values snaps the bar backward then forward — the flicker.
// We hold the bar at the seek target and ignore reports until one lands near it (or we time out).
const draggingSeek = ref(false);
let seekTarget: number | null = null;
let seekDeadline = 0;

function applyState(next: PlayerState | null) {
  state.value = next;
  const incoming = next?.videoProgress ?? 0;
  if (draggingSeek.value) return;
  if (seekTarget !== null && Math.abs(incoming - seekTarget) > 1.5 && Date.now() < seekDeadline) return;
  seekTarget = null;
  localProgress.value = incoming;
}

onMounted(async () => {
  applyState(await window.ytmd.requestPlayerState());
  window.ytmd.onPlayerState(applyState);

  ticker = setInterval(() => {
    if (isPlaying.value && hasVideo.value && !draggingSeek.value) {
      const max = duration.value || Number.POSITIVE_INFINITY;
      localProgress.value = Math.min(localProgress.value + 0.25, max);
    }
  }, 250);
});

onUnmounted(() => {
  if (ticker) clearInterval(ticker);
});

const video = computed(() => state.value?.videoDetails ?? null);
const hasVideo = computed(() => !!video.value);
const adPlaying = computed(() => !!state.value?.adPlaying);
const isPlaying = computed(() => state.value?.trackState === VideoState.Playing);

const title = computed(() => (adPlaying.value ? "Advertisement" : video.value?.title || "Nothing playing"));
const artist = computed(() => (adPlaying.value ? "" : video.value?.author || ""));
const subtitle = computed(() => (hasVideo.value ? artist.value : "Open YouTube Music to start playing"));

const art = computed(() => {
  const thumbs = video.value?.thumbnails;
  if (!thumbs?.length) return null;
  return [...thumbs].sort((a, b) => b.width - a.width)[0]?.url ?? null; // highest resolution
});

const duration = computed(() => video.value?.durationSeconds ?? 0);
const progress = computed(() => Math.min(localProgress.value, duration.value || localProgress.value));
const progressPct = computed(() => (duration.value ? Math.min(100, (progress.value / duration.value) * 100) : 0));

const muted = computed(() => !!state.value?.muted);
const volume = ref(100);
const draggingVolume = ref(false);
watch(
  () => state.value?.volume,
  v => {
    if (!draggingVolume.value && typeof v === "number") volume.value = v;
  }
);
const volumeDisplay = computed(() => (muted.value ? 0 : volume.value));

const repeatMode = computed(() => state.value?.queue?.repeatMode ?? RepeatMode.None);
const repeatActive = computed(() => repeatMode.value === RepeatMode.All || repeatMode.value === RepeatMode.One);
const repeatIcon = computed(() => (repeatMode.value === RepeatMode.One ? "repeat_one" : "repeat"));

const volumeIcon = computed(() => {
  if (muted.value || volume.value === 0) return "volume_off";
  if (volume.value < 50) return "volume_down";
  return "volume_up";
});

function fmt(seconds: number) {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function playPause() {
  if (hasVideo.value) window.ytmd.sendCommand("playPause");
}
function next() {
  if (hasVideo.value) window.ytmd.sendCommand("next");
}
// Threshold (seconds) after which Previous restarts the song instead of skipping back
const RESTART_THRESHOLD_SECONDS = 3;

function previous() {
  if (!hasVideo.value) return;
  // Match Spotify / YouTube Music: once you're a few seconds in, Previous restarts the
  // current track; near the start it skips to the previous one. This also gives the
  // "single click = restart, quick double click = previous" feel without a click timer —
  // the first press restarts (now at 0s), so a fast second press skips back.
  if (progress.value > RESTART_THRESHOLD_SECONDS) {
    localProgress.value = 0; // optimistic, so a fast second press sees us at the start
    window.ytmd.sendCommand("seekTo", 0);
  } else {
    window.ytmd.sendCommand("previous");
  }
}
function shuffle() {
  if (hasVideo.value) window.ytmd.sendCommand("shuffle");
}

function cycleRepeat() {
  if (!hasVideo.value) return;
  // None -> All -> One -> None
  const nextMode: Record<number, string> = {
    [RepeatMode.None]: "ALL",
    [RepeatMode.All]: "ONE",
    [RepeatMode.One]: "NONE"
  };
  window.ytmd.sendCommand("repeatMode", nextMode[repeatMode.value] ?? "ALL");
}

function onSeekInput(e: Event) {
  draggingSeek.value = true;
  localProgress.value = Number((e.target as HTMLInputElement).value);
}
function onSeekChange(e: Event) {
  const secs = Number((e.target as HTMLInputElement).value);
  localProgress.value = secs;
  draggingSeek.value = false;
  seekTarget = secs;
  seekDeadline = Date.now() + 2000;
  window.ytmd.sendCommand("seekTo", secs);
}

function onVolumeInput(e: Event) {
  draggingVolume.value = true;
  volume.value = Number((e.target as HTMLInputElement).value);
}
function onVolumeChange(e: Event) {
  const v = Number((e.target as HTMLInputElement).value);
  volume.value = v;
  window.ytmd.sendCommand("setVolume", v);
  draggingVolume.value = false;
}
function toggleMute() {
  if (hasVideo.value) window.ytmd.sendCommand(muted.value ? "unmute" : "mute");
}

function openApp() {
  window.ytmd.showMainWindow();
}
</script>

<template>
  <div class="mini" :class="{ idle: !hasVideo }">
    <div class="backdrop" :style="art ? { backgroundImage: `url(${art})` } : undefined"></div>
    <div class="scrim"></div>

    <div class="content">
      <div class="art" title="Open YouTube Music" @click="openApp">
        <img v-if="art" :src="art" alt="" />
        <span v-else class="material-symbols-outlined ph">music_note</span>
      </div>

      <div class="meta">
        <div class="title" :title="title">{{ title }}</div>
        <div class="artist" :title="subtitle">{{ subtitle }}</div>
      </div>

      <div class="seek">
        <input
          class="range"
          type="range"
          min="0"
          :max="Math.max(duration, 1)"
          step="1"
          :value="progress"
          :disabled="!hasVideo || adPlaying"
          :style="{ '--pct': progressPct + '%' }"
          @input="onSeekInput"
          @change="onSeekChange"
        />
        <div class="times">
          <span>{{ fmt(progress) }}</span>
          <span>{{ fmt(duration) }}</span>
        </div>
      </div>

      <div class="controls">
        <button class="ctrl" :disabled="!hasVideo" title="Shuffle" @click="shuffle">
          <span class="material-symbols-outlined">shuffle</span>
        </button>
        <button class="ctrl" :disabled="!hasVideo" title="Previous" @click="previous">
          <span class="material-symbols-outlined">skip_previous</span>
        </button>
        <button class="ctrl play" :disabled="!hasVideo" :title="isPlaying ? 'Pause' : 'Play'" @click="playPause">
          <span class="material-symbols-outlined">{{ isPlaying ? "pause" : "play_arrow" }}</span>
        </button>
        <button class="ctrl" :disabled="!hasVideo" title="Next" @click="next">
          <span class="material-symbols-outlined">skip_next</span>
        </button>
        <button class="ctrl" :class="{ active: repeatActive }" :disabled="!hasVideo" title="Repeat" @click="cycleRepeat">
          <span class="material-symbols-outlined">{{ repeatIcon }}</span>
        </button>
      </div>

      <div class="volume">
        <button class="vol-btn" :disabled="!hasVideo" :title="muted ? 'Unmute' : 'Mute'" @click="toggleMute">
          <span class="material-symbols-outlined">{{ volumeIcon }}</span>
        </button>
        <input
          class="range vol"
          type="range"
          min="0"
          max="100"
          step="1"
          :value="volumeDisplay"
          :disabled="!hasVideo"
          :style="{ '--pct': volumeDisplay + '%' }"
          @input="onVolumeInput"
          @change="onVolumeChange"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.mini {
  position: relative;
  width: 100%;
  height: 100vh;
  border-radius: 16px;
  overflow: hidden;
  user-select: none;
}

.backdrop {
  position: absolute;
  inset: 0;
  background-color: #1a1a1a;
  background-size: cover;
  background-position: center;
  filter: blur(44px) saturate(1.5) brightness(0.55);
  transform: scale(1.4);
}

.scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.2) 0%, rgba(0, 0, 0, 0.55) 60%, rgba(0, 0, 0, 0.78) 100%);
}

.content {
  position: relative;
  z-index: 1;
  height: 100%;
  box-sizing: border-box;
  padding: 20px 22px 22px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.art {
  width: 196px;
  height: 196px;
  border-radius: 14px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.06);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.55);
  display: grid;
  place-items: center;
  cursor: pointer;
}
.art img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.art .ph {
  font-size: 64px;
  color: rgba(255, 255, 255, 0.45);
}

.meta {
  width: 100%;
  text-align: center;
  min-width: 0;
}
.title {
  font-family: "Open Sans", sans-serif;
  font-weight: 700;
  font-size: 16px;
  color: #ffffff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.artist {
  margin-top: 3px;
  min-height: 17px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.62);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.seek {
  width: 100%;
}
.times {
  display: flex;
  justify-content: space-between;
  margin-top: 5px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);
  font-variant-numeric: tabular-nums;
}

.range {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(to right, #ffffff var(--pct, 0%), rgba(255, 255, 255, 0.22) var(--pct, 0%));
  cursor: pointer;
  outline: none;
}
.range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
  opacity: 0;
  transition: opacity 0.12s ease;
}
.range:hover::-webkit-slider-thumb {
  opacity: 1;
}
.range:disabled {
  opacity: 0.5;
  cursor: default;
}

.controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.ctrl {
  -webkit-app-region: no-drag;
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.92);
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  cursor: pointer;
  transition:
    background-color 0.12s ease,
    transform 0.12s ease,
    color 0.12s ease;
}
.ctrl .material-symbols-outlined {
  font-size: 26px;
}
.ctrl:hover:not(:disabled) {
  background-color: rgba(255, 255, 255, 0.14);
}
.ctrl:disabled {
  opacity: 0.35;
  cursor: default;
}
.ctrl.active {
  color: #ff5b5b;
}
.ctrl.play {
  width: 58px;
  height: 58px;
  background: #ffffff;
  color: #111111;
}
.ctrl.play .material-symbols-outlined {
  font-size: 34px;
  font-variation-settings: "FILL" 1;
}
.ctrl.play:hover:not(:disabled) {
  background: #ffffff;
  transform: scale(1.05);
}

.volume {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
}
.vol-btn {
  -webkit-app-region: no-drag;
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.82);
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  cursor: pointer;
  flex: none;
}
.vol-btn .material-symbols-outlined {
  font-size: 20px;
}
.vol-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
.range.vol {
  flex: 1;
}
</style>
