<script setup lang="ts">
import { ref, computed, watch } from "vue";

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  type: {
    type: String,
    default: "available" // available, downloaded, error
  },
  version: {
    type: String,
    default: ""
  },
  progress: {
    type: Number,
    default: 0
  },
  error: {
    type: String,
    default: ""
  }
});

const emit = defineEmits(["close", "install", "check"]);

const isVisible = ref(props.show);
const notificationClass = computed(() => {
  return {
    "update-notification": true,
    "notification-available": props.type === "available",
    "notification-downloaded": props.type === "downloaded",
    "notification-error": props.type === "error"
  };
});

const progressFormatted = computed(() => {
  return `${Math.round(props.progress)}%`;
});

const title = computed(() => {
  switch (props.type) {
    case "available":
      return "Update Available";
    case "downloaded":
      return "Update Ready";
    case "error":
      return "Update Error";
    default:
      return "Update";
  }
});

const message = computed(() => {
  switch (props.type) {
    case "available":
      return props.version ? `Version ${props.version} is available and downloading.` : "A new update is available and downloading.";
    case "downloaded":
      return props.version ? `Version ${props.version} has been downloaded and is ready to install.` : "Update has been downloaded and is ready to install.";
    case "error":
      return props.error || "An error occurred while checking for updates.";
    default:
      return "Update notification";
  }
});

function close() {
  isVisible.value = false;
  emit("close");
}

function install() {
  emit("install");
}

function checkForUpdates() {
  emit("check");
}

watch(
  () => props.show,
  newValue => {
    isVisible.value = newValue;
  }
);
</script>

<template>
  <div v-if="isVisible" :class="notificationClass">
    <div class="notification-content">
      <div class="notification-header">
        <span class="notification-icon">
          <span v-if="type === 'available'" class="material-symbols-outlined">download</span>
          <span v-else-if="type === 'downloaded'" class="material-symbols-outlined">system_update</span>
          <span v-else-if="type === 'error'" class="material-symbols-outlined">error</span>
        </span>
        <span class="notification-title">{{ title }}</span>
        <button class="close-button" @click="close">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <div class="notification-body">
        <p>{{ message }}</p>

        <div v-if="type === 'available'" class="progress-container">
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: progressFormatted }"></div>
          </div>
          <span class="progress-text">{{ progressFormatted }}</span>
        </div>

        <div class="notification-actions">
          <button v-if="type === 'downloaded'" class="action-button install-button" @click="install">
            <span class="material-symbols-outlined">upgrade</span>
            Install Now
          </button>

          <button v-if="type === 'error'" class="action-button retry-button" @click="checkForUpdates">
            <span class="material-symbols-outlined">refresh</span>
            Try Again
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.update-notification {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 320px;
  background-color: #212121;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  z-index: 1000;
  overflow: hidden;
  animation: slide-in 0.3s ease-out;
}

@keyframes slide-in {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

.notification-content {
  padding: 16px;
}

.notification-header {
  display: flex;
  align-items: center;
  margin-bottom: 12px;
}

.notification-icon {
  margin-right: 8px;
  display: flex;
  align-items: center;
}

.notification-icon .material-symbols-outlined {
  font-size: 24px;
}

.notification-available .notification-icon .material-symbols-outlined {
  color: #2196f3;
}

.notification-downloaded .notification-icon .material-symbols-outlined {
  color: #4caf50;
}

.notification-error .notification-icon .material-symbols-outlined {
  color: #f44336;
}

.notification-title {
  flex-grow: 1;
  font-weight: 500;
  font-size: 16px;
}

.close-button {
  background: none;
  border: none;
  cursor: pointer;
  color: #888;
  padding: 0;
  display: flex;
  align-items: center;
}

.close-button:hover {
  color: #fff;
}

.notification-body {
  color: #bbb;
}

.notification-body p {
  margin: 0 0 12px 0;
}

.progress-container {
  display: flex;
  align-items: center;
  margin-bottom: 12px;
}

.progress-bar {
  flex-grow: 1;
  height: 6px;
  background-color: #333;
  border-radius: 3px;
  overflow: hidden;
  margin-right: 8px;
}

.progress-fill {
  height: 100%;
  background-color: #2196f3;
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 12px;
  color: #888;
  min-width: 36px;
  text-align: right;
}

.notification-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.action-button {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  font-size: 14px;
  gap: 6px;
}

.install-button {
  background-color: #4caf50;
  color: white;
}

.install-button:hover {
  background-color: #388e3c;
}

.retry-button {
  background-color: #424242;
  color: white;
}

.retry-button:hover {
  background-color: #616161;
}
</style>
