import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    authId: string
  }
}
