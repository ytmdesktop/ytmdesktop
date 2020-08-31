const cp = require('child_process')
const path = require('path')

let npm = 'npm'
if (process.platform === 'win32') {
    npm = 'npm.cmd'
}

let platform = ''
switch (process.platform) {
    case 'darwin':
        platform = 'mac'
        break
    case 'linux':
        platform = 'lin'
        break
    case 'win32':
        platform = 'win'
        break
}

if (!platform) throw new Error('Unsupported platform')

const { status } = cp.spawnSync(
    npm,
    ['run', `build:${platform}`, '--', '--publish=never'],
    {
        cwd: path.resolve(__dirname, '..'),
        stdio: 'inherit',
    }
)

process.exit(status)
