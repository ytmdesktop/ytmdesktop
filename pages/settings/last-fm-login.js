const __ = require("../../providers/translateProvider");
const scrobbleProvider = require("../../providers/scrobblerProvider");
__.loadi18n();
const Base64 = require("js-base64").Base64;

document.getElementById("btn-close").addEventListener("click", function() {
  window.close();
});

var login = scrobbleProvider.getLogin();
if (login) {
  document.getElementById("username").value = login.username;
  document.getElementById("password").value = login.password;
}

document.getElementById("btn-save").addEventListener("click", function() {
  var username = document.getElementById("username").value;
  var password = document.getElementById("password").value;
  scrobbleProvider.setLogin(username, password);

  scrobbleProvider.getToken();
});
