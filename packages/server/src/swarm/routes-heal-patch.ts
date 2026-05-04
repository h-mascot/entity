// Add this import at the top of routes.ts:
// import { healStuckJobs, getHealerStatus } from './healer';

// Add these routes before the return statement:

/*
  // POST /api/swarm/heal - Manual heal trigger
  router.post('/heal', async (_req: Request, res: Response) => {
    try {
      const result = await healStuckJobs();
      res.json({ success: true, result });
    } catch (error) {
      res.status(500).json({ error: 'Heal operation failed' });
    }
  });

  // GET /api/swarm/healer/status
  router.get('/healer/status', (_req: Request, res: Response) => {
    res.json(getHealerStatus());
  });
*/
