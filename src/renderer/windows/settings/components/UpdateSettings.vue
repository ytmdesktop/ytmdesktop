<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from "vue";
import YTMDSetting from "../../../components/YTMDSetting.vue";

// Update settings
const updateSettings = ref({
  checkIntervalMinutes: 60,
  checkOnStartup: true,
  autoInstall: false,
  betaChannel: false,
  lastChecked: 0
});

// Update status
const updateStatus = ref("idle");
const updateProgress = ref(0);
const updateInfo = ref(null);
const updateError = ref(null);
const isUpdateAvailable = ref(false);
const isUpdateDownloaded = ref(false);

// Format the last checked time as a readable string
const lastCheckedFormatted = computed(() => {
  if (!updateSettings.value.lastChecked) return "Never";

  const date = new Date(updateSettings.value.lastChecked);
  return date.toLocaleString();
});

// Format the update progress as a percentage
const updateProgressFormatted = computed(() => {
  return `${Math.round(updateProgress.value)}%`;
});

// Check interval options
const intervalOptions = {
  15: "15 minutes",
  30: "30 minutes",
  60: "1 hour",
  120: "2 hours",
  240: "4 hours",
  480: "8 hours",
  720: "12 hours",
  1440: "24 hours"
};

// Cleanup registry for memory leak prevention
const cleanupFunctions: Array<() => void> = [];

// Load update settings and status
onMounted(async () => {
  try {
    // Get update settings
    const settings = await window.ipcRenderer.invoke("app:getUpdateSettings");
    if (settings) {
      updateSettings.value = settings;
    }

    // Get update status
    const status = await window.ipcRenderer.invoke("app:getUpdateStatus");
    if (status) {
      updateStatus.value = status.status;
      updateProgress.value = status.progress;
      updateInfo.value = status.info;
      updateError.value = status.error;
      isUpdateAvailable.value = status.isAvailable;
      isUpdateDownloaded.value = status.isDownloaded;
    }

    // Set up event listeners for update status changes with proper cleanup
    const updateDownloadProgressHandler = (_event, progressObj) => {
      updateProgress.value = progressObj.percent || 0;
    };
    window.ipcRenderer.on("app:updateDownloadProgress", updateDownloadProgressHandler);
    cleanupFunctions.push(() => window.ipcRenderer.removeListener("app:updateDownloadProgress", updateDownloadProgressHandler));

    const updateAvailableHandler = (_event, info) => {
      updateStatus.value = "downloading";
      updateInfo.value = info;
      isUpdateAvailable.value = true;
    };
    window.ipcRenderer.on("app:updateAvailable", updateAvailableHandler);
    cleanupFunctions.push(() => window.ipcRenderer.removeListener("app:updateAvailable", updateAvailableHandler));

    const updateDownloadedHandler = (_event, info) => {
      updateStatus.value = "ready";
      updateInfo.value = info;
      updateProgress.value = 100;
      isUpdateDownloaded.value = true;
    };
    window.ipcRenderer.on("app:updateDownloaded", updateDownloadedHandler);
    cleanupFunctions.push(() => window.ipcRenderer.removeListener("app:updateDownloaded", updateDownloadedHandler));

    const updateErrorHandler = (_event, error) => {
      updateStatus.value = "error";
      updateError.value = error;
    };
    window.ipcRenderer.on("app:updateError", updateErrorHandler);
    cleanupFunctions.push(() => window.ipcRenderer.removeListener("app:updateError", updateErrorHandler));
  } catch (error) {
    console.error("Failed to load update settings:", error);
  }
});

// Professional cleanup pattern - remove ALL event listeners
onBeforeUnmount(() => {
  cleanupFunctions.forEach(cleanup => {
    try {
      cleanup();
    } catch (error) {
      console.error("Error during cleanup:", error);
    }
  });
  cleanupFunctions.length = 0;
});

// Save update settings
async function saveUpdateSettings() {
  try {
    await window.ipcRenderer.send("app:updateSettings", updateSettings.value);
  } catch (error) {
    console.error("Failed to save update settings:", error);
  }
}

// Check for updates
function checkForUpdates() {
  updateStatus.value = "checking";
  window.ytmd.checkForUpdates();
}

// Install update
function installUpdate() {
  window.ytmd.restartApplicationForUpdate();
}
</script>

