<script setup lang="ts">
import { computed, ref } from "vue";
import type { ListenTogetherEndedUIState } from "~shared/listentogether/ipc";
import { closeListenTogetherPanel, dispatchCommand } from "./utils";
import TrackThumbnail from "./TrackThumbnail.vue";

const props = defineProps<{
  ended: ListenTogetherEndedUIState;
}>();

const busy = ref(false);
const errorText = ref<string | null>(null);

const statusTitle = computed(() => {
  switch (props.ended.reason) {
    case "host-left":
      return props.ended.hostName
        ? `Room ended — ${props.ended.hostName} closed the session`
        : "Room ended — Host closed the session";
    case "timeout":
      return "Connection to Host timed out";
    case "kicked":
      return "Removed from room — The host removed you from this session";
  }
});

async function handleHostNewRoom() {
  busy.value = true;
  errorText.value = null;
  try {
    const res = await dispatchCommand({ type: "hostNewRoomWithQueue" });
    if (!res.ok) {
      errorText.value = res.error;
    }
  } finally {
    busy.value = false;
  }
}

async function handleReturnToLobby() {
  busy.value = true;
  try {
    await dispatchCommand({ type: "returnToLobby" });
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="lt-view">
    <header class="lt-header">
      <span class="lt-header-title">Listen Together</span>
      <button
        type="button"
        class="lt-icon-btn"
        title="Close panel"
        @click="closeListenTogetherPanel"
      >
        <span class="material-symbols-outlined">close</span>
      </button>
    </header>

    <div class="lt-scroll lt-ended-body">
      <div class="lt-card lt-status-card">
        <p class="lt-status-title">{{ statusTitle }}</p>

        <div class="lt-ended-actions">
          <template v-if="ended.reason !== 'kicked'">
            <button
              type="button"
              class="lt-btn lt-btn-primary lt-btn-block"
              :disabled="busy"
              @click="handleHostNewRoom"
            >
              Host New Room with Queue
            </button>
            <p class="lt-muted lt-action-hint">
              Starts a new room — share the new link with friends
            </p>
          </template>
          <button
            type="button"
            class="lt-btn lt-btn-block"
            :disabled="busy"
            @click="handleReturnToLobby"
          >
            Return to Lobby
          </button>
        </div>

        <p v-if="errorText" class="lt-error-text">{{ errorText }}</p>
      </div>

      <section v-if="ended.queueSnapshot.length > 0" class="lt-queue-snapshot">
        <div class="lt-snapshot-heading">
          Saved Queue ({{ ended.queueSnapshot.length }})
        </div>
        <div class="lt-snapshot-list">
          <div
            v-for="(track, index) in ended.queueSnapshot"
            :key="track.entryId"
            class="lt-snapshot-row"
          >
            <span class="lt-snapshot-index lt-tabular">{{ index + 1 }}</span>
            <TrackThumbnail :src="track.thumbnailUrl" />
            <div class="lt-snapshot-meta">
              <div class="lt-snapshot-title">{{ track.title }}</div>
              <div class="lt-snapshot-sub">
                {{ track.author }} • Added by {{ track.addedByName }}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.lt-ended-body {
  flex: 1;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.lt-status-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.lt-status-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: #eeeeee;
  word-break: break-word;
}

.lt-ended-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.lt-action-hint {
  margin: 0 0 4px;
}

.lt-queue-snapshot {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.lt-snapshot-heading {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #969696;
}

.lt-snapshot-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.lt-snapshot-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px;
  border: 1px solid #212121;
  border-radius: 4px;
  background-color: #000000;
  min-width: 0;
}

.lt-snapshot-index {
  width: 16px;
  font-size: 11px;
  color: #969696;
  text-align: right;
  flex-shrink: 0;
}

.lt-snapshot-meta {
  min-width: 0;
  flex: 1;
}

.lt-snapshot-title {
  font-size: 12px;
  font-weight: 500;
  color: #eeeeee;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lt-snapshot-sub {
  font-size: 11px;
  color: #969696;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
