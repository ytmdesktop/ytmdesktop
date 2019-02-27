const { remote, ipcRenderer: ipc } = require( 'electron' );

document.getElementById('btn-play-pause').addEventListener('click', function() {
    ipc.send('media-play-pause');
});

document.getElementById('btn-exit').addEventListener('click', function() {
    remote.app.exit( 0 );
});

document.getElementById('btn-previous').addEventListener('click', function() {
    ipc.send('media-previous-track');
});

document.getElementById('btn-next').addEventListener('click', function() {
    ipc.send('media-next-track');
});

document.getElementById( 'btn-show-settings' ).addEventListener( 'click', function() {
    ipc.send('show-settings')
});

document.getElementById( 'btn-show-lyric' ).addEventListener( 'click', function() {
    ipc.send('show-lyrics')
});