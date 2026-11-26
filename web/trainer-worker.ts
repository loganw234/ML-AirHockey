// A Web Worker for training in the page. The work is src/workerCore.ts, the same function the Node worker
// threads of tools/train.ts run.

import { handle } from '../src/workerCore.ts';
import type { WorkRequest } from '../src/workerCore.ts';

self.onmessage = (e: MessageEvent<WorkRequest>) => {
  self.postMessage(handle(e.data));
};
