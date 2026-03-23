import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { Logger } from '../logger/index.js';
import type { AppConfig } from '../config/index.js';
import type { DbPool } from '../db/pool.js';
import { healthRoute } from './routes/health.js';
import { transactionsRoute } from './routes/transactions.js';
import { instructionsRoute } from './routes/instructions.js';
import { aggregationsRoute } from './routes/aggregations.js';
import { statsRoute } from './routes/stats.js';
import { schemaRoute } from './routes/schema.js';

export interface ApiDeps {
  config: AppConfig;
  pool: DbPool;
  logger: Logger;
}

export async function createApi(deps: ApiDeps) {
  const app = Fastify({
    logger: false, // We use our own logger
    requestTimeout: 30000,
  });

  await app.register(cors, { origin: true });

  // Inject dependencies into request context
  app.decorate('deps', deps);

  // Register routes
  await app.register(healthRoute, { prefix: '/' });
  await app.register(transactionsRoute, { prefix: '/transactions' });
  await app.register(instructionsRoute, { prefix: '/instructions' });
  await app.register(aggregationsRoute, { prefix: '/aggregations' });
  await app.register(statsRoute, { prefix: '/stats' });
  await app.register(schemaRoute, { prefix: '/schema' });

  // Global error handler
  app.setErrorHandler((error, request, reply) => {
    deps.logger.error({ err: error, url: request.url }, 'Request error');
    reply.status(error.statusCode || 500).send({
      error: error.message || 'Internal Server Error',
      statusCode: error.statusCode || 500,
    });
  });

  return app;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    deps: ApiDeps;
  }
}
