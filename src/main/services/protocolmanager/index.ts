import { app, net, protocol } from "electron";
import Service from "../service";
import log from "electron-log";
import YTMViewManager from "../ytmviewmanager";
import { DependencyConstructor } from "~shared/types";
import path from "node:path";
import { pathToFileURL } from "node:url";

export default class ProtocolManager extends Service {
  public static override readonly dependencies: DependencyConstructor<Service>[] = [YTMViewManager];

  private _initialized = false;
  public get initialized() {
    return this._initialized;
  }

  public override onPreInitialized() {
    // Register a custom protocol for use within the app - https://www.electronjs.org/docs/latest/tutorial/security#18-avoid-usage-of-the-file-protocol-and-prefer-usage-of-custom-protocols
    protocol.registerSchemesAsPrivileged([
      {
        scheme: "ytmd-app",
        privileges: {
          standard: true,
          secure: true
        }
      }
    ]);
  }

  public onInitialized() {
    if (this._initialized) throw new Error("ProtocolManager is already initialized!");
    this._initialized = true;

    // Create a handler for the in app ytmd-app protocol
    protocol.handle("ytmd-app", this.handleYTMDAppProtocol.bind(this));

    // Register a `ytmd` protocol into the system to allow opening songs inside YTMD
    // This will register the protocol in development, this is intentional and should stay this way for development purposes
    if (!app.isDefaultProtocolClient("ytmd")) {
      if (process.defaultApp) {
        if (process.argv.length >= 2) {
          log.info("Application set as default protcol client for 'ytmd'");
          app.setAsDefaultProtocolClient("ytmd", process.execPath, [path.resolve(process.argv[1])]);
        }
      } else {
        log.info("Application set as default protcol client for 'ytmd'");
        app.setAsDefaultProtocolClient("ytmd", process.execPath);
      }
    }
  }

  public override onPostInitialized(): void {}

  public override onTerminated(): void {}

  public async handleYTMDProtocol(url: string) {
    const ytmViewManager = this.getDependency(YTMViewManager);

    log.info("Handling ytmd protocol url", url);
    const urlPaths = url.split("://")[1];
    if (urlPaths) {
      const paths = urlPaths.split("/");
      if (paths.length > 0) {
        switch (paths[0]) {
          case "play": {
            if (paths.length >= 2) {
              const videoId = paths[1];
              const playlistId = paths[2];

              if (ytmViewManager.isInitialized()) {
                log.debug(`Navigating to videoId: ${videoId}, playlistId: ${playlistId}`);
                await ytmViewManager.ready();
                ytmViewManager.getView().webContents.send("remoteControl:execute", "navigate", {
                  watchEndpoint: {
                    videoId: videoId,
                    playlistId: playlistId
                  }
                });
              }
            }
          }
        }
      }
    }
  }

  private async handleYTMDAppProtocol(req: Request) {
    const { host, pathname } = new URL(req.url);
    let rootPath = undefined;
    switch (host) {
      case "updater": {
        rootPath = path.resolve(process.resourcesPath, `app.asar/.vite/renderer/windows/updater`);
        break;
      }

      case "main": {
        rootPath = path.resolve(process.resourcesPath, `app.asar/.vite/renderer/windows/main`);
        break;
      }

      case "titlebar": {
        rootPath = path.resolve(process.resourcesPath, `app.asar/.vite/renderer/windows/titlebar`);
        break;
      }

      case "settings": {
        rootPath = path.resolve(process.resourcesPath, `app.asar/.vite/renderer/windows/settings`);
        break;
      }

      case "authorize-companion": {
        rootPath = path.resolve(process.resourcesPath, `app.asar/.vite/renderer/windows/authorize-companion`);
        break;
      }

      case "miniplayer": {
        rootPath = path.resolve(process.resourcesPath, `app.asar/.vite/renderer/windows/miniplayer`);
        break;
      }
    }

    log.debug(`${req.method} ytmd-app://${host}${pathname}`);

    let desiredPath = pathname;
    if (pathname === "/") desiredPath = "/index.html";

    const assetsRegex = /^[/\\]+(assets[/\\]+)+/;
    if (assetsRegex.test(desiredPath)) {
      desiredPath = desiredPath.replace(assetsRegex, "");
      rootPath = path.resolve(process.resourcesPath, `app.asar/.vite/renderer/assets`);
    }

    desiredPath = desiredPath.replace(/^[/\\]+/, "");

    if (!this.isSafePath(rootPath, desiredPath)) {
      log.warn("Requested path violated the safe path policy");
      return new Response("Policy Violation", {
        status: 403,
        headers: { "Content-Type": "text/html" }
      });
    }

    const fileUrlPath = pathToFileURL(path.resolve(rootPath, desiredPath)).toString();
    log.debug(`Path inferenced to ${fileUrlPath}`);

    return net.fetch(fileUrlPath);
  }

  private isSafePath(rootPath: string, requestedPath: string) {
    const pathToServe = path.resolve(rootPath, requestedPath);
    const relativePath = path.relative(rootPath, pathToServe);
    const isSafe = relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
    return isSafe;
  }
}
