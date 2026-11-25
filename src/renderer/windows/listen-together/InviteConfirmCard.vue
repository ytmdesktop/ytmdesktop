<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type {
  ListenTogetherPendingInviteUI,
  ListenTogetherUIState,
} from "~shared/listentogether/ipc";
import { closeListenTogetherPanel, dispatchCommand } from "./utils";

const props = defineProps<{
  state: ListenTogetherUIState;
  invite: ListenTogetherPendingInviteUI;
}>();

const nameInput = ref(props.state.displayName);
const nameError = ref<string | null>(null);
const trustRelay = ref(false);
const actionError = ref<string | null>(null);
const joining = ref(false);
const nameInputEl = ref<HTMLInputElement | null>(null);

watch(
  () => props.state.displayName,
  (next) => {
    if (document.activeElement !== nameInputEl.value) {
      nameInput.value = next;
    }
  },
);

watch(
  () => props.invite.rawUrl,
  () => {
    trustRelay.value = false;
    actionError.value = null;
  },
);

const connectionLabel = computed(() =>
  props.invite.relayHost
    ? `Via relay: ${props.invite.relayHost}`
    : "Local network / direct",
);

const showTrustCheckbox = computed(
  () => Boolean(props.invite.relayHost) && !props.invite.relayTrusted,
);

async function handleJoin() {
  const cleanName = nameInput.value.trim().slice(0, 32);
  if (!cleanName) {
    nameError.value = "Enter your name first.";
    nameInputEl.value?.focus();
    return;
  }
  nameError.value = null;
  actionError.value = null;
  joining.value = true;
  try {
    const res = await dispatchCommand({
      type: "confirmPendingInvite",
      displayName: cleanName,
      trustRelayHost: showTrustCheckbox.value ? trustRelay.value : undefined,
    });
    if (!res.ok) {
      actionError.value = res.error;
    }
  } finally {
    joining.value = false;
  }
}

async function handleCancel() {
  await dispatchCommand({ type: "cancelPendingInvite" });
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

    <div class="lt-scroll lt-invite-body">
      <div class="lt-card lt-invite-card">
        <h2 class="lt-invite-title">Join Listen Together Room?</h2>
        <p class="lt-invite-connection">{{ connectionLabel }}</p>

        <div class="lt-field">
          <label class="lt-label" for="lt-invite-name">Your Name</label>
          <input
            id="lt-invite-name"
            ref="nameInputEl"
            v-model="nameInput"
            type="text"
            class="lt-input"
            maxlength="32"
            placeholder="Your name"
            @input="nameError = null"
          />
          <p v-if="nameError" class="lt-error-text">{{ nameError }}</p>
        </div>

        <label v-if="showTrustCheckbox" class="lt-trust-row">
          <input v-model="trustRelay" type="checkbox" class="lt-checkbox" />
          <span class="lt-trust-label">
            Also use {{ invite.relayHost }} as my relay for future room codes
          </span>
        </label>

        <p v-if="actionError || state.errorBanner" class="lt-error-text">
          {{ actionError ?? state.errorBanner }}
        </p>

        <div class="lt-invite-actions">
          <button
            type="button"
            class="lt-btn lt-btn-primary lt-btn-block"
            :disabled="joining"
            @click="handleJoin"
          >
            {{ joining ? "Joining…" : "Join Room" }}
          </button>
          <button
            type="button"
            class="lt-btn lt-btn-block"
            :disabled="joining"
            @click="handleCancel"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lt-invite-body {
  flex: 1;
  padding: 12px;
}

.lt-invite-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.lt-invite-title {
  margin: 0;
  font-family: "Open Sans", sans-serif;
  font-size: 14px;
  font-weight: 600;
  color: #eeeeee;
}

.lt-invite-connection {
  margin: 0;
  font-size: 12px;
  color: #bbbbbb;
  word-break: break-word;
}

.lt-field {
  min-width: 0;
}

.lt-trust-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  cursor: pointer;
}

.lt-checkbox {
  margin-top: 2px;
  accent-color: #f44336;
  flex-shrink: 0;
}

.lt-trust-label {
  font-size: 12px;
  color: #bbbbbb;
  line-height: 1.35;
  word-break: break-word;
}

.lt-invite-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
</style>
