import { resolve } from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { createApp } from '../server/dist/app.js';

const { app } = await createApp({ databasePath: process.argv[2], clientPath: resolve('client/dist'), lanAddresses: () => [{ address: '127.0.0.1', label: 'Simulated LAN' }] });
const delay = monitorEventLoopDelay({ resolution: 10 }); delay.enable();
const initial = performance.eventLoopUtilization();
let peakRss = 0; let peakHeap = 0;
const sample = () => { const memory = process.memoryUsage(); peakRss = Math.max(peakRss,memory.rss); peakHeap = Math.max(peakHeap,memory.heapUsed); };
sample(); const timer = setInterval(sample,100);
await app.listen({ host: '127.0.0.1', port: 0 });
process.send({ ready: true, port: app.server.address().port });
process.on('message', async message => {
  if (message !== 'finish') return;
  sample(); clearInterval(timer); delay.disable();
  process.send({ stats: { peakRssMiB: peakRss / 1048576, peakHeapMiB: peakHeap / 1048576, eventLoopP95Ms: delay.percentile(95) / 1e6, eventLoopUtilization: performance.eventLoopUtilization(initial).utilization } });
  await app.close(); process.disconnect();
});
