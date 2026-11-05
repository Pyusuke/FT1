import { useEffect, useRef, useState } from 'react';
import type { WorkerRequest, WorkerResponse } from '../../core/worker';

type Kind = 'trials' | 'validation';
type Resp<K extends Kind> = Extract<WorkerResponse, { type: K }>;
type Req<K extends Kind> = Omit<Extract<WorkerRequest, { type: K }>, 'id' | 'type'>;

/** Worker に1種類の計算を依頼し、最新の依頼の結果だけを受け取る */
export function useWorkerJob<K extends Kind>(worker: Worker | null, type: K) {
  const [result, setResult] = useState<Resp<K> | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useRef(type === 'trials' ? 2_000_000 : 3_000_000);
  useEffect(() => {
    if (!worker) return;
    const h = (ev: MessageEvent<WorkerResponse>) => {
      if (ev.data.type === type && ev.data.id === id.current) {
        setResult(ev.data as Resp<K>);
        setBusy(false);
      }
    };
    worker.addEventListener('message', h);
    return () => worker.removeEventListener('message', h);
  }, [worker, type]);
  const run = (req: Req<K>) => {
    if (!worker) return;
    id.current += 1;
    setBusy(true);
    worker.postMessage({ ...req, type, id: id.current } as unknown as WorkerRequest);
  };
  return { result, busy, run };
}
