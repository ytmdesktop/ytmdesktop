import { spawn } from "node:child_process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const PRIMARY_TESTS = [
  {
    flag: "--update-dialog",
    expect: "Updater window stays open showing 'Checking for updates...'",
  },
  {
    flag: "--update-dialog=available",
    expect: "Updater window stays open showing 'Downloading update...'",
  },
  {
    flag: "--update-dialog=downloaded",
    expect: "Updater window stays open showing 'Restarting for update...'",
  },
  {
    flag: "--update-dialog=not-available",
    expect: "Updater window stays open showing 'No updates available'",
  },
  {
    flag: "--update-dialog=error",
    expect: "Updater window stays open showing 'Error checking for updates'",
  },
  {
    flag: "--settings",
    expect: "Main window opens and Settings modal opens automatically",
  },
  {
    flag: "--changelog",
    expect: "Main window opens and Changelog modal opens automatically",
  },
  {
    flag: "--miniplayer",
    expect: "Miniplayer window opens and Main window hides",
  },
  {
    flag: "--authorize-companion",
    expect: "Authorize Companion window opens with debug app & code",
  },
  {
    flag: "--start-minimized",
    expect: "App launches hidden to tray (main window does not appear)",
  },
  {
    flag: "--skip-update",
    expect: "App skips the startup updater splash/check",
  },
  {
    flag: "--disable-hardware-acceleration",
    expect: "Hardware acceleration is disabled for this session",
  },
  {
    flag: "--safe-mode",
    expect: "All integrations are skipped/disabled for this session",
  },
  {
    flag: "--devtools",
    expect: "DevTools and YTMView Inspect menu item are enabled",
  },
];

const SECOND_INSTANCE_TESTS = [
  {
    flag: "--hide",
    expect: "Running Main/Miniplayer window hides to tray",
  },
  {
    flag: "--show",
    expect: "Hidden Main window restores and focuses",
  },
  {
    flag: "--play-pause",
    expect: "Playback toggles Play/Pause on the running instance",
  },
  {
    flag: "--next",
    expect: "Skips to the next track on the running instance",
  },
  {
    flag: "--previous",
    expect: "Skips to the previous track on the running instance",
  },
  {
    flag: "--settings",
    expect: "Settings window opens/focuses on the running instance",
  },
  {
    flag: "--changelog",
    expect: "Changelog window opens/focuses on the running instance",
  },
  {
    flag: "--miniplayer",
    expect: "Miniplayer window opens/focuses on the running instance",
  },
  {
    flag: "--update-dialog=downloaded",
    expect:
      "Updater dialog opens on the running instance in 'downloaded' state",
  },
  {
    flag: "--authorize-companion",
    expect: "Authorize Companion window opens on the running instance",
  },
];

const cliArgs = process.argv.slice(2);
const verbose = cliArgs.includes("--verbose");
const filters = cliArgs.filter((a) => !a.startsWith("--verbose"));

function matchesFilter(flag) {
  if (filters.length === 0) return true;
  return filters.some((f) => flag.includes(f));
}

let activeChild = null;
let isStoppingChild = false;

