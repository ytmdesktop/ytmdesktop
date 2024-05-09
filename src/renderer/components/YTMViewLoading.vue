<script setup lang="ts">
import { onBeforeMount, ref } from "vue";

const memoryStore = window.ytmd.memoryStore;

const ytmViewLoading = ref<boolean>(await memoryStore.get("ytmViewLoading"));
const ytmViewLoadingError = ref<boolean>(await memoryStore.get("ytmViewLoadingError"));
const ytmViewLoadTimedout = ref<boolean>(await memoryStore.get("ytmViewLoadTimedout"));
const ytmViewLoadingStatus = ref<string>((await memoryStore.get("ytmViewLoadingStatus")) ?? "");

onBeforeMount(async () => {
  ytmViewLoading.value = await memoryStore.get("ytmViewLoading");
  ytmViewLoadTimedout.value = await memoryStore.get("ytmViewLoadTimedout");
  ytmViewLoadingError.value = await memoryStore.get("ytmViewLoadingError");
  ytmViewLoadingStatus.value = (await memoryStore.get("ytmViewLoadingStatus")) ?? "";
});

memoryStore.onStateChanged(newState => {
  ytmViewLoading.value = newState.ytmViewLoading;
  ytmViewLoadingError.value = newState.ytmViewLoadingError;
  ytmViewLoadTimedout.value = newState.ytmViewLoadTimedout;
  ytmViewLoadingStatus.value = newState.ytmViewLoadingStatus;
});
</script>

<template>
  <div class="ytmview-loading-container">
    <Transition name="fade">
      <div v-if="ytmViewLoading" class="ytmview-loading">
        <img class="logo" :src="require('~assets/icons/ytmd.png')" />
        <div class="music-loader">
          <div class="loader-line"></div>
          <div class="loader-line"></div>
          <div class="loader-line"></div>
          <div class="loader-line"></div>
          <div class="loader-line"></div>
          <div class="loader-line"></div>
          <div class="loader-line"></div>
          <div class="loader-line"></div>
        </div>
        <p :class="{ 'ytmview-loading-status': true, 'error': ytmViewLoadingError }">{{ ytmViewLoadingStatus }}</p>
        <p v-if="ytmViewLoadTimedout" class="ytmview-loading-timeout">YouTube Music is taking longer than usual to load</p>
      </div>
      <div v-else class="ytmview-loading"></div>
    </Transition>
  </div>
</template>

<style scoped>
.ytmview-loading-container {
  height: calc(100% - 36px);
  background-color: #000000;
}

.ytmview-loading {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: calc(100% - 36px);
  user-select: none;
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
