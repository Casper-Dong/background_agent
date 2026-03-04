import { EventEmitter } from "events";

// In-memory pub/sub for SSE log streaming.
// In production with multiple API replicas, replace with Redis pub/sub.

class LogBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
  }

  publish(jobId: string, log: { id?: number; level: string; message: string; source: string; ts: Date }) {
    this.emit(`job:${jobId}`, log);
  }

  subscribe(jobId: string, listener: (log: any) => void): () => void {
    const event = `job:${jobId}`;
    this.on(event, listener);
    return () => this.off(event, listener);
  }
}

export const logBus = new LogBus();
