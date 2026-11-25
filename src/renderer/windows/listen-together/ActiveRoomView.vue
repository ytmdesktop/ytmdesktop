<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { ListenTogetherActiveRoomUIState } from "~shared/listentogether/ipc";
import type { MemberStatus } from "~shared/listentogether/protocol";
import TrackThumbnail from "./TrackThumbnail.vue";
import {
  copyToClipboard,
  dispatchCommand,
  formatDuration,
  formatPasscodeDisplay,
  roleLabel,
} from "./utils";

const props = defineProps<{
  room: ListenTogetherActiveRoomUIState;
}>();

const emit = defineEmits<{
  openSettings: [];
}>();

const invitePopoverOpen = ref(false);
const copiedInvite = ref(false);
let copiedInviteTimer: ReturnType<typeof setTimeout> | null = null;
const copiedCode = ref(false);
let copiedCodeTimer: ReturnType<typeof setTimeout> | null = null;
const formattedPasscode = computed(() =>
  props.room.passcode ? formatPasscodeDisplay(props.room.passcode) : null,
);
const nowWallMs = ref(Date.now());
let remoteClockTimer: ReturnType<typeof setInterval> | null = null;

const confirmLeave = ref(false);
const showAddForm = ref(false);
const songInput = ref("");
const addError = ref<string | null>(null);
const addingSong = ref(false);
const songInputEl = ref<HTMLInputElement | null>(null);

const friendsOpen = ref(false);
const historyOpen = ref(true);
const leaveMenuOpen = ref(false);
const openMenuPeerId = ref<string | null>(null);
const draggedEntryId = ref<string | null>(null);
const dragOverEntryId = ref<string | null>(null);

watch(
  () => props.room.isHost,
  (isHost) => {
    if (!isHost) {
      confirmLeave.value = false;
      invitePopoverOpen.value = false;
      openMenuPeerId.value = null;
    }
  },
);

watch(
  () => props.room.role,
  (role) => {
    if (role === "listener") {
      showAddForm.value = false;
      addError.value = null;
    }
  },
);

watch(
  () => props.room.members,
  (members) => {
    if (
      openMenuPeerId.value &&
      !members.some((m) => m.peerId === openMenuPeerId.value)
    ) {
      openMenuPeerId.value = null;
    }
  },
);

function closeInlineOverlays(): boolean {
  if (invitePopoverOpen.value) {
    invitePopoverOpen.value = false;
    return true;
  }
  if (openMenuPeerId.value !== null) {
    openMenuPeerId.value = null;
    return true;
  }
  if (showAddForm.value) {
    showAddForm.value = false;
    addError.value = null;
    return true;
  }
  if (confirmLeave.value) {
    confirmLeave.value = false;
    return true;
  }
  if (leaveMenuOpen.value) {
    leaveMenuOpen.value = false;
    return true;
  }
  return false;
}

defineExpose({ closeInlineOverlays });

function handleDocumentClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  if (invitePopoverOpen.value && !target?.closest(".lt-invite-anchor")) {
    invitePopoverOpen.value = false;
  }
  if (openMenuPeerId.value && !target?.closest(".lt-member-menu-wrap")) {
    openMenuPeerId.value = null;
  }
  if (leaveMenuOpen.value && !target?.closest(".lt-split-leave-wrap")) {
    leaveMenuOpen.value = false;
  }
}

onMounted(() => {
  document.addEventListener("click", handleDocumentClick);
  remoteClockTimer = setInterval(() => {
    nowWallMs.value = Date.now();
  }, 500);
});

onUnmounted(() => {
  document.removeEventListener("click", handleDocumentClick);
  if (copiedInviteTimer) clearTimeout(copiedInviteTimer);
  if (copiedCodeTimer) clearTimeout(copiedCodeTimer);
  if (remoteClockTimer) clearInterval(remoteClockTimer);
});

watch(
  () => [
    props.room.remotePositionSec,
    props.room.remotePositionCapturedAtMs,
    props.room.remotePositionAdvancing,
  ],
  () => {
    nowWallMs.value = Date.now();
  },
);

const remoteElapsedSec = computed(() => {
  const track = props.room.currentTrack;
  if (!track) return 0;
  const base = props.room.remotePositionSec ?? 0;
  const deltaSec = props.room.remotePositionAdvancing
    ? Math.max(0, (nowWallMs.value - props.room.remotePositionCapturedAtMs) / 1000)
    : 0;
  return Math.max(0, Math.min(track.durationSec, base + deltaSec));
});

const remoteProgressPct = computed(() => {
  const dur = props.room.currentTrack?.durationSec ?? 0;
  if (dur <= 0) return 0;
  return Math.max(0, Math.min(100, (remoteElapsedSec.value / dur) * 100));
});

const statusMeta = computed(() => {
  if (props.room.listeningMode === "local") {
    return { color: "#ffb300", pulsing: false, label: "Listening Locally" };
  }
  switch (props.room.syncStatus) {
    case "synced":
      return { color: "#4caf50", pulsing: false, label: "Synced" };
    case "starting":
      return { color: "#eeeeee", pulsing: true, label: "Starting together…" };
    case "syncing":
      return { color: "#eeeeee", pulsing: true, label: "Syncing…" };
    case "paused-for-ad":
      return { color: "#eeeeee", pulsing: true, label: "Paused for ad" };
    case "reconnecting":
      return { color: "#f44336", pulsing: false, label: "Reconnecting…" };
    case "host-disconnected":
      return { color: "#f44336", pulsing: false, label: "Host disconnected" };
  }
});

const guestCount = computed(() => Math.max(0, props.room.members.length - 1));
const canAddSongs = computed(
  () => props.room.isHost || props.room.role === "dj",
);

const isAddDisabled = computed(
  () =>
    props.room.rateLimitRemainingSec > 0 || props.room.rateLimitReason !== null,
);

const addButtonLabel = computed(() => {
  if (props.room.rateLimitReason) {
    return props.room.rateLimitReason;
  }
  if (props.room.rateLimitRemainingSec > 0) {
    return `Wait ${props.room.rateLimitRemainingSec}s`;
  }
  return "+ Add Song";
});

const isPlaying = computed(() => props.room.anchor?.desiredState === "PLAYING");

const selfVotedSkip = computed(() =>
  props.room.skipVotes.includes(props.room.selfPeerId),
);

const showVoteSkip = computed(
  () =>
    Boolean(props.room.currentTrack) &&
    props.room.settings.voteSkipMode !== "off" &&
    props.room.skipVotesRequired > 0,
);

const selfMember = computed(
  () =>
    props.room.members.find((m) => m.peerId === props.room.selfPeerId) ?? null,
);

const selfInAd = computed(() => selfMember.value?.status === "in-ad");

const hostDisplayName = computed(
  () =>
    props.room.members.find((m) => m.role === "admin")?.displayName ?? "Host",
);

const waitingAdNames = computed(() => {
  const names =
    props.room.anchor?.waitingOnAds.map((w) => w.displayName).filter(Boolean) ??
    [];
  return names.join(", ");
});

const localSubjectLabel = computed(() => {
  if (props.room.localTrack) {
    return props.room.localTrack.author
      ? `${props.room.localTrack.title} — ${props.room.localTrack.author}`
      : props.room.localTrack.title;
  }
  if (props.room.localPlaylist) {
    return props.room.localPlaylist.title;
  }
  return "Playing your own music";
});

type AlertBanner = {
  kind:
    | "audio-blocked"
    | "reconnecting"
    | "host-disconnected"
    | "paused-for-ad"
    | "ad-catchup"
    | "minority-unavailable"
    | "clicked-candidate"
    | "notice";
  icon: string;
  text: string;
  subtext?: string;
  danger?: boolean;
};

