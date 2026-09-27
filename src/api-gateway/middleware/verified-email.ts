import type { NextFunction, Request, Response } from 'express';
import { isEmailVerified } from '../services/owner-verification.service';
import { ServiceError } from '../services/service-error';

/**
 * Guards the actions that need a proven mailbox: inviting or changing the team, and ordering/paying. Only signed-in people are
 * checked (API keys cannot reach these routes). Everything else, devices and messaging included, keeps working unverified.
 */
export async function requireVerifiedEmail(request: Request, _response: Response, next: NextFunction): Promise<void> {
  const actor = request.actor;
  if (actor?.kind === 'user' && !(await isEmailVerified(actor.userId))) {
    throw new ServiceError(403, 'EMAIL_NOT_VERIFIED', 'Verifikasi email Anda dulu sebelum mengundang anggota atau melakukan pembayaran.');
  }
  next();
}
