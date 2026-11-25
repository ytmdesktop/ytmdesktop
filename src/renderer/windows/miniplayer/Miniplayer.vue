<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import {
  PlayerState,
  RepeatMode,
  Thumbnail,
  VideoState,
} from "~shared/playerstatestore/types";
import type { ListenTogetherUIState } from "~shared/listentogether/ipc";
import RangeInput from "../../components/RangeInput.vue";

const state = ref<PlayerState | null>(null);
state.value = await window.ytmd.playerStore.getState();

const listenTogetherState = ref<ListenTogetherUIState | null>(null);
try {
  listenTogetherState.value = await window.ytmd.listenTogether.getState();
} catch {
  listenTogetherState.value = null;
}

const inRoom = computed(() => listenTogetherState.value?.room != null);
const isRoomSynced = computed(
  () =>
    inRoom.value &&
    listenTogetherState.value?.room?.listeningMode === "room",
);
const isHost = computed(() => listenTogetherState.value?.room?.isHost ?? false);
const isGuestRestricted = computed(() => inRoom.value && !isHost.value);
let unsubListenTogether: (() => void) | null = null;

const volume = ref(state.value?.volume ?? 0);

const videoProgress = ref(0);
const videoLength = ref(0);
const videoId = ref("");

const seekbarContainer = useTemplateRef("seekbarContainer");
const infoContainer = useTemplateRef("infoContainer");
const infoTitle = useTemplateRef("infoTitle");

function getHighestResThumbnail(thumbnails: Thumbnail[]): string {
  return thumbnails.reduce(
    (accumulator, current) =>
      current.height * current.width <= accumulator.height * accumulator.width
        ? accumulator
        : current,
    thumbnails[0],
  ).url;
}

let seekbarDragging = false;

async function stateChanged(newState) {
  state.value = newState;

  if (newState.videoDetails && newState.videoDetails.id != videoId.value) {
    const thumbnailUrl = getHighestResThumbnail(
      newState.videoDetails?.thumbnails,
    );
    if (thumbnailUrl) {
      document.body.style.backgroundImage = `url("${thumbnailUrl}")`;
    } else {
      document.body.style.backgroundImage = "";
    }
    videoLength.value = newState.videoDetails.durationSeconds;
    videoId.value = newState.videoDetails.id;

    nextTick(() => {
      reconcileMarquee();
    });
  }

  if (!seekbarDragging) {
    videoProgress.value = newState.videoProgress;
  }

  volume.value = newState.volume;
  state.value = newState;
}

function reconcileMarquee() {
  if (infoTitle.value) {
    if (infoTitle.value.scrollWidth > infoContainer.value.clientWidth) {
      infoTitle.value.classList.add("marquee");
    } else {
      infoTitle.value.classList.remove("marquee");
    }
  }
}

onMounted(() => {
  window.ytmd.playerStore.handleStateChanged((newState) => {
    stateChanged(newState);
  });

  unsubListenTogether = window.ytmd.listenTogether.onStateChanged(
    (nextState) => {
      listenTogetherState.value = nextState;
    },
  );

  window.ytmd.requestWindowState();
  stateChanged(state.value);
});

onUnmounted(() => {
  unsubListenTogether?.();
});

const seekHandleVisible = ref(false);

watch(isGuestRestricted, (restricted) => {
  if (restricted) {
    seekbarDragging = false;
    seekHandleVisible.value = false;
    document.body.style.userSelect = "";
  }
});

function showSeekHandle() {
  if (isGuestRestricted.value) return;
  seekHandleVisible.value = true;
}

function hideSeekHandle() {
  seekHandleVisible.value = false;
}

function startDrag(event) {
  if (isGuestRestricted.value) return;
  seekbarDragging = true;
  seek(event);

  document.body.style.userSelect = "none";
}

function getOffsetX(event, rect) {
  let offsetX = event.clientX - rect.left;
  offsetX = Math.max(0, Math.min(offsetX, rect.width));
  return offsetX;
}

