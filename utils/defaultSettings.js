const settingsProvider = require("../providers/settingsProvider");

settingsProvider.setInitialValue("titlebar-type", "nice");
settingsProvider.setInitialValue("settings-page-zoom", 100);
settingsProvider.setInitialValue("last-fm-login", {
  username: "",
  password: ""
});
