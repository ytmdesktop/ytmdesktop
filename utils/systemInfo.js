/**
 * system-info.js
 * Utils for System info
 */

function isWindows() {
    return process.platform === "win32";
}

function isLinux() {
    return (
        process.platform === "freebsd" ||
        process.platform === "linux" ||
        process.platform === "openbsd"
    );
}

function isMac() {
    return process.platform === "darwin";
}

module.exports = {
    isWindows: isWindows,
    isLinux: isLinux,
    isMac: isMac
}