<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";
import type {
  ListenTogetherLanRoomUI,
  ListenTogetherUIState,
} from "~shared/listentogether/ipc";
import {
  closeListenTogetherPanel,
  dispatchCommand,
  formatEndpoint,
  formatPasscodeDisplay,
  isInviteUrlInput,
  normalizePasscodeInput,
} from "./utils";

const props = defineProps<{
  state: ListenTogetherUIState;
}>();

const nameInput = ref(props.state.displayName);
const nameError = ref<string | null>(null);
const nameInputEl = ref<HTMLInputElement | null>(null);
const persistentRoomName = ref(props.state.persistentRoomName);

const joinInput = ref("");
const joinError = ref<string | null>(null);
const joinInputEl = ref<HTMLInputElement | null>(null);

const selectedLanRoom = ref<ListenTogetherLanRoomUI | null>(null);
const advancedOpen = ref(false);
const derpInput = ref(props.state.tailcatDerpMapUrl ?? "");
const derpFeedback = ref<{ text: string; isError: boolean } | null>(null);
const logFeedback = ref<string | null>(null);
const busyAction = ref<"create" | "join" | "derp" | null>(null);

onMounted(() => {
  if (props.state.friends.length > 0) {
    void dispatchCommand({ type: "refreshFriends" });
  }
});

watch(
  () => props.state.displayName,
  (next) => {
    if (document.activeElement !== nameInputEl.value) {
      nameInput.value = next;
    }
  },
);

watch(
  () => props.state.tailcatDerpMapUrl,
  (next) => {
    derpInput.value = next ?? "";
  },
);

watch(
  () => props.state.lanRooms,
  (rooms) => {
    if (
      selectedLanRoom.value &&
      !rooms.some((r) => r.lookupId === selectedLanRoom.value?.lookupId)
    ) {
      selectedLanRoom.value = null;
    }
  },
);

function validateDisplayName(): string | null {
  const clean = nameInput.value.trim().slice(0, 32);
  if (!clean) {
    nameError.value = "Enter your name first.";
    nameInputEl.value?.focus();
    return null;
  }
  nameError.value = null;
  return clean;
}

async function handleNameBlur() {
  const clean = nameInput.value.trim().slice(0, 32);
  if (clean) {
    nameError.value = null;
    if (clean !== props.state.displayName) {
      await dispatchCommand({ type: "setDisplayName", displayName: clean });
    }
  }
}

async function handleCreateRoom() {
  const cleanName = validateDisplayName();
  if (!cleanName) return;
  busyAction.value = "create";
  try {
    await dispatchCommand({
      type: "setPersistentRoom",
      enabled: true,
      roomName: persistentRoomName.value,
    });
    const res = await dispatchCommand({
      type: "createRoom",
      displayName: cleanName,
    });
    if (!res.ok) {
      joinError.value = res.error;
    }
  } finally {
    busyAction.value = null;
  }
}

function handleJoinInput(event: Event) {
  const target = event.target as HTMLInputElement;
  const val = target.value;
  joinError.value = null;
  if (isInviteUrlInput(val)) {
    selectedLanRoom.value = null;
    joinInput.value = val;
    return;
  }
  const trimmed = val.trim();
  if (
    !trimmed.toLowerCase().startsWith("ytmd") &&
    !trimmed.includes("://") &&
    !trimmed.includes("/")
  ) {
    const stripped = trimmed.replace(/[\s-]+/g, "").toUpperCase();
    if (
      stripped.length === 8 &&
      /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(stripped)
    ) {
      joinInput.value = formatPasscodeDisplay(stripped);
      return;
    }
  }
  joinInput.value = val;
}

function handleSelectLanRoom(room: ListenTogetherLanRoomUI) {
  selectedLanRoom.value = room;
  joinError.value = null;
  void nextTick(() => {
    joinInputEl.value?.focus();
  });
}

