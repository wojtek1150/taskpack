import type { Server } from 'node:http';
import type { Express } from 'express';
import supertest from 'supertest';

const servers: Server[] = [];

/**
 * supertest against a server bound explicitly to 127.0.0.1.
 *
 * `supertest(app)` listens on `::` but connects to 127.0.0.1. On macOS the kernel may hand out a
 * port that another process already holds on 127.0.0.1, so the request lands in that process
 * (random 403/404/"socket hang up" in the full parallel run).
 */
export function localAgent(app: Express) {
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  return supertest(server);
}

export async function closeAgents(): Promise<void> {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.closeAllConnections();
          s.close(() => resolve());
        }),
    ),
  );
}
