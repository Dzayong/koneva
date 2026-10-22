import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withDeviceSendLock } from './device-send-lock';

test('the final send gate is serialized for one device and independent across devices', async () => {
  let active = 0;
  let maximum = 0;
  const send = (deviceKey: string) => withDeviceSendLock(deviceKey, async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
  });

  await Promise.all([send('WAPI-1'), send('WAPI-1'), send('WAPI-2')]);
  assert.equal(maximum, 2, 'distinct device numbers can still work concurrently');
});