const alertBanner = computed<AlertBanner | null>(() => {
  if (props.room.audioBlocked && props.room.listeningMode !== "local") {
    return {
      kind: "audio-blocked",
      icon: "volume_off",
      text: "Audio blocked by browser",
      danger: true,
    };
  }
  if (props.room.syncStatus === "reconnecting") {
    return {
      kind: "reconnecting",
      icon: "wifi_off",
      text: "Connection lost — reconnecting…",
      danger: true,
    };
  }
  if (props.room.syncStatus === "host-disconnected") {
    return {
      kind: "host-disconnected",
      icon: "person_off",
      text: `Host disconnected — waiting for ${hostDisplayName.value}…`,
      danger: true,
    };
  }
  if (
    props.room.listeningMode !== "local" &&
    (props.room.syncStatus === "paused-for-ad" || props.room.anchor?.pausedForAd)
  ) {
    if (selfInAd.value) {
      return {
        kind: "paused-for-ad",
        icon: "hourglass_top",
        text: "Ad playing — friends are paused for you",
      };
    }
    return {
      kind: "paused-for-ad",
      icon: "hourglass_top",
      text: waitingAdNames.value
        ? `Waiting for ${waitingAdNames.value}'s ad…`
        : "Waiting for friend's ad…",
      subtext: "Music resumes automatically",
    };
  }
  if (props.room.listeningMode !== "local" && selfInAd.value) {
    if (
      props.room.syncStatus === "starting" ||
      selfMember.value?.status === "catching-up" ||
      props.room.anchor?.desiredState === "LOADING_BARRIER"
    ) {
      return {
        kind: "ad-catchup",
        icon: "hourglass_top",
        text: "Playing ad — you'll jump to the room's track next",
      };
    }
    return {
      kind: "paused-for-ad",
      icon: "hourglass_top",
      text: "Room kept playing — you'll jump back in after your ad",
    };
  }
  if (
    props.room.listeningMode !== "local" &&
    props.room.minorityUnavailable
  ) {
    return {
      kind: "minority-unavailable",
      icon: "block",
      text: "This track isn't available for you — waiting for next song",
    };
  }
  if (props.room.clickedCandidate && canAddSongs.value) {
    return {
      kind: "clicked-candidate",
      icon: "playlist_add",
      text: `Add '${props.room.clickedCandidate.title}' to Room Queue?`,
    };
  }
  if (props.room.noticeBanner) {
    return {
      kind: "notice",
      icon: "info",
      text: props.room.noticeBanner,
    };
  }
  return null;
});

const inviteReachability = computed(() => {
  switch (props.room.connectionKind) {
    case "tailcat":
    case "relay":
      return {
        kind: props.room.connectionKind,
        badge: "Online",
      };
    default:
      return {
        kind: "direct" as const,
        badge: "Local Only",
      };
  }
});

function selectInvitePreview(event: FocusEvent) {
  const input = event.target as HTMLInputElement | null;
  input?.select();
}

function trackThumbSrc(track: {
  videoId: string;
  thumbnailUrl?: string | null;
}): string {
  if (track.thumbnailUrl && track.thumbnailUrl.trim()) {
    return track.thumbnailUrl;
  }
  return `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`;
}

async function handleCopyInvite() {
  const urlToCopy = props.room.shortInviteUrl || props.room.inviteUrl;
  if (!urlToCopy) return;
  const ok = await copyToClipboard(urlToCopy);
  if (!ok) return;
  copiedInvite.value = true;
  if (copiedInviteTimer) clearTimeout(copiedInviteTimer);
  copiedInviteTimer = setTimeout(() => {
    copiedInvite.value = false;
  }, 2000);
}

async function handleCopyCode() {
  if (!formattedPasscode.value) return;
  const ok = await copyToClipboard(formattedPasscode.value);
  if (!ok) return;
  copiedCode.value = true;
  if (copiedCodeTimer) clearTimeout(copiedCodeTimer);
  copiedCodeTimer = setTimeout(() => {
    copiedCode.value = false;
  }, 2000);
}

function handleLeaveClick() {
  leaveMenuOpen.value = false;
  void dispatchCommand({ type: "leaveRoom", endForAll: false });
}

function handleEndForAllClick() {
  leaveMenuOpen.value = false;
  if (props.room.isHost) {
    confirmLeave.value = true;
    return;
  }
  void dispatchCommand({ type: "leaveRoom", endForAll: true });
}

function handleToggleTuneMode() {
  if (props.room.listeningMode === "local") {
    void dispatchCommand({ type: "tuneBackIn" });
  } else {
    void dispatchCommand({ type: "tuneOut" });
  }
}

async function handleAddFromHistory(videoId: string) {
  if (!canAddSongs.value || isAddDisabled.value) return;
  await dispatchCommand({ type: "addSongByUrlOrId", input: videoId });
}

async function handleConfirmHostLeave() {
  confirmLeave.value = false;
  await dispatchCommand({ type: "leaveRoom" });
}

function openAddSongForm() {
  if (isAddDisabled.value) return;
  showAddForm.value = !showAddForm.value;
  addError.value = null;
  if (showAddForm.value) {
    void nextTick(() => {
      songInputEl.value?.focus();
    });
  }
}

async function handleSubmitSong() {
  const input = songInput.value.trim();
  if (!input) {
    addError.value = "Paste a YouTube Music link first.";
    return;
  }
  addingSong.value = true;
  addError.value = null;
  try {
    const res = await dispatchCommand({ type: "addSongByUrlOrId", input });
    if (res.ok) {
      songInput.value = "";
      showAddForm.value = false;
    } else {
      addError.value = res.error;
    }
  } finally {
    addingSong.value = false;
  }
}

function memberHasQueuedTracks(peerId: string): boolean {
  return props.room.queue.some((track) => track.addedBy === peerId);
}

function memberStatusLabel(status: MemberStatus): string | null {
  switch (status) {
    case "in-ad":
      return "In ad";
    case "unavailable":
      return "Unavailable";
    case "buffering":
      return "Buffering";
    case "catching-up":
      return "Catching up";
    case "synced":
      return null;
  }
}

function toggleMemberMenu(peerId: string) {
  openMenuPeerId.value = openMenuPeerId.value === peerId ? null : peerId;
}

function effectiveListeningMode(
  member: ListenTogetherActiveRoomUIState["members"][number],
): "room" | "local" {
  return member.peerId === props.room.selfPeerId
    ? props.room.listeningMode
    : member.listeningMode;
}

async function handleModerate(
  targetPeerId: string,
  action: "make-dj" | "make-listener" | "demote-clear" | "promote-host" | "kick",
) {
  openMenuPeerId.value = null;
  await dispatchCommand({ type: "moderateMember", targetPeerId, action });
}

function handleQueueRowClick(entryId: string) {
  if (!props.room.isHost) return;
  void dispatchCommand({ type: "jumpToTrack", target: "queue", entryId });
}

function handleHistoryRowClick(entryId: string) {
  if (!props.room.isHost) return;
  void dispatchCommand({ type: "jumpToTrack", target: "history", entryId });
}

function handleDragStart(event: DragEvent, entryId: string) {
  if (!props.room.isHost) return;
  draggedEntryId.value = entryId;
  dragOverEntryId.value = null;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", entryId);
  }
}

function handleDragOver(entryId: string) {
  if (!props.room.isHost || !draggedEntryId.value) return;
  dragOverEntryId.value = entryId;
}

function handleDragLeave(entryId: string) {
  if (dragOverEntryId.value === entryId) {
    dragOverEntryId.value = null;
  }
}

