const { BrowserWindow, ipcRenderer: ipc } = require( 'electron' );
const path = require( 'path' );
const remote = require( 'electron' ).remote;
const window = remote.getCurrentWindow();

document.getElementById( 'btn-update' ).addEventListener( 'click', function() {
    ipc.send( 'btn-update-clicked', true );
} );

document.getElementById( 'btn-show-lyrics' ).addEventListener( 'click', function() {
    ipc.send('show-lyrics')
} );

document.getElementById( 'btn-minimize' ).addEventListener( 'click', function() {
    window.minimize();
} );

document.getElementById( 'btn-maximize' ).addEventListener( 'click', function() {
    if ( !window.isMaximized() ) {
        window.maximize();
    } else {
        window.unmaximize();
    }
} );

document.getElementById( 'btn-close' ).addEventListener( 'click', function() {
    ipc.send( 'will-close-mainwindow' )
} );

ipc.on( 'window-is-maximized', function( event, value ) {
    if ( value ) {
        document.getElementById( 'icon_maximize' ).classList.add( 'hide' );
        document.getElementById( 'icon_restore' ).classList.remove( 'hide' );
    } else {
        document.getElementById( 'icon_restore' ).classList.add( 'hide' );
        document.getElementById( 'icon_maximize' ).classList.remove( 'hide' );
    }
} );

ipc.on( 'have-new-update', function( e, data ) {
    // document.getElementById( 'btn-update' ).classList.remove( 'hide' );
} );

ipc.on( 'downloaded-new-update', function( e, data ) {
    document.getElementById( 'btn-update' ).classList.remove( 'hide' );
} );