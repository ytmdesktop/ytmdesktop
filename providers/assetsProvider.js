const { app } = require("electron");
const path = require("path");

const systemInfo = require("../utils/systemInfo");

/**
 * Get local asset
 * @param {*} asset
 */
function getLocal(asset) {
  let type = ".png";
  let localAsset = path.join(app.getAppPath(), "assets", `${asset}`);

  if (systemInfo.isWindows) {
    type = ".ico";
  } else if (systemInfo.isMac) {
    type = ".icns";
  } else {
    type = ".png";
  }

  return localAsset + type;
}

function getExternal() {}

module.exports = {
  getLocal: getLocal,
  getExternal: getExternal
};