function handleDrop(event: DragEvent, targetIndex: number) {
  if (!props.room.isHost) return;
  const entryId =
    draggedEntryId.value || event.dataTransfer?.getData("text/plain") || "";
  draggedEntryId.value = null;
  dragOverEntryId.value = null;
  if (!entryId) return;
  void dispatchCommand({ type: "reorderQueue", entryId, targetIndex });
}

function handleDragEnd() {
  draggedEntryId.value = null;
  dragOverEntryId.value = null;
}
</script>

<template>
  <div class="lt-room">
    <!-- Zone 1: Clean Single-Row Room Header -->
    <header class="lt-room-header">
      <div class="lt-header-top">
        <div class="lt-status-group">
          <span
            class="lt-status-dot"
            :class="{ 'lt-dot-pulsing': statusMeta.pulsing }"
            :style="{ backgroundColor: statusMeta.color }"
            :title="statusMeta.label"
          />
          <span
            v-if="room.listeningMode === 'local' || room.syncStatus !== 'synced'"
            class="lt-status-label"
            data-testid="lt-status-label"
          >
            {{ statusMeta.label }}
          </span>
          <span
            v-if="room.roomName"
            class="lt-room-name"
            data-testid="lt-room-name"
            :title="room.roomName"
          >
            {{ room.roomName }}
          </span>
          <span class="lt-role-badge">{{ roleLabel(room.role) }}</span>
        </div>

        <div class="lt-header-actions">
          <div
            v-if="room.isHost && room.inviteUrl"
            class="lt-invite-anchor"
          >
            <button
              type="button"
              class="lt-btn lt-btn-sm lt-invite-trigger"
              :class="{ 'lt-active-pill': invitePopoverOpen }"
              data-testid="lt-invite-btn"
              title="Invite friends"
              @click.stop="invitePopoverOpen = !invitePopoverOpen"
            >
              <span class="material-symbols-outlined">person_add</span>
              <span>Invite</span>
            </button>
          </div>

          <button
            v-if="!room.isHost"
            type="button"
            class="lt-icon-btn"
            :title="
              room.isFavorite ? 'Remove from favorites' : 'Save to favorites'
            "
            data-testid="lt-favorite-btn"
            @click="dispatchCommand({ type: 'saveFavoriteRoom' })"
          >
            <span class="material-symbols-outlined">
              {{ room.isFavorite ? "star" : "star_outline" }}
            </span>
          </button>

          <button
            v-if="room.isHost"
            type="button"
            class="lt-icon-btn lt-room-settings-btn"
            data-testid="lt-settings-btn"
            title="Room settings"
            @click="emit('openSettings')"
          >
            <span class="material-symbols-outlined">tune</span>
          </button>
        </div>
      </div>

      <!-- Invite Popover Card -->
      <div
        v-if="invitePopoverOpen && room.isHost"
        class="lt-invite-popover lt-invite-anchor"
        data-testid="lt-invite-popover"
        @click.stop
      >
        <div class="lt-invite-popover-header">
          <span class="lt-invite-popover-title">Invite Friends</span>
          <button
            type="button"
            class="lt-icon-btn lt-popover-close"
            title="Close invite popover"
            @click="invitePopoverOpen = false"
          >
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>

        <div
          class="lt-invite-reachability"
          :class="`is-${inviteReachability.kind}`"
          data-testid="lt-invite-reachability"
        >
          <span class="lt-reachability-dot" />
          <span>{{ inviteReachability.badge }}</span>
        </div>

        <div v-if="room.shortInviteUrl || room.passcode || room.inviteUrl" class="lt-invite-link-section">
          <template v-if="room.shortInviteUrl">
            <span class="lt-code-caption">
              Invite Code: {{ room.shortCode }}
            </span>
            <input
              type="text"
              readonly
              class="lt-invite-link-preview"
              data-testid="lt-invite-link-preview"
              aria-label="Shareable invite link"
              :value="room.shortInviteUrl"
              @focus="selectInvitePreview"
            />
            <button
              type="button"
              class="lt-btn lt-btn-primary lt-btn-block lt-invite-link-btn"
              :class="{ 'lt-copied': copiedInvite }"
              data-testid="lt-copy-invite-link-btn"
              @click="handleCopyInvite"
            >
              <span class="material-symbols-outlined">
                {{ copiedInvite ? "check" : "link" }}
              </span>
              <span>{{ copiedInvite ? "Invite Copied" : "Copy Invite" }}</span>
            </button>
          </template>
          <template v-else-if="room.lanDiscoveryEnabled && formattedPasscode">
            <span class="lt-code-caption">Room Code (Wi-Fi)</span>
            <input
              type="text"
              readonly
              class="lt-invite-link-preview lt-tabular"
              data-testid="lt-invite-link-preview"
              aria-label="Room code"
              :value="formattedPasscode"
              @focus="selectInvitePreview"
            />
            <button
              type="button"
              class="lt-btn lt-btn-primary lt-btn-block lt-invite-link-btn"
              :class="{ 'lt-copied': copiedCode }"
              data-testid="lt-copy-invite-code-btn"
              @click="handleCopyCode"
            >
              <span class="material-symbols-outlined">
                {{ copiedCode ? "check" : "content_copy" }}
              </span>
              <span>{{ copiedCode ? "Code Copied" : "Copy Code" }}</span>
            </button>
            <button
              v-if="room.inviteUrl"
              type="button"
              class="lt-btn lt-btn-sm lt-btn-block"
              :class="{ 'lt-copied': copiedInvite }"
              data-testid="lt-copy-invite-link-btn"
              @click="handleCopyInvite"
            >
              <span class="material-symbols-outlined">
                {{ copiedInvite ? "check" : "link" }}
              </span>
              <span>{{ copiedInvite ? "Link Copied" : "Copy Full Link" }}</span>
            </button>
          </template>
          <template v-else-if="room.inviteUrl">
            <span class="lt-code-caption">Shareable Invite Link</span>
            <input
              type="text"
              readonly
              class="lt-invite-link-preview"
              data-testid="lt-invite-link-preview"
              aria-label="Shareable invite link"
              :value="room.inviteUrl"
              @focus="selectInvitePreview"
            />
            <button
              type="button"
              class="lt-btn lt-btn-primary lt-btn-block lt-invite-link-btn"
              :class="{ 'lt-copied': copiedInvite }"
              data-testid="lt-copy-invite-link-btn"
              @click="handleCopyInvite"
            >
              <span class="material-symbols-outlined">
                {{ copiedInvite ? "check" : "link" }}
              </span>
              <span>{{ copiedInvite ? "Link Copied" : "Copy Invite Link" }}</span>
            </button>
          </template>
        </div>
      </div>
    </header>

    <!-- Zone 2A: Local Listening Bar -->
    <Transition name="lt-tune-fade">
      <section
        v-if="room.listeningMode === 'local'"
        class="lt-local-bar"
        data-testid="lt-local-bar"
      >
        <div class="lt-local-top">
          <span class="material-symbols-outlined lt-local-icon">headphones</span>
          <div class="lt-local-copy">
            <div class="lt-local-title">Listening Locally</div>
            <div class="lt-local-subject">{{ localSubjectLabel }}</div>
          </div>
        </div>
      </section>
    </Transition>

    <!-- Alert Banner -->
    <div
      v-if="alertBanner"
      class="lt-alert-slot"
      :class="{ 'lt-alert-danger': alertBanner.danger }"
    >
      <div class="lt-alert-row">
        <span class="material-symbols-outlined lt-alert-icon">
          {{ alertBanner.icon }}
        </span>
        <div class="lt-alert-copy">
          <div class="lt-alert-text">{{ alertBanner.text }}</div>
          <div v-if="alertBanner.subtext" class="lt-alert-sub">
            {{ alertBanner.subtext }}
          </div>
        </div>
        <button
          v-if="alertBanner.kind === 'notice'"
          type="button"
          class="lt-icon-btn lt-alert-close"
          title="Dismiss"
          @click="dispatchCommand({ type: 'dismissNotice' })"
        >
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <div
        v-if="
          alertBanner.kind === 'audio-blocked' ||
          alertBanner.kind === 'reconnecting' ||
          alertBanner.kind === 'host-disconnected' ||
          (alertBanner.kind === 'paused-for-ad' && !selfInAd && room.isHost) ||
          alertBanner.kind === 'clicked-candidate'
        "
        class="lt-alert-actions"
      >
        <button
          v-if="alertBanner.kind === 'audio-blocked'"
          type="button"
          class="lt-btn lt-btn-primary lt-btn-sm"
          @click="dispatchCommand({ type: 'enableAudio' })"
        >
          Enable Audio
        </button>

        <template v-if="alertBanner.kind === 'reconnecting'">
          <button
            type="button"
            class="lt-btn lt-btn-sm"
            @click="dispatchCommand({ type: 'reconnectNow' })"
          >
            Retry Now
          </button>
          <button
            type="button"
            class="lt-btn lt-btn-sm"
            @click="handleLeaveClick"
          >
            Leave
          </button>
        </template>

        <button
          v-if="alertBanner.kind === 'host-disconnected'"
          type="button"
          class="lt-btn lt-btn-sm"
          @click="handleLeaveClick"
        >
          Leave
        </button>

        <button
          v-if="
            alertBanner.kind === 'paused-for-ad' && !selfInAd && room.isHost
          "
          type="button"
          class="lt-btn lt-btn-sm"
          @click="dispatchCommand({ type: 'forceResumeFromAd' })"
        >
          Skip Wait
        </button>

        <template v-if="alertBanner.kind === 'clicked-candidate'">
          <button
            type="button"
            class="lt-btn lt-btn-primary lt-btn-sm"
            @click="dispatchCommand({ type: 'acceptClickedCandidate' })"
          >
            + Queue
          </button>
          <button
            type="button"
            class="lt-btn lt-btn-sm"
            @click="dispatchCommand({ type: 'dismissClickedCandidate' })"
          >
            Dismiss
          </button>
        </template>
      </div>
    </div>

    <!-- Zone 3: Now Playing -->
    <section
      class="lt-now-playing"
      :class="{ 'is-tuned-out': room.listeningMode === 'local' }"
      data-testid="lt-now-playing"
    >
      <template v-if="room.currentTrack">
        <Transition name="lt-tune-fade" mode="out-in">
          <div
            v-if="room.listeningMode === 'local'"
            key="tuned-out"
            class="lt-np-tuned-out-wash"
          >
            <div class="lt-tuned-out-head">
              <span class="lt-tuned-out-badge">Tuned out</span>
              <span class="lt-tuned-out-timer lt-tabular" data-testid="lt-remote-timer">
                {{ formatDuration(remoteElapsedSec) }} /
                {{ formatDuration(room.currentTrack.durationSec) }}
              </span>
            </div>
            <div class="lt-tuned-out-song">
              {{ room.currentTrack.title }} —
              {{ room.currentTrack.author || "Unknown artist" }}
            </div>
            <div class="lt-tuned-out-attr">
              <span
                v-if="room.currentTrack.source === 'autoplay'"
                class="lt-autoplay-pill"
              >
                AUTOPLAY
              </span>
              <span v-else>
                {{
                  room.currentTrack.addedBy === room.selfPeerId
                    ? "Added by You"
                    : `Added by ${room.currentTrack.addedByName}`
                }}
              </span>
            </div>
            <div
              v-if="room.queue[0] || room.autoplayNext"
              class="lt-tuned-out-next"
            >
              Up next: {{ (room.queue[0] ?? room.autoplayNext)?.title }}
            </div>
            <button
              type="button"
              class="lt-btn lt-btn-primary lt-btn-sm lt-tuned-out-cta"
              data-testid="lt-tune-back-in-btn"
              @click="dispatchCommand({ type: 'tuneBackIn' })"
            >
              <span class="material-symbols-outlined">podcasts</span>
              <span>Tune In</span>
            </button>
          </div>

          <div v-else key="tuned-in">
            <div class="lt-np-main">
              <TrackThumbnail
                :src="trackThumbSrc(room.currentTrack)"
                size="lg"
              />

              <div class="lt-np-meta">
                <div class="lt-np-title">{{ room.currentTrack.title }}</div>
                <div class="lt-np-artist">
                  <span>{{ room.currentTrack.author || "Unknown artist" }}</span>
                  <span class="lt-tabular">
                    • {{ formatDuration(room.currentTrack.durationSec) }}
                  </span>
                </div>
                <div class="lt-np-attribution">
                  <template v-if="room.currentTrack.source === 'autoplay'">
                    <span class="lt-autoplay-pill">AUTOPLAY</span>
                  </template>
                  <span v-else class="lt-np-attr-text">
                    {{
                      room.currentTrack.addedBy === room.selfPeerId
                        ? "Queued by You"
                        : `Queued by ${room.currentTrack.addedByName}`
                    }}
                  </span>
                </div>
              </div>

              <div class="lt-np-transport">
                <button
                  type="button"
                  class="lt-icon-btn"
                  title="Add to your playlist"
                  data-testid="lt-np-add-to-playlist-btn"
                  @click="
                    dispatchCommand({
                      type: 'openAddToPlaylist',
                      videoId: room.currentTrack.videoId,
                    })
                  "
                >
                  <span class="material-symbols-outlined">playlist_add</span>
                </button>
                <button
                  type="button"
                  class="lt-icon-btn lt-tune-toggle-btn"
                  title="Tune out to local playback"
                  data-testid="lt-tune-toggle-btn"
                  @click="handleToggleTuneMode"
                >
                  <span class="material-symbols-outlined">headphones</span>
                </button>
                <button
                  v-if="showVoteSkip"
                  type="button"
                  class="lt-btn lt-btn-sm lt-vote-skip-btn"
                  :class="{ 'is-voted': selfVotedSkip }"
                  :aria-pressed="selfVotedSkip"
                  :title="
                    selfVotedSkip
                      ? 'Remove your skip vote'
                      : 'Vote to skip this song'
                  "
                  data-testid="lt-vote-skip-btn"
                  @click="dispatchCommand({ type: 'voteSkip' })"
                >
                  <span class="material-symbols-outlined">how_to_vote</span>
                  <span class="lt-tabular">
                    {{ room.skipVotes.length }}/{{ room.skipVotesRequired }}
                  </span>
                </button>
                <template v-if="room.isHost">
                  <button
                    type="button"
                    class="lt-icon-btn"
                    :title="isPlaying ? 'Pause' : 'Play'"
                    @click="
                      dispatchCommand({
                        type: 'hostTransport',
                        action: isPlaying ? 'pause' : 'play',
                      })
                    "
                  >
                    <span class="material-symbols-outlined">
                      {{ isPlaying ? "pause" : "play_arrow" }}
                    </span>
                  </button>
                  <button
                    type="button"
                    class="lt-icon-btn"
                    title="Skip track"
                    @click="
                      dispatchCommand({ type: 'hostTransport', action: 'skip' })
                    "
                  >
                    <span class="material-symbols-outlined">skip_next</span>
                  </button>
                </template>
              </div>
            </div>

            <div class="lt-np-progress-row">
              <div class="lt-np-progress-track">
                <div
                  class="lt-np-progress-fill"
                  :style="{ width: `${remoteProgressPct}%` }"
                />
              </div>
              <span class="lt-np-timer lt-tabular" data-testid="lt-remote-timer">
                {{ formatDuration(remoteElapsedSec) }} /
                {{ formatDuration(room.currentTrack.durationSec) }}
              </span>
            </div>
          </div>
        </Transition>
      </template>

      <div v-else class="lt-np-empty">
        <div class="lt-np-empty-title">Nothing playing right now</div>
        <div class="lt-muted">
          {{
            canAddSongs
              ? "Add a song below or play music in YTM to queue it."
              : "Waiting for a song to be queued."
          }}
        </div>
      </div>
    </section>

    <!-- Zone 4: Room Queue -->
    <section class="lt-queue-section lt-scroll">
      <div class="lt-queue-header">
        <span class="lt-queue-title">ROOM QUEUE ({{ room.queue.length }})</span>

        <button
          v-if="canAddSongs"
          type="button"
          class="lt-btn lt-btn-sm"
          :disabled="isAddDisabled"
          @click="openAddSongForm"
        >
          {{ addButtonLabel }}
        </button>
        <span v-else class="lt-listener-hint">Listeners can't add songs</span>
      </div>

      <form
        v-if="showAddForm && canAddSongs"
        class="lt-add-form"
        @submit.prevent="handleSubmitSong"
      >
        <input
          ref="songInputEl"
          v-model="songInput"
          type="text"
          class="lt-input"
          placeholder="Paste YouTube Music link…"
          @keydown.esc.stop.prevent="
            showAddForm = false;
            addError = null;
          "
        />
        <div class="lt-add-form-actions">
          <button
            type="submit"
            class="lt-btn lt-btn-primary lt-btn-sm"
            :disabled="addingSong"
          >
            {{ addingSong ? "Adding…" : "Add" }}
          </button>
          <button
            type="button"
            class="lt-btn lt-btn-sm"
            @click="
              showAddForm = false;
              addError = null;
            "
          >
            Cancel
          </button>
        </div>
        <p v-if="addError" class="lt-error-text">{{ addError }}</p>
      </form>

      <div
        v-if="room.history.length > 0"
        class="lt-history-list"
        data-testid="lt-history-list"
      >
        <button
          type="button"
          class="lt-history-toggle"
          :aria-expanded="historyOpen"
          data-testid="lt-history-toggle"
          @click="historyOpen = !historyOpen"
        >
          <span class="material-symbols-outlined">
            {{ historyOpen ? "expand_more" : "chevron_right" }}
          </span>
          <span class="lt-history-caption">
            PREVIOUSLY PLAYED ({{ room.history.length }})
          </span>
        </button>
        <template v-if="historyOpen">
          <div
            v-for="track in room.history"
            :key="`hist:${track.entryId}`"
            class="lt-queue-row lt-history-row"
            :class="{ 'is-clickable': room.isHost }"
            :data-entry-id="track.entryId"
            :title="room.isHost ? `Play '${track.title}' again` : undefined"
            data-testid="lt-history-row"
            @click="handleHistoryRowClick(track.entryId)"
          >
            <span class="lt-queue-index lt-history-icon">
              <span class="material-symbols-outlined">history</span>
            </span>

            <TrackThumbnail :src="trackThumbSrc(track)" size="md" />

            <div class="lt-queue-meta">
              <div class="lt-queue-track-title">
                <span class="lt-queue-title-text">{{ track.title }}</span>
              </div>
              <div class="lt-queue-track-sub-row">
                <span class="lt-queue-artist">
                  {{ track.author || "Unknown artist" }}
                </span>
                <span class="lt-queue-added-by">
                  {{
                    track.source === "autoplay"
                      ? "Autoplay"
                      : `by ${track.addedBy === room.selfPeerId ? "You" : track.addedByName}`
                  }}
                </span>
              </div>
            </div>

            <button
              type="button"
              class="lt-icon-btn lt-history-add-btn"
              title="Add to your playlist"
              data-testid="lt-history-add-to-playlist-btn"
              @click.stop="
                dispatchCommand({
                  type: 'openAddToPlaylist',
                  videoId: track.videoId,
                })
              "
            >
              <span class="material-symbols-outlined">playlist_add</span>
            </button>
            <button
              v-if="canAddSongs"
              type="button"
              class="lt-icon-btn lt-history-add-btn"
              :disabled="isAddDisabled"
              title="Add to room queue"
              data-testid="lt-history-add-btn"
              @click.stop="handleAddFromHistory(track.videoId)"
            >
              <span class="material-symbols-outlined">add</span>
            </button>
          </div>
        </template>
      </div>

      <div
        v-if="room.queue.length > 0"
        class="lt-queue-list"
        data-testid="lt-queue-list"
      >
        <div
          v-for="(track, index) in room.queue"
          :key="track.entryId"
          class="lt-queue-row"
          :class="{
            'is-pinned': track.pinned,
            'is-clickable': room.isHost,
            'is-dragging': draggedEntryId === track.entryId,
            'is-drag-over':
              dragOverEntryId === track.entryId &&
              draggedEntryId !== track.entryId,
          }"
          :draggable="room.isHost"
          :data-entry-id="track.entryId"
          :title="
            room.isHost
              ? `Click to play '${track.title}' or drag to reorder`
              : undefined
          "
          data-testid="lt-queue-row"
          @click="handleQueueRowClick(track.entryId)"
          @dragstart="handleDragStart($event, track.entryId)"
          @dragover.prevent="handleDragOver(track.entryId)"
          @dragleave="handleDragLeave(track.entryId)"
          @drop.prevent="handleDrop($event, index)"
          @dragend="handleDragEnd"
        >
          <span
            v-if="room.isHost"
            class="lt-drag-handle"
            title="Drag to reorder"
            data-testid="lt-drag-handle"
          >
            <span class="material-symbols-outlined">drag_indicator</span>
          </span>
          <span class="lt-queue-index lt-tabular">{{ index + 1 }}</span>

          <TrackThumbnail :src="trackThumbSrc(track)" />

          <div class="lt-queue-meta">
            <div class="lt-queue-track-title">
              <span class="lt-queue-title-text">{{ track.title }}</span>
            </div>
            <div class="lt-queue-track-sub-row">
              <span class="lt-queue-artist">
                {{ track.author || "Unknown artist" }}
              </span>
              <span class="lt-queue-added-by">
                by
                {{
                  track.addedBy === room.selfPeerId ? "You" : track.addedByName
                }}
              </span>
            </div>
          </div>

          <div class="lt-queue-row-actions">
            <button
              type="button"
              class="lt-icon-btn lt-row-btn"
              title="Add to your playlist"
              data-testid="lt-add-to-playlist-btn"
              @click.stop="
                dispatchCommand({
                  type: 'openAddToPlaylist',
                  videoId: track.videoId,
                })
              "
            >
              <span class="material-symbols-outlined">playlist_add</span>
            </button>
            <button
              v-if="room.isHost"
              type="button"
              class="lt-icon-btn lt-row-btn lt-pin-btn"
              :class="{ 'is-pinned': track.pinned }"
              :aria-pressed="track.pinned"
              :title="
                track.pinned ? 'Unpin from play next' : 'Pin to play next'
              "
              data-testid="lt-pin-btn"
              @click.stop="
                dispatchCommand({
                  type: track.pinned ? 'unpinTrack' : 'pinTrackNext',
                  entryId: track.entryId,
                })
              "
            >
              <span class="material-symbols-outlined">push_pin</span>
            </button>
            <button
              v-if="
                room.isHost ||
                (room.role === 'dj' && track.addedBy === room.selfPeerId)
              "
              type="button"
              class="lt-icon-btn lt-row-btn"
              title="Remove"
              @click.stop="
                dispatchCommand({ type: 'removeTrack', entryId: track.entryId })
              "
            >
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>
      </div>

      <div v-else-if="room.autoplayNext" class="lt-autoplay-next">
        <div class="lt-autoplay-divider">
          <span>Up Next</span>
          <span class="lt-autoplay-pill">AUTOPLAY</span>
        </div>
        <div class="lt-queue-row lt-autoplay-preview">
          <TrackThumbnail :src="trackThumbSrc(room.autoplayNext)" size="md" />
          <div class="lt-queue-meta">
            <div class="lt-queue-track-title">
              <span class="lt-queue-title-text">
                {{ room.autoplayNext.title }}
              </span>
            </div>
            <div class="lt-queue-track-sub-row">
              <span class="lt-queue-artist">
                {{ room.autoplayNext.author || "Unknown artist" }}
              </span>
            </div>
          </div>
          <button
            v-if="room.isHost"
            type="button"
            class="lt-icon-btn lt-row-btn"
            title="Dismiss autoplay suggestion"
            data-testid="lt-dismiss-autoplay-btn"
            @click.stop="dispatchCommand({ type: 'dismissAutoplayNext' })"
          >
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>

      <div v-else class="lt-queue-empty lt-muted">Queue is empty.</div>
    </section>

    <!-- Bottom Footer -->
    <footer class="lt-friends-footer">
      <div
        v-if="confirmLeave"
        class="lt-leave-confirm"
        data-testid="lt-leave-confirm"
      >
        <span class="lt-leave-confirm-text">
          Leave and end room for {{ guestCount }}
          {{ guestCount === 1 ? "friend" : "friends" }}?
        </span>
        <div class="lt-leave-confirm-actions">
          <button
            type="button"
            class="lt-btn lt-btn-primary lt-btn-sm"
            data-testid="lt-confirm-end-btn"
            @click="handleConfirmHostLeave"
          >
            End Room
          </button>
          <button
            type="button"
            class="lt-btn lt-btn-sm"
            @click="confirmLeave = false"
          >
            Cancel
          </button>
        </div>
      </div>

      <div class="lt-footer-bar">
        <button
          type="button"
          class="lt-friends-toggle"
          :aria-expanded="friendsOpen"
          data-testid="lt-friends-toggle"
          @click="friendsOpen = !friendsOpen"
        >
          <span class="material-symbols-outlined">
            {{ friendsOpen ? "expand_more" : "chevron_right" }}
          </span>
          <span class="lt-friends-summary">
            Friends ({{ room.members.length }})
          </span>
        </button>

        <div class="lt-split-leave-wrap">
          <div class="lt-split-btn">
            <button
              type="button"
              class="lt-btn lt-btn-sm lt-footer-leave-btn"
              :class="{ 'is-split-main': room.isHost }"
              title="Leave room"
              data-testid="lt-leave-btn"
              @click="handleLeaveClick"
            >
              <span class="material-symbols-outlined">logout</span>
              <span>Leave</span>
            </button>
            <button
              v-if="room.isHost"
              type="button"
              class="lt-btn lt-btn-sm lt-footer-leave-btn is-split-arrow"
              title="More leave options"
              data-testid="lt-leave-split-btn"
              @click.stop="leaveMenuOpen = !leaveMenuOpen"
            >
              <span class="material-symbols-outlined">expand_more</span>
            </button>
          </div>
          <div
            v-if="room.isHost && leaveMenuOpen"
            class="lt-leave-menu"
            data-testid="lt-leave-menu"
          >
            <button
              type="button"
              class="lt-menu-item lt-menu-danger"
              data-testid="lt-end-for-all-btn"
              @click="handleEndForAllClick"
            >
              End for all
            </button>
          </div>
        </div>
      </div>

      <div v-if="friendsOpen" class="lt-friends-list lt-scroll">
        <div
          v-for="req in room.pendingFriendRequests"
          :key="req.id"
          class="lt-member-row lt-friend-req-banner"
        >
          <span class="lt-member-name">{{ req.fromDisplayName }}</span>
          <div class="lt-member-actions">
            <button
              type="button"
              class="lt-icon-btn lt-friend-accept-btn"
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

        <div
          v-for="member in room.members"
          :key="member.peerId"
          class="lt-member-row"
        >
          <div class="lt-member-info">
            <span
              class="material-symbols-outlined lt-member-tune-icon"
              :class="
                effectiveListeningMode(member) === 'local'
                  ? 'is-tuned-out'
                  : 'is-tuned-in'
              "
              :title="
                effectiveListeningMode(member) === 'local'
                  ? 'Tuned out (listening locally)'
                  : 'Tuned in'
              "
            >
              {{
                effectiveListeningMode(member) === "local"
                  ? "headphones"
                  : "podcasts"
              }}
            </span>
            <span class="lt-member-name">{{ member.displayName }}</span>
            <span
              v-if="member.peerId === room.selfPeerId"
              class="lt-member-tag"
            >
              (You)
            </span>
            <span class="lt-member-tag">({{ roleLabel(member.role) }})</span>
            <span
              v-if="memberStatusLabel(member.status)"
              class="lt-member-status"
            >
              {{ memberStatusLabel(member.status) }}
            </span>
          </div>

          <div class="lt-member-actions">
            <span
              v-if="
                member.peerId !== room.selfPeerId &&
                room.friendPubKeys.includes(member.peerId)
              "
              class="material-symbols-outlined lt-friend-badge-icon"
              title="Friend"
            >
              how_to_reg
            </span>
            <span
              v-else-if="
                member.peerId !== room.selfPeerId &&
                room.sentFriendRequestPeerIds.includes(member.peerId)
              "
              class="lt-member-pending-chip"
            >
              Pending
            </span>
            <button
              v-else-if="member.peerId !== room.selfPeerId"
              type="button"
              class="lt-icon-btn"
              title="Add friend"
              @click="
                dispatchCommand({
                  type: 'sendFriendRequest',
                  targetPeerId: member.peerId,
                })
              "
            >
              <span class="material-symbols-outlined">person_add</span>
            </button>

            <div
              v-if="room.isHost && member.peerId !== room.selfPeerId"
              class="lt-member-menu-wrap"
            >
            <button
              type="button"
              class="lt-icon-btn lt-member-menu-btn"
              title="Member actions"
              @click.stop="toggleMemberMenu(member.peerId)"
            >
              <span class="material-symbols-outlined">more_vert</span>
            </button>

            <div v-if="openMenuPeerId === member.peerId" class="lt-member-menu">
              <button
                v-if="member.role === 'listener'"
                type="button"
                class="lt-menu-item"
                @click="handleModerate(member.peerId, 'make-dj')"
              >
                Make DJ
              </button>
              <template v-if="member.role === 'dj'">
                <button
                  type="button"
                  class="lt-menu-item"
                  @click="handleModerate(member.peerId, 'make-listener')"
                >
                  Make Listener
                </button>
                <button
                  v-if="memberHasQueuedTracks(member.peerId)"
                  type="button"
                  class="lt-menu-item"
                  @click="handleModerate(member.peerId, 'demote-clear')"
                >
                  Make Listener &amp; Clear Queue
                </button>
              </template>
              <button
                type="button"
                class="lt-menu-item"
                @click="handleModerate(member.peerId, 'promote-host')"
              >
                Promote to Host
              </button>
              <button
                type="button"
                class="lt-menu-item lt-menu-danger"
                @click="handleModerate(member.peerId, 'kick')"
              >
                Kick
              </button>
            </div>
          </div>
          </div>
        </div>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.lt-room {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.lt-room-header {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid #212121;
  background-color: #000000;
  flex-shrink: 0;
}

.lt-header-top {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.lt-status-group {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.lt-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.lt-status-label {
  font-size: 12px;
  font-weight: 600;
  color: #eeeeee;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lt-room-name {
  font-size: 12px;
  font-weight: 600;
  color: #f1f1f1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lt-role-badge {
  font-size: 11px;
  color: #bbbbbb;
  background-color: #212121;
  padding: 2px 6px;
  border-radius: 4px;
  white-space: nowrap;
  flex-shrink: 0;
}

.lt-header-actions {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.lt-invite-anchor {
  position: relative;
}

.lt-invite-trigger .material-symbols-outlined {
  font-size: 15px;
}

.lt-active-pill {
  background-color: #323232;
  border-color: #555555;
  color: #ffffff;
}

.lt-invite-popover {
  position: absolute;
  top: 44px;
  left: 8px;
  right: 8px;
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  border: 1px solid #323232;
  border-radius: 8px;
  background-color: #111111;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.78);
}

.lt-invite-popover-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.lt-invite-popover-title {
  font-size: 12px;
  font-weight: 600;
  color: #eeeeee;
}

.lt-popover-close {
  width: 22px;
  height: 22px;
}

.lt-invite-reachability {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  border: 1px solid #2e2e2e;
  background-color: #181818;
  color: #d0d0d0;
}

.lt-reachability-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background-color: #ffb300;
  flex-shrink: 0;
}

.lt-invite-reachability.is-tailcat,
.lt-invite-reachability.is-relay {
  border-color: rgba(76, 175, 80, 0.35);
  background-color: rgba(76, 175, 80, 0.1);
  color: #a5d6a7;
}

.lt-invite-reachability.is-tailcat .lt-reachability-dot,
.lt-invite-reachability.is-relay .lt-reachability-dot {
  background-color: #4caf50;
}

.lt-invite-link-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.lt-invite-link-preview {
  width: 100%;
  min-width: 0;
  padding: 6px 8px;
  border-radius: 5px;
  border: 1px solid #262626;
  background-color: #080808;
  color: #bbbbbb;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  text-overflow: ellipsis;
  outline: none;
  user-select: text;
}

.lt-invite-link-preview:focus {
  border-color: #444444;
  color: #eeeeee;
}

.lt-invite-link-btn .material-symbols-outlined {
  font-size: 16px;
}

.lt-copied {
  border-color: #4caf50 !important;
  color: #4caf50 !important;
  background-color: rgba(76, 175, 80, 0.12) !important;
}

/* Zone 2A: Local Listening Bar */
.lt-local-bar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #2a2210;
  background-color: #161209;
  border-left: 3px solid #ffb300;
  flex-shrink: 0;
}

.lt-local-top {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
}

.lt-local-icon {
  color: #ffb300;
  margin-top: 1px;
}

.lt-local-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.lt-local-title {
  font-size: 12px;
  font-weight: 600;
  color: #ffd54f;
}

.lt-local-subject {
  font-size: 12px;
  font-weight: 500;
  color: #eeeeee;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Zone 2B: Alert Banner */
.lt-alert-slot {
  border-bottom: 1px solid #212121;
  background-color: #212121;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}

.lt-alert-danger {
  border-left: 3px solid #f44336;
  background-color: #111111;
}

.lt-alert-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
}

.lt-alert-icon {
  color: #bbbbbb;
  margin-top: 1px;
}

.lt-alert-danger .lt-alert-icon {
  color: #f44336;
}

.lt-alert-copy {
  flex: 1;
  min-width: 0;
}

.lt-alert-text {
  font-size: 12px;
  font-weight: 500;
  color: #eeeeee;
  word-break: break-word;
}

.lt-alert-sub {
  font-size: 11px;
  color: #969696;
}

.lt-alert-close {
  width: 22px;
  height: 22px;
}

.lt-alert-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* Zone 3: Now Playing */
.lt-now-playing {
  position: relative;
  padding: 10px 12px;
  border-bottom: 1px solid #212121;
  background-color: #000000;
  flex-shrink: 0;
  transition: background-color 0.25s ease;
}

.lt-now-playing.is-tuned-out {
  background-color: #161209;
}

.lt-np-tuned-out-wash {
  background: linear-gradient(
    135deg,
    rgba(255, 179, 0, 0.16),
    rgba(22, 18, 9, 0.92)
  );
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 8px 10px;
}

.lt-tuned-out-attr {
  font-size: 11px;
  color: #cbb888;
}

.lt-tuned-out-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.lt-tuned-out-badge {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #ffd54f;
}

.lt-tuned-out-timer {
  font-size: 11px;
  color: #e0c98d;
}

.lt-tuned-out-song {
  font-size: 12px;
  font-weight: 600;
  color: #ffffff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lt-tuned-out-next {
  font-size: 11px;
  color: #cbb888;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lt-tuned-out-cta {
  align-self: flex-start;
  margin-top: 2px;
}

.lt-tune-fade-enter-active,
.lt-tune-fade-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.lt-tune-fade-enter-from,
.lt-tune-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.lt-np-main {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}

.lt-np-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.lt-np-title {
  font-size: 13px;
  font-weight: 600;
  color: #eeeeee;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lt-np-artist {
  font-size: 12px;
  color: #bbbbbb;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lt-np-attribution {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  margin-top: 2px;
}

.lt-autoplay-pill {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: #eeeeee;
  background-color: #212121;
  border: 1px solid #323232;
  padding: 1px 5px;
  border-radius: 3px;
}

.lt-np-attr-text {
  font-size: 11px;
  color: #969696;
  min-width: 0;
  word-break: break-word;
}

.lt-np-transport {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.lt-vote-skip-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 7px;
  font-size: 11px;
  color: #bbbbbb;
  border-color: #2f2f2f;
  background-color: #141414;
}

.lt-vote-skip-btn .material-symbols-outlined {
  font-size: 14px;
}

.lt-vote-skip-btn.is-voted {
  color: #ff8a80;
  border-color: rgba(244, 67, 54, 0.55);
  background-color: rgba(244, 67, 54, 0.16);
}

.lt-np-progress-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.lt-np-progress-track {
  flex: 1;
  height: 3px;
  border-radius: 999px;
  background-color: #242424;
  overflow: hidden;
  min-width: 0;
}

.lt-np-progress-fill {
  height: 100%;
  background-color: #f44336;
  transition: width 0.35s linear;
}

.lt-np-timer {
  font-size: 11px;
  color: #bbbbbb;
  white-space: nowrap;
  flex-shrink: 0;
}

.lt-np-empty {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.lt-np-empty-title {
  font-size: 13px;
  font-weight: 500;
  color: #bbbbbb;
}

/* Zone 4: Room Queue */
.lt-queue-section {
  flex: 1;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.lt-queue-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.lt-queue-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: #969696;
}

.lt-listener-hint {
  font-size: 11px;
  color: #888888;
}

.lt-add-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid #212121;
  border-radius: 6px;
  background-color: #111111;
}

.lt-add-form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.lt-queue-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.lt-history-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-bottom: 6px;
  border-bottom: 1px solid #1d1d1d;
}

.lt-history-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: none;
  padding: 2px 4px;
  cursor: pointer;
  color: #707070;
  text-align: left;
}

.lt-history-toggle:hover {
  color: #aaaaaa;
}

.lt-history-toggle .material-symbols-outlined {
  font-size: 15px;
}

.lt-history-caption {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: inherit;
}

.lt-history-add-btn {
  opacity: 0;
  transition: opacity 0.15s ease;
  flex-shrink: 0;
}

.lt-history-row:hover .lt-history-add-btn,
.lt-history-add-btn:focus-visible {
  opacity: 1;
}

.lt-history-row {
  opacity: 0.52;
}

.lt-history-row:hover {
  opacity: 0.85;
}

.lt-history-icon {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
}

.lt-history-icon .material-symbols-outlined {
  font-size: 14px;
  color: #777777;
}

.lt-queue-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 6px;
  border-radius: 4px;
  border-left: 2px solid transparent;
  min-width: 0;
  transition: background-color 0.15s ease, opacity 0.15s ease;
}

