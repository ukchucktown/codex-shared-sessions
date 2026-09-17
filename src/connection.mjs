import WebSocket from 'ws';

export async function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let sequence = 0;

  socket.on('message', data => {
    let message;
    try { message = JSON.parse(data); } catch { return; }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });

  socket.on('close', () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('Server disconnected'));
    }
    pending.clear();
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('Server connection timed out'));
    }, 3000);
    socket.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
  });

  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, 10000);
    pending.set(id, {resolve, reject, timer});
    socket.send(JSON.stringify({id, method, params}));
  });

  await request('initialize', {
    clientInfo: {
      name: 'codex_shared_sessions',
      title: 'Codex Shared Sessions',
      version: '0.1.0',
    },
  });
  socket.send(JSON.stringify({method: 'initialized', params: {}}));
  return {socket, request, close: () => socket.close()};
}

export async function snapshot(url) {
  const connection = await connect(url);
  try {
    const threads = [];
    let cursor;
    do {
      const page = await connection.request('thread/loaded/list', cursor ? {cursor} : {});
      for (const threadId of page.data) {
        const {thread} = await connection.request('thread/read', {threadId, includeTurns: false});
        threads.push({id: thread.id, cwd: thread.cwd, status: thread.status});
      }
      cursor = page.nextCursor;
    } while (cursor);
    return {
      reachable: true,
      threads,
      active: threads.filter(thread => thread.status?.type === 'active'),
    };
  } finally {
    connection.close();
  }
}

