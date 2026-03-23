import type { FastifyPluginAsync } from 'fastify';

export const healthRoute: FastifyPluginAsync = async (app) => {
  app.get('/health', async (request, reply) => {
    try {
      await app.deps.pool.query('SELECT 1');
      return { status: 'ok', timestamp: new Date().toISOString() };
    } catch {
      reply.status(503);
      return { status: 'unhealthy', timestamp: new Date().toISOString() };
    }
  });
};
