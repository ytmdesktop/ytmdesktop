const scribble = require("scribble");
const electronStore = require("electron-store");
const store = new electronStore();
const http = require("http");
const Base64 = require("js-base64").Base64;

const apiKey = "9ab417e8b808ed071223a1b4b3c29642";
const apiSecret = "9d8830c167627e65dac63786be101964";

var Scrobbler;

var userLogin = getLogin();

function signIn() {
  Scrobbler = new scribble(
    apiKey,
    apiSecret,
    userLogin.username,
    userLogin.password
  );
}

function setLogin(username, password) {
  store.set("last-fm-login", {
    username: username,
    password: Base64.encode(password)
  });
}

function getLogin() {
  var login = store.get("last-fm-login", { username: "", password: "" });
  login.password = Base64.decode(login.password);

  return login;
}

function getToken() {
  http.get(
    `http://ws.audioscrobbler.com/2.0/?method=auth.gettoken&api_key=${apiKey}&format=json`,
    function(res) {
      let rawData = "";
      res.on("data", chunk => {
        rawData += chunk;
      });
      res.on("end", () => {
        try {
          const parsedData = JSON.parse(rawData);
          authorize(parsedData.token);
        } catch (e) {
          console.error(e.message);
        }
      });
    }
  );
}

function updateTrackInfo(title, author) {
  if (store.get("settings-last-fm-scrobbler")) {
    if (Scrobbler === undefined) {
      signIn();
    }

    var song = {
      artist: author,
      track: title
    };
    Scrobbler.Scrobble(song, function(_) {});
  }
}

function authorize(token) {
  var authorize = window.open(
    `https://www.last.fm/api/auth?api_key=${apiKey}&token=${token}`,
    "Authorize App",
    "frame=true"
  );
}

module.exports = {
  getToken: getToken,
  updateTrackInfo: updateTrackInfo,
  getLogin: getLogin,
  setLogin: setLogin,
  authorize: authorize
};
