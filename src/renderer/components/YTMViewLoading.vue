<script setup lang="ts">
import { computed, ref } from "vue";
import logo from "~assets/icons/ytmd.png";
import { YTMViewStatus } from "~shared/types";

const unresponsive = ref(false);
const hide = ref(false);
const ytmViewLoadingStatus = ref<YTMViewStatus>(YTMViewStatus.Loading);
const ytmViewLoadingStatusMessage = computed(() => {
  switch (ytmViewLoadingStatus.value) {
    case YTMViewStatus.Loading:
      return "Loading YouTube Music...";
    case YTMViewStatus.Hooking:
      return "Waiting for YTMDesktop hooks...";
    case YTMViewStatus.Ready:
      return "Ready";
    default:
      return "";
  }
});
const ytmViewLoadTimedOut = ref(false);

let ytmViewTimeout = setTimeout(() => {
  ytmViewLoadTimedOut.value = true;
}, 5 * 1000);

window.ytmd.ytmViewStatusChanged((status: YTMViewStatus) => {
  if (status !== YTMViewStatus.Ready) {
    clearTimeout(ytmViewTimeout);
    ytmViewTimeout = setTimeout(() => {
      ytmViewLoadTimedOut.value = true;
    }, 5 * 1000);
  }

  ytmViewLoadingStatus.value = status;
});
window.ytmd.memoryStore.onStateChanged(newState => {
  unresponsive.value = newState.ytmViewUnresponsive ?? false;
});

window.ytmd.appViewHiding(() => {
  hide.value = true;
});
window.ytmd.appViewShowing(() => {
  hide.value = false;
});

function onHide() {
  window.ytmd.appViewHide();
}
</script>

<template>
  <Transition
    name="fade"
    @after-leave="onHide"
  >
    <div
      v-if="!hide"
      class="ytmview-loading-container"
    >
      <Transition
        name="fade"
        @after-leave="onHide"
      >
        <div
          v-if="ytmViewLoadingStatus != YTMViewStatus.Ready"
          class="ytmview-loading"
        >
          <img
            class="logo"
            :src="logo"
          >
          <div class="music-loader">
            <div class="loader-line" />
            <div class="loader-line" />
            <div class="loader-line" />
            <div class="loader-line" />
            <div class="loader-line" />
            <div class="loader-line" />
            <div class="loader-line" />
            <div class="loader-line" />
          </div>
          <p class="ytmview-loading-status">
            {{ ytmViewLoadingStatusMessage }}
          </p>
          <div
            v-if="ytmViewLoadTimedOut"
            class="ytmview-loading-timeout"
          >
            <span>YouTube Music is taking longer than usual to load</span>
          </div>
        </div>
      </Transition>
      <Transition
        name="fade"
        @after-leave="onHide"
      >
        <div
          v-if="unresponsive"
          class="ytmview-unresponsive"
        />
      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
.ytmview-loading-container {
  width: 100%;
  height: 100%;
}

.ytmview-loading {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100%;
  user-select: none;
  background-color: #000000;
}

.ytmview-unresponsive {
  display: flex;
  width: 100%;
  height: 100%;
  background-color: rgba(127, 127, 127, 0.5);
  cursor: wait;
}

.ytmview-loading-status {
  color: #969696;
}

.ytmview-loading-status.error {
  color: #f44336;
}

.ytmview-loading-timeout {
  color: #f44336;
}

.ytmview-loading-timeout {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.logo {
  width: 160px;
  height: 160px;
}

.music-loader {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  height: 160px;
}

.loader-line {
  width: 12px;
  height: 4px;
  border-radius: 10px;
  background-color: #ffffff;
  animation: musicloader 1.5s ease-in-out infinite;
}

.loader-line:nth-child(1) {
  animation-delay: 1s;
}

.loader-line:nth-child(2) {
  animation-delay: 0.8s;
}

.loader-line:nth-child(3) {
  animation-delay: 0.4s;
}

.loader-line:nth-child(4) {
  animation-delay: 0.2s;
}

.loader-line:nth-child(5) {
  animation-delay: 0.2s;
}

.loader-line:nth-child(6) {
  animation-delay: 0.4s;
}

.loader-line:nth-child(7) {
  animation-delay: 0.8s;
}

.loader-line:nth-child(8) {
  animation-delay: 1s;
}

@keyframes musicloader {
  0% {
    height: 4px;
  }
  50% {
    height: 72px;
  }
  100% {
    height: 4px;
  }
}
</style>
