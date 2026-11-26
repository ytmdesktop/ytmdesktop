import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';

const source = await readFile(
  new URL('../src/renderer/ytmview/scripts/ytmhook.ts', import.meta.url),
  'utf8',
);
const { YTMHook } = await import(
  `data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(source))}`
);

test('the provider hook accepts nullish Map entries and captures player and store providers', () => {
  const original = Object.getOwnPropertyDescriptor(Map.prototype, 'set');
  try {
    const hook = new YTMHook();
    hook.init();

    const map = new Map();
    for (const key of [null, undefined, 0, false, 'key', Symbol('key')]) {
      assert.equal(map.set(key, key), map);
      assert.equal(map.get(key), key);
    }
    assert.equal(map.set({ name: 'PLAYER_CONTROLLER_TOKEN' }, null), map);
    assert.equal(map.set({ name: 'STATE_STORE_TOKEN' }, undefined), map);

    class Player {}
    const playerProvider = { useClass: Player };
    const store = {};
    const storeProvider = { useFactory: () => store };
    map.set({ name: 'PLAYER_CONTROLLER_TOKEN' }, playerProvider);
    map.set({ name: 'STATE_STORE_TOKEN' }, storeProvider);
    const player = new playerProvider.useClass();
    assert.equal(storeProvider.useFactory(), store);
    assert.equal(hook.ytmPlayerController, player);
    assert.equal(hook.ytmStateStore, store);
  } finally {
    Object.defineProperty(Map.prototype, 'set', original);
  }
});
