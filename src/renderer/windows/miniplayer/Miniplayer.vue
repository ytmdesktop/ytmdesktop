<script setup lang="ts">
import { nextTick, onMounted, ref, useTemplateRef } from "vue";
import { PlayerState, Thumbnail, VideoState } from "~shared/playerstatestore/types";

const state = ref<PlayerState | null>(null);
state.value = await window.ytmd.playerStore.getState();

const thumbnailUrl = ref("");

const videoProgress = ref(0);
const videoLength = ref(0);
const videoId = ref("");

const seekbarContainer = useTemplateRef("seekbarContainer");
const infoContainer = useTemplateRef("infoContainer");
const infoTitle = useTemplateRef("infoTitle");

function getHighestResThumbnail(thumbnails: Thumbnail[]): string {
  return thumbnails.reduce(
    (accumulator, current) => (current.height * current.width <= accumulator.height * accumulator.width ? accumulator : current),
    thumbnails[0]
  ).url;
}

let seekbarDragging = false;

function stateChanged(newState) {
  state.value = newState;

  if (newState.videoDetails && newState.videoDetails.id != videoId.value) {
    thumbnailUrl.value = getHighestResThumbnail(newState.videoDetails?.thumbnails);
    videoLength.value = newState.videoDetails.durationSeconds;
    videoId.value = newState.videoDetails.id;

    nextTick(() => {
      reconcileMarquee();
    });
  }

  if (!seekbarDragging) {
    videoProgress.value = newState.videoProgress;
  }
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
  window.ytmd.playerStore.handleStateChanged(newState => {
    stateChanged(newState);
  });

  window.ytmd.requestWindowState();
  stateChanged(state.value);
});

const seekHandleVisible = ref(false);

function showSeekHandle() {
  seekHandleVisible.value = true;
}

function hideSeekHandle() {
  seekHandleVisible.value = false;
}

function startDrag(event) {
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
  const seekbarRect = seekbarContainer.value.getBoundingClientRect();
  const offsetX = getOffsetX(event, seekbarRect);
  const seekToValue = (offsetX * videoLength.value) / seekbarRect.width;
  videoProgress.value = seekToValue;
  window.ytmd.executeCommandInYTMView("seekTo", seekToValue);
}

document.addEventListener("mousemove", event => {
  if (!seekbarDragging) return;
  if (event.clientX > -1) {
    seek(event);
  }
});

document.addEventListener("mouseup", () => {
  if (seekbarDragging) {
    seekbarDragging = false;

    document.body.style.userSelect = null;
  }
});

function previousVideo() {
  window.ytmd.executeCommandInYTMView("previous");
}
function playPauseVideo() {
  window.ytmd.executeCommandInYTMView("playPause");
}
function nextVideo() {
  window.ytmd.executeCommandInYTMView("next");
}

window.addEventListener("resize", reconcileMarquee);
</script>

<template>
  <div
    v-if="state.videoDetails != null"
    class="container"
  >
    <div class="thumbnail-container">
      <img
        class="thumbnail"
        :src="thumbnailUrl"
        crossorigin="anonymous"
        referrerpolicy="no-referrer"
      >
    </div>
    <div class="video-data">
      <div
        ref="infoContainer"
        class="video-info"
      >
        <span
          ref="infoTitle"
          class="title"
        >{{ state.videoDetails?.title }} • {{ state.videoDetails?.author }}</span>
      </div>
      <div
        ref="seekbarContainer"
        class="seekbar-container"
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
            :style="{ left: `${((videoProgress - 3) / videoLength) * 100}%` }"
          />
        </div>
      </div>
      <div class="video-controls">
        <div class="controls">
          <button
            class="previous"
            @click="previousVideo"
          >
            <span class="icon material-symbols-outlined">skip_previous</span>
          </button>
          <button
            class="play-pause"
            @click="playPauseVideo"
          >
            <span
              v-if="state.trackState == VideoState.Paused"
              class="icon material-symbols-outlined"
            >play_arrow</span>
            <span
              v-if="state.trackState == VideoState.Playing"
              class="icon material-symbols-outlined"
            >pause</span>
            <span
              v-if="state.trackState == VideoState.Buffering"
              class="icon material-symbols-outlined"
            >data_saver_off</span>
            <span
              v-if="state.trackState == VideoState.Unknown"
              class="icon material-symbols-outlined"
            >play_arrow</span>
          </button>
          <button
            class="next"
            @click="nextVideo"
          >
            <span class="icon material-symbols-outlined">skip_next</span>
          </button>
        </div>
      </div>
    </div>
  </div>
  <div
    v-else
    class="container unavailable"
  >
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

.thumbnail-container {
  padding: 16px;
  flex-grow: 1;
  height: 0;
  -webkit-app-region: drag;
}

.thumbnail {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.video-data {
  display: flex;
  height: 80px;
  flex-direction: column;
  -webkit-app-region: no-drag;
}

.video-controls {
  display: flex;
  flex: 1;
  justify-content: center;
  align-items: center;
  margin-bottom: 8px;
}

.controls {
  display: flex;
  justify-content: center;
  align-items: center;
}

.controls button {
  background-color: transparent;
  border: none;
  cursor: pointer;
  height: 100%;
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

.video-info .details {
  display: flex;
  justify-content: center;
  color: #bbbbbb;
}

.marquee {
  display: inline-flex;
  animation: marquee 16s linear infinite;
}

.seekbar-container {
  padding: 8px 0;
  cursor: pointer;
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
  background-color: #f00;
  pointer-events: none;
}

.seekbar .handle {
  width: 16px;
  height: 16px;
  background-color: #f00;
  border-radius: 50%;
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
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
