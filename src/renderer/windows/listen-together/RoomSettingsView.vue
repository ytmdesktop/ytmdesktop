<script setup lang="ts">
import { computed, ref } from "vue";
import type { ListenTogetherActiveRoomUIState } from "~shared/listentogether/ipc";
import type {
  AutoplayMode,
  QueueMode,
  RateLimitPreset,
  RoomSettings,
  VoteSkipMode,
} from "~shared/listentogether/protocol";
import { dispatchCommand } from "./utils";

const props = defineProps<{
  room: ListenTogetherActiveRoomUIState;
}>();

const emit = defineEmits<{
  back: [];
}>();

const confirmEndRoom = ref(false);
const resetFeedback = ref<{ text: string; isError: boolean } | null>(null);
const resetting = ref(false);

const guestCount = computed(() => Math.max(0, props.room.members.length - 1));

const pauseForAds = computed(
  () => props.room.settings.adSyncMode === "pause-for-all",
);
const newFriendsCanAdd = computed(
  () => props.room.settings.defaultJoinRole === "dj",
);

async function updateSetting(patch: Partial<RoomSettings>) {
  await dispatchCommand({
    type: "updateRoomSettings",
    settings: patch,
  });
}

function onPauseForAdsChange(event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  void updateSetting({ adSyncMode: checked ? "pause-for-all" : "stay-live" });
}

function onQueueOrderChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value as QueueMode;
  void updateSetting({ queueMode: value });
}

function onNewFriendsCanAddChange(event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  void updateSetting({ defaultJoinRole: checked ? "dj" : "listener" });
}

function onRateLimitChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value as RateLimitPreset;
  void updateSetting({ rateLimitPreset: value });
}

function onAutoplayChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value as AutoplayMode;
  void updateSetting({ autoplayMode: value });
}

function onVoteSkipModeChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value as VoteSkipMode;
  void updateSetting({ voteSkipMode: value });
}

async function handleResetInvite() {
  resetting.value = true;
  resetFeedback.value = null;
  try {
    const res = await dispatchCommand({ type: "resetInviteLinkAndCode" });
    if (res.ok) {
      resetFeedback.value = {
        text: "✓ New invite link and code created.",
        isError: false,
      };
    } else {
      resetFeedback.value = { text: res.error, isError: true };
    }
  } finally {
    resetting.value = false;
  }
}

async function handleConfirmEndRoom() {
  confirmEndRoom.value = false;
  await dispatchCommand({ type: "leaveRoom" });
}

async function handleOpenLogFile() {
  await dispatchCommand({ type: "openLogFile" });
}
</script>

