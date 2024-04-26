import fs from "fs";
import path from "path";
import { FastifyPluginCallback, FastifyPluginOptions } from "fastify";
import { app } from "electron";

const assetFolder = path.join(
  process.env.NODE_ENV === "development" ? path.join(app.getAppPath(), "src/main/integrations/companion-server/remote/src") : process.resourcesPath
);
const RemoteServer: FastifyPluginCallback<FastifyPluginOptions> = async (fastify, options, next) => {
  // Give the contents of `src` as the root of the server
  fastify.get("/", async (req, reply) => {
    const stream = fs.createReadStream(getPath("index.html"), "utf-8");
    return reply.type("text/html").send(stream);
  });

  fastify.get("/css/control.css", async (req, reply) => {
    const stream = fs.createReadStream(getPath("control.css", "css"), "utf-8");
    return reply.type("text/css").send(stream);
  });

  fastify.get("/js/control.js", async (req, reply) => {
    const stream = fs.createReadStream(getPath("control.js", "js"), "utf-8");
    return reply.type("text/javascript").send(stream);
  });

  fastify.get("/js/socket.io.min.js", async (req, reply) => {
    const stream = fs.createReadStream(getPath("socket.io.min.js", "js"), "utf-8");
    return reply.type("text/javascript").send(stream);
  });

  fastify.get("*", async (req, reply) => {
    return reply.redirect("/remote");
  });

  next();
};

function getPath(file: string, folder?: string): string {
  const paths: string[] = [];

  paths.push(assetFolder);
  if (folder && process.env.NODE_ENV === "development") {
    paths.push(folder);
  }
  paths.push(file);

  return path.join(...paths);
}

export default RemoteServer;
