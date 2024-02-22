import { spawn } from "child_process";
import path from "path";

function modifyShortcut(shouldExist: boolean) {
  return new Promise(resolve => {
    const updateExecutable = path.resolve(path.dirname(process.execPath), "../Update.exe");
    const executableTarget = path.basename(process.execPath);

    if (shouldExist) {
      spawn(updateExecutable, [`--createShortcut='${executableTarget}'`], {
        detached: true
      }).on("close", resolve);
    } else {
      spawn(updateExecutable, [`--removeShortcut='${executableTarget}'`], {
        detached: true
      }).on("close", resolve);
    }
  });
}

export default async function () {
  if (process.platform === "win32") {
    const command = process.argv[1];

    if (command === "--squirrel-install" || command === "--squirrel-update") {
      // Create shortcut
      await modifyShortcut(true);
      return true;
    }

    if (command === "--squirrel-uninstall") {
      // Remove shortcut
      await modifyShortcut(false);
      return true;
    }

    if (command == "--squirrel-obsolete") {
      return true;
    }
  }

  return false;
}
