import { Router } from 'express';
import { listPublicPlans } from '../services/billing.service';

// No sign-in needed: prospective customers compare plans before they register.
const router = Router();

router.get('/plans', async (_request, response) => {
  response.set('Cache-Control', 'public, max-age=60');
  response.json({ success: true, data: await listPublicPlans() });
});

export default router;
