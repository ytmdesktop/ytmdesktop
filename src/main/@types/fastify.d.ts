import "fastify";
import type { Server as SocketIOServer } from "socket.io";

declare module "fastify" {
  interface FastifyInstance {
    io: SocketIOServer;
  }

  interface FastifyRequest {
    authId: string;
  }
}
