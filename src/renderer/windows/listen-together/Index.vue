<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import type { ListenTogetherUIState } from "~shared/listentogether/ipc";
import ActiveRoomView from "./ActiveRoomView.vue";
import InviteConfirmCard from "./InviteConfirmCard.vue";
import LobbyView from "./LobbyView.vue";
import RoomEndedView from "./RoomEndedView.vue";
import RoomSettingsView from "./RoomSettingsView.vue";
import { closeListenTogetherPanel, dispatchCommand } from "./utils";

const state = ref<ListenTogetherUIState | null>(null);
const inRoomSettings = ref(false);
const activeRoomRef = ref<InstanceType<typeof ActiveRoomView> | null>(null);
let unsubState: (() => void) | null = null;

watch(
  () => [state.value?.view, state.value?.room?.isHost] as const,
  ([view, isHost]) => {
    if (view !== "active" || !isHost) {
      inRoomSettings.value = false;
    }
  },
);

function handleKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.defaultPrevented) {
    return;
  }
  if (state.value?.view === "active" && inRoomSettings.value) {
    inRoomSettings.value = false;
    return;
  }
  if (
    state.value?.view === "active" &&
    activeRoomRef.value?.closeInlineOverlays()
  ) {
    return;
  }
  closeListenTogetherPanel();
}

onMounted(async () => {
  window.addEventListener("keydown", handleKeyDown);
  unsubState = window.ytmd.listenTogether.onStateChanged((nextState) => {
    state.value = nextState;
  });
  try {
    state.value = await window.ytmd.listenTogether.getState();
  } catch {
    state.value = null;
  }
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeyDown);
  unsubState?.();
});
</script>

<template>
  <div class="lt-shell">
    <template v-if="!state">
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
      <div class="lt-connecting-body">
        <span class="material-symbols-outlined lt-spin lt-spinner-icon">
          progress_activity
        </span>
        <span class="lt-muted">Loading…</span>
      </div>
    </template>

    <InviteConfirmCard
      v-else-if="state.view === 'invite-confirm' && state.pendingInvite"
      :state="state"
      :invite="state.pendingInvite"
    />

    <div v-else-if="state.view === 'connecting'" class="lt-view">
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
      <div class="lt-connecting-body">
        <span class="material-symbols-outlined lt-spin lt-spinner-icon">
          progress_activity
        </span>
        <p class="lt-connecting-stage">
          {{ state.connectingStage ?? "Connecting…" }}
        </p>
        <button
          type="button"
          class="lt-btn"
          @click="dispatchCommand({ type: 'cancelConnecting' })"
        >
          Cancel
        </button>
      </div>
    </div>

    <RoomSettingsView
      v-else-if="
        state.view === 'active' &&
        state.room &&
        state.room.isHost &&
        inRoomSettings
      "
      :room="state.room"
      @back="inRoomSettings = false"
    />

    <ActiveRoomView
      v-else-if="state.view === 'active' && state.room"
      ref="activeRoomRef"
      :room="state.room"
      @open-settings="inRoomSettings = true"
    />

    <RoomEndedView
      v-else-if="state.view === 'ended' && state.ended"
      :ended="state.ended"
    />

    <LobbyView v-else :state="state" />
  </div>
</template>

<style scoped>
.lt-connecting-body {
  flex: 1;
  padding: 24px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
}

.lt-spinner-icon {
  font-size: 28px !important;
  color: #eeeeee;
}

.lt-connecting-stage {
  margin: 0;
  font-size: 13px;
  color: #bbbbbb;
  word-break: break-word;
}
</style>
