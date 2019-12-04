const scribble = require("scribble");
const electronStore = require("electron-store");
const store = new electronStore();

const apiKey = "9ab417e8b808ed071223a1b4b3c29642";
const apiSecret = "9d8830c167627e65dac63786be101964";

var Scrobbler;

var userLogin = store.get("last-fm-login");

function signIn() {
  Scrobbler = new scribble(
    apiKey,
    apiSecret,
    userLogin.user,
    userLogin.password
  );
}

exports.getToken = function() {
  var windowToken = window.open(
    `http://ws.audioscrobbler.com/2.0/?method=auth.gettoken&api_key=${apiKey}&format=json`
  );
  console.log(windowToken);
};

exports.updateTrackInfo = function(title, author) {
  console.log(Scrobbler);
  var song = {
    artist: author,
    track: title
  };

  Scrobbler.Scrobble(song, function(_) {});
};