async function handleJoinRoom() {
  const cleanName = validateDisplayName();
  if (!cleanName) return;

  const raw = joinInput.value.trim();
  if (!raw) {
    joinError.value = "Paste an invite link or enter a room code.";
    joinInputEl.value?.focus();
    return;
  }

  joinError.value = null;
  busyAction.value = "join";
  try {
    if (isInviteUrlInput(raw)) {
      const res = await dispatchCommand({
        type: "joinByUrl",
        rawUrl: raw,
        displayName: cleanName,
      });
      if (!res.ok) {
        joinError.value = res.error;
      }
      return;
    }

    const code = normalizePasscodeInput(raw);
    if (!code) {
      joinError.value = "Enter a valid 8-character room code or invite link.";
      return;
    }

    if (!selectedLanRoom.value) {
      const res = await dispatchCommand({
        type: "joinByUrl",
        rawUrl: code,
        displayName: cleanName,
      });
      if (!res.ok) {
        joinError.value = res.error;
      }
      return;
    }

    const res = await dispatchCommand({
      type: "joinByPasscode",
      code,
      displayName: cleanName,
      lanEndpoint: formatEndpoint(
        selectedLanRoom.value.ip,
        selectedLanRoom.value.port,
      ),
    });
    if (!res.ok) {
      joinError.value = res.error;
    }
  } finally {
    busyAction.value = null;
  }
}

async function saveDerpMap(url: string | null) {
  if (url === null) {
    derpInput.value = "";
  }
  const trimmed = url?.trim() || null;
  derpFeedback.value = null;
  busyAction.value = "derp";
  try {
    const res = await dispatchCommand({
      type: "setTailcatDerpMapUrl",
      url: trimmed,
    });
    if (!res.ok) {
      derpFeedback.value = { text: res.error, isError: true };
    } else {
      derpFeedback.value = {
        text: trimmed ? "Relay map saved." : "Using default Tailcat relays.",
        isError: false,
      };
    }
  } finally {
    busyAction.value = null;
  }
}

async function handleOpenLogFile() {
  logFeedback.value = null;
  const res = await dispatchCommand({ type: "openLogFile" });
  if (!res.ok) {
    logFeedback.value = res.error;
  }
}

