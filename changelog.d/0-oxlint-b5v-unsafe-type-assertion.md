## Changed

- **B5 子批 22：20 份 / 47 处 `typescript/no-unsafe-type-assertion` 清零**（判决面删掉这 20 份路径行；
  实扫 47 处，比挂账注记多 1 处为代码漂移，已按实扫清零）。本批覆盖 `server/db`、`server/api/trpc`、
  `server/agent/run-engine` 与 `server/api/routers`（generate / llm / model / project / run / series /
  series-generation / setting / skill / task / workflow 及各用例）。
  修法仍是「运行时校验 + 类型守卫」，没有新增 `as` / `!` / `@ts-ignore`：
  - globalThis 单例缓存改 `declare global` 环境声明（`db.ts` 的 `db` 键、`trpc.ts` 的慢查询桶），
    与 `lib/**` 既有同型写法对齐，不再 `as unknown as`。
  - 对象读取复用 `~/lib/is-record` 的 `isRecord` / `isPlainRecord` / `asRecord`；
    数组列（`shots` / `characters` / `rawJson.nodes`）按「数组且条目是对象」判，
    条目形状仍由写入端与 draft-integrity 读侧保证。
  - `workflow-mutations` 的坐标覆盖表抽本地 `isPositionMap` 守卫（两处消费点），
    非法形状按「没有覆盖」处理，垃圾坐标不再原样写进节点。
  - `isProjectType` 守卫提升进 `~/lib/workshop/types`（union 与词表同源），`draft-sync-shared`
    的本地副本与重复词表随之删除；`run-engine` 的景别改走既有 `normalizeShotType`。
  - `RawWorkflow` 自带索引签名，`workflow-list` 的双重断言（`as unknown as Record`）直接删。
  - `llm.ts` 的 `z.enum` 利用 zod v4 的 `const T extends readonly string[]` 直接吃词表派生数组，
    字面量联合保留，不再断言成 `[string, ...string[]]`。
  - 测试侧：`TestDb` 改成与 drizzle 实例的交集类型（`test-db.ts` 自身的 `as unknown as` 一并删除），
    `series.test` 不再强转；mock 回执行从 `undefined as never` 改为最小 `LlmConfig` 回执行；
    `spawnMock` 改带签名泛型，取参不再断言。
  - 四处「故意喂非法枚举 / 缺必填字段」的 zod 闸用例按 B2 同款转**逐行禁用 + 一行理由**
    （线上 JSON 载荷绕得过编译期类型、绕不过运行期闸——测试必须能在类型层之外构造该值），
    计入「豁免不计入清零」口径。

语义未变：合法输入结果一致；非法输入维持既有的回落 / 跳过行为（垃圾坐标不再透传是本批唯一的行为面收紧）。
