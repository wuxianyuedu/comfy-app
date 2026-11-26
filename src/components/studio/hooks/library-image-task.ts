"use client";

/**
 * 库页「本地工作流生图」的任务观察出口（规范 17 §17.2 第②层）：
 * 风格库与脸库各有一处结果网格，原先各自包一遍 SSE 观察，取消时若只退订，
 * 有界并发会永远等在一条不会再落定的 Promise 上。这里把退订与落定收在一处，
 * 取消会让观察 Promise 以专属错误结束，调用方据此不把结果改写成 failed。
 */
import { LOCAL_TASK_TIMEOUT_MS, observeTaskUntilSettled } from "~/lib/workshop/generation-client";
import { isWantedOutput } from "~/lib/workshop/output-filter";

/** 单条取消的落定信号；与真实生成失败分开，调用方据此保留「已取消」态。 */
export class LibraryTaskCancelledError extends Error {
  constructor() {
    super("任务已取消");
    this.name = "LibraryTaskCancelledError";
  }
}

/** 观察一张图的产物；登记按 taskId 索引的退订口，供单条取消直接调用。 */
export function observeLibraryImageTask(
  taskId: string,
  registerDisposer: (taskId: string, dispose: () => void) => void,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let stop: () => void = () => undefined;
    let settled = false;
    let url = "";

    const finish = (end: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      stop();
      end();
    };

    stop = observeTaskUntilSettled({
      onIdleTimeout: (snapshot) => {
        finish(() => {
          const found = snapshot?.outputs.find((out) => isWantedOutput("image", out));
          if (found) {
            resolve(found.url);
          } else {
            reject(new Error("任务超时未产出图片"));
          }
        });
      },
      onOutput: (out) => {
        if (isWantedOutput("image", out)) {
          url = out.url;
        }
      },
      onSettled: (result) => {
        finish(() => {
          if (result.ok && url !== "") {
            resolve(url);
          } else {
            reject(new Error(result.message ?? "生成失败"));
          }
        });
      },
      taskId,
      timeoutMs: LOCAL_TASK_TIMEOUT_MS,
    });
    registerDisposer(taskId, () => {
      finish(() => {
        reject(new LibraryTaskCancelledError());
      });
    });
  });
}