.lt-queue-row:hover {
  background-color: #111111;
}

.lt-queue-row.is-clickable {
  cursor: pointer;
}

.lt-queue-row.is-dragging {
  opacity: 0.4;
}

.lt-queue-row.is-drag-over {
  border-top: 2px solid #f44336;
  background-color: #181818;
}

.lt-drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #666666;
  cursor: grab;
  flex-shrink: 0;
  margin-right: -4px;
}

.lt-drag-handle:active {
  cursor: grabbing;
}

.lt-drag-handle .material-symbols-outlined {
  font-size: 15px;
}

.lt-queue-row:hover .lt-drag-handle {
  color: #aaaaaa;
}

.lt-queue-row.is-pinned {
  border-left: 2px solid #f44336;
  background-color: rgba(244, 67, 54, 0.05);
}

.lt-queue-index {
  width: 16px;
  font-size: 11px;
  color: #969696;
  text-align: right;
  flex-shrink: 0;
}

.lt-queue-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.lt-queue-track-title {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.lt-queue-title-text {
  font-size: 12px;
  font-weight: 500;
  color: #eeeeee;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lt-queue-track-sub-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
}

.lt-queue-artist {
  font-size: 11px;
  color: #aaaaaa;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
}

.lt-queue-added-by {
  flex-shrink: 0;
  font-size: 10px;
  color: #888888;
  white-space: nowrap;
}

.lt-queue-row-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  opacity: 0.72;
  transition: opacity 0.15s ease;
}

