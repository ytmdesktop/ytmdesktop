<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import TitleBar from "../../components/TitleBar.vue";
import YTMViewLoading from "../../components/YTMViewLoading.vue";
import UpdateNotification from "../../components/UpdateNotification.vue";
import logo from "../../../assets/icons/ytmd_white.png";
const keyboardFocus = ref<HTMLElement | null>(null);
const keyboardFocusZero = ref<HTMLElement | null>(null);

// Update notification state
const showUpdateNotification = ref(false);
const updateType = ref("available");
const updateVersion = ref("");
const updateProgress = ref(0);
const updateError = ref("");

// Cleanup registry for memory leak prevention
const cleanupFunctions: Array<() => void> = [];

onMounted(() => {
  // Store DOM event handlers for cleanup
  const windowFocusHandler = () => {
    if (document.activeElement != keyboardFocusZero.value) {
      // This resets the focus of keyboard navigation
      keyboardFocusZero.value?.focus();
      keyboardFocusZero.value?.blur();
    }
  };

  const keyboardFocusHandler = () => {
    window.ytmd.switchFocus("ytm");
  };

  // Add DOM event listeners
  window.addEventListener("focus", windowFocusHandler);
  cleanupFunctions.push(() => window.removeEventListener("focus", windowFocusHandler));

  if (keyboardFocus.value) {
    keyboardFocus.value.addEventListener("focus", keyboardFocusHandler);
    cleanupFunctions.push(() => {
      if (keyboardFocus.value) {
        keyboardFocus.value.removeEventListener("focus", keyboardFocusHandler);
      }
    });
  }

  window.ytmd.requestWindowState();

  // Set up update notification listeners with proper cleanup
  // @ts-expect-error: ipcRenderer is injected via Electron contextBridge
  const updateAvailableHandler = (_event, info) => {
    updateType.value = "available";
    updateVersion.value = info?.version || "";
    updateProgress.value = 0;
    showUpdateNotification.value = true;
  };
  // @ts-expect-error: ipcRenderer is injected via Electron contextBridge
  window.ipcRenderer.on("app:updateAvailable", updateAvailableHandler);
  // @ts-expect-error: ipcRenderer is injected via Electron contextBridge
  cleanupFunctions.push(() => window.ipcRenderer.removeListener("app:updateAvailable", updateAvailableHandler));

  // @ts-expect-error: ipcRenderer is injected via Electron contextBridge
  const updateProgressHandler = (_event, progressObj) => {
    if (showUpdateNotification.value && updateType.value === "available") {
      updateProgress.value = progressObj.percent || 0;
    }
  };
  // @ts-expect-error: ipcRenderer is injected via Electron contextBridge
  window.ipcRenderer.on("app:updateDownloadProgress", updateProgressHandler);
  // @ts-expect-error: ipcRenderer is injected via Electron contextBridge
  cleanupFunctions.push(() => window.ipcRenderer.removeListener("app:updateDownloadProgress", updateProgressHandler));

  // @ts-expect-error: ipcRenderer is injected via Electron contextBridge
  const updateDownloadedHandler = (_event, info) => {
    updateType.value = "downloaded";
    updateVersion.value = info?.version || "";
    showUpdateNotification.value = true;
  };
  // @ts-expect-error: ipcRenderer is injected via Electron contextBridge
  window.ipcRenderer.on("app:updateDownloaded", updateDownloadedHandler);
  // @ts-expect-error: ipcRenderer is injected via Electron contextBridge
  cleanupFunctions.push(() => window.ipcRenderer.removeListener("app:updateDownloaded", updateDownloadedHandler));

  // @ts-expect-error: ipcRenderer is injected via Electron contextBridge
  const updateErrorHandler = (_event, error) => {
    updateType.value = "error";
    updateError.value = error?.message || "Unknown error";
    showUpdateNotification.value = true;
  };
  // @ts-expect-error: ipcRenderer is injected via Electron contextBridge
  window.ipcRenderer.on("app:updateError", updateErrorHandler);
  // @ts-expect-error: ipcRenderer is injected via Electron contextBridge
  cleanupFunctions.push(() => window.ipcRenderer.removeListener("app:updateError", updateErrorHandler));

  // Check if there's already an update downloaded
  checkUpdateStatus();
});

// Professional cleanup pattern - remove ALL event listeners
onBeforeUnmount(() => {
  // Execute all cleanup functions
  cleanupFunctions.forEach(cleanup => {
    try {
      cleanup();
    } catch (error) {
      console.error("Error during cleanup:", error);
    }
  });

  // Clear the cleanup array
  cleanupFunctions.length = 0;

  // Nullify refs to help garbage collection
  keyboardFocus.value = null;
  keyboardFocusZero.value = null;
});

async function checkUpdateStatus() {
  try {
    // @ts-expect-error: ipcRenderer is injected via Electron contextBridge
    const status = await window.ipcRenderer.invoke("app:getUpdateStatus");

    if (status.isDownloaded) {
      updateType.value = "downloaded";
      updateVersion.value = status.info?.version || "";
      showUpdateNotification.value = true;
    } else if (status.status === "downloading") {
      updateType.value = "available";
      updateVersion.value = status.info?.version || "";
      updateProgress.value = status.progress || 0;
      showUpdateNotification.value = true;
    }
  } catch (error) {
    console.error("Failed to check update status:", error);
  }
}

function closeUpdateNotification() {
  showUpdateNotification.value = false;
}

function installUpdate() {
  window.ytmd.restartApplicationForUpdate();
}

function checkForUpdates() {
  window.ytmd.checkForUpdates();
}
</script>

<template>
  <div ref="keyboardFocusZero" tabindex="0"></div>
  <Suspense>
    <TitleBar is-main-window has-home-button has-settings-button has-minimize-button has-maximize-button title="YouTube Music Desktop App" :icon-file="logo" />
  </Suspense>
  <Suspense>
    <YTMViewLoading />
  </Suspense>
  <div ref="keyboardFocus" tabindex="32767"></div>

  <!-- Update notification -->
  <UpdateNotification
    :show="showUpdateNotification"
    :type="updateType"
    :version="updateVersion"
    :progress="updateProgress"
    :error="updateError"
    @close="closeUpdateNotification"
    @install="installUpdate"
    @check="checkForUpdates"
  />
</template>
