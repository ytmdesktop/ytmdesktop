<script setup lang="ts">
import TitleBar from '../../shared/components/TitleBar.vue';
import Settings from '../../shared/components/Settings.vue'
</script>

<template>
    <div class="container">
        <TitleBar class="titlebar" title="Settings" icon="settings" />
        <Suspense>
            <Settings />
        </Suspense>
    </div>
</template>

<style scoped>
.titlebar {
    border-bottom: 1px solid #212121;
}

.container {
    width: 100%;
    height: 100%;
    background-color: #000000;
}

.content-container {
    height: 100%;
    display: flex;
}

.content {
    overflow: auto;
    flex-grow: 1;
    padding: 4px 16px;
}

.sidebar {
    width: 25%;
    list-style-type: none;
    margin: unset;
    padding: unset;
    height: 100%;
    border-right: 1px solid #212121;
}

.sidebar li {
    display: flex;
    align-items: center;
    padding: 16px;
    cursor: pointer;
    color: #BBBBBB;
}

.sidebar li .material-symbols-outlined {
    font-size: 28px;
    font-variation-settings:
        'FILL' 0,
        'wght' 100,
        'GRAD' 0,
        'opsz' 28;
}

.sidebar li:hover {
    background-color: #111111;
}

.sidebar li.active {
    background-color: #212121;
    color: #EEEEEE;
}

.sidebar li .material-symbols-outlined {
    margin-right: 8px;
}

.setting {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.toggle {
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    width: 62px;
    height: 32px;
    display: inline-block;
    position: relative;
    border-radius: 50px;
    overflow: hidden;
    outline: none;
    border: none;
    cursor: pointer;
    background-color: #707070;
    transition: background-color ease 0.3s;
}

.toggle:before {
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

.toggle:checked {
    background-color: #F44336;
}

.toggle:checked:before {
    left: 32px;
}
</style>