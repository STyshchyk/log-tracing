import { describe, expect, it } from 'vitest';
import { createInMemoryMqttTransport } from '../src/mqtt/transport.js';

describe('in-memory MQTT transport', () => {
  it('delivers matching wildcard messages and ignores non-matching topics', async () => {
    const transport = createInMemoryMqttTransport();
    const received: Array<{ topic: string; payload: string }> = [];

    await transport.subscribe('factory/winders/#', async (topic, payload) => {
      received.push({ topic, payload: payload.toString('utf8') });
    });

    await transport.emit('factory/winders/W-01/status', '{"state":"WORKING"}');
    await transport.emit('factory/other/O-01/status', '{"state":"IDLE"}');

    expect(received).toEqual([
      { topic: 'factory/winders/W-01/status', payload: '{"state":"WORKING"}' },
    ]);
  });

  it('supports single-level + wildcards and stops delivering after close', async () => {
    const transport = createInMemoryMqttTransport();
    const received: string[] = [];

    await transport.subscribe('factory/winders/+/coil', async (topic) => {
      received.push(topic);
    });

    await transport.emit('factory/winders/W-02/coil', '{}');
    await transport.emit('factory/winders/W-02/coil/extra', '{}');
    await transport.close();
    await transport.emit('factory/winders/W-03/coil', '{}');

    expect(received).toEqual(['factory/winders/W-02/coil']);
  });
});
