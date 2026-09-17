import path from 'node:path';

export class Presence {
  constructor({emit, root, pid = process.pid}) {
    this.emit = emit;
    this.root = path.resolve(root);
    this.pid = pid;
    this.requests = new Map();
    this.threadId = null;
    this.registered = false;
    this.lastState = null;
    this.completedTurns = new Set();
  }

  signal(event) {
    if (event === this.lastState) return;
    this.lastState = event;
    this.emit(`\x1b]3008;${event === 'session_end' ? 'end' : 'start'}=codex;event=${event};pid=${this.pid}\x1b\\`);
  }

  close() {
    if (this.registered) this.signal('session_end');
    this.registered = false;
    this.threadId = null;
  }

  client(message) {
    if (['thread/start', 'thread/resume', 'thread/fork'].includes(message.method)) {
      this.requests.set(message.id, message.method);
    }
  }

  status(status) {
    if (!this.registered) return;
    if (status?.type === 'active') {
      const waits = status.activeFlags?.some(flag => /waiting/i.test(flag));
      this.signal(waits ? 'awaiting_input' : 'busy');
    } else if (status?.type === 'systemError') {
      this.signal('error');
    } else if (status?.type === 'idle') {
      this.signal('idle');
    }
  }

  server(message) {
    if (this.requests.has(message.id)) {
      this.requests.delete(message.id);
      const thread = message.result?.thread;
      if (!thread) return;
      if (thread.id !== this.threadId) this.close();
      const relative = thread.cwd ? path.relative(this.root, path.resolve(thread.cwd)) : '..';
      if (relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) {
        this.close();
        return;
      }
      this.threadId = thread.id;
      if (!this.registered) {
        this.registered = true;
        this.signal('session_start');
      }
      this.status(thread.status);
      return;
    }

    const params = message.params;
    if (!this.registered || params?.threadId !== this.threadId) return;
    if (message.method === 'thread/status/changed') this.status(params.status);
    if (message.method === 'turn/started') this.signal('busy');
    if (/requestApproval|requestUserInput/.test(message.method ?? '')) this.signal('awaiting_input');
    if (message.method === 'turn/completed') {
      this.signal(params.turn?.status === 'failed' ? 'error' : 'idle');
      if (!params.turn?.id || this.completedTurns.has(params.turn.id)) return;
      this.completedTurns.add(params.turn.id);
      if (this.completedTurns.size > 100) {
        this.completedTurns.delete(this.completedTurns.values().next().value);
      }
      const title = Buffer.from('Codex').toString('base64');
      const body = Buffer.from(params.turn.status === 'failed' ? 'Task failed' : 'Task complete').toString('base64');
      this.emit(`\x1b]3008;start=codex;kind=notify;title=${title};body=${body}\x1b\\`);
    }
  }
}

