import { app } from "electron";
import log from "electron-log";
import type { MemoryStoreSchema } from "~shared/store/schema";
import type { DependencyConstructor } from "~shared/types";
import ConfigStore from "../configstore";
import MemoryStore from "../memorystore";
import ProtectedAPIManager from "../protectedapimanager";
import Service from "../service";
import AppWindowManager from "../windowmanager";
import { launchArgRegistry } from "./registry";
import type {
  LaunchArgDefinition,
  LaunchArgPhase,
  LaunchArgState,
  LaunchWindowActions,
} from "./types";

interface ParsedLaunchArg {
  name: string;
  definition: LaunchArgDefinition;
  value?: string;
}

export default class LaunchArgsManager extends Service {
  public static override readonly dependencies: DependencyConstructor<Service>[] =
    [
      ConfigStore,
      MemoryStore<MemoryStoreSchema>,
      ProtectedAPIManager,
      AppWindowManager,
    ];

  private parsedArgs: Map<string, ParsedLaunchArg> = new Map();
  private windowActions?: LaunchWindowActions;

  public readonly state: LaunchArgState = {
    skipUpdateCheck: false,
    startMinimized: false,
    forceDevTools: false,
    gpuDisabledByFlag: false,
    safeModeEnabled: false,
  };

  public override onPreInitialized() {
    this.parsedArgs = this.parseCommandLine(process.argv);
    if (this.parsedArgs.size > 0) {
      const names = Array.from(this.parsedArgs.keys(), (n) => `--${n}`);
      log.info(`Parsed launch arguments: ${names.join(", ")}`);
    }

    this.runArgs(this.parsedArgs, "preInit");
  }

  public override onInitialized() {
    const memoryStore = this.getDependency(MemoryStore<MemoryStoreSchema>);
    memoryStore.set("gpuDisabledByFlag", this.state.gpuDisabledByFlag);
    memoryStore.set("safeModeEnabled", this.state.safeModeEnabled);
    memoryStore.set("safeModeOverrides", "");
    log.info("LaunchArgsManager initialized");
  }

  public override onPostInitialized() {}

  public override onTerminated() {}

  public isDevToolsEnabled(): boolean {
    if (!app.isPackaged || this.state.forceDevTools) return true;

    return this.getDependency(ConfigStore).get("developer.enableDevTools");
  }

  public runReady(actions: LaunchWindowActions) {
    this.windowActions = actions;
    this.runArgs(this.parsedArgs, "ready");
  }

  public handleSecondInstance(commandLine: string[]): boolean {
    const args = this.parseCommandLine(commandLine);
    if (args.size === 0) return false;

    return this.runArgs(args, "secondInstance");
  }

  private runArgs(
    args: Map<string, ParsedLaunchArg>,
    phase: LaunchArgPhase,
  ): boolean {
    let handled = false;
    for (const parsed of args.values()) {
      const handler = parsed.definition.phases[phase];
      if (!handler) continue;

      handled = true;
      try {
        handler({
          getService: (service) => this.getDependency(service),
          state: this.state,
          windows: this.windowActions,
          value: parsed.value,
        });
      } catch (error) {
        log.error(
          `Failed to execute launch arg '--${parsed.name}' (${phase})`,
          error,
        );
      }
    }

    return handled;
  }

  private parseCommandLine(argv: string[]): Map<string, ParsedLaunchArg> {
    const result = new Map<string, ParsedLaunchArg>();

    for (const rawArg of argv) {
      if (!rawArg.startsWith("--")) continue;

      const eqIndex = rawArg.indexOf("=");
      const rawName = (
        eqIndex === -1 ? rawArg.slice(2) : rawArg.slice(2, eqIndex)
      ).toLowerCase();
      const definition = Object.hasOwn(launchArgRegistry, rawName)
        ? launchArgRegistry[rawName]
        : undefined;
      if (!definition) continue;

      result.set(rawName, {
        name: rawName,
        definition,
        value: eqIndex === -1 ? undefined : rawArg.slice(eqIndex + 1),
      });
    }

    return result;
  }
}
