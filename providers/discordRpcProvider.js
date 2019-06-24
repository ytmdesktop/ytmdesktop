'use strict';

const electronStore = require('electron-store');
const store = new electronStore();
const DiscordRPC = require('discord-rpc');
const startTimestamp = new Date();
const clientId = '495666957501071390';
DiscordRPC.register( clientId );
let rpc = new DiscordRPC.Client( { transport: 'ipc' } );
// only needed for discord allowing spectate, join, ask to join

function setActivity( songTitle, songAuthor ) {
  if (!rpc) {
    return;
  }

  if ( store.get( 'settings-discord-rich-presence' ) ) {   

    rpc.login( { clientId } ).then(
      function() {
        // RPC Connected
        rpc.setActivity( {
          details: songTitle,
          state: songAuthor,
          startTimestamp,
          largeImageKey: 'ytm_logo_512',
          instance: false,
        } );
      },
      function() {
        // Error connecting to RPC
        setTimeout( function() {
          // Trying connect to RPC
          rpc = new DiscordRPC.Client( { transport: 'ipc' } );
          setActivity( songTitle, songAuthor );
        }, 10000 );
      }
    )
      
  }
}

exports.activity = setActivity;