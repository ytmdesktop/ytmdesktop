const { ipcMain } = require('electron')
const http = require('http')
const os = require('os')
const url = require('url')
const networkInterfaces = os.networkInterfaces()
const settingsProvider = require('../providers/settingsProvider')

const ip = '0.0.0.0'
const port = 9864

const pattIgnoreInterface = /(Loopback|lo$|virtual|wsl|vEthernet|Default Switch|VMware|Adapter|Hamachi)\w*/gim
let serverInterfaces = []

function fetchNetworkInterfaces() {
    serverInterfaces = Object.entries(networkInterfaces)
        .filter(([interfaces]) => !pattIgnoreInterface.test(interfaces))
        .map(([name, value]) => {
            value = value.filter(
                (data) => data.family === 'IPv4' && data.internal === false
            )
            return {
                name: name,
                ip: value.length ? value[0].address : '',
            }
        })
}

const serverFunction = (req, res) => {
    const realUrl =
        (req.connection.encrypted ? 'https' : 'http') +
        '://' +
        req.headers.host +
        req.url
    const urlObj = url.parse(realUrl, true)
    if (urlObj.pathname === '/') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.writeHead(200)
        res.write(`<html lang="en">
          <head>
              <title>YTMDesktop Genius authenticating...</title>
              <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
          </head>
          <body> <p>Authenticating..</p> </body>
          <script>
          if(window.location.hash) window.location.replace("http://localhost:9864/" + window.location.hash.replace("#", "?"));
          else document.getElementsByTagName("p")[0].textContent = "Authenticated! You can close this window.";
          </script>
      </html>`)

        if (urlObj.query['access_token']) {
            console.log(urlObj.query.access_token)
            console.log(urlObj.query.token_type)
            settingsProvider.set('genius-auth', urlObj.query)
        }
        res.end()
    } else if (req.url === '/login') {
        const clientID = `KBdWh3QGsSZI1joBSRmO3KvhBkanqt5hrofKo9rHjvRAZ4VybE4Fxqj4pRqKMrI6`
        const redirectURI = `http://localhost:9864/`
        res.writeHead(301, {
            Location: `http://api.genius.com/oauth/authorize?response_type=token&client_id=${clientID}&redirect_uri=${redirectURI}`,
        })
        res.end()
    }
}

const server = http.createServer(serverFunction)

function start() {
    try {
        server.listen(port, ip)
        fetchNetworkInterfaces()
        ipcMain.emit('log', {
            type: 'info',
            data: `Genius Auth Server listening on port ${port}`,
        })
    } catch (error) {
        ipcMain.emit('log', {
            type: 'warn',
            data: `Error to start server on port ${port}.\n cause: ${error}`,
        })
    }
}

function stop() {
    server.close()
    console.log('Genius Auth Server has stopped')
}

module.exports = {
    start: start,
    stop: stop,
}
