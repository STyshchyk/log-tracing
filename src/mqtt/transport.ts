import mqtt, { type MqttClient } from 'mqtt';

/**
 * Callback invoked when an MQTT message arrives on a subscribed topic filter.
 */
export type MqttMessageHandler = (topic: string, payload: Buffer) => Promise<void> | void;

/**
 * Swappable MQTT transport seam (real Mosquitto in production, in-memory emitter in tests).
 */
export interface MqttTransport {
  subscribe(topicFilter: string, handler: MqttMessageHandler): Promise<void>;
  close(): Promise<void>;
}

/**
 * In-memory MQTT transport adapter with synchronous-awaitable message emission for tests.
 */
export interface InMemoryMqttTransport extends MqttTransport {
  emit(topic: string, payload: string | Buffer): Promise<void>;
}

interface Subscription {
  topicFilter: string;
  handler: MqttMessageHandler;
}

function matchesTopicFilter(filter: string, topic: string): boolean {
  const filterLevels = filter.split('/');
  const topicLevels = topic.split('/');

  for (let i = 0; i < filterLevels.length; i += 1) {
    const level = filterLevels[i];
    if (level === '#') {
      return i === filterLevels.length - 1;
    }
    if (i >= topicLevels.length) {
      return false;
    }
    if (level !== '+' && level !== topicLevels[i]) {
      return false;
    }
  }

  return filterLevels.length === topicLevels.length;
}

function createSubscriptionRegistry() {
  const subscriptions: Subscription[] = [];

  return {
    add(topicFilter: string, handler: MqttMessageHandler): void {
      subscriptions.push({ topicFilter, handler });
    },
    async dispatch(topic: string, payload: Buffer): Promise<void> {
      for (const sub of subscriptions) {
        if (matchesTopicFilter(sub.topicFilter, topic)) {
          await sub.handler(topic, payload);
        }
      }
    },
    clear(): void {
      subscriptions.length = 0;
    },
  };
}

/**
 * Create an in-memory MQTT transport adapter supporting + and # wildcards.
 */
export function createInMemoryMqttTransport(): InMemoryMqttTransport {
  const registry = createSubscriptionRegistry();
  let closed = false;

  return {
    async subscribe(topicFilter: string, handler: MqttMessageHandler): Promise<void> {
      if (closed) {
        throw new Error('Cannot subscribe on a closed in-memory MQTT transport');
      }
      registry.add(topicFilter, handler);
    },

    async emit(topic: string, payload: string | Buffer): Promise<void> {
      if (closed) {
        return;
      }
      const buffer = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
      await registry.dispatch(topic, buffer);
    },

    async close(): Promise<void> {
      closed = true;
      registry.clear();
    },
  };
}

/**
 * Connect to an Eclipse Mosquitto broker over TCP MQTT.
 */
export function createMosquittoTransport(brokerUrl: string): MqttTransport {
  const client: MqttClient = mqtt.connect(brokerUrl);
  const registry = createSubscriptionRegistry();

  client.on('error', (err) => {
    console.error('MQTT client error:', err.message);
  });

  client.on('message', (topic, payload) => {
    void registry.dispatch(topic, payload).catch((err) => {
      console.error(`Unhandled error in MQTT handler for topic ${topic}:`, err);
    });
  });

  return {
    async subscribe(topicFilter: string, handler: MqttMessageHandler): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        client.subscribe(topicFilter, (err) => {
          if (err) {
            reject(err);
            return;
          }
          registry.add(topicFilter, handler);
          resolve();
        });
      });
    },

    async close(): Promise<void> {
      registry.clear();
      await new Promise<void>((resolve) => {
        client.end(false, {}, () => resolve());
      });
    },
  };
}
