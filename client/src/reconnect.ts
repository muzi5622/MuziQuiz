/** Socket.IO retries transport loss itself, but requires connect() after a
 * server-initiated namespace disconnect (including graceful server shutdown). */
export function resumeAfterRestart(socket: {
  on(event: 'disconnect', listener: (reason: string) => void): unknown;
  off(event: 'disconnect', listener: (reason: string) => void): unknown;
  connect(): unknown;
}) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listener = (reason: string) => {
    if (reason !== 'io server disconnect' || stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => { if (!stopped) socket.connect(); }, 1000);
  };
  socket.on('disconnect', listener);
  return () => { stopped = true; clearTimeout(timer); socket.off('disconnect', listener); };
}