.lt-queue-row:hover .lt-queue-row-actions,
.lt-queue-row:focus-within .lt-queue-row-actions,
.lt-queue-row.is-pinned .lt-queue-row-actions {
  opacity: 1;
}

.lt-row-btn {
  width: 24px;
  height: 24px;
}

.lt-row-btn .material-symbols-outlined {
  font-size: 16px;
}

/* Reactive Pin / Unpin Button */
.lt-pin-btn {
  color: #969696;
  background-color: transparent;
  border-color: transparent;
  transition:
    background-color 0.16s ease,
    border-color 0.16s ease,
    color 0.16s ease;
}

.lt-pin-btn .material-symbols-outlined {
  transform: rotate(0deg);
  transition:
    transform 0.18s ease,
    color 0.16s ease;
}

.lt-pin-btn:hover:not(.is-pinned) {
  background-color: #262626;
  border-color: #3a3a3a;
  color: #eeeeee;
}

.lt-pin-btn:hover:not(.is-pinned) .material-symbols-outlined {
  transform: rotate(22deg) scale(1.08);
}

.lt-pin-btn.is-pinned {
  background-color: rgba(244, 67, 54, 0.18);
  border-color: rgba(244, 67, 54, 0.45);
  color: #ff6b6b;
}

.lt-pin-btn.is-pinned .material-symbols-outlined {
  transform: rotate(45deg);
  font-variation-settings:
    "FILL" 1,
    "wght" 400,
    "GRAD" 0,
    "opsz" 24;
}

