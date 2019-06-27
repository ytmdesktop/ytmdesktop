const { ipcMain, ipcRenderer } = require('electron');

const ip = '0.0.0.0';
const port = 8080;
const http = require('http');
const server = http.createServer();
server.listen(port, ip);
const io = require('socket.io')(server);

io.on('connection', function (socket) {

    socket.on('track-commands', function( cmd ) {
        switch( cmd ) {
            case 'previous-track':
                ipcMain.emit('media-previous-track', true)
                break;

            case 'play-track': 
                ipcMain.emit('media-play-pause', true);
                break;

            case 'pause-track':
                ipcMain.emit('media-play-pause', true);
                break;

            case 'next-track':
                ipcMain.emit('media-next-track', true)
                break;
        }
    } );

    socket.on('settings', function( cmd ) {
        switch( cmd ) {
            case 'show-settings':
                ipcMain.emit('show-settings', true);
                break;
        }
    } );



});

console.log("Socket listening on port " + port);