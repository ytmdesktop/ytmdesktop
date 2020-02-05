const settingsProvider = require("../providers/settingsProvider");
const { isLinux } = require("./systemInfo");

if (isLinux()) {
  settingsProvider.setInitialValue("titlebar-type", "system");
} else {
  settingsProvider.setInitialValue("titlebar-type", "nice");
}
settingsProvider.setInitialValue("settings-page-zoom", 100);
settingsProvider.setInitialValue("last-fm-login", {
  username: "",
  password: ""
});
