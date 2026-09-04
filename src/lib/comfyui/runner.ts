// P3: public entry for the ComfyUI runner.
//
// refactor: the original single-file `runner.ts` (1971 lines)
// was split by responsibility into three modules plus shared state and a
// protocol adapter:
//
//   • enqueue.ts  — enqueue / subscribe / getLogs / cancelTask (public API)
//   • executor.ts — WS connect / handleMessage / processQueue / complete
//                   & fail (incl. the comfy-cli raw-workflow path)
//   • reaper.ts   — orphan task reclamation (stale QUEUED / RUNNING sweeps)
//   • runner-state.ts   — shared singleton state + log persistence (internal)
//   • protocol-adapter.ts — isolates ComfyUI WS protocol differences
//                   (kaytool v0.28 non-standard `execution_success` signal)
//                   behind an Adapter so the executor never hard-codes
//                   vendor-specific message types.
//
// This file is now a thin re-export shim: every existing `import … from
// "@/lib/comfyui/runner"` keeps working unchanged (same names, same types,
// same signatures).  Importing the runner also starts the reaper side-effect
// (cold-start sweep + 30s interval), exactly as the pre-split module did.

import "./reaper"; // module side-effect: launch the reaper sweeps

export type { RawWorkflowOverride, Job, LogEntry, TaskEvent } from "./runner-state";

export { enqueue, subscribe, getLogs, cancelTask } from "./enqueue";
export {
  collectOutputs,
  extractRuntimeParams,
  friendlyError,
  applyRawOverrides,
} from "./executor";
export type { RuntimeParams } from "./executor";
