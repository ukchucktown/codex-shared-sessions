import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket, {WebSocketServer} from 'ws';
import {once} from 'node:events';
import {relay} from '../src/relay.mjs';
import {Presence} from '../src/presence.mjs';

function attach(presence, id, cwd, status = {type: 'idle'}) {
  presence.client({id: 1, method: 'thread/resume', params: {threadId: id}});
  presence.server({id: 1, result: {thread: {id, cwd, status}}});
}

test('desktop activity goes only to the attached thread and matching worktree', () => {
  const outputA = [];
  const outputB = [];
  const presenceA = new Presence({emit: value => outputA.push(value), root: '/work/a'});
  const presenceB = new Presence({emit: value => outputB.push(value), root: '/work/b'});
  attach(presenceA, 'a', '/work/a');
  attach(presenceB, 'b', '/work/b');
  outputA.length = 0;
  outputB.length = 0;
  const event = {
    method: 'thread/status/changed',
    params: {threadId: 'a', status: {type: 'active', activeFlags: []}},
  };
  presenceA.server(event);
  presenceB.server(event);
  assert.match(outputA.join(''), /event=busy/);
  assert.deepEqual(outputB, []);
  attach(presenceB, 'a', '/work/a');
  assert.match(outputB.join(''), /event=session_end/);
  outputB.length = 0;
  presenceB.server(event);
  assert.deepEqual(outputB, []);
});

test('approval and completion produce one notification and detach clears presence', () => {
  const output = [];
  const presence = new Presence({emit: value => output.push(value), root: '/work/a'});
  attach(presence, 'a', '/work/a', {type: 'active', activeFlags: ['waitingOnApproval']});
  assert.match(output.join(''), /event=awaiting_input/);
  const completed = {
    method: 'turn/completed',
    params: {threadId: 'a', turn: {id: 'turn-1', status: 'completed'}},
  };
  presence.server(completed);
  presence.server(completed);
  presence.close();
  assert.equal(output.filter(value => value.includes('kind=notify')).length, 1);
  assert.match(output.at(-1), /end=codex;event=session_end/);
});

test('sibling paths do not receive the worktree badge', () => {
  const output = [];
  const presence = new Presence({emit: value => output.push(value), root: '/work/a'});
  attach(presence, 'bad', '/work/another');
  assert.deepEqual(output, []);
  attach(presence, 'good', '/work/a/subfolder');
  assert.match(output.join(''), /event=session_start/);
});

test('relay preserves frames and another client survives a terminal disconnect', {timeout: 5000}, async context => {
  const server = new WebSocketServer({host: '127.0.0.1', port: 0});
  await once(server, 'listening');
  context.after(() => {
    for (const client of server.clients) client.terminate();
    server.close();
  });
  server.on('connection', socket => socket.on('message', data => {
    const message = JSON.parse(data);
    socket.send(JSON.stringify({
      id: message.id,
      result: {
        thread: {
          id: message.params.threadId,
          cwd: message.params.cwd,
          status: {type: 'idle'},
        },
      },
    }));
  }));

  const endpoint = `ws://127.0.0.1:${server.address().port}`;
  const outputA = [];
  const outputB = [];
  let detached;
  const detachSignal = new Promise(resolve => { detached = resolve; });
  const relayA = await relay({
    upstreamUrl: endpoint,
    root: '/a',
    emit: value => {
      outputA.push(value);
      if (value.includes('event=session_end')) detached();
    },
  });
  const relayB = await relay({upstreamUrl: endpoint, root: '/b', emit: value => outputB.push(value)});
  context.after(() => {
    relayA.close();
    relayB.close();
  });

  const clientA = new WebSocket(relayA.url);
  const clientB = new WebSocket(relayB.url);
  context.after(() => {
    clientA.terminate();
    clientB.terminate();
  });
  await Promise.all([once(clientA, 'open'), once(clientB, 'open')]);
  for (const [client, id] of [[clientA, 'a'], [clientB, 'b']]) {
    const response = once(client, 'message');
    client.send(JSON.stringify({id: 73, method: 'thread/resume', params: {threadId: id, cwd: `/${id}`}}));
    assert.equal(JSON.parse((await response)[0]).id, 73);
  }

  outputA.length = 0;
  outputB.length = 0;
  const event = JSON.stringify({method: 'turn/started', params: {threadId: 'a', turn: {id: 't'}}});
  const received = Promise.all([once(clientA, 'message'), once(clientB, 'message')]);
  for (const client of server.clients) client.send(event);
  const frames = await received;
  assert.equal(frames[0][0].toString(), event);
  assert.equal(frames[1][0].toString(), event);
  assert.match(outputA.join(''), /event=busy/);
  assert.deepEqual(outputB, []);

  const closed = once(clientA, 'close');
  clientA.close();
  await Promise.all([closed, detachSignal]);
  assert.match(outputA.join(''), /event=session_end/);
  const response = once(clientB, 'message');
  clientB.send(JSON.stringify({id: 91, method: 'thread/resume', params: {threadId: 'b', cwd: '/b'}}));
  assert.equal(JSON.parse((await response)[0]).id, 91);
});

test('relay rejects browser-origin connections', async context => {
  const localRelay = await relay({upstreamUrl: 'ws://127.0.0.1:1', root: '/work'});
  context.after(() => localRelay.close());
  const socket = new WebSocket(localRelay.url, {origin: 'https://example.com'});
  const [error] = await once(socket, 'error');
  assert.match(error.message, /403/);
});

