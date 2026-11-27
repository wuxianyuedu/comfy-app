/** JSON 值的结构化相等比较（#5224 A5）：不靠 `JSON.stringify` 直接拼字符串 ——
 *  键序不同的两个对象语义相同却会被判成「变了」，而误判的代价是一次白写 /
 *  一次无谓的列表引用重建。对象键排序、数组保序、`undefined` 视同缺键。
 *  纯函数、零 IO，客户端与服务端 Node 进程都可引。 */
import { isRecord } from "~/lib/is-record";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    const parts = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${parts.join(",")}}`;
  }
  /* 顶层 `undefined` 与 `null` 的旧口径一致（原实现 `?? "null"` 兜底），对象内的
   *  undefined 走上面的缺键过滤 —— 两种语义分开，不能合成一个。 */
  return JSON.stringify(value) ?? "null";
}

/** 两个 JSON 值是否结构等价（键序无关、`undefined` 与缺键同义）。 */
export function jsonEquals(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}
