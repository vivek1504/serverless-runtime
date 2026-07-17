import { runtimeStore } from "../runtime/store.js";
import { cleanupVm } from "../runtime/cleanup.js";
import { sessionLogger } from "../utils/logger.js";

export interface Session {
  sessionId: string;
  createdAt: number;
  lastActivityAt: number;
  state: "creating" | "active" | "destroying";
}

const sessions = new Map<string, Session>();

export function getSession(sessionId: string): Session | undefined {
  return sessions.get(sessionId);
}

export function createSession(sessionId: string): Session {
  const session: Session = {
    sessionId,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    state: "creating",
  };
  sessions.set(sessionId, session);
  return session;
}

export function touchSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) session.lastActivityAt = Date.now();
}

export async function destroySession(sessionId: string): Promise<boolean> {
  const session = sessions.get(sessionId);
  if (!session) return false;

  session.state = "destroying";

  const fn = runtimeStore.functions.get(sessionId);
  if (fn) {
    for (const vm of [...fn.vms]) {
      await cleanupVm(fn, vm);
    }
    runtimeStore.functions.delete(sessionId);
  }

  sessions.delete(sessionId);
  sessionLogger.info({ sessionId }, "session destroyed");
  return true;
}

export function getActiveSessions(): number {
  return sessions.size;
}

export function getAllSessions(): Session[] {
  return [...sessions.values()];
}

export function startSessionReaper(ttlMs: number = 30 * 60 * 1000): void {
  setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.lastActivityAt > ttlMs && session.state === "active") {
        sessionLogger.info({ sessionId: id, idleMs: now - session.lastActivityAt }, "reaping idle session");
        destroySession(id).catch(err => {
          sessionLogger.error({ sessionId: id, err }, "session reap failed");
        });
      }
    }
  }, 60_000);
}