function spawnApp(args) {
  isStoppingChild = false;
  const child = spawn("pnpm", args, {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const forward = (chunk) => {
    if (isStoppingChild) return;
    const text = chunk.toString();
    if (verbose) {
      output.write(text);
      return;
    }
    for (const line of text.split(/\r?\n/)) {
      const lower = line.toLowerCase();
      if (
        line.includes("Launch arg") ||
        line.includes("Parsed launch") ||
        lower.includes("[error]") ||
        lower.includes("fatal") ||
        lower.includes("crash")
      ) {
        console.log(`  [app] ${line}`);
      }
    }
  };

  child.stdout?.on("data", forward);
  child.stderr?.on("data", forward);
  return child;
}

function isProcessGroupAlive(pgid) {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForGroupExit(pgid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessGroupAlive(pgid)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return !isProcessGroupAlive(pgid);
}

async function stopProcessGroup(child) {
  if (!child?.pid) return;
  const pgid = child.pid;
  isStoppingChild = true;
  child.stdout?.removeAllListeners("data");
  child.stderr?.removeAllListeners("data");

  for (const [signal, waitMs] of [
    ["SIGINT", 1500],
    ["SIGTERM", 1000],
    ["SIGKILL", 500],
  ]) {
    if (!isProcessGroupAlive(pgid)) return;

    try {
      process.kill(-pgid, signal);
    } catch {
      return;
    }

    if (await waitForGroupExit(pgid, waitMs)) return;
  }
}

async function runSecondInstance(flag) {
  await new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "electron", ".", flag], {
      stdio: verbose ? "inherit" : "ignore",
    });
    child.once("error", reject);
    child.once("exit", resolve);
  });
}

async function promptAction(rl, message) {
  try {
    const answer = (await rl.question(message)).trim().toLowerCase();
    if (answer === "q" || answer === "quit") return "quit";
    if (answer === "s" || answer === "skip") return "skip";
    return "next";
  } catch (error) {
    if (error?.code === "ABORT_ERR" || error?.name === "AbortError") {
      return "quit";
    }
    throw error;
  }
}

async function main() {
  const rl = readline.createInterface({ input, output });

  let cleaningUp = false;
  const cleanupAndExit = async () => {
    if (cleaningUp) return;
    cleaningUp = true;
    await stopProcessGroup(activeChild);
    activeChild = null;
    rl.close();
    process.exit(0);
  };
  process.on("SIGINT", cleanupAndExit);
  rl.on("SIGINT", cleanupAndExit);

  const primaryQueue = PRIMARY_TESTS.filter((t) => matchesFilter(t.flag));
  const secondQueue = SECOND_INSTANCE_TESTS.filter((t) =>
    matchesFilter(t.flag),
  );

  console.log(
    `\nLaunch Argument Interactive Tester (${primaryQueue.length} primary, ${secondQueue.length} second-instance)`,
  );
  console.log("Controls: [Enter] close & next | [q] quit\n");

  for (let i = 0; i < primaryQueue.length; i++) {
    const test = primaryQueue[i];
    console.log(
      `\n[Primary ${i + 1}/${primaryQueue.length}] Launching with ${test.flag}\n  Expect: ${test.expect}`,
    );

    activeChild = spawnApp(["start", "--", test.flag]);

    const action = await promptAction(
      rl,
      "  Press [Enter] to close app and test next ([q] quit): ",
    );
    await stopProcessGroup(activeChild);
    activeChild = null;

    if (action === "quit") return cleanupAndExit();
  }

  if (secondQueue.length > 0) {
    console.log("\n=== Phase 2: Second-Instance Launch Arguments ===");
    console.log("Launching base instance...");
    activeChild = spawnApp(["start"]);

    const readyAction = await promptAction(
      rl,
      "Wait for the app to load (start playing a track to verify media controls), then press [Enter] to start ([s] skip phase / [q] quit): ",
    );
    if (readyAction === "quit") return cleanupAndExit();

    if (readyAction !== "skip") {
      for (let i = 0; i < secondQueue.length; i++) {
        const test = secondQueue[i];
        console.log(
          `\n[Second-Instance ${i + 1}/${secondQueue.length}] Sending ${test.flag}\n  Expect: ${test.expect}`,
        );

        await runSecondInstance(test.flag);
        const confirmAction = await promptAction(
          rl,
          "  Press [Enter] to test next ([q] quit): ",
        );
        if (confirmAction === "quit") return cleanupAndExit();
      }
    }

    console.log("\nClosing base instance...");
    await stopProcessGroup(activeChild);
    activeChild = null;
  }

  console.log("\nAll launch argument tests completed.");
  rl.close();
}

main().catch(async (err) => {
  console.error(err);
  await stopProcessGroup(activeChild);
  process.exit(1);
});
