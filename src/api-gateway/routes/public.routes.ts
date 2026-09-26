import { Router } from 'express';
import config from '../../shared/config';
import { listPublicPlans } from '../services/billing.service';

// No sign-in needed: prospective customers compare plans before they register.
const router = Router();

router.get('/plans', async (_request, response) => {
  response.set('Cache-Control', 'public, max-age=60');
  response.json({ success: true, data: await listPublicPlans() });
});

// Contact shown in the public footer; empty when the operator has not set one.
router.get('/info', (_request, response) => {
  response.set('Cache-Control', 'public, max-age=300');
  response.json({ success: true, data: { support_contact: config.billing.operatorContact || null } });
});

export default router;
