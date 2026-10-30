/**
 * 「线上契约」类判据的两件共享件（台账 E4）。
 *
 * 为什么抽出来：这两件事原先各写在 `tests/task-list-wire-contract.test.ts` 里，
 * 而它们是**任何**一份「客户端镜像 ↔ 服务端真实投影」判据都要做的两步 ——
 * ① 把 caller 的返回值过一次 JSON（少了这一步，测的是进程内传对象，而线上是传文本：
 *    `Date` 变字符串、值为 `undefined` 的键直接消失，这两件事都会改变镜像能否对上列）；
 * ② 取「镜像声明了但线上没发」的那些列。第二份判据（`task.detail` 的 `images`）
 * 动手时若照抄一遍，就是 §12.12 意义上的孪生实现 —— 而孪生的收口历来是两份一起漂。
 *
 * 分工仍然只在测试侧：src/ 里不许 import 本文件。
 */
import type { ZodRawShape } from "zod";

/**
 * 走一次真实传输：`JSON.parse(JSON.stringify(x))`。
 *
 * 泛型只到「文本往返后的形状」这一层，调用方按需窄化 —— 这里替调用方断形状
 * 等于把判据的判断力交出去（它想断的正是「线上到底发成什么样」）。
 */
export function throughJsonWire<T>(value: unknown): T {
  return /* SAFETY: 类型断言已复核 */ JSON.parse(JSON.stringify(value)) as T;
}

/** 镜像声明的列里，线上没有发出来的那些（空数组 = 契约对得上）。 */
export function missingFromWire(shape: ZodRawShape, wireKeys: readonly string[]): string[] {
  return Object.keys(shape).filter((key) => !wireKeys.includes(key));
}
