const { ipcMain } = require('electron');
const os = require( 'os' );
//const mdns = require('mdns-js');
const networkInterfaces = os.networkInterfaces();
const qrcode = require('qrcode-generator');

const ip = '0.0.0.0';
const port = 9863;
const http = require('http');
const pattIgnoreInterface = /(virtual)\w*/gmi;

let connectionsTotal = 0;

/*function createAdvertisement() {
    try {
        var ad = mdns.createAdvertisement(mdns.tcp('_http'), port, 
            {
                name:'ytmdesktop._companion',
                port: port,
                txt: {
                    txtvers:'1'
                },
            }
        );
        ad.start();
    } catch (ex) {
        handleError(ex);
    }
}

function handleError(error) {
    switch (error.errorCode) {
        case mdns.kDNSServiceErr_Unknown:
            console.warn(error);
            setTimeout(createAdvertisement, 5000);
        break;

        default:
            throw error;
    } 
}

createAdvertisement();
*/

const server = http.createServer( ( req, res ) => {    
    let collection = '';

    Object.keys(networkInterfaces).forEach( ( v, k ) => {
        if( !pattIgnoreInterface.test( v ) ) {
            
            networkInterfaces[v].forEach( ( vv, kk) => {

                if ( vv.family == 'IPv4' && vv.internal == false ) {
                    var qr = qrcode(0, 'M');
                    qr.addData(`{ "name": "${os.hostname()}", "ip":"${vv.address}" }`);
                    qr.make();

                    collection += `
                        <div class="row" style="margin-top: 10px;">
                            <div class="col s12">
                                <div class="card transparent z-depth-0">
                                    <div class="card-content">
                                        <div class="row" style="margin-bottom: 0 !important;">
                                            <div class="col s6"> 
                                                <img class="card card-content" style="padding: 10px !important;" src="${qr.createDataURL(6)}" width="180" />
                                            </div>
                                            <div class="col s6 white-text" style="border-left: solid 1px #222 !important; heigth: 500px; margin-top: 2.8% !important;"> 
                                                <h3>${os.hostname()}</h3> 
                                                <h5 style="font-weight: 100 !important;">${vv.address}</h5> 
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;

                }

            });
    
        }

    } );

    res.writeHead( 200, {'Content-Type': 'text/html', 'Access-Control-Allow-Origin': '*'});

    res.write(`<html>
        <head>
            <title>YTMDesktop Companion Server</title>
            <meta http-equiv="refresh" content="60">
            <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
            <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/css/materialize.min.css">
            <style>
                html, body {
                    margin: 0;
                    padding: 0;
                    text-align: center;
                    background: linear-gradient(to right top, #000 20%, #1d1d1d 80%);
                }
                h5 {
                    margin: 1rem 0 1rem 0 !important;
                }
            </style>
        </head>
        <body>

            <div class="col s12">
                <h3 class="red-text">YTMDesktop Companion</h3>
            </div>

            <div class="container" style="margin-top: 13%;">

                ${collection}

            </div>

            <div class="card-panel transparent z-depth-0" style="position: fixed; bottom: 0; text-align: center; width: 100%;">
                <a class="white-text btn-flat tooltipped" data-position="top" data-tooltip="Devices Connected"><i class="material-icons left">devices</i>${connectionsTotal}</a>
            </div>

        </body>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/js/materialize.min.js"></script>
        <script>
            document.addEventListener('DOMContentLoaded', function() {
                var elems = document.querySelectorAll('.tooltipped');
                M.Tooltip.init(elems, {});
            });
        </script>
    </html>`);

    res.end();
} );

server.listen(port, ip);
const io = require('socket.io')(server);

function convertToHuman(time) {
    var _aux = time;
    var _minutes = 0;
    var _seconds = 0;

    while (_aux >= 60) {
        _aux = _aux - 60;
        _minutes++;
    }

    _seconds = _aux;

    if (_seconds < 10) {
        return _minutes + ':0' + _seconds;
    }
    return _minutes + ':' + _seconds;
}

setInterval( () => {
    connectionsTotal = Object.keys(io.sockets.sockets).length;
    console.log(connectionsTotal + ' devices connected');
}, 1000);

io.on('connection', (socket) => {
    
    let timer = setInterval( () => {
        ipcMain.emit('what-is-song-playing-now');
    }, 500);

    socket.on('disconnect', () => {
        clearInterval(timer);
    });
    
    ipcMain.on('song-playing-now-is', (data) => {
        data['song']['durationHuman'] = convertToHuman(data['song']['duration']);
        data['player']['seekbarCurrentPositionHuman'] = convertToHuman(data['player']['seekbarCurrentPosition']);

        io.emit('media-now-playing', data);
    });

    socket.on('media-commands', (cmd, data) => {

        switch( cmd ) {
            case 'previous-track':
                ipcMain.emit('media-previous-track', true);
                break;

            case 'play-track': 
                ipcMain.emit('media-play-pause', true);
                break;

            case 'pause-track':
                ipcMain.emit('media-play-pause', true);
                break;

            case 'next-track':
                ipcMain.emit('media-next-track', true);
                break;

            case 'thumbs-up-track':
                ipcMain.emit('media-up-vote', true);
                break;

            case 'thumbs-down-track':
                ipcMain.emit('media-down-vote', true);
                break;

            case 'volume-up':
                ipcMain.emit('media-volume-up', true);
                break;

            case 'volume-down':
                ipcMain.emit('media-volume-down', true);
                break;

            case 'forward-X-seconds':
                ipcMain.emit('media-forward-X-seconds', true);
                break;

            case 'rewind-X-seconds':
                ipcMain.emit('media-rewind-X-seconds', true);
                break;

            case 'change-seekbar':
                ipcMain.emit('media-change-seekbar', data);
                break;
        }
    } );

});

console.log("Companion Server listening on port " + port);