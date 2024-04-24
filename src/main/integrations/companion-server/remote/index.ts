import path from "path";
import { FastifyPluginCallback, FastifyPluginOptions } from "fastify";
import { fastifyStatic } from "@fastify/static";
import { app } from "electron";

const assetFolder = path.join(
  process.env.NODE_ENV === "development" ? path.join(app.getAppPath(), "src/main/integrations/companion-server/remote/src") : process.resourcesPath
);
const RemoteServer: FastifyPluginCallback<FastifyPluginOptions> = async (fastify, options, next) => {
  // Give the contents of `src` as the root of the server

  fastify.register(fastifyStatic, {
    root: path.join(assetFolder),
    prefix: "/"
  });

  next();
};

export default RemoteServer;