<template>
  <div class="update-settings">
    <div class="update-status-card" :class="updateStatus">
      <div class="status-header">
        <h3>Update Status</h3>
        <span class="status-badge">{{ updateStatus }}</span>
      </div>

      <div v-if="updateStatus === 'idle'" class="status-content">
        <p>No updates are currently being checked or downloaded.</p>
        <p>Last checked: {{ lastCheckedFormatted }}</p>
        <button class="check-button" @click="checkForUpdates">
          <span class="material-symbols-outlined">update</span>
          Check for Updates
        </button>
      </div>

      <div v-else-if="updateStatus === 'checking'" class="status-content">
        <p>Checking for updates...</p>
        <div class="loading-spinner">
          <span class="material-symbols-outlined rotating">progress_activity</span>
        </div>
      </div>

      <div v-else-if="updateStatus === 'downloading'" class="status-content">
        <p v-if="updateInfo">Downloading update {{ updateInfo.version }}</p>
        <p v-else>Downloading update...</p>
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: updateProgressFormatted }"></div>
          <span class="progress-text">{{ updateProgressFormatted }}</span>
        </div>
      </div>

      <div v-else-if="updateStatus === 'ready'" class="status-content">
        <p v-if="updateInfo">Update {{ updateInfo.version }} is ready to install</p>
        <p v-else>Update is ready to install</p>
        <button class="install-button" @click="installUpdate">
          <span class="material-symbols-outlined">upgrade</span>
          Restart and Install
        </button>
      </div>

      <div v-else-if="updateStatus === 'error'" class="status-content">
        <p>Failed to check for updates</p>
        <p v-if="updateError" class="error-message">{{ updateError }}</p>
        <button class="check-button" @click="checkForUpdates">
          <span class="material-symbols-outlined">update</span>
          Try Again
        </button>
      </div>
    </div>

    <div class="update-settings-form">
      <h3>Update Settings</h3>

      <YTMDSetting v-model="updateSettings.checkOnStartup" type="checkbox" name="Check for updates on startup" @change="saveUpdateSettings" />

      <YTMDSetting
        v-model="updateSettings.autoInstall"
        type="checkbox"
        name="Automatically install updates"
        description="Updates will be installed when the app restarts"
        @change="saveUpdateSettings"
      />

      <YTMDSetting
        v-model="updateSettings.betaChannel"
        type="checkbox"
        name="Beta channel"
        description="Receive beta updates (may be unstable)"
        @change="saveUpdateSettings"
      />

      <YTMDSetting
        v-model="updateSettings.checkIntervalMinutes"
        type="select"
        name="Check frequency"
        description="How often to check for updates"
        :options-map="intervalOptions"
        @change="saveUpdateSettings"
      />
    </div>
  </div>
</template>

<style scoped>
.update-settings {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.update-status-card {
  background-color: #1a1a1a;
  border-radius: 8px;
  padding: 16px;
  border: 1px solid #333;
}

.update-status-card.downloading {
  border-color: #2196f3;
}

.update-status-card.ready {
  border-color: #4caf50;
}

.update-status-card.error {
  border-color: #f44336;
}

.status-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.status-header h3 {
  margin: 0;
}

.status-badge {
  text-transform: uppercase;
  font-size: 12px;
  font-weight: bold;
  padding: 4px 8px;
  border-radius: 4px;
  background-color: #333;
}

.idle .status-badge {
  background-color: #333;
}

.checking .status-badge {
  background-color: #ff9800;
}

.downloading .status-badge {
  background-color: #2196f3;
}

.ready .status-badge {
  background-color: #4caf50;
}

.error .status-badge {
  background-color: #f44336;
}

.status-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.status-content p {
  margin: 0;
  text-align: center;
}

.check-button,
.install-button {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 500;
  border: none;
}

.check-button {
  background-color: #333;
}

.check-button:hover {
  background-color: #444;
}

.install-button {
  background-color: #4caf50;
  color: white;
}

.install-button:hover {
  background-color: #388e3c;
}

.loading-spinner {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 48px;
}

.rotating {
  animation: rotate 1s infinite linear;
  font-size: 32px;
}

@keyframes rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.progress-bar {
  width: 100%;
  height: 20px;
  background-color: #333;
  border-radius: 10px;
  position: relative;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background-color: #2196f3;
  transition: width 0.3s ease;
}

.progress-text {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  color: white;
  font-size: 12px;
  font-weight: bold;
}

.error-message {
  color: #f44336;
  font-size: 14px;
  max-width: 100%;
  word-break: break-word;
}

.update-settings-form {
  background-color: #1a1a1a;
  border-radius: 8px;
  padding: 16px;
  border: 1px solid #333;
}

.update-settings-form h3 {
  margin-top: 0;
  margin-bottom: 16px;
}
</style>
