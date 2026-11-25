<script setup lang="ts">
import { ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    src?: string | null;
    size?: "sm" | "md" | "lg";
  }>(),
  {
    src: null,
    size: "sm",
  },
);

const broken = ref(false);

watch(
  () => props.src,
  () => {
    broken.value = false;
  },
);
</script>

<template>
  <img
    v-if="src && !broken"
    :src="src"
    referrerpolicy="no-referrer"
    alt=""
    class="lt-thumb"
    :class="`lt-thumb-${size}`"
    @error="broken = true"
  />
  <div
    v-else
    class="lt-thumb lt-thumb-fallback"
    :class="`lt-thumb-${size}`"
  >
    <span class="material-symbols-outlined">music_note</span>
  </div>
</template>

<style scoped>
.lt-thumb {
  object-fit: cover;
  background-color: #212121;
  flex-shrink: 0;
}

.lt-thumb-sm {
  width: 32px;
  height: 32px;
  border-radius: 3px;
}

.lt-thumb-md {
  width: 36px;
  height: 36px;
  border-radius: 4px;
}

.lt-thumb-lg {
  width: 44px;
  height: 44px;
  border-radius: 4px;
}

.lt-thumb-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #969696;
}
</style>
