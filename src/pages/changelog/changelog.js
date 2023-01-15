const { ipcRenderer } = require('electron')
const markdown = require('markdown').markdown
const fetch = require('node-fetch')
const settingsProvider = require('../../providers/settingsProvider')

fetch(`https://api.github.com/repos/ytmdesktop/ytmdesktop/releases`)
    .then((res) => res.json())
    .then((json) => {
        let tag = ipcRenderer.sendSync('get-app-version')

        let filtered = json.filter((value) => value.tag_name === tag)
        let changelog = filtered[0]

        let body = changelog
            ? changelog.body
            : 'No changelog available for ' + tag

        document.getElementById('version').innerHTML = markdown.toHTML(tag)
        document.getElementById('changelog').innerHTML = markdown.toHTML(body)

        settingsProvider.set('has-updated', false)
    })
