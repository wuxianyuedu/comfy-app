/**
 * 破坏性入口的「参数契约」：认不出的旗标一律**拦下**，不许默默吞掉之后照旧作动。
 *
 * ## 为什么值得单独一份
 *
 * 本仓有两个入口默认动的是**写库**的那一句 —— `db-push.mjs` 起
 * `drizzle-kit push --force`（`--force` 的语义就是「自动批准会丢数据的语句」），
 * `db-migrate.mjs` 起 `drizzle-kit migrate` 并往 `__drizzle_migrations` 记一条账。
 * 而它们原先**一句 `argv` 都不读**，于是 `--dry-run` 这种「我以为让它别写」的参数
 * 被当成「没有参数的那一次调用」：库照改、账照记，**还退 0**。
 *
 * 两笔都是实测踩出来的，不是设计推演（ISSUE #1956 与 #2096，探针都把
 * `DATABASE_URL` 指到临时目录、没碰开发库）：`db-push` 那一跑落了库，只因为那批里
 * 唯一的 `DROP TABLE` 恰好打在一张 0 行的表上才没造成损失；`db-migrate` 那一跑
 * 建出 23 张表、账本记上 1/1，退出码 0。
 *
 * ## 方向是不猜
 *
 * 破坏性入口遇到认不出的旗标时，唯一诚实的答复是**不作动**。补一个假的 `--dry-run`
 * 更坏 —— 那会让「我以为它在干 A」与「它其实在干 B」这对错认**继续存在**，只是多
 * 了一个看起来正规的写法。所以这里只做一件事：把「哪些是认不出的」判出来，
 * 按一份统一形状把话组好，交给调用方的出口。
 *
 * ## 分工
 *
 * 「打什么字、以什么码退」留在各入口自己手里（那句因果只有它自己说得准：push 要讲
 * `--force` 与无 TTY 的 dry-run，migrate 要讲账本与 `.sql` 文件），本件不碰任何一侧的
 * 传输层（§12.12：共享内核里不放任何一侧的实现）—— 连退出都是注入的 `fail`。
 */

/**
 * 认不出的参数非空时调 `fail` 交出一段可行动正文；全认得时什么都不做。
 *
 * 入参：
 *   · `argv` —— 待判的参数（缺省取 `process.argv.slice(2)`，用例里传进来）；
 *   · `recognized` —— 它**认**的旗标，精确匹配不是前缀；两个数据库入口目前都是空表；
 *   · `command` —— 给人看的命令名（`db:push` / `db:migrate`）；
 *   · `action` —— 一句「它默认动的是什么」，必须含**会不会写库**：这一格正是被
 *     吞掉的那句代价，不许写成中性的「执行相应操作」；
 *   · `exits` —— 「想要的东西对应哪一条」的逐条出口（不含前导符号）；
 *   · `fail` —— 调用方的出口（打印 + 退码都由它定，本件不决定退成几）。
 *
 * @param {{
 *   argv?: string[],
 *   recognized?: string[],
 *   command: string,
 *   action: string,
 *   exits?: string[],
 *   fail: (text: string) => void,
 * }} options
 * @returns {string[]} 拦下来的那些参数（放行时为空数组）。留一个读数给调用方与用例，
 *   但**不据它决定退不退** —— 退是 `fail` 的事。
 */
export function rejectUnknownArgs({
  argv = process.argv.slice(2),
  recognized = [],
  command,
  action,
  exits = [],
  fail,
}) {
  const unknown = argv.filter((arg) => !recognized.includes(arg));
  if (unknown.length === 0) return unknown;
  const lines = [`${command} 不接受参数，但收到了：${unknown.join(" ")}`, ""];
  lines.push(
    recognized.length > 0
      ? `它认的只有：${recognized.join(" ")}`
      : "它一个参数都不认。",
  );
  lines.push("认不出的旗标在这里**不会被当成「已生效的开关」**。");
  lines.push("");
  lines.push(action);
  if (exits.length > 0) {
    lines.push("");
    lines.push("想要的东西对应哪一条：");
    for (const exit of exits) lines.push(`  · ${exit}`);
  }
  fail(lines.join("\n"));
  return unknown;
}
