<script setup lang="ts" generic="T extends 'checkbox' | 'file' | 'range' | 'text' | 'custom'">
import { computed, ref } from "vue";

type ModelValue = {
  checkbox: boolean;
  file: string;
  range: number;
  text: string;
  custom: never;
};

const props = defineProps<{
  type: T;
  modelValue?: ModelValue[T];
  name: string;
  description?: string;
  restartRequired?: boolean;
  indented?: boolean;
  bindSetting?: string; // This is for the file picker so that it can properly set a data attribute that binds the setting correctly. TODO: Rewrite to not have this
  max?: number | string;
  min?: number | string;
  step?: number | string;
  disabled?: boolean;
  disabledMessage?: string;
  flexColumn?: boolean;
  beta?: boolean;
}>();
const emit = defineEmits(["update:modelValue", "file-change", "change", "input", "clear"]);

const value = computed({
  get() {
    return props.modelValue;
  },
  set(value) {
    emit("update:modelValue", value);
  }
});

const hasDescription = computed(() => {
  return props.description && props.description.trim() !== "";
});

const fileInput = ref(null);
</script>

<template>
  <div :class="{ 'ytmd-setting': true, 'indented': props.indented, 'flex-column': props.flexColumn }">
    <p v-if="!disabled && !hasDescription">
      {{ name }} <span v-if="restartRequired" class="reload-required material-symbols-outlined">autorenew</span>
      <span v-if="beta" class="beta-tag" title="This is a beta feature and may not work correctly yet.">BETA</span>
    </p>
    <div v-else-if="!disabled && hasDescription" class="name-description">
      <p class="name">
        {{ name }} <span v-if="restartRequired" class="reload-required material-symbols-outlined">autorenew</span>
        <span v-if="beta" class="beta-tag" title="This is a beta feature and may not work correctly yet.">BETA</span>
      </p>
      <p class="description">{{ description }}</p>
    </div>
    <div v-if="disabled" class="disabled-name-message">
      <p class="name">
        <span class="disabled-tag">DISABLED</span> {{ name }} <span v-if="restartRequired" class="reload-required material-symbols-outlined">autorenew</span>
        <span v-if="beta" class="beta-tag" title="This is a beta feature and may not work correctly yet.">BETA</span>
      </p>
      <p class="message">{{ disabledMessage }}</p>
    </div>

    <input
      v-if="type !== 'file' && type !== 'range' && type !== 'custom'"
      v-model="value"
      :disabled="disabled"
      :type="props.type"
      @change="$emit('change', $event)"
    />
    <div v-if="type == 'range'" class="range-selector">
      <span class="range-value">{{ value }}</span>
      <input v-model="value" :disabled="disabled" :type="props.type" :max="props.max" :min="props.min" :step="props.step" @change="$emit('change', $event)" />
    </div>
    <div v-if="type == 'file'" class="file-picker">
      <input ref="fileInput" :disabled="disabled" type="file" accept=".css" :data-setting="bindSetting" @change="$emit('file-change', $event)" />
      <div class="file-input-button">
        <button class="choose" @click="fileInput.click()"><span class="material-symbols-outlined">file_open</span></button>
        <input :disabled="disabled" type="text" readonly class="path" placeholder="No file chosen" :value="value" />
        <button v-if="value" class="remove" @click="$emit('clear')"><span class="material-symbols-outlined">delete</span></button>
      </div>
    </div>

    <slot></slot>
  </div>
</template>

<style scoped>
.ytmd-setting {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ytmd-setting.indented {
  margin-left: 12px;
  padding-left: 12px;
  border-left: 1px solid #212121;
}

.ytmd-setting.flex-column {
  flex-direction: column;
  align-items: initial;
  justify-content: initial;
}

.ytmd-setting .beta-tag {
  background-color: #f44336;
  border-radius: 4px;
  padding: 2px 4px;
}

.ytmd-setting .disabled-tag {
  background-color: #212121;
  border-radius: 4px;
  padding: 2px 4px;
}

.name-description .name,
.disabled-name-message .name {
  margin-bottom: unset;
}

.name-description .description,
.disabled-name-message .message {
  margin-top: 4px;
  color: #969696;
}

.reload-required {
  vertical-align: middle;
}

input[type="checkbox"] {
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
  min-width: 62px;
  min-height: 32px;
  width: 62px;
  height: 32px;
  display: inline-block;
  position: relative;
  border-radius: 50px;
  overflow: hidden;
  outline: none;
  border: none;
  cursor: pointer;
  background-color: #212121;
  transition: background-color ease 0.3s;
}

input[type="checkbox"]:before {
  content: "";
  display: block;
  position: absolute;
  z-index: 2;
  width: 28px;
  height: 28px;
  background: #fff;
  left: 2px;
  top: 2px;
  border-radius: 50%;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  transition: all ease 0.3s;
}

input[type="checkbox"]:checked {
  background-color: #f44336;
}

input[type="checkbox"]:checked:before {
  left: 32px;
}

input[type="checkbox"]:disabled {
  background-color: #212121;
  cursor: not-allowed;
}

input[type="checkbox"]:disabled::before {
  background-color: #969696;
}

input[type="file"] {
  display: none;
}

.file-picker {
  background-color: #212121;
  border-radius: 4px;
}

.file-input-button {
  width: 216px;
  border-radius: 4px;
  display: flex;
  align-items: center;
}

.file-input-button button {
  padding: 8px;
  border: none;
  display: flex;
  align-items: center;
  cursor: pointer;
}

.file-input-button button.choose {
  background-color: #f44336;
  border-radius: 4px 0 0 4px;
}

.file-input-button button.remove {
  background-color: transparent;
  border-left: 1px solid #323232;
  border-radius: 0 4px 4px 0;
}

.file-input-button button .material-symbols-outlined {
  margin-right: 4px;
  font-size: 18px;
}

.file-input-button input[type="text"] {
  margin: 0;
  padding: 8px;
  width: 100%;
  border: none;
  background-color: transparent;
}

.file-input-button input[type="text"]:focus,
.file-input-button input[type="text"]:active {
  outline: none;
}

.file-input-button p {
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.range-value {
  vertical-align: top;
  margin-right: 8px;
}

input[type="range"] {
  appearance: none;
  height: 15px;
  border-radius: 4px;
  background: #212121;
  outline: none;
}

input[type="range"]::-webkit-slider-thumb {
  appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #f44336;
  cursor: pointer;
}
</style>
