/**
 * 「线上契约」类判据的两件共享件（台账 E4）。先 JSON 往返一次（否则测的是进程内传对象：`Date` 变字符串、
 * `undefined` 键消失，会改变镜像能否对上列），再取「镜像声明了但线上没发」的列。第二份判据（`task.detail`
 * 的 `images`）若照抄一遍就是 §12.12 的孪生实现，收口历来两份一起漂。只许测试侧用，src/ 不许 import。
 */
import type { ZodRawShape } from "zod";

/**
 * 走一次真实传输：`JSON.parse(JSON.stringify(x))`。泛型只到「文本往返后的形状」，调用方按需窄化 ——
 * 这里替调用方断形状等于把判据的判断力交出去（它想断的正是「线上到底发成什么样」）。
 */
export function throughJsonWire<T>(value: unknown): T {
  /* 这一处断言是**设计本身**（见上：形状判断力故意留给调用方），不是待清的存量 ——
     就地行级豁免并写明理由（B5 清账：文件级豁免收到行级）。 */
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 镜像声明的列里，线上没有发出来的那些（空数组 = 契约对得上）。 */
export function missingFromWire(
  shape: ZodRawShape,
  wireKeys: ReadonlyArray<string>,
): Array<string> {
  return Object.keys(shape).filter((key) => !wireKeys.includes(key));
}
