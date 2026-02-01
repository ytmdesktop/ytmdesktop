const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    send: (channel, data) => {
      // Whitelist channels
      const validChannels = [
        'vinyl-player:play-pause',
        'vinyl-player:next',
        'vinyl-player:previous',
        'vinyl-player:close',
        // Used by 6K widget mode for click-and-drag window movement
        'vinyl-player:drag-start',
        'vinyl-player:drag-end'
      ];
      if (validChannels.includes(channel)) {
        ipcRenderer.send(channel, data);
      } else {
        // #region agent log (debug instrumentation)
        try {
          const f = globalThis.fetch;
          if (typeof f === 'function') {
            f('http://127.0.0.1:7244/ingest/0a7fc512-60ca-4a36-8768-23f664c122af',{
              method:'POST',
              headers:{'Content-Type':'application/json'},
              body:JSON.stringify({sessionId:'debug-session',runId:'multiclick-1',hypothesisId:'MC',location:'vinyl-player-preload.js:send',message:'blocked channel',data:{channel},timestamp:Date.now()})
            }).catch(()=>{});
          }
        } catch {}
        // #endregion agent log (debug instrumentation)
      }
    },
    on: (channel, func) => {
      // Whitelist channels
      const validChannels = [
        'vinyl-player:update-track',
        'vinyl-player:update-settings'
      ];
      if (validChannels.includes(channel)) {
        // Deliberately strip event as it includes `sender`
        ipcRenderer.on(channel, (event, ...args) => func(...args));
      }
    }
  }
});

