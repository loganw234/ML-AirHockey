// A worker thread for tools/train.ts. The work itself is src/workerCore.ts, which the page's Web Worker
// runs too.

import { parentPort } from 'node:worker_threads';
import { handle } from '../src/workerCore.ts';
import type { WorkRequest } from '../src/workerCore.ts';

const port = parentPort;
if (!port) throw new Error('WORKER-ONLY: tools/worker.ts runs as a worker thread of tools/train.ts');
port.on('message', (msg: WorkRequest) => port.postMessage(handle(msg)));
