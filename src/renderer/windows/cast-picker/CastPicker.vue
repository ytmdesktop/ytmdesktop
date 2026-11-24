<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import type { CastPickerDevice, CastPickerDeviceKind } from "~shared/types";

const icons: Record<CastPickerDeviceKind, string> = {
  tv: "tv",
  speaker: "speaker",
  group: "speaker_group",
};

const root = ref<HTMLElement | null>(null);
const devices = ref<CastPickerDevice[]>([]);
const currentDeviceId = ref<string | undefined>(undefined);
const activeIndex = ref(0);

function reportSize() {
  if (root.value) window.ytmd.castPicker.resize(root.value.offsetHeight);
}

function scrollActiveIntoView() {
  root.value
    ?.querySelector<HTMLElement>(`[data-index="${activeIndex.value}"]`)
    ?.scrollIntoView({ block: "nearest" });
}

function move(delta: number) {
  const count = devices.value.length;
  if (count === 0) return;
  activeIndex.value = (activeIndex.value + delta + count) % count;
  scrollActiveIntoView();
}

function choose(device: CastPickerDevice) {
  window.ytmd.castPicker.choose(device.id);
}

function stop() {
  window.ytmd.castPicker.stop();
}

function onKeyDown(event: KeyboardEvent) {
  switch (event.key) {
    case "ArrowDown":
      move(1);
      break;
    case "ArrowUp":
      move(-1);
      break;
    case "Home":
      activeIndex.value = 0;
      scrollActiveIntoView();
      break;
    case "End":
      activeIndex.value = Math.max(devices.value.length - 1, 0);
      scrollActiveIntoView();
      break;
    case "Enter": {
      // Let a focused Stop button handle its own Enter
      if (event.target instanceof HTMLButtonElement) return;
      const device = devices.value[activeIndex.value];
      if (device) choose(device);
      break;
    }
    case "Escape":
      window.ytmd.castPicker.cancel();
      break;
    default:
      return;
  }
  event.preventDefault();
}

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  window.ytmd.castPicker.onShow(async (args) => {
    devices.value = args.devices;
    currentDeviceId.value = args.currentDeviceId;
    const current = args.devices.findIndex(
      (device) => device.id === args.currentDeviceId,
    );
    activeIndex.value = current >= 0 ? current : 0;
    await nextTick();
    // Always report, so main can show the window even when the height did not change
    reportSize();
    scrollActiveIntoView();
  });

  if (root.value) {
    resizeObserver = new ResizeObserver(() => reportSize());
    resizeObserver.observe(root.value);
  }
  window.addEventListener("keydown", onKeyDown);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  window.removeEventListener("keydown", onKeyDown);
});
</script>

<template>
  <div ref="root" class="picker">
    <div class="title">Cast to</div>
    <div class="list" role="listbox">
      <div
        v-for="(device, index) in devices"
        :key="device.id"
        class="row"
        :class="{
          active: index === activeIndex,
          current: device.id === currentDeviceId,
        }"
        role="option"
        :aria-selected="device.id === currentDeviceId"
        :data-index="index"
        @click="choose(device)"
        @mousemove="activeIndex = index"
      >
        <span class="icon material-symbols-outlined">{{
          icons[device.kind]
        }}</span>
        <span class="text">
          <span class="name">{{ device.name }}</span>
          <span class="secondary">{{
            device.id === currentDeviceId ? "Casting" : device.model
          }}</span>
        </span>
        <button
          v-if="device.id === currentDeviceId"
          class="stop"
          type="button"
          @click.stop="stop()"
        >
          Stop
        </button>
      </div>
      <div v-if="devices.length === 0" class="empty">No devices found</div>
    </div>
  </div>
</template>

<style scoped>
.picker {
  background-color: #212121;
  user-select: none;
  cursor: default;
}

.title {
  padding: 14px 16px 8px;
  font-size: 15px;
  font-weight: 500;
}

.list {
  max-height: 360px;
  overflow-y: auto;
  padding-bottom: 8px;
}

.row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 16px;
}

.row.active {
  background-color: #333333;
}

.row.current .icon,
.row.current .secondary {
  color: #8ab4f8;
}

.icon {
  font-size: 24px;
  color: #bbbbbb;
}

.text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.name,
.secondary {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.name {
  font-size: 14px;
}

.secondary {
  font-size: 12px;
  color: #999999;
}

.stop {
  flex-shrink: 0;
  padding: 4px 12px;
  border: 1px solid #5f6368;
  border-radius: 14px;
  background: transparent;
  color: #8ab4f8;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.stop:hover,
.stop:focus-visible {
  background-color: rgba(138, 180, 248, 0.15);
  outline: none;
}

.empty {
  padding: 12px 16px;
  font-size: 13px;
  color: #999999;
}
</style>
