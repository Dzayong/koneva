import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';

interface ValidationSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

export function validate(schemas: ValidationSchemas) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const validated: NonNullable<Request['validated']> = {};

    for (const key of ['body', 'query', 'params'] as const) {
      const schema = schemas[key];
      if (!schema) continue;
      const result = schema.safeParse(request[key]);
      if (!result.success) {
        response.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `Invalid request ${key}`,
            details: result.error.flatten(),
          },
        });
        return;
      }
      validated[key] = result.data;
    }

    request.validated = validated;
    next();
  };
}
