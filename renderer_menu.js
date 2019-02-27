const { remote, ipcRenderer: ipc } = require( 'electron' );
const electronStore = require( 'electron-store' );
const status = remote.getGlobal('sharedObj');
const store = new electronStore();
const __ = require( './translateProvider' );



// loadi18n();

// remote.getCurrentWebContents().openDevTools();

// document.addEventListener( 'DOMContentLoaded', function() {
// } );

// let update = ()=>{
//     document.getElementById('btn-play-pause').innerText = status.paused? "Play": "Pause"
// }

document.getElementById('btn-play-pause').addEventListener('click',
    function(){
    // MediaPlayPause();
    ipc.send('media-play-pause');
    // update();
})

document.getElementById('btn-exit').addEventListener('click',
    function(){
        remote.app.exit( 0 );
})

document.getElementById('btn-previous').addEventListener('click',
    function(){
        ipc.send('media-previous-track');
})
document.getElementById('btn-next').addEventListener('click',
    function(){
        ipc.send('media-next-track');
})

document.getElementById( 'btn-show-settings' ).addEventListener( 'click', function() {
    ipc.send('show-settings')
} );

document.getElementById( 'btn-show-lyric' ).addEventListener( 'click', function() {
    ipc.send('show-lyrics')
});

function loadi18n() {
}

function relaunch() {
    remote.app.relaunch();
    remote.app.exit( 0 );
}
