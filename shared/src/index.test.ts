import { describe, expect, it } from 'vitest';
import { ConnectionSchema, HealthSchema } from './index.js';
describe('foundation contracts', () => {
  it('validates health and rejects invalid connection timestamps', () => {
    expect(HealthSchema.parse({ status: 'ok', version: '0.1.0' }).status).toBe('ok');
    expect(ConnectionSchema.safeParse({ serverTime: -1 }).success).toBe(false);
  });
});
