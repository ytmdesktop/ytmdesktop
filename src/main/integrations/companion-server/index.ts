import IIntegration from "../integration";
import Fastify, { FastifyInstance } from "fastify";
import FastifyIO from "fastify-socket.io/dist/index";
import CompanionServerAPIv1 from "./api/v1";
import { MemoryStoreSchema, StoreSchema } from "~shared/store/schema";
import Conf from "conf";
import { BrowserView, safeStorage, app, ipcMain } from "electron";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { AuthToken } from "~shared/integrations/companion-server/types";
import { RemoteSocket } from "socket.io";
import { DefaultEventsMap } from "socket.io/dist/typed-events";
import cors from "@fastify/cors";
import MemoryStore from "../../memory-store";
import log from "electron-log";
import { isDefinedAPIError } from "./api-shared/errors";
import { createCertificate } from "pem";
import path from "path";
import fs from "fs";
import os from "os";

export default class CompanionServer implements IIntegration {
  private listenIp = "0.0.0.0";
  private listenPort = 9863;
  private fastifyServer: FastifyInstance;
  private httpSetupServer: FastifyInstance;
  private store: Conf<StoreSchema>;
  private memoryStore: MemoryStore<MemoryStoreSchema>;
  private ytmView: BrowserView;
  private storeListener: () => void | null = null;

  private getLocalIP(): string | null {
    const interfaces = os.networkInterfaces();
    for (const name in interfaces) {
      for (const iface of interfaces[name]!) {
        if (iface.family === "IPv4" && !iface.internal) {
          return iface.address;
        }
      }
    }
    return null;
  }

  private async ensureCertificates(): Promise<{ key: Buffer; cert: Buffer; ca: Buffer }> {
    log.info("Pasta Local do usuário", app.getPath("userData"));
    const certDir = path.join(app.getPath("userData"), "certs");
    fs.mkdirSync(certDir, { recursive: true });

    const certPath = path.join(certDir, "cert.pem");
    const keyPath = path.join(certDir, "key.pem");
    const caPath = path.join(certDir, "ca.pem");

    if (fs.existsSync(certPath) && fs.existsSync(keyPath) && fs.existsSync(caPath)) {
      return {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
        ca: fs.readFileSync(caPath)
      };
    }

    const localIP = this.getLocalIP() ?? "localhost";

    return new Promise((resolve, reject) => {
      createCertificate({ days: 1000000, selfSigned: true }, (err, ca) => {
        if (err) return reject(err);

        fs.writeFileSync(caPath, ca.certificate);

        createCertificate(
          {
            serviceKey: ca.serviceKey,
            serviceCertificate: ca.certificate,
            serial: Date.now(),
            days: 1000000,
            commonName: localIP,
            altNames: ["localhost", localIP]
          },
          async (err2, cert) => {
            if (err2) return reject(err2);

            fs.writeFileSync(certPath, cert.certificate);
            fs.writeFileSync(keyPath, cert.clientKey);

            // seta flag no localStorage do Electron
            ipcMain.emit("ssl-cert-generated");
            global.ytmd?.memoryStore?.set("ssl_cert_generated", true);

            resolve({
              key: Buffer.from(cert.clientKey),
              cert: Buffer.from(cert.certificate),
              ca: Buffer.from(ca.certificate)
            });
          }
        );
      });
    });
  }

