const { ipcMain, app } = require('electron')
const http = require('http')
const os = require('os')
const networkInterfaces = os.networkInterfaces()
const qrcode = require('qrcode-generator')
const infoPlayerProvider = require('../providers/infoPlayerProvider')
const settingsProvider = require('../providers/settingsProvider')

const ip = '0.0.0.0'
const port = 9863
const hostname = os.hostname()

const pattIgnoreInterface =
    /(Loopback|lo$|virtual|wsl|vEthernet|Default Switch|VMware|Adapter|Hamachi)\w*/gim

let totalConnections = 0
let timerTotalConections
let serverInterfaces = []

function infoApp() {
    return {
        version: app.getVersion(),
    }
}
function infoServer() {
    return {
        name: hostname,
        listen: serverInterfaces,
        port: port,
        isProtected:
            settingsProvider.get('settings-companion-server-protect') || false,
        connections: totalConnections,
    }
}

function fetchNetworkInterfaces() {
    serverInterfaces = Object.entries(networkInterfaces)
        .filter(([interfaces]) => !pattIgnoreInterface.test(interfaces))
        .map(([name, value]) => {
            value = value.filter((data) => {
                return data.family === 'IPv4' && data.internal === false
            })
            return {
                name: name,
                ip: value.length ? value[0].address : '',
                isProtected: infoServer().isProtected,
            }
        })
}

