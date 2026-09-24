import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queueName, deadLetterQueueName } from './queue';

// BullMQ queue names cannot contain ':', so the "queue:messages:{device_key}"
// convention is applied via the Redis key prefix instead of the name itself.
test('queueName is the bare device key (colon-free, valid as a BullMQ name)', () => {
  assert.equal(queueName('WAPI-TEST01'), 'WAPI-TEST01');
});

test('deadLetterQueueName suffixes the device key with -dead', () => {
  assert.equal(deadLetterQueueName('WAPI-TEST01'), 'WAPI-TEST01-dead');
});