function seek(event) {
  if (isGuestRestricted.value) return;
  const seekbarRect = seekbarContainer.value.getBoundingClientRect();
  const offsetX = getOffsetX(event, seekbarRect);
  const seekToValue = (offsetX * videoLength.value) / seekbarRect.width;
  videoProgress.value = seekToValue;
  window.ytmd.executeCommandInYTMView("seekTo", seekToValue);
}

document.addEventListener("mousemove", (event) => {
  if (!seekbarDragging) return;
  if (event.clientX > -1) {
    seek(event);
  }
});

document.addEventListener("mouseup", () => {
  if (seekbarDragging) {
    seekbarDragging = false;

    document.body.style.userSelect = "";
  }
});

function previousVideo() {
  if (isGuestRestricted.value) return;
  window.ytmd.executeCommandInYTMView("previous");
}
function playPauseVideo() {
  window.ytmd.executeCommandInYTMView("playPause");
}
function nextVideo() {
  if (isGuestRestricted.value) return;
  window.ytmd.executeCommandInYTMView("next");
}
function cycleRepeat() {
  if (isGuestRestricted.value) return;
  window.ytmd.executeCommandInYTMView("cycleRepeatMode");
}
function volumeChanged() {
  window.ytmd.executeCommandInYTMView("setVolume", volume.value);
}
function toggleMute() {
  if (!state.value?.muted) {
    window.ytmd.executeCommandInYTMView("mute");
  } else {
    window.ytmd.executeCommandInYTMView("unmute");
  }
}

window.addEventListener("resize", reconcileMarquee);
</script>

<template>
  <div
    v-if="state?.videoDetails != null"
    class="container"
    :class="{ 'is-room-synced': isRoomSynced }"
  >
    <div class="pusher"></div>
    <div class="video-data">
      <div class="backdrop" />
      <div ref="infoContainer" class="video-info">
        <span ref="infoTitle" class="title"
          >{{ state?.videoDetails?.title }} •
          {{ state?.videoDetails?.author }}</span
        >
      </div>
      <div
        ref="seekbarContainer"
        class="seekbar-container"
        :class="{ 'guest-disabled': isGuestRestricted }"
        @mouseenter="showSeekHandle"
        @mouseleave="hideSeekHandle"
        @mousedown="startDrag"
      >
        <div class="seekbar">
          <div
            class="progress"
            :style="{ width: `${(videoProgress / videoLength) * 100}%` }"
          />
          <div
            v-if="seekHandleVisible"
            id="handle"
            class="handle"
            :style="{ left: `${(videoProgress / videoLength) * 100}%` }"
          />
        </div>
      </div>
      <div class="video-controls">
        <div class="padding" />
        <div class="controls">
          <button
            class="previous"
            :class="{ 'guest-disabled': isGuestRestricted }"
            :disabled="isGuestRestricted"
            @click="previousVideo"
          >
            <span class="icon material-symbols-outlined">skip_previous</span>
          </button>
          <button class="play-pause" @click="playPauseVideo">
            <span
              v-if="state?.trackState == VideoState.Paused"
              class="icon material-symbols-outlined"
              >play_arrow</span
            >
            <span
              v-if="state?.trackState == VideoState.Playing"
              class="icon material-symbols-outlined"
              >pause</span
            >
            <span
              v-if="state?.trackState == VideoState.Buffering"
              class="icon material-symbols-outlined"
              >data_saver_off</span
            >
            <span
              v-if="state?.trackState == VideoState.Unknown"
              class="icon material-symbols-outlined"
              >play_arrow</span
            >
          </button>
          <button
            class="next"
            :class="{ 'guest-disabled': isGuestRestricted }"
            :disabled="isGuestRestricted"
            @click="nextVideo"
          >
            <span class="icon material-symbols-outlined">skip_next</span>
          </button>
        </div>
        <div class="controls right">
          <div class="volume">
            <RangeInput
              v-model="volume"
              class="slider"
              :min="0"
              :max="100"
              @update:model-value="volumeChanged"
            />
            <button class="next" @click="toggleMute">
              <span
                v-if="volume <= 50 && !state?.muted"
                class="icon material-symbols-outlined"
                >volume_down</span
              >
              <span
                v-if="volume > 50 && !state?.muted"
                class="icon material-symbols-outlined"
                >volume_up</span
              >
              <span v-if="state?.muted" class="icon material-symbols-outlined"
                >volume_off</span
              >
            </button>
          </div>
          <button
            class="repeat"
            :class="{ 'guest-disabled': isGuestRestricted }"
            :disabled="isGuestRestricted"
            @click="cycleRepeat"
          >
            <span
              v-if="
                state?.queue.repeatMode === RepeatMode.None ||
                state?.queue.repeatMode === RepeatMode.Unknown
              "
              class="icon material-symbols-outlined"
              >repeat</span
            >
            <span
              v-if="state?.queue.repeatMode === RepeatMode.All"
              class="icon material-symbols-outlined"
              >repeat_on</span
            >
            <span
              v-if="state?.queue.repeatMode === RepeatMode.One"
              class="icon material-symbols-outlined"
              >repeat_one_on</span
            >
          </button>
        </div>
      </div>
    </div>
  </div>
  <div v-else class="container unavailable">
    <p>Video is still loading or no video loaded</p>
  </div>