const serverFunction = (req, res) => {
    if (req.url === '/') {
        let collection = ''
        let isProtected = infoServer().isProtected

        serverInterfaces.forEach((value) => {
            let qr = qrcode(0, 'H')
            value.hostname = hostname
            qr.addData(JSON.stringify(value))
            qr.make()

            // TODO: This is quite messy
            collection += `
                          <div class="row" >
                              <div class="col s12">
                                  <div class="card transparent z-depth-0">
                                      <div class="card-content">
                                          <div class="row" style="margin-bottom: 0 !important;">
                                              <div class="col s6"> 
                                                  <img class="card card-content" style="padding: 10px !important;" src="${qr.createDataURL(
                                                      6
                                                  )}" alt="QR Code" width="180" />
                                              </div>
                                              <div class="col s6 white-text" style="border-left: solid 1px #222 !important; height: 500px; margin-top: 2.8% !important;"> 
                                                  <h3>${value.name}</h3> 
                                                  <h5 style="font-weight: 100 !important;">${
                                                      value.ip
                                                  }</h5> 
                                              </div>
                                          </div>
                                      </div>
                                  </div>
                              </div>
                          </div>`
        })

        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.writeHead(200)

        res.write(`<html lang="en">
          <head>
              <title>YTMDesktop Remote Control</title>
              <meta http-equiv="refresh" content="60">
              <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
              <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
              <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/css/materialize.min.css">
              <style>
                  html {
                      margin: 0;
                      padding: 0;
                      text-align: center;
                      background: linear-gradient(to right top, #000 20%, #1d1d1d 80%) fixed;
                      font-family: sans-serif;
                  }
                  h5 {
                      margin: 1rem 0 1rem 0 !important;
                  }

                  .center {
                    width: 68%;
                    position: absolute;
                    left: 50%;
                    top: 48%;
                    transform: translate(-50%, -50%);
                  }
              </style>
          </head>
          <body>              
              <h4 class="white-text">YTMDesktop Remote Control</h4>
              
              <div class="row" style="height: 0; visibility: ${
                  infoPlayerProvider.getTrackInfo().id ? 'visible' : 'hidden'
              }">
                <div class="col s8 offset-s2 m6 offset-m3 l2 offset-l5">
                    <div class="card horizontal">
                      <div class="card-image" style="padding: 3px;">
                        <img src="${
                            infoPlayerProvider.getTrackInfo().cover
                        }" style="min-width: 78px; width: 78px;" alt="Track cover image">
                      </div>
                      <div class="card-stacked" style="width: 74%;">
                        <div class="card-content" style="font-size: 11px;">
                          <p class="truncate"><strong>${
                              infoPlayerProvider.getTrackInfo().title
                          }</strong></p>
                          ${infoPlayerProvider.getTrackInfo().author}
                        </div>
                      </div>
                    </div>
                </div>
              </div>
  
              <div class="container" style="margin: 13% auto 5% auto;">
  
                  ${collection}
  
              </div>
  
              <div class="card-panel transparent z-depth-0 white-text" style="position: fixed; bottom: 0; text-align: center; width: 100%; padding: 0;">
                <div>
                    <a href='https://play.google.com/store/apps/details?id=app.ytmdesktop.remote&pcampaignid=pcampaignidMKT-Other-global-all-co-prtnr-py-PartBadge-Mar2515-1' target="_blank">
                        <img width="200" alt='Get it on Google Play' src='https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png'/>
                    </a>
                </div>

                <a class="${
                    isProtected ? 'white-text' : 'orange-text'
                } btn-flat tooltipped" data-position="top" data-tooltip="${
            isProtected ? 'Protected' : 'Not protected'
        } with password"><i class="material-icons tiny">${
            isProtected ? 'lock' : 'lock_open'
        }</i>
                </a>
                  ${hostname} 
                  <a class="white-text btn-flat tooltipped" data-position="top" data-tooltip="Devices Connected"><i class="material-icons left">devices_other</i>${totalConnections}</a>
              </div>
          </body>
          <script src="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/js/materialize.min.js"></script>
          <script>
              document.addEventListener('DOMContentLoaded', function() {
                  const elems = document.querySelectorAll('.tooltipped');
                  M.Tooltip.init(elems, {});
              });
          </script>
      </html>`)

        res.end()
    } else {
        res.setHeader('Content-Type', 'text/json; charset=utf-8')
        res.setHeader('Access-Control-Allow-Origin', '*')
    }

    if (req.url === '/query') {
        if (req.method === 'GET') {
            let data = {
                player: infoPlayerProvider.getPlayerInfo(),
                track: infoPlayerProvider.getTrackInfo(),
                /*queue: infoPlayerProvider.getQueueInfo(),
                playlist: infoPlayerProvider.getPlaylistInfo(),
                lyrics: infoPlayerProvider.getLyricsInfo(),*/
            }
            res.write(JSON.stringify(data))
            res.end()
        }

        if (req.method === 'POST') {
            let body = []

            req.on('data', (chunk) => {
                body.push(chunk)
            }).on('end', () => {
                try {
                    body = Buffer.concat(body).toString()
                    let { command, value } = JSON.parse(body)

                    if (
                        settingsProvider.get(
                            'settings-companion-server-protect'
                        )
                    ) {
                        try {
                            let headerAuth = req.headers.authorization
                            let authToken = headerAuth
                                .split(' ')[1]
                                .toUpperCase()

                            if (
                                authToken ===
                                settingsProvider.get(
                                    'settings-companion-server-token'
                                )
                            )
                                execCmd(command, value)
                            else {
                                res.writeHead(401)
                                res.end(
                                    JSON.stringify({ error: 'Unathorized' })
                                )
                            }
                        } catch (_) {
                            res.writeHead(400)
                            res.end(
                                JSON.stringify({ error: 'No token provided' })
                            )
                        }
                    } else execCmd(command, value)

                    res.end(body)
                } catch (_) {
                    res.end(
                        JSON.stringify({
                            error: 'error to execute command',
                        })
                    )
                }
            })
        }
    }

    if (req.url === '/query/player')
        if (req.method === 'GET') {
            res.write(JSON.stringify(infoPlayerProvider.getPlayerInfo()))
            res.end()
        }

    if (req.url === '/query/track')
        if (req.method === 'GET') {
            res.write(JSON.stringify(infoPlayerProvider.getTrackInfo()))
            res.end()
        }

    if (req.url === '/query/queue')
        if (req.method === 'GET') {
            res.write(JSON.stringify(infoPlayerProvider.getQueueInfo()))
            res.end()
        }

    if (req.url === '/query/playlist')
        if (req.method === 'GET') {
            res.write(JSON.stringify(infoPlayerProvider.getPlaylistInfo()))
            res.end()
        }

    if (req.url === '/query/lyrics')
        if (req.method === 'GET') {
            res.write(JSON.stringify(infoPlayerProvider.getLyricsInfo()))
            res.end()
        }

    if (req.url === '/info')
        if (req.method === 'GET') {
            const result = {
                app: infoApp(),
                server: infoServer(),
            }
            res.write(JSON.stringify(result))
            res.end()
        }
}

const server = http.createServer(serverFunction)

function canConnect(socket) {
    let clientPassword = socket.handshake.headers.password || ''
    let clientHost = socket.handshake.address
    let clientIsLocalhost = clientHost === '127.0.0.1'

    let serverPassword = settingsProvider.get('settings-companion-server-token')

    return !(
        infoServer().isProtected &&
        clientIsLocalhost === false &&
        clientPassword !== serverPassword
    )
}

