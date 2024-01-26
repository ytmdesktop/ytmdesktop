<script setup lang="ts">
import { computed, ref } from "vue";

const props = defineProps({
  modelValue: {
    type: String,
    default: ""
  }
});
const emit = defineEmits(["update:modelValue", "change"]);

const keybindInput = ref(null);
const isEditing = ref(false);

const currentKeybind = computed({
  get() {
    return props.modelValue;
  },
  set(value) {
    emit("update:modelValue", value);
    emit("change");
  }
});

function startEditing() {
  keybindInput.value.focus();
}

function keybindInputFocused() {
  isEditing.value = true;
}

function keybindInputBlurred() {
  isEditing.value = false;
}

function isDisallowedKey(key: string) {
  return (
    key === "Meta" ||
    key === "Command" ||
    key === "Control" ||
    key === "Alt" ||
    key === "Shift" ||
    key === "AltGraph" ||
    key === "Pause" ||
    key === "MediaPlayPause" ||
    key === "MediaTrackPrevious" ||
    key === "MediaTrackNext" ||
    key === "MediaStop" ||
    key === "Tab" ||
    key === "AudioVolumeUp" ||
    key === "AudioVolumeDown" ||
    key === "AudioVolumeMute" ||
    key === "ContextMenu" ||
    key === "Cancel"
  );
}

function validateKey(event: KeyboardEvent) {
  if (event.key === " ") return "Space";
  if (event.code === "NumpadEnter") return "Enter";
  if (event.code === "NumpadAdd") return "NumAdd";
  if (event.code === "NumpadSubtract") return "NumSub";
  if (event.code === "NumpadDecimal") return "NumDec";
  if (event.code === "NumpadMultiply") return "NumMult";
  if (event.code === "NumpadDivide") return "NumDiv";
  if (event.code === "Numpad0") return "Num0";
  if (event.code === "Numpad1") return "Num1";
  if (event.code === "Numpad2") return "Num2";
  if (event.code === "Numpad3") return "Num3";
  if (event.code === "Numpad4") return "Num4";
  if (event.code === "Numpad5") return "Num5";
  if (event.code === "Numpad6") return "Num6";
  if (event.code === "Numpad7") return "Num7";
  if (event.code === "Numpad8") return "Num8";
  if (event.code === "Numpad9") return "Num9";
  if (event.code === "ArrowUp") return "Up";
  if (event.code === "ArrowDown") return "Down";
  if (event.code === "ArrowLeft") return "Left";
  if (event.code === "ArrowRight") return "Right";
  if (event.shiftKey && event.code === "Equal") return "Plus";
  if (event.keyCode >= 65 && event.keyCode <= 90) return event.key.toUpperCase();

  return event.key;
}

function keybindInputKeyDown(event: KeyboardEvent) {
  if (isDisallowedKey(event.key)) {
    return;
  }

  let newKeybind = "";

  if (event.key === "Escape") {
    currentKeybind.value = "";
    keybindInput.value.blur();
    event.preventDefault();
    return;
  }

  if (event.metaKey) newKeybind += "Meta+";
  if (event.ctrlKey) newKeybind += "CmdOrCtrl+";
  if (event.altKey) newKeybind += "Alt+";
  if (event.shiftKey) newKeybind += "Shift+";

  newKeybind += validateKey(event);
  keybindInput.value.blur();

  currentKeybind.value = newKeybind;

  event.preventDefault();
}
</script>

<template>
  <div :class="{ 'keybind': true, 'is-editing': isEditing }">
    <p v-if="!currentKeybind" class="keybind-text" @click="startEditing">None</p>
    <p v-else class="keybind-text" @click="startEditing">{{ currentKeybind }}</p>
    <input ref="keybindInput" class="keybind-input" type="text" @focus="keybindInputFocused" @blur="keybindInputBlurred" @keydown="keybindInputKeyDown" />
    <button class="remove" :disabled="!currentKeybind" @click="currentKeybind = ''"><span class="material-symbols-outlined">delete</span></button>
  </div>
</template>

<style scoped>
.keybind {
  position: relative;
  user-select: none;
  cursor: pointer;
  display: flex;
}

.keybind.is-editing {
  border: 2px solid #f44336;
}

.keybind-text {
  background-color: #212121;
  border: none;
  padding: 8px;
  border-radius: 4px;
  width: 216px;
  height: 20px;
  margin: 0;
}

.keybind-input {
  width: 0;
  height: 0;
  position: absolute;
  background: none;
  border: none;
  outline: none;
}

.remove {
  display: flex;
  justify-content: center;
  align-items: center;
  background-color: #212121;
  border-color: #323232;
  border-style: solid;
  border-width: 0 0 0 1px;
  border-radius: 0 4px 4px 0;
  cursor: pointer;
}

.remove:disabled {
  border-color: #323232;
  border-style: solid;
  border-width: 0 0 0 1px;
  cursor: not-allowed;
}
</style>