</template>

<style scoped>
.container {
  width: 100vw;
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - 36px);
  max-height: calc(100vh - 36px);
}

.container.unavailable {
  justify-content: center;
  align-items: center;
}

.pusher {
  flex-grow: 1;
}

.video-data {
  display: flex;
  height: 80px;
  flex-direction: column;
  position: relative;
}

.video-data .backdrop {
  position: absolute;
  width: 100%;
  height: 200%;
  top: -100%;
  backdrop-filter: blur(10px);
  mask-image: linear-gradient(to top, black 0%, black 25%, transparent 100%);
  z-index: -888;
  background-color: rgba(0, 0, 0, 0.5);
  pointer-events: none;
}

.video-controls {
  display: grid;
  flex: 1;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  margin-bottom: 8px;
}

.controls {
  display: flex;
  justify-content: center;
  align-items: center;
  justify-self: center;
}

.controls.right {
  justify-self: end;
}

.controls button {
  background-color: transparent;
  border: none;
  cursor: pointer;
  height: 100%;
  -webkit-app-region: no-drag;
}

.volume {
  -webkit-app-region: no-drag;
  display: flex;
  justify-content: center;
  align-items: center;
}

.volume .slider {
  width: 56px;
  margin-right: 6px;
  margin-bottom: 3px;
}

.volume {
  -webkit-app-region: no-drag;
  display: flex;
  justify-content: center;
  align-items: center;
}

.volume .slider {
  width: 56px;
  margin-right: 6px;
  margin-bottom: 3px;
}

.video-info {
  display: flex;
  flex-direction: column;
  justify-content: center;
  max-height: 38px;
  overflow: hidden;
  white-space: nowrap;
}

.video-info .title {
  display: inline-flex;
  justify-content: center;
}

.marquee {
  display: inline-flex;
  animation: marquee 16s linear infinite;
}

.seekbar-container {
  padding: 8px 0;
  cursor: pointer;
  -webkit-app-region: no-drag;
}

.seekbar {
  width: 100%;
  height: 4px;
  background-color: #323232;
  position: relative;
  user-select: none;
  pointer-events: none;
}

.seekbar .progress {
  height: 100%;
  background-color: #ff0000;
  pointer-events: none;
}

.seekbar .handle {
  width: 16px;
  height: 16px;
  background-color: #ff0000;
  border-radius: 50%;
  position: absolute;
  top: 50%;
  transform: translate(-8px, -50%);
}

.guest-disabled {
  opacity: 0.4;
  pointer-events: none;
}

.container.is-room-synced .video-data .backdrop {
  background-color: rgba(14, 52, 28, 0.58);
  border-top: 1px solid rgba(76, 175, 80, 0.35);
}

.container.is-room-synced .seekbar .progress,
.container.is-room-synced .seekbar .handle {
  background-color: #4caf50;
}

.container.is-room-synced .controls button {
  color: #81c784;
}

.container.is-room-synced .volume :deep(.range-fill),
.container.is-room-synced .volume :deep(.range-handle) {
  background-color: #4caf50;
}

@keyframes marquee {
  0% {
    transform: translateX(100%);
  }
  100% {
    transform: translateX(-100%);
  }
}
</style>
