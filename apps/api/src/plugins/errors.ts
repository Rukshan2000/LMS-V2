import fp from 'fastify-plugin';
import { ZodError, z } from 'zod';
import { HttpError } from '../lib/http-error.js';

// Every error leaves as { code, message, requestId, details? }.
export default fp(async (app) => {
  app.setErrorHandler((err, req, reply) => {
    const requestId = req.id;
    if (err instanceof ZodError) {
      return reply.status(400).send({
        code: 'validation_error',
        message: 'Invalid request',
        requestId,
        details: z.flattenError(err).fieldErrors,
      });
    }
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ code: err.code, message: err.message, requestId });
    }
    // Fastify's own client errors (bad JSON, 415, 429, ...).
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({
        code: (err as { code?: string }).code ?? 'bad_request',
        message: (err as Error).message,
        requestId,
      });
    }
    req.log.error(err);
    return reply
      .status(500)
      .send({ code: 'internal_error', message: 'Something went wrong', requestId });
  });

  app.setNotFoundHandler((req, reply) =>
    reply.status(404).send({ code: 'not_found', message: 'Not found', requestId: req.id }),
  );
});
