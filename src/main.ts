import 'dotenv/config';
import env from './env.js';
import { initialize } from './queues/initialize.js';
import { createServer } from './server.js';
import { handleExit } from './utils.js';

const port = env.HTTP_SERVER_PORT;

export const start = async () => {
  const queues = await initialize();

  const app = createServer(queues);

  app.listen({ host: '0.0.0.0', port }, () => {
    // eslint-disable-next-line no-console
    console.log(`Server listening on port ${port}`);
    // eslint-disable-next-line no-console
    console.log(`Visit the admin pages: http://127.0.0.1:${port}/admin/queues`);
  });

  handleExit(async () => {
    await app.close();
  });
};

await start();