.lt-pin-btn.is-pinned:hover {
  background-color: rgba(244, 67, 54, 0.28);
  border-color: rgba(244, 67, 54, 0.65);
  color: #ff8a80;
}

.lt-pin-btn.is-pinned:hover .material-symbols-outlined {
  transform: rotate(28deg);
}

.lt-autoplay-next {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 2px;
}

.lt-autoplay-divider {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #969696;
  border-top: 1px solid #212121;
  padding-top: 8px;
}

.lt-autoplay-preview {
  opacity: 0.85;
}

.lt-queue-empty {
  padding: 6px 0;
}

/* Zone 5: Bottom Footer */
.lt-friends-footer {
  border-top: 1px solid #212121;
  background-color: #000000;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}

.lt-leave-confirm {
  margin: 8px 10px 4px;
  background-color: #111111;
  border: 1px solid #f44336;
  border-radius: 6px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.lt-leave-confirm-text {
  font-size: 12px;
  color: #eeeeee;
}

.lt-leave-confirm-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.lt-footer-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding-right: 8px;
}

.lt-friends-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  background: transparent;
  border: none;
  color: #bbbbbb;
  font-family: "Work Sans", sans-serif;
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}

.lt-friends-toggle:hover {
  background-color: #111111;
  color: #eeeeee;
}

