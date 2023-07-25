<script setup lang="ts">
import { computed, ref } from 'vue';

const props = defineProps(['modelValue']);
const emit = defineEmits(['update:modelValue', 'change'])

const keybindInput = ref(null);
const isEditing = ref(false);

const currentKeybind = computed({
    get() {
        return props.modelValue
    },
    set(value) {
        emit('update:modelValue', value);
        emit('change');
    }
})

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
        key === 'Meta' ||
        key === 'Command' ||
        key === 'Control' ||
        key === 'Alt' ||
        key === 'Shift' ||
        key === 'AltGraph' ||
        key === 'MediaPlayPause' ||
        key === 'MediaTrackPrevious' ||
        key === 'MediaTrackNext' ||
        key === 'MediaStop' ||
        key === 'Tab'
    )
}

function validateKey(event: KeyboardEvent) {
    if (event.key === ' ') return 'Space'
    if (event.code === 'NumpadEnter') return 'Enter'
    if (event.code === 'NumpadAdd') return 'NumAdd'
    if (event.code === 'NumpadSubtract') return 'NumSub'
    if (event.code === 'NumpadDecimal') return 'NumDec'
    if (event.code === 'NumpadMultiply') return 'NumMult'
    if (event.code === 'NumpadDivide') return 'NumDiv'
    if (event.code === 'ArrowUp') return 'Up'
    if (event.code === 'ArrowDown') return 'Down'
    if (event.code === 'ArrowLeft') return 'Left'
    if (event.code === 'ArrowRight') return 'Right'
    if (event.keyCode >= 65 && event.keyCode <= 90) return event.key.toUpperCase()

    return event.key
}

function keybindInputKeyDown(event: KeyboardEvent) {
    if (isDisallowedKey(event.key)) {
        return;
    }

    let newKeybind = '';

    if (event.key === 'Escape') {
        currentKeybind.value = '';
        keybindInput.value.blur();
        event.preventDefault();
        return;
    }

    if (event.metaKey) newKeybind += 'Meta+'
    if (event.ctrlKey) newKeybind += 'CmdOrCtrl+'
    if (event.altKey) newKeybind += 'Alt+'
    if (event.shiftKey) newKeybind += 'Shift+'

    newKeybind += validateKey(event)
    keybindInput.value.blur();

    currentKeybind.value = newKeybind

    event.preventDefault();
}
</script>

<template>
    <div :class="{ 'keybind': true, 'is-editing': isEditing }" @click="startEditing">
        <p v-if="!currentKeybind" class="keybind-text">None</p>
        <p v-else class="keybind-text">{{ currentKeybind }}</p>
        <input ref="keybindInput" class="keybind-input" type="text" @focus="keybindInputFocused"
            @blur="keybindInputBlurred" @keydown="keybindInputKeyDown" />
    </div>
</template>

<style scoped>
.keybind {
    position: relative;
    user-select: none;
    cursor: pointer;
}

.keybind.is-editing .keybind-text {
    border: 2px solid #F44336;
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
</style>