// dev server 进程启动标识（server-only）。
//
// 用途：给前端提供一个可靠信号区分「dev server 进程真的重启了」与
// 「网络瞬时抖动 / 显示器关闭 / 浏览器后台节流」导致的探测失败。
//
// 原理：本模块以模块级变量缓存 bootId——每次 Next dev server 进程冷启动，
// 模块重新执行，bootId 重新生成。只要进程没重启，bootId 恒定不变；一旦
// 进程重启，bootId 即变化。前端轮询该值，前后不一致即为真正重启。
// （网络抖动期间进程仍在、bootId 不变，可据此排除误报。）

import "server-only";

const BOOT_ID_PREFIX = "dev-boot";

/** 环境变量名：**本次启动**的标识（launcher 的 runId，6 位小写十六进制）。
 *
 * 与 {@link getServerBootId} 是两个不同的身份，别混：
 *   · `bootId` 认**进程** —— 每次 dev server 冷启动重新生成，判「进程换没换」；
 *   · `runId` 认**启动** —— 由 launcher 在拉起服务之前生成并透传，同一次启动里
 *     被 spawn 的所有子进程共享，判「这是哪一次启动」。
 *
 * 为什么需要后者：消息中心要把历史消息按「每一次启动」分开显示（多次启动的记录
 * 混在一起时分不清哪几条属于同一次），而 bootId 在整页刷新后也会变（刷新不换进程、
 * 却会换 bootId 的对比基准），拿它分组会把「用户按了一次 Ctrl+R」也算成一次启动。
 * runId 由 launcher 单点产出，与 `log/runs/<日期>_<时分秒>-<runId>`、
 * `run/app-service-exit.json` 的 `runId` 字段同源 —— 分组头带上它，用户能直接
 * 拿去和日志目录对号。
 */
const RUN_ID_ENV = "COMFYAPP_RUN_ID";

let cachedBootId: string | null = null;

/** 返回当前进程的 bootId；进程重启后重新生成（模块级缓存，冷启动即失效）。 */
export function getServerBootId(): string {
  cachedBootId ??= `${BOOT_ID_PREFIX}:${process.pid}:${Date.now()}:${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  return cachedBootId;
}

/**
 * 当前**这一次启动**的 runId；拿不到给 null。
 *
 * 拿不到是正常状态而不是错误：纯手工 `pnpm dev`（没走 launcher）时没有这个环境
 * 变量，浏览器形态下 likewise。此时**不编一个值**——编出来的分组键会让两条本不
 * 属于同一次启动的消息被并到一组，比分不出来更坏。
 */
export function getServerRunId(): string | null {
  const raw = process.env[RUN_ID_ENV];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}
