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

let cachedBootId: string | null = null;

/** 返回当前进程的 bootId；进程重启后重新生成（模块级缓存，冷启动即失效）。 */
export function getServerBootId(): string {
  cachedBootId ??= `${BOOT_ID_PREFIX}:${process.pid}:${Date.now()}:${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  return cachedBootId;
}
