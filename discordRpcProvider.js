'use strict';

const electronStore = require('electron-store');
const store = new electronStore();
const DiscordRPC = require('discord-rpc');
const startTimestamp = new Date();
const clientId = '495666957501071390';
DiscordRPC.register( clientId );
const rpc = new DiscordRPC.Client( { transport: 'ipc' } );
// only needed for discord allowing spectate, join, ask to join

function setActivity( songTitle, songAuthor ) {
  if (!rpc) {
    return;
  }

  if ( store.get( 'settings-show-notifications' ) ) {   
      
    rpc.setActivity( {
      details: songTitle,
      state: songAuthor,
      startTimestamp,
      largeImageKey: 'ytm_logo_512',
      instance: false,
    } );

  }
}

rpc.login( { clientId } ).catch( console.error );

exports.activity = setActivity;