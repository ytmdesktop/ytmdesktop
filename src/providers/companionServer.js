const { ipcMain, app, ipcRenderer } = require('electron')
const http = require('http')
const os = require('os')
const networkInterfaces = os.networkInterfaces()
const qrcode = require('qrcode-generator')
const infoPlayerProvider = require('../providers/infoPlayerProvider')
const settingsProvider = require('../providers/settingsProvider')

const ip = '0.0.0.0'
const port = 9863
const hostname = os.hostname()

const pattIgnoreInterface = /(virtual|wsl|vEthernet|Default Switch)\w*/gim

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
    Object.keys(networkInterfaces).forEach((v, k) => {
        if (!pattIgnoreInterface.test(v)) {
            networkInterfaces[v].forEach((vv, kk) => {
                if (vv.family == 'IPv4' && vv.internal == false) {
                    var data = {
                        name: v,
                        ip: vv.address,
                    }
                    serverInterfaces.push(data)
                }
            })
        }
    })
}

var serverFunction = function (req, res) {
    if (req.url === '/') {
        var collection = ''

        serverInterfaces.forEach((value) => {
            let qr = qrcode(6, 'H')
            value['h'] = hostname
            qr.addData(JSON.stringify(value))
            qr.make()

            collection += `
                          <div class="row" style="margin-top: 10px;">
                              <div class="col s12">
                                  <div class="card transparent z-depth-0">
                                      <div class="card-content">
                                          <div class="row" style="margin-bottom: 0 !important;">
                                              <div class="col s6"> 
                                                  <img class="card card-content" style="padding: 10px !important;" src="${qr.createDataURL(
                                                      6
                                                  )}" width="180" />
                                              </div>
                                              <div class="col s6 white-text" style="border-left: solid 1px #222 !important; heigth: 500px; margin-top: 2.8% !important;"> 
                                                  <h3>${value.name}</h3> 
                                                  <h5 style="font-weight: 100 !important;">${
                                                      value.ip
                                                  }</h5> 
                                              </div>
                                          </div>
                                      </div>
                                  </div>
                              </div>
                          </div>
                      `
        })

        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.writeHead(200)

        res.write(`<html>
          <head>
              <title>YouTube Music Desktop Companion</title>
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
              <h3 class="red-text">YouTube Music Desktop</h3>
              
              <div class="row" style="height: 0; visibility: ${
                  infoPlayerProvider.getTrackInfo().id ? 'visible' : 'hidden'
              }">
                <div class="col s8 offset-s2 m6 offset-m3 l2 offset-l5">
                    <div class="card horizontal">
                      <div class="card-image" style="padding: 3px;">
                        <img src="${
                            infoPlayerProvider.getTrackInfo().cover
                        }" style="min-width: 78px; width: 78px;">
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
  
              <div class="container" style="margin-top: 13%;">
  
                  ${collection}
  
              </div>
  
              <div class="card-panel transparent z-depth-0 white-text" style="position: fixed; bottom: 0; text-align: center; width: 100%;">
                  ${hostname} <a class="white-text btn-flat tooltipped" data-position="top" data-tooltip="Devices Connected"><i class="material-icons left">devices</i>${totalConnections}</a>
              </div>
  
          </body>
          <script src="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/js/materialize.min.js"></script>
          <script>
              document.addEventListener('DOMContentLoaded', function() {
                  var elems = document.querySelectorAll('.tooltipped');
                  M.Tooltip.init(elems, {});
              });
          </script>
      </html>`)

        res.end()
    }

    if (req.url === '/query') {
        res.setHeader('Content-Type', 'text/json; charset=utf-8')
        res.setHeader('Access-Control-Allow-Origin', '*')

        if (req.method === 'GET') {
            let data = {
                player: infoPlayerProvider.getPlayerInfo(),
                track: infoPlayerProvider.getTrackInfo(),
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
                            let auth = headerAuth.split(' ')[1]

                            if (
                                auth ==
                                settingsProvider.get(
                                    'settings-companion-server-token'
                                )
                            ) {
                                execCmd(command, value)
                            } else {
                                res.writeHead(401)
                                res.end(
                                    JSON.stringify({ error: 'Unathorized' })
                                )
                            }
                        } catch {
                            res.writeHead(400)
                            res.end(
                                JSON.stringify({ error: 'No token provided' })
                            )
                        }
                    } else {
                        execCmd(command, value)
                    }

                    res.end(body)
                } catch {
                    res.end(
                        JSON.stringify({
                            error: 'error to execute command',
                        })
                    )
                }
            })
        }
    }

    if (req.url === '/info') {
        res.setHeader('Content-Type', 'text/json; charset=utf-8')
        res.setHeader('Access-Control-Allow-Origin', '*')

        if (req.method === 'GET') {
            var result = {
                app: infoApp(),
                server: infoServer(),
            }
            res.write(JSON.stringify(result))
            res.end()
        }
    }
}

var server = http.createServer(serverFunction)

function canConnect(socket) {
    let clientPassword = socket.handshake.headers['password'] || ''
    let clientHost = socket.handshake['address']
    let clientIsLocalhost = clientHost == '127.0.0.1'

    let serverPassword = settingsProvider.get('settings-companion-server-token')

    if (infoServer().isProtected) {
        if (clientIsLocalhost == false && clientPassword != serverPassword) {
            return false
        }
    }
    return true
}

function start() {
    server.listen(port, ip)
    const io = require('socket.io')(server)

    timerTotalConections = setInterval(() => {
        totalConnections = Object.keys(io.sockets.sockets).length

        if (totalConnections) {
            io.emit('query', infoPlayerProvider.getAllInfo())
        }
    }, 600)

    io.on('connection', (socket) => {
        if (!canConnect(socket)) {
            socket.disconnect()
        }

        socket.on('media-commands', (cmd, value) => {
            execCmd(cmd, value)
        })

        socket.on('retrieve-info', () => {
            socket.emit('info', {
                app: infoApp(),
                server: infoServer(),
            })
        })
    })

    fetchNetworkInterfaces()

    console.log('Companion Server listening on port ' + port)
}

function stop() {
    clearInterval(timerTotalConections)
    server.close()
    console.log('Companion Server has stopped')
}

function execCmd(cmd, value) {
    value = value || true

    switch (cmd) {
        case 'track-play':
            ipcMain.emit('media-command', {
                command: 'media-play-pause',
                value: true,
            })
            break

        case 'track-pause':
            ipcMain.emit('media-command', {
                command: 'media-play-pause',
                value: true,
            })
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

        case 'show-lyrics-hidden':
            ipcMain.emit('window', { command: 'show-lyrics-hidden' })
            break
    }
}

module.exports = {
    start: start,
    stop: stop,
}