function start() {
    try {
        server.listen(port, ip)
        const io = require('socket.io')(server)

        timerTotalConections = setInterval(() => {
            totalConnections = Object.keys(io.sockets.sockets).length

            if (totalConnections)
                io.emit('tick', infoPlayerProvider.getAllInfo())
        }, 500)

        io.on('connection', (socket) => {
            if (!canConnect(socket)) socket.disconnect()

            socket.on('media-commands', (cmd, value) => execCmd(cmd, value))

            socket.on('retrieve-info', () =>
                socket.emit('info', { app: infoApp(), server: infoServer() })
            )

            socket.on('query-player', () =>
                socket.emit('player', infoPlayerProvider.getPlayerInfo())
            )

            socket.on('query-track', () =>
                socket.emit('track', infoPlayerProvider.getTrackInfo())
            )

            socket.on('query-queue', () =>
                socket.emit('queue', infoPlayerProvider.getQueueInfo())
            )

            socket.on('query-playlist', () =>
                socket.emit('playlist', infoPlayerProvider.getPlaylistInfo())
            )

            socket.on('query-lyrics', () =>
                socket.emit('lyrics', infoPlayerProvider.getLyricsInfo())
            )
        })

        fetchNetworkInterfaces()

        ipcMain.emit('log', {
            type: 'info',
            data: `Companion Server listening on port ${port}`,
        })
    } catch (_) {
        ipcMain.emit('log', {
            type: 'warn',
            data: `Error to start server on port ${port}`,
        })
    }
}

function stop() {
    clearInterval(timerTotalConections)
    server.close()
    console.log('Companion Server has stopped')
}

function execCmd(cmd, value) {
    value = value || true

    switch (cmd) {
        case 'track-play-pause':
            ipcMain.emit('media-command', {
                command: 'media-play-pause',
                value: true,
            })
            break

        case 'track-play':
            if (infoPlayerProvider.getPlayerInfo().isPaused) {
                ipcMain.emit('media-command', {
                    command: 'media-play-pause',
                    value: true,
                })
            }
            break

        case 'track-pause':
            if (!infoPlayerProvider.getPlayerInfo().isPaused) {
                ipcMain.emit('media-command', {
                    command: 'media-play-pause',
                    value: true,
                })
            }
            break

        case 'track-next':
            ipcMain.emit('media-command', {
                command: 'media-track-next',
                value: true,
            })
            break

        case 'track-previous':
            ipcMain.emit('media-command', {
                command: 'media-track-previous',
                value: true,
            })
            break

        case 'track-thumbs-up':
            ipcMain.emit('media-command', {
                command: 'media-vote-up',
                value: true,
            })
            break

        case 'track-thumbs-down':
            ipcMain.emit('media-command', {
                command: 'media-vote-down',
                value: true,
            })
            break

        case 'player-volume-up':
            ipcMain.emit('media-command', {
                command: 'media-volume-up',
                value: true,
            })
            break

        case 'player-volume-down':
            ipcMain.emit('media-command', {
                command: 'media-volume-down',
                value: true,
            })
            break

        case 'player-forward':
            ipcMain.emit('media-command', {
                command: 'media-seekbar-forward',
                value: true,
            })
            break

        case 'player-rewind':
            ipcMain.emit('media-command', {
                command: 'media-seekbar-rewind',
                value: true,
            })
            break

        case 'player-set-seekbar':
            ipcMain.emit('media-command', {
                command: 'media-seekbar-set',
                value: value,
            })
            break

        case 'player-set-volume':
            ipcMain.emit('media-command', {
                command: 'media-volume-set',
                value: value,
            })
            break

        case 'player-set-queue':
            ipcMain.emit('media-command', {
                command: 'media-queue-set',
                value: value,
            })
            break

        case 'player-repeat':
            ipcMain.emit('media-command', {
                command: 'media-repeat',
                value: true,
            })
            break

        case 'player-shuffle':
            ipcMain.emit('media-command', {
                command: 'media-shuffle',
                value: true,
            })
            break

        case 'player-add-library':
            ipcMain.emit('media-command', {
                command: 'media-add-library',
                value: true,
            })
            break

        case 'player-add-playlist':
            ipcMain.emit('media-command', {
                command: 'media-add-playlist',
                value: value,
            })
            break

        case `skip-ad`:
            ipcMain.emit('media-command', { command: 'media-skip-ad' })
            break

        case `start-playlist`:
            ipcMain.emit('media-command', {
                command: 'media-start-playlist',
                value: value,
            })
            break

        case `play-url`:
            ipcMain.emit('media-command', {
                command: 'media-play-url',
                value: value,
            })
            break

        case 'show-lyrics-hidden':
            ipcMain.emit('window', { command: 'show-lyrics-hidden' })
            break
    }
}

module.exports = {
    start: start,
    stop: stop,
}