  private async createServer() {
    let certs: { key: Buffer; cert: Buffer; ca: Buffer } | null = null;

    try {
      certs = await this.ensureCertificates();
    } catch (e) {
      log.warn("Erro ao gerar certificados locais, tentando remoto", e);
    }

    if (certs.key && certs.cert && certs.ca) {
      this.fastifyServer = Fastify({
        logger: true,
        https: {
          key: certs.key,
          cert: certs.cert,
          ca: certs.ca
        }
      }).withTypeProvider<TypeBoxTypeProvider>();
    } else {
      this.fastifyServer = Fastify().withTypeProvider<TypeBoxTypeProvider>();
    }

    this.fastifyServer.register(cors, {
      origin: this.store.get<"integrations.companionServerCORSWildcardEnabled", boolean>("integrations.companionServerCORSWildcardEnabled", false) ? "*" : false
    });
    this.fastifyServer.register(FastifyIO, {
      transports: ["websocket"],
      allowUpgrades: false,
      // While this is websocket only we still apply cors just in case
      cors: {
        origin: this.store.get<"integrations.companionServerCORSWildcardEnabled", boolean>("integrations.companionServerCORSWildcardEnabled", false)
          ? "*"
          : false
      }
    });
    this.fastifyServer.register(CompanionServerAPIv1, {
      prefix: "/api/v1",
      getYtmView: () => {
        return this.ytmView;
      },
      getStore: () => {
        return this.store;
      },
      getMemoryStore: () => {
        return this.memoryStore;
      }
    });
    this.fastifyServer.setErrorHandler((error, request, reply) => {
      if (!isDefinedAPIError(error)) {
        if (!error.statusCode || error.statusCode >= 500) {
          log.error(error);
          reply.send(new Error("An internal server error occurred"));
          return;
        }
      }

      reply.send(error);
    });
    this.fastifyServer.get("/metadata", (request, reply) => {
      reply.send({
        apiVersions: ["v1"]
      });
    });

    // Disconnect connections to the default namespace
    this.fastifyServer.ready().then(() => {
      this.fastifyServer.io.on("connection", socket => socket.disconnect());
    });
  }

  private async createServerCertificado() {
    this.httpSetupServer = Fastify().withTypeProvider<TypeBoxTypeProvider>();

    this.httpSetupServer.get("/ca.pem", async (request, reply) => {
      const certDir = path.join(app.getPath("userData"), "certs");
      const caPath = path.join(certDir, "ca.pem");

      if (fs.existsSync(caPath)) {
        const caContent = fs.readFileSync(caPath);
        reply.header("Content-Type", "application/x-x509-ca-cert").header("Content-Disposition", 'attachment; filename="ca.pem"').send(caContent);
      } else {
        reply.code(404).send({ error: "CA não encontrada." });
      }
    });

    this.httpSetupServer.get("/setup", async (request, reply) => {
      const caPath = path.join(app.getPath("userData"), "certs", "ca.pem");
      const certExists = fs.existsSync(caPath);

      reply.type("text/html").send(`
        <html>
          <head>
            <meta charset="utf-8">
            <title>Instalação do Certificado SSL</title>
            <style>
              body { font-family: sans-serif; background: #1e1e1e; color: #f0f0f0; padding: 2rem; }
              h1, h2 { color: #00bfff; }
              code { background: #333; padding: 2px 4px; border-radius: 4px; }
              .card { background: #2a2a2a; padding: 1.5rem; border-radius: 8px; margin-top: 1rem; }
              a.button { display: inline-block; background: #00bfff; color: white; padding: 0.6rem 1rem; border-radius: 6px; text-decoration: none; font-weight: bold; margin-top: 1rem; }
              a.button:hover { background: #0099cc; }
            </style>
          </head>
          <body>
            <h1>⚙️ Configuração de SSL Local</h1>
    
            ${
              !certExists
                ? `
              <div class="card" style="border-left: 5px solid #ff6f61;">
                <h2>❗ Certificado ainda não gerado</h2>
                <p>Volte às configurações do app e clique em <strong>"Gerar Certificado SSL"</strong> para iniciar a geração automática.</p>
              </div>
            `
                : `
              <div class="card">
                <h2>📥 Baixar Autoridade Certificadora (CA)</h2>
                <p>Você precisa instalar esse certificado no seu sistema para que conexões HTTPS locais sejam reconhecidas como seguras.</p>
                <a class="button" href="http://localhost:9862/ca.pem" download>⬇️ Baixar CA (ca.pem)</a>
              </div>
    
              <div class="card">
                <h2>🛠️ Instruções de Instalação</h2>
    
                <h3>🔹 Chrome / Edge (Windows, Linux)</h3>
                <ol>
                  <li>Acesse <code>chrome://settings/certificates</code></li>
                  <li>Vá até a aba <strong>"Autoridades"</strong></li>
                  <li>Importe o arquivo <code>ca.pem</code></li>
                  <li>Marque as opções para confiar na CA</li>
                </ol>
    
                <h3>🦊 Firefox</h3>
                <ol>
                  <li>Abra o menu → Configurações → Privacidade e Segurança</li>
                  <li>Role até a seção <strong>Certificados</strong> e clique em <strong>"Ver Certificados"</strong></li>
                  <li>Importe o <code>ca.pem</code></li>
                </ol>
    
                <h3>🪟 Windows</h3>
                <ol>
                  <li>Execute o arquivo <code>ca.pem</code> (ou clique com o botão direito → "Instalar")</li>
                  <li>Escolha "Autoridades de certificação raiz confiáveis"</li>
                  <li>Confirme todos os passos</li>
                </ol>
    
                <h3>🐧 Linux (Chrome/Chromium)</h3>
                <pre>sudo cp ca.pem /usr/local/share/ca-certificates/myca.crt
    sudo update-ca-certificates</pre>
    
                <h3>🍎 macOS</h3>
                <ol>
                  <li>Abra o <strong>Acesso às Chaves</strong></li>
                  <li>Importe o <code>ca.pem</code> na categoria "Sistema"</li>
                  <li>Clique com o botão direito → "Obter informações" → "Confiar sempre"</li>
                </ol>
              </div>
            `
            }
          </body>
        </html>
      `);
    });

    this.httpSetupServer.register(cors, {
      origin: this.store.get<"integrations.companionServerCORSWildcardEnabled", boolean>("integrations.companionServerCORSWildcardEnabled", false) ? "*" : false
    });
    this.httpSetupServer.register(FastifyIO, {
      transports: ["websocket"],
      allowUpgrades: false,
      // While this is websocket only we still apply cors just in case
      cors: {
        origin: this.store.get<"integrations.companionServerCORSWildcardEnabled", boolean>("integrations.companionServerCORSWildcardEnabled", false)
          ? "*"
          : false
      }
    });
    this.httpSetupServer.register(CompanionServerAPIv1, {
      prefix: "/api/v1",
      getYtmView: () => {
        return this.ytmView;
      },
      getStore: () => {
        return this.store;
      },
      getMemoryStore: () => {
        return this.memoryStore;
      }
    });
    this.httpSetupServer.setErrorHandler((error, request, reply) => {
      if (!isDefinedAPIError(error)) {
        if (!error.statusCode || error.statusCode >= 500) {
          log.error(error);
          reply.send(new Error("An internal server error occurred"));
          return;
        }
      }

      reply.send(error);
    });
    this.httpSetupServer.get("/metadata", (request, reply) => {
      reply.send({
        apiVersions: ["v1"]
      });
    });

    // Disconnect connections to the default namespace
    this.httpSetupServer.ready().then(() => {
      this.httpSetupServer.io.on("connection", socket => socket.disconnect());
    });
  }

