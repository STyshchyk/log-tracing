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

  it('records published messages, delivers them to matching subscribers, clears recorded history, and rejects publish after close', async () => {
    const transport = createInMemoryMqttTransport();
    const received: Array<{ topic: string; payload: string }> = [];

    await transport.subscribe('factory/winders/+/command', async (topic, payload) => {
      received.push({ topic, payload: payload.toString('utf8') });
    });

    await transport.publish(
      'factory/winders/W-01/command',
      '{"command":"OTA_UPDATE"}',
      { qos: 1, retain: false },
    );

    expect(transport.published).toEqual([
      {
        topic: 'factory/winders/W-01/command',
        payload: '{"command":"OTA_UPDATE"}',
        options: { qos: 1, retain: false },
      },
    ]);
    expect(received).toEqual([
      {
        topic: 'factory/winders/W-01/command',
        payload: '{"command":"OTA_UPDATE"}',
      },
    ]);

    transport.clearPublished();
    expect(transport.published).toEqual([]);

    await transport.close();
    await expect(
      transport.publish('factory/winders/W-01/command', '{}', { qos: 1, retain: false }),
    ).rejects.toThrow(/closed/i);
  });
});