function handleDismissError() {
  void dispatchCommand({ type: "dismissError" });
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

    <div class="lt-scroll lt-lobby-body">
      <div v-if="state.errorBanner" class="lt-error-card">
        <div class="lt-error-header">
          <span class="lt-error-title">{{ state.errorBanner }}</span>
          <button
            type="button"
            class="lt-icon-btn lt-dismiss-btn"
            title="Dismiss"
            @click="handleDismissError"
          >
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        <p v-if="state.errorDetail" class="lt-muted lt-error-detail">
          {{ state.errorDetail }}
        </p>
      </div>

      <section class="lt-card lt-profile-card">
        <label class="lt-label" for="lt-display-name">Name</label>
        <input
          id="lt-display-name"
          ref="nameInputEl"
          v-model="nameInput"
          type="text"
          class="lt-input"
          maxlength="32"
          placeholder="Your name (for creating or joining)"
          @blur="handleNameBlur"
          @input="nameError = null"
        />
        <p v-if="nameError" class="lt-error-text">{{ nameError }}</p>
      </section>

      <section class="lt-card lt-create-card">
        <input
          v-model="persistentRoomName"
          type="text"
          class="lt-input"
          maxlength="48"
          placeholder="Room name (e.g. Chill Room)"
          @blur="
            dispatchCommand({
              type: 'setPersistentRoom',
              enabled: true,
              roomName: persistentRoomName,
            })
          "
        />
        <button
          type="button"
          class="lt-btn lt-btn-primary lt-btn-block"
          :disabled="busyAction !== null"
          @click="handleCreateRoom"
        >
          {{ busyAction === "create" ? "Creating…" : "Create Room" }}
        </button>
      </section>

      <section
        class="lt-card lt-lan-card"
        data-testid="lt-friends-card"
      >
        <div class="lt-friends-header-row">
          <span class="lt-section-heading">Friends</span>
          <button
            v-if="state.friends.length > 0"
            type="button"
            class="lt-icon-btn"
            title="Refresh friends"
            @click="dispatchCommand({ type: 'refreshFriends' })"
          >
            <span class="material-symbols-outlined">refresh</span>
          </button>
        </div>

        <div
          v-for="req in state.pendingFriendRequests"
          :key="req.id"
          class="lt-lan-row lt-friend-req-row"
        >
          <span class="lt-lan-name">{{ req.fromDisplayName }}</span>
          <div class="lt-fav-actions">
            <button
              type="button"
              class="lt-icon-btn lt-accept-btn"
              title="Accept friend"
              @click="
                dispatchCommand({
                  type: 'respondFriendRequest',
                  requestId: req.id,
                  accept: true,
                })
              "
            >
              <span class="material-symbols-outlined">check</span>
            </button>
            <button
              type="button"
              class="lt-icon-btn"
              title="Decline friend"
              @click="
                dispatchCommand({
                  type: 'respondFriendRequest',
                  requestId: req.id,
                  accept: false,
                })
              "
            >
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>

        <div v-if="state.friends.length > 0" class="lt-lan-list">
          <div
            v-for="friend in state.friends"
            :key="friend.pubKeyB64"
            class="lt-lan-row"
          >
            <span
              class="lt-status-chip"
              :class="{
                'is-online': friend.status === 'online',
                'is-checking': friend.status === 'checking',
                'is-offline': friend.status !== 'online' && friend.status !== 'checking',
              }"
              :title="friend.roomName || undefined"
            >
              <span class="lt-status-dot" />
              <span>
                {{
                  friend.status === "online"
                    ? "Open"
                    : friend.status === "checking"
                      ? "…"
                      : "Offline"
                }}
              </span>
            </span>

            <button
              type="button"
              class="lt-btn lt-btn-sm lt-friend-join-btn"
              :class="{ 'lt-btn-primary': friend.status === 'online' }"
              :disabled="busyAction !== null || !friend.tcAddress"
              :title="friend.roomName ? `Join ${friend.roomName}` : `Join ${friend.displayName}`"
              @click="dispatchCommand({ type: 'joinFriend', pubKeyB64: friend.pubKeyB64 })"
            >
              {{ friend.displayName }} : Join
            </button>

            <button
              type="button"
              class="lt-icon-btn"
              title="Remove friend"
              @click="dispatchCommand({ type: 'removeFriend', pubKeyB64: friend.pubKeyB64 })"
            >
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>
        <div
          v-else-if="state.pendingFriendRequests.length === 0"
          class="lt-muted-empty"
        >
          No friends yet
        </div>
      </section>

      <section
        v-if="state.lanDiscoveryEnabled && advancedOpen && state.lanRooms.length > 0"
        class="lt-card lt-lan-card"
      >
        <div class="lt-section-heading">Nearby on Wi-Fi</div>
        <div class="lt-lan-list">
          <div
            v-for="room in state.lanRooms"
            :key="room.lookupId"
            class="lt-lan-row"
          >
            <span class="lt-lan-name">{{ room.label }}</span>
            <button
              type="button"
              class="lt-btn lt-btn-sm"
              @click="handleSelectLanRoom(room)"
            >
              Join
            </button>
          </div>
        </div>
      </section>

      <section class="lt-card lt-join-card">
        <label class="lt-label" for="lt-join-input">Join a Room</label>
        <div v-if="selectedLanRoom" class="lt-lan-chip">
          <span class="lt-lan-chip-text">
            Joining {{ selectedLanRoom.label }} (Wi-Fi)
          </span>
          <button
            type="button"
            class="lt-icon-btn lt-chip-clear"
            title="Clear selected Wi-Fi room"
            @click="selectedLanRoom = null"
          >
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        <form class="lt-join-form" @submit.prevent="handleJoinRoom">
          <input
            id="lt-join-input"
            ref="joinInputEl"
            :value="joinInput"
            type="text"
            class="lt-input lt-tabular"
            :placeholder="
              selectedLanRoom
                ? 'Enter room code (XXXX-XXXX)'
                : 'Invite code (XXXX-XXXX) or link'
            "
            @input="handleJoinInput"
          />
          <button
            type="submit"
            class="lt-btn lt-join-btn"
            :disabled="busyAction !== null"
          >
            {{ busyAction === "join" ? "Joining…" : "Join" }}
          </button>
        </form>
        <p v-if="joinError" class="lt-error-text">{{ joinError }}</p>
      </section>

      <section class="lt-advanced">
        <button
          type="button"
          class="lt-disclosure-btn"
          :aria-expanded="advancedOpen"
          @click="advancedOpen = !advancedOpen"
        >
          <span class="lt-disclosure-arrow">{{
            advancedOpen ? "▾" : "▸"
          }}</span>
          <span>Advanced</span>
        </button>

        <div v-if="advancedOpen" class="lt-card lt-advanced-body">
          <label class="lt-persist-row">
            <input
              type="checkbox"
              :checked="state.lanDiscoveryEnabled"
              @change="
                dispatchCommand({
                  type: 'setLanDiscovery',
                  enabled: ($event.target as HTMLInputElement).checked,
                })
              "
            />
            <span>Enable LAN (Wi-Fi) discovery</span>
          </label>
          <label class="lt-label" for="lt-derp-url">
            Custom Relay Map (Optional)
          </label>
          <input
            id="lt-derp-url"
            v-model="derpInput"
            type="text"
            class="lt-input"
            placeholder="Default public Tailcat relays"
            @input="derpFeedback = null"
          />
          <p class="lt-muted lt-helper-hint">
            Optional self-hosted Tailcat DERP map JSON URL.
          </p>
          <div class="lt-advanced-actions">
            <button
              type="button"
              class="lt-btn lt-btn-sm"
              :disabled="busyAction !== null"
              @click="saveDerpMap(derpInput)"
            >
              Save
            </button>
            <button
              type="button"
              class="lt-btn lt-btn-sm"
              :disabled="
                busyAction !== null ||
                (!derpInput.trim() && state.tailcatDerpMapUrl === null)
              "
              @click="saveDerpMap(null)"
            >
              Clear
            </button>
          </div>
          <p
            v-if="derpFeedback"
            :class="derpFeedback.isError ? 'lt-error-text' : 'lt-saved-text'"
          >
            {{ derpFeedback.text }}
          </p>

          <div class="lt-advanced-logs">
            <span class="lt-label">Diagnostics</span>
            <button
              type="button"
              class="lt-btn lt-btn-sm"
              data-testid="lt-open-log-btn"
              @click="handleOpenLogFile"
            >
              Open Log File
            </button>
            <p v-if="state.logFilePath" class="lt-muted lt-log-path">
              {{ state.logFilePath }}
            </p>
            <p v-if="logFeedback" class="lt-error-text">{{ logFeedback }}</p>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.lt-lobby-body {
  flex: 1;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.lt-error-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6px;
}

