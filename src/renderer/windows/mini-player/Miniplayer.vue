<script setup lang="ts"></script>

<template>
  <div class="miniplayer">
    <div class="drag-handle">
      <span class="material-symbols-outlined material-symbols-filled">drag_indicator</span>
    </div>
    <div class="restore-mainwindow">
      <span class="material-symbols-outlined material-symbols-filled">open_in_new</span>
    </div>

    <div class="miniplayer-container">
      <div class="miniplayer-title">TITLE</div>
      <div class="miniplayer-artist">ARTIST</div>

      <div class="miniplayer-textprogress"><span class="miniplayer-text-current">0:00</span> / <span class="miniplayer-text-total">1:00</span></div>

      <div class="miniplayer-controls">
        <button id="control-like" class="control-button control-outer" title="Like" aria-label="Like">
          <span class="material-symbols-outlined">thumb_up</span>
        </button>
        <button id="control-previous" class="control-button control-middle" fill="currentColor" title="Previous" aria-label="Previous">
          <span class="material-symbols-outlined material-symbols-filled">skip_next</span>
        </button>
        <button id="control-playpause" class="control-button control-center" fill="currentColor" title="Play/Pause" aria-label="Play/Pause">
          <span class="material-symbols-outlined material-symbols-filled">play_arrow</span>
        </button>
        <button id="control-next" class="control-button control-middle" fill="currentColor" title="Next" aria-label="Next">
          <span class="material-symbols-outlined material-symbols-filled">skip_next</span>
        </button>
        <button id="control-dislike" class="control-button control-outer" title="Dislike" aria-label="Dislike">
          <span class="material-symbols-outlined">thumb_down</span>
        </button>
      </div>

      <div class="miniplayer-progress">
        <div class="miniplayer-progress-bar"></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.material-symbols-filled {
  font-variation-settings:
    "FILL" 1,
    "wght" 400,
    "GRAD" 0,
    "opsz" 24;
}

.drag-handle {
  z-index: 100;
  position: absolute;
  top: 0;
  left: 0;

  cursor: grab;
}

.restore-mainwindow {
  z-index: 100;
  position: absolute;
  top: 0;
  right: 0;

  cursor: pointer;
}

/* Fade in and blur background on Hover */
.miniplayer-container {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  width: 100%;
  height: 100%;
  backdrop-filter: blur(5px);
  opacity: 0;
  transition:
    opacity 0.3s,
    backdrop-filter 0.3s;
}

.miniplayer-container:hover {
  opacity: 1;
  backdrop-filter: blur(10px);
}
</style>