.lt-friends-summary {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lt-split-leave-wrap {
  position: relative;
  flex-shrink: 0;
}

.lt-split-btn {
  display: inline-flex;
  align-items: stretch;
}

.lt-footer-leave-btn.is-split-main {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
  border-right: none;
}

.lt-footer-leave-btn.is-split-arrow {
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  padding: 0 5px;
}

.lt-leave-menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 4px);
  min-width: 130px;
  background: #161616;
  border: 1px solid #2c2c2c;
  border-radius: 6px;
  padding: 4px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.55);
  z-index: 20;
}

.lt-footer-leave-btn {
  color: #bbbbbb;
  border-color: #2c2c2c;
  background-color: transparent;
  flex-shrink: 0;
}

.lt-footer-leave-btn .material-symbols-outlined {
  font-size: 14px;
}

.lt-footer-leave-btn:hover:not(:disabled) {
  color: #f44336;
  border-color: #f44336;
  background-color: rgba(244, 67, 54, 0.1);
}

.lt-friends-list {
  max-height: 180px;
  border-top: 1px solid #212121;
  padding: 4px 8px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.lt-member-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 4px 4px;
  border-radius: 4px;
  min-width: 0;
}

.lt-member-row:hover {
  background-color: #111111;
}

.lt-member-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.lt-friend-badge-icon {
  font-size: 16px;
  color: #81c784;
  padding: 0 4px;
}

