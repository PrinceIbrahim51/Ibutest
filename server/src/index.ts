import { startServer } from './server.js';

try {
  const running = await startServer();
  const shutdown = async (signal: string) => {
    console.info(`Received ${signal}, shutting down`);
    const timer = setTimeout(() => process.exit(1), 10_000);
    timer.unref();
    await running.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
} catch {
  process.exit(1);
}
