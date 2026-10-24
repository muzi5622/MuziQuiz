import { afterEach, expect, it, vi } from 'vitest';
import { resumeAfterRestart } from './reconnect.js';
afterEach(() => vi.useRealTimers());
it('resumes a graceful server restart, but cancels on removal or unmount', () => {
  vi.useFakeTimers();
  let listener: (reason: string) => void = () => {};
  const socket = { on: vi.fn((_event, next) => { listener = next; }), off: vi.fn(), connect: vi.fn() };
  const stop = resumeAfterRestart(socket);
  listener('transport close'); vi.advanceTimersByTime(1000); expect(socket.connect).not.toHaveBeenCalled();
  listener('io server disconnect'); vi.advanceTimersByTime(1000); expect(socket.connect).toHaveBeenCalledTimes(1);
  listener('io server disconnect'); stop(); vi.advanceTimersByTime(1000); expect(socket.connect).toHaveBeenCalledTimes(1);
  expect(socket.off).toHaveBeenCalledWith('disconnect', listener);
});
