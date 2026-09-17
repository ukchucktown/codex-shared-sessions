import http from 'node:http';
import WebSocket, {WebSocketServer} from 'ws';
import {Presence} from './presence.mjs';

export async function relay({upstreamUrl, root, emit = () => {}}) {
  const httpServer = http.createServer((request, response) => {
    response.writeHead(404);
    response.end();
  });
  const webSockets = new WebSocketServer({noServer: true, maxPayload: 64 * 1024 * 1024});
  const connections = new Set();

  httpServer.on('upgrade', (request, socket, head) => {
    if (request.headers.origin) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    webSockets.handleUpgrade(request, socket, head, client => webSockets.emit('connection', client));
  });

  webSockets.on('connection', downstream => {
    const upstream = new WebSocket(upstreamUrl, {maxPayload: 64 * 1024 * 1024});
    connections.add(downstream);
    connections.add(upstream);
    const presence = new Presence({emit, root});
    const queue = [];
    let queuedBytes = 0;
    let closed = false;

    const inspect = (data, direction) => {
      try { presence[direction](JSON.parse(data.toString())); }
      catch { /* Forward frames even when they are not JSON. */ }
    };
    const close = () => {
      if (closed) return;
      closed = true;
      presence.close();
      for (const socket of [upstream, downstream]) {
        connections.delete(socket);
        if (socket.readyState === WebSocket.OPEN) socket.close();
        else if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
      }
    };

    upstream.on('open', () => {
      for (const [data, binary] of queue) upstream.send(data, {binary});
      queue.length = 0;
    });
    downstream.on('message', (data, binary) => {
      inspect(data, 'client');
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data, {binary});
      else {
        queuedBytes += data.length;
        if (queuedBytes > 64 * 1024 * 1024) close();
        else queue.push([data, binary]);
      }
    });
    upstream.on('message', (data, binary) => {
      inspect(data, 'server');
      if (downstream.readyState === WebSocket.OPEN) downstream.send(data, {binary});
    });
    upstream.on('error', close);
    downstream.on('error', close);
    upstream.on('close', close);
    downstream.on('close', close);
  });

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `ws://127.0.0.1:${httpServer.address().port}`,
    close() {
      for (const socket of connections) socket.terminate();
      webSockets.close();
      httpServer.close();
    },
  };
}