<template>
  <div class="lt-view">
    <header class="lt-header lt-settings-header">
      <button
        type="button"
        class="lt-icon-btn"
        title="Back to room"
        @click="emit('back')"
      >
        <span class="material-symbols-outlined">arrow_back</span>
      </button>
      <span class="lt-header-title">Room Settings</span>
    </header>

    <div class="lt-scroll lt-settings-body">
      <section class="lt-settings-section">
        <h3 class="lt-settings-section-title">Playback &amp; Queue</h3>

        <div class="lt-setting-block">
          <label class="lt-label lt-setting-label" for="lt-queue-order">
            Queue order
          </label>
          <select
            id="lt-queue-order"
            class="lt-select"
            :value="room.settings.queueMode"
            @change="onQueueOrderChange"
          >
            <option value="fair-rr">Fair turns (1 per DJ)</option>
            <option value="fifo">First added</option>
          </select>
        </div>

        <div class="lt-setting-block">
          <label class="lt-label lt-setting-label" for="lt-autoplay-mode">
            When queue is empty
          </label>
          <select
            id="lt-autoplay-mode"
            class="lt-select"
            :value="room.settings.autoplayMode"
            @change="onAutoplayChange"
          >
            <option value="shared">Radio from queued songs</option>
            <option value="history">Replay room history</option>
            <option value="off">Stop</option>
          </select>
        </div>

        <div class="lt-setting-block">
          <div class="lt-toggle-row">
            <div class="lt-toggle-copy">
              <span class="lt-setting-name">Pause for everyone's ads</span>
              <span class="lt-muted">
                Wait when any friend gets an ad so everyone stays together.
              </span>
            </div>
            <label class="lt-toggle">
              <input
                type="checkbox"
                :checked="pauseForAds"
                @change="onPauseForAdsChange"
              />
              <span class="lt-toggle-track">
                <span class="lt-toggle-thumb" />
              </span>
            </label>
          </div>
        </div>
      </section>

      <div class="lt-divider" />

      <section class="lt-settings-section">
        <h3 class="lt-settings-section-title">Permissions &amp; Fairness</h3>

        <div class="lt-setting-block">
          <div class="lt-toggle-row">
            <div class="lt-toggle-copy">
              <span class="lt-setting-name">New friends can add songs</span>
              <span class="lt-muted">
                If off, new friends join as Listeners.
              </span>
            </div>
            <label class="lt-toggle">
              <input
                type="checkbox"
                :checked="newFriendsCanAdd"
                @change="onNewFriendsCanAddChange"
              />
              <span class="lt-toggle-track">
                <span class="lt-toggle-thumb" />
              </span>
            </label>
          </div>
        </div>

        <div class="lt-setting-block">
          <label class="lt-label lt-setting-label" for="lt-rate-limit">
            Fair queue limits
          </label>
          <select
            id="lt-rate-limit"
            class="lt-select"
            :value="room.settings.rateLimitPreset"
            @change="onRateLimitChange"
          >
            <option value="off">Off (up to 25)</option>
            <option value="strict">Strict (3 songs, 30s wait)</option>
          </select>
        </div>

        <div class="lt-setting-block">
          <label class="lt-label lt-setting-label" for="lt-vote-skip-mode">
            Vote skip
          </label>
          <select
            id="lt-vote-skip-mode"
            class="lt-select"
            data-testid="lt-vote-skip-select"
            :value="room.settings.voteSkipMode"
            @change="onVoteSkipModeChange"
          >
            <option value="off">Off (host only)</option>
            <option value="majority">Majority (50%+)</option>
            <option value="two-thirds">Two-thirds (67%+)</option>
            <option value="unanimous">Everyone (100%)</option>
          </select>
        </div>
      </section>

      <div class="lt-divider" />

      <section class="lt-settings-section">
        <h3 class="lt-settings-section-title">Room &amp; Diagnostics</h3>

        <div class="lt-setting-block">
          <button
            type="button"
            class="lt-btn lt-btn-block"
            :disabled="resetting"
            @click="handleResetInvite"
          >
            {{ resetting ? "Resetting…" : "Reset Invite Link & Code" }}
          </button>
          <span class="lt-muted">
            Invalidates old links and creates a new room code.
          </span>
          <p
            v-if="resetFeedback"
            :class="resetFeedback.isError ? 'lt-error-text' : 'lt-reset-ok'"
          >
            {{ resetFeedback.text }}
          </p>
        </div>

        <div class="lt-setting-block">
          <button
            type="button"
            class="lt-btn lt-btn-block"
            data-testid="lt-settings-open-log-btn"
            @click="handleOpenLogFile"
          >
            Open Log File
          </button>
        </div>

        <div class="lt-setting-block">
          <button
            v-if="!confirmEndRoom"
            type="button"
            class="lt-btn lt-btn-danger-outline lt-btn-block"
            @click="confirmEndRoom = true"
          >
            End Room for Everyone
          </button>

          <div v-else class="lt-confirm-box">
            <p class="lt-confirm-text">
              {{
                guestCount > 0
                  ? `End session for ${guestCount} ${guestCount === 1 ? "friend" : "friends"}?`
                  : "End this session?"
              }}
            </p>
            <div class="lt-confirm-actions">
              <button
                type="button"
                class="lt-btn lt-btn-primary lt-btn-sm"
                @click="handleConfirmEndRoom"
              >
                End Room
              </button>
              <button
                type="button"
                class="lt-btn lt-btn-sm"
                @click="confirmEndRoom = false"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.lt-settings-header {
  justify-content: flex-start;
}

.lt-settings-body {
  flex: 1;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.lt-settings-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.lt-settings-section-title {
  margin: 0;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #888888;
}

.lt-setting-block {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.lt-setting-label {
  color: #eeeeee;
  margin-bottom: 0;
  line-height: 1.4;
  padding-bottom: 1px;
}

.lt-toggle-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.lt-toggle-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}

.lt-setting-name {
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
  padding-bottom: 1px;
  color: #eeeeee;
}

.lt-divider {
  height: 1px;
  background-color: #212121;
}

.lt-reset-ok {
  margin: 0;
  font-size: 12px;
  color: #4caf50;
}

.lt-confirm-box {
  border: 1px solid #f44336;
  background-color: #111111;
  border-radius: 6px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.lt-confirm-text {
  margin: 0;
  font-size: 12px;
  color: #eeeeee;
}

.lt-confirm-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
</style>
