const { exec } = require('child_process')
const fs = require('fs')

exec('git rev-parse HEAD', (error, stdout, stderr) => {
    if (error) {
        console.log(`error: ${error.message}`)
        return
    }
    if (stderr) {
        console.log(`stderr: ${stderr}`)
        return
    }
    var hash = stdout.slice(0, 8)
    fs.readFile('./commit_hash.js.tpl', 'utf8', (err, data) => {
        if (err) {
            return console.log(`error: ${err}`)
        }
        var result = data.replace(/DEVELOPMENT_BUILD/g, hash)
        fs.writeFile('./commit_hash.js', result, function (err) {
            if (err) return console.log(err)
        })
    })
})