  public provide(store: Conf<StoreSchema>, memoryStore: MemoryStore<MemoryStoreSchema>, ytmView: BrowserView): void {
    this.store = store;
    this.memoryStore = memoryStore;
    this.ytmView = ytmView;
  }

  public async enable() {
    if (!this.memoryStore.get("safeStorageAvailable")) {
      log.info("Refusing to enable Companion Server Integration with reason: safeStorage unavailable");
      return;
    }

    if (!this.httpSetupServer || (this.httpSetupServer && !this.httpSetupServer.server.listening)) {
      await this.createServerCertificado();
      await this.httpSetupServer.listen({
        host: this.listenIp,
        port: 9862
      });
    }

    if (!this.fastifyServer || (this.fastifyServer && !this.fastifyServer.server.listening)) {
      await this.createServer();
      await this.fastifyServer.listen({
        host: this.listenIp,
        port: this.listenPort
      });
      this.storeListener = this.store.onDidChange("integrations", async newState => {
        const validTokenIds: string[] = newState.companionServerAuthTokens
          ? JSON.parse(safeStorage.decryptString(Buffer.from(newState.companionServerAuthTokens, "hex"))).map((authToken: AuthToken) => authToken.id)
          : [];
        if (this.fastifyServer.server.listening) {
          const namespaces = this.fastifyServer.io._nsps.keys();
          let sockets: RemoteSocket<DefaultEventsMap, { tokenId: string }>[] = [];

          for (const namespace of namespaces) {
            const namespacedSockets = await this.fastifyServer.io.of(namespace).fetchSockets();
            sockets = sockets.concat(namespacedSockets);
          }

          for (const socket of sockets) {
            if (!validTokenIds.includes(socket.data.tokenId)) {
              socket.disconnect(true);
            }
          }
        }
      });
    }
  }

  public async disable() {
    if (this.fastifyServer) {
      await this.fastifyServer.close();
      if (this.storeListener) {
        this.storeListener();
      }
    }
  }

  public getYTMScripts(): { name: string; script: string }[] {
    return [];
  }
}
