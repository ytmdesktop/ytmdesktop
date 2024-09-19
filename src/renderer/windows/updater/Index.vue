<script setup lang="ts">
import { ref } from "vue";

const appLoadingStatus = ref<string>("Checking for updates...");

window.ytmd.autoUpdater.onChecking(() => {
  appLoadingStatus.value = "Checking for updates...";
});
window.ytmd.autoUpdater.onNotAvailable(() => {
  appLoadingStatus.value = "No updates available";
});
window.ytmd.autoUpdater.onAvailable(() => {
  appLoadingStatus.value = "Downloading update...";
});
window.ytmd.autoUpdater.onDownloaded(() => {
  appLoadingStatus.value = "Restarting for update...";
});
window.ytmd.autoUpdater.onError(() => {
  appLoadingStatus.value = "Error checking for updates";
});
</script>

<template>
  <div class="app-updater-container">
    <img class="logo" draggable="false" :src="require('~assets/icons/ytmd.png')" />
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
    <p class="status-text">{{ appLoadingStatus }}</p>
  </div>
</template>

<style scoped>
.app-updater-container {
  height: 100%;
  background-color: #000000;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  user-select: none;
}

.logo {
  width: 128px;
  height: 128px;
  margin-bottom: 16px;
}

.status-text {
  color: #969696;
}

.music-loader {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 80px;
}

.loader-line {
  width: 6px;
  height: 2px;
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
    height: 56px;
  }
  100% {
    height: 4px;
  }
}
</style>
