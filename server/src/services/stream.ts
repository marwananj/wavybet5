import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { eventInclude, serializeEvent } from './serialize';

/**
 * Live push channel (Server-Sent Events).
 * Browsers keep one connection open; whenever the live jobs change an event (odds, score, minute,
 * lock/unlock), the fresh event is pushed to everyone instantly — no waiting for the next poll.
 */
const clients = new Set<Response>();

export function addStreamClient(req: Request, res: Response) {
  res.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable proxy buffering
  });
  res.flushHeaders?.();
  res.write('retry: 3000\n\n'); // browser reconnects after 3 s if the connection drops
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 20_000); // keep proxies from closing idle connections
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
}

export const streamClientCount = () => clients.size;

function send(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) {
    try {
      c.write(payload);
    } catch {
      clients.delete(c);
    }
  }
}

/** Push the current state of these events to every connected browser. */
export async function broadcastEvents(ids: string[]) {
  if (!clients.size || !ids.length) return;
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 50) {
    const events = await prisma.event.findMany({ where: { id: { in: unique.slice(i, i + 50) } }, include: eventInclude });
    if (events.length) send('events', { events: events.map(serializeEvent) });
  }
}