.lt-error-title {
  font-size: 12px;
  font-weight: 600;
  color: #eeeeee;
  word-break: break-word;
}

.lt-error-detail {
  margin: 0;
  color: #bbbbbb;
  word-break: break-word;
}

.lt-dismiss-btn {
  width: 22px;
  height: 22px;
}

.lt-create-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.lt-lan-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.lt-section-heading {
  font-size: 12px;
  font-weight: 600;
  color: #bbbbbb;
}

.lt-lan-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.lt-fav-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.lt-friends-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.lt-status-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  background-color: #1f1f1f;
  color: #9e9e9e;
  flex-shrink: 0;
}

.lt-status-chip.is-online {
  background-color: rgba(76, 175, 80, 0.16);
  color: #81c784;
}

.lt-status-chip.is-checking {
  color: #ffb74d;
}

.lt-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: currentColor;
}

.lt-friend-join-btn {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lt-accept-btn {
  color: #81c784;
}

.lt-muted-empty {
  font-size: 12px;
  color: #777777;
}

.lt-saved-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.lt-saved-owner {
  font-size: 11px;
  color: #888888;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lt-persist-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #dddddd;
  cursor: pointer;
}

.lt-lan-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  background-color: #111111;
  min-width: 0;
}

.lt-lan-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #eeeeee;
  font-size: 12px;
}

.lt-join-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.lt-lan-chip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 4px 8px;
  background-color: #111111;
  border: 1px solid #323232;
  border-radius: 4px;
  font-size: 11px;
  color: #bbbbbb;
}

.lt-lan-chip-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lt-chip-clear {
  width: 20px;
  height: 20px;
}

.lt-join-form {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.lt-join-form .lt-input {
  flex: 1 1 110px;
}

.lt-join-btn {
  flex-shrink: 0;
}

.lt-helper-hint {
  margin: 2px 0 0;
  line-height: 1.35;
}

.lt-advanced {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.lt-disclosure-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  background: transparent;
  border: none;
  color: #969696;
  font-family: "Work Sans", sans-serif;
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}

.lt-disclosure-btn:hover {
  color: #eeeeee;
}

.lt-disclosure-arrow {
  font-size: 11px;
  width: 10px;
}

.lt-advanced-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.lt-advanced-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.lt-saved-text {
  color: #4caf50;
  font-size: 12px;
  margin: 0;
}

.lt-advanced-logs {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid #212121;
}

.lt-log-path {
  margin: 0;
  font-size: 11px;
  word-break: break-all;
}
</style>
