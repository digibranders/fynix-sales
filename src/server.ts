import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = await openDb(config.databaseUrl);
  const app = await buildApp(db, config);

  const stop = async (signal: string): Promise<void> => {
    console.log(`${signal} received, shutting down`);
    await app.close();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));

  await app.listen({ host: config.host, port: config.port });
  console.log(`Fynix Sales is running at http://${config.host}:${config.port}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
