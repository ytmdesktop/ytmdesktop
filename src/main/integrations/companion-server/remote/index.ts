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
    const stream = fs.createReadStream(path.join(assetFolder, "index.html"), "utf-8");
    return reply.type("text/html").send(stream);
  });

  fastify.get("/css/control.css", async (req, reply) => {
    const stream = fs.createReadStream(path.join(assetFolder, "css/control.css"), "utf-8");
    return reply.type("text/css").send(stream);
  });

  fastify.get("/js/control.js", async (req, reply) => {
    const stream = fs.createReadStream(path.join(assetFolder, "js/control.js"), "utf-8");
    return reply.type("text/javascript").send(stream);
  });

  fastify.get("/js/socket.io.min.js", async (req, reply) => {
    const stream = fs.createReadStream(path.join(assetFolder, "js/socket.io.min.js"), "utf-8");
    return reply.type("text/javascript").send(stream);
  });

  fastify.get("*", async (req, reply) => {
    return reply.redirect("/remote");
  });

  next();
};

export default RemoteServer;