.lt-friend-accept-btn {
  color: #81c784;
}

.lt-member-pending-chip {
  font-size: 10px;
  color: #ffb74d;
  padding: 1px 6px;
  border-radius: 999px;
  background-color: rgba(255, 183, 77, 0.14);
}

.lt-member-tune-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  font-size: 16px;
  flex-shrink: 0;
}

.lt-member-tune-icon.is-tuned-in {
  color: #4caf50;
  background-color: rgba(76, 175, 80, 0.14);
}

.lt-member-tune-icon.is-tuned-out {
  color: #ffb300;
  background-color: rgba(255, 179, 0, 0.16);
}

.lt-member-info {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: 6px;
  row-gap: 2px;
  min-width: 0;
  flex: 1;
  line-height: 18px;
}

.lt-member-name {
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
  color: #eeeeee;
  min-width: 0;
  word-break: break-word;
}

.lt-member-tag {
  font-size: 11px;
  line-height: 18px;
  color: #969696;
  white-space: nowrap;
}

.lt-member-status {
  font-size: 10px;
  line-height: 14px;
  color: #bbbbbb;
  background-color: #212121;
  padding: 1px 5px;
  border-radius: 3px;
  align-self: center;
}

.lt-member-menu-wrap {
  position: relative;
  flex-shrink: 0;
}

.lt-member-menu-btn {
  width: 24px;
  height: 24px;
}

.lt-member-menu {
  position: absolute;
  right: 0;
  bottom: 26px;
  z-index: 20;
  min-width: 168px;
  max-width: calc(100vw - 24px);
  background-color: #111111;
  border: 1px solid #323232;
  border-radius: 6px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.lt-menu-item {
  width: 100%;
  padding: 6px 8px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: #eeeeee;
  font-family: "Work Sans", sans-serif;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.lt-menu-item:hover {
  background-color: #212121;
}

.lt-menu-danger {
  color: #f44336;
}
</style>
