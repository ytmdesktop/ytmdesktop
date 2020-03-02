const { remote, ipcRenderer } = require("electron");
const request = require("request");
const __ = require("../../providers/translateProvider");

const url = "https://api.vagalume.com.br/search.php";

const window = remote.getCurrentWindow();
const elementLyric = document.getElementById("lyric");

let lastSong;
let lastArtist;
let target;
let toggled;

loadi18n();

/*document.getElementById("btn-close").addEventListener("click", function() {
  window.close();
});*/

document.getElementById("content").addEventListener("dblclick", function(e) {
  this.scrollTo(0, target);
});
document.getElementById("content").addEventListener("scroll", function(e) {
  var scrollTop = document.getElementById("content").scrollTop;
  var differential =
    target > scrollTop ? target - scrollTop : scrollTop - target;
  if (differential >= 40) {
    document.getElementById("tips").innerText = __.trans(
      "DOUBLE_CLICK_TO_RESET_POSITION"
    );
    toggled = false;
  } else {
    document.getElementById("tips").innerText = "";
    toggled = true;
  }
});
setInterval(function() {
  ipcRenderer.send("what-is-song-playing-now");
}, 1000);

ipcRenderer.on("song-playing-now-is", function(e, data) {
  var scrollHeight = document.getElementById("content").scrollHeight;
  target = (scrollHeight * data.track.statePercent) / 1.4;
  if (toggled) {
    document.getElementById("content").scrollTo(0, target);
  }

  getLyric(data.track.author, data.track.title);
});

function getLyric(artist, song) {
  if (artist != undefined && song != undefined) {
    if (artist != lastArtist && song != lastSong) {
      lastSong = song;
      lastArtist = artist;
      toggled = true;

      request(
        url + "?art=" + escapeHtml(artist) + "&mus=" + escapeHtml(song),
        { json: true },
        function(err, res, body) {
          if (err) {
            console.log("LYRICS ERRO");
            elementLyric.innerText = __.trans("LABEL_LYRICS_NOT_FOUND");
            return;
          }

          //document.getElementById("now-playing").innerText = song + " - " + artist;
          if (body.mus) {
            elementLyric.innerText = body.mus[0].text;
          } else {
            elementLyric.innerText = __.trans("LABEL_LYRICS_NOT_FOUND");
          }

          document.getElementById("content").scrollTop = 0;
        }
      );
    }
  } else {
    elementLyric.innerText = __.trans("LABEL_PLAY_MUSIC");
  }
}

function loadi18n() {
  document.getElementById("i18n_LABEL_LOADING").innerText = __.trans(
    "LABEL_LOADING"
  );
}

function escapeHtml(text) {
  var map = {
    "&": "and",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  };

  return text.replace(/[&<>"']/g, function(m) {
    return map[m];
  });
}
