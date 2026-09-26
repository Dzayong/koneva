import type { NextFunction, Request, Response } from 'express';
import { auditFromRequest, describeAction, recordAudit, targetFromBody } from '../services/audit.service';

/** Records successful, state-changing calls after the response is sent. */
export function auditTrail(request: Request, response: Response, next: NextFunction): void {
  const found = describeAction(request.method, request.path);
  if (found) {
    // Creates only learn their target id while responding (the new id lives in the response body).
    let created: string | undefined;
    const send = response.json.bind(response);
    response.json = (body: unknown) => {
      created = targetFromBody(body);
      return send(body);
    };
    response.on('finish', () => {
      if (response.statusCode >= 400) return;
      const entry = auditFromRequest(request, found, found.targetId ? undefined : { targetId: created });
      if (entry) void recordAudit(entry);
    });
  }
  next();
}
