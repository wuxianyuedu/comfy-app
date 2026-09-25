/**
 * 集合分桶的通用原语（纯函数，无 IO / 无平台依赖）。
 *
 * 背景（§12.18 复用优先）：`map.get(k)!.push(x)` 这类「取一个分组桶、没有就建一个、
 * 然后往里塞」的写法此前散在各处（materials 的按文件夹、history 的按日期、
 * segment-popover 的按子组），每一处都靠 `!` 断言「这个键我刚才一定塞过」——
 * 而那份「一定」是读代码的人要自己核对的隐性契约（初始化循环离用点十几行就会被改散）。
 * 收口成一个 `getOrCreate`，把「没有就建、有就取」这件事在一处写对并配单测，调用点
 * 不再需要 `!`。`getOrThrow` 是另一半：键**按构造必存在**（如刚从同集合派生的索引）时，
 * 用一条带上下文的报错替代静默的 `!` 崩溃。
 *
 * @module collections — 分组桶的取或建 / 必存在取值（纯函数）
 */

/** 取 `key` 对应的桶；不存在则用 `create` 建一个、放进 map、再返回。 */
export function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  const existing = map.get(key);
  if (existing !== undefined) return existing;
  const created = create();
  map.set(key, created);
  return created;
}

/** 取 `key` 对应的值；缺失即抛带 `message` 的错误（替代 `map.get(key)!` 的无上下文崩溃）。 */
export function getOrThrow<K, V>(map: Map<K, V>, key: K, message: string): V {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(`${message}（键：${String(key)}）`);
  }
  return value;
}
