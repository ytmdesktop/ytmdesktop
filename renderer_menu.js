const { remote, ipcRenderer: ipc } = require( 'electron' );
const electronStore = require( 'electron-store' );
const store = new electronStore();
const __ = require( './translateProvider' );


// loadi18n();

// remote.getCurrentWebContents().openDevTools();

// document.addEventListener( 'DOMContentLoaded', function() {
// } );

document.getElementById('btn-play-pause').addEventListener('click',
    function(){
    // MediaPlayPause();
    ipc.send('media-play-pause');
})

function loadi18n() {
}

function relaunch() {
    remote.app.relaunch();
    remote.app.exit( 0 );
}
