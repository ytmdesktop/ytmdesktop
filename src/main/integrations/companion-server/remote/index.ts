import fs from "fs";
import path from "path";
import { FastifyPluginCallback, FastifyPluginOptions } from "fastify";

const RemoteServer: FastifyPluginCallback<FastifyPluginOptions> = async (fastify, options, next) => {
  // Give the contents of `src` as the root of the server
  fastify.get("/", async (req, reply) => {
    const stream = fs.createReadStream(getPath("index.html"), "utf-8");
    return reply.type("text/html").send(stream);
  });

  fastify.get("/index.js", async (req, reply) => {
    const stream = fs.createReadStream(getPath("index.js"), "utf-8");
    return reply.type("text/javascript").send(stream);
  });

  fastify.get("*", async (req, reply) => {
    return reply.redirect("/remote");
  });

  next();
};

function getPath(file: string): string {
  // Get root of the ASAR
  const relativePath = path.resolve(__dirname, "../renderer/remote", file);

  return relativePath;
}

export default RemoteServer;
