export function startWorkerLoop(worker,{intervalMs=1000,batchSize=20,onError=()=>{}}={}){
 let stopped=false,pending=null,timer;
 const tick=()=>{
  if(stopped||pending)return;
  pending=(async()=>{try{for(let n=0;n<batchSize&&!stopped;n++)if(!await worker.runOne())break;}catch{onError('OUTBOX_CYCLE_FAILED');}})()
   .finally(()=>{pending=null;if(!stopped)timer=setTimeout(tick,intervalMs);});
 };
 tick();return {async stop(){stopped=true;clearTimeout(timer);if(pending)await pending;}};
}
