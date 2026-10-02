## Fixed

- MCP 工坊服务端的两个写侧工具不再「什么都收」：`workshop_set_characters` /
  `workshop_set_storyboard` 的入参原本是 `z.array(z.any())` 再 `as never` 压进
  `Character[]` / `Shot[]`，而这两个工具是**整幅覆盖草稿并落库**。具体后果不是
  「类型不安全」这种抽象说法：`styleTags` 被模型写成字符串（`"皮克斯"`）时，
  `buildCharacterPrompt` 先过 `c.styleTags.length`（字符串也成立）再 `.join()` →
  TypeError 打断整条写入路径；`characterIds` 同理被 `rebuildShotPrompts` 的
  `.includes` 用掉。
- 现在由 `~/lib/workshop/types` 贴着接口出一份写侧契约，工具直接引用它，
  `as never` 随之消失（tsc 这一格重新在真验东西）。口径四条：只有「缺了就没法被引用」
  的字段必填；可缺省的补默认（下游无条件读取它们）；**必填枚举严格**（脏 `status`
  走边界拒收）、**可选枚举认不出当没给**（`motion: "hyper"` 既不落库也不因它拒收整批）；
  `positivePrompt` / `prompt` 一律空串占位，由服务端 `rebuild*Prompts` 重算 ——
  外部传什么都不信。
- 顺带把 `Shot.status` / `Shot.clipStatus` / `Asset.status` 三份一样的联合类型
  收成一处 `SHOT_STATUSES`（契约要按同一份枚举校验取值），`MotionLevel` /
  `Transition` 同理落成 `MOTION_LEVELS` / `TRANSITIONS` 两份单点清单。

## Added

- `src/server/mcp/workshop-mcp.test.ts` —— 这一层 17 条工具**此前零执行者**。
  走真的 `client.callTool`（内存 transport）而不是直接调 handler：实测 SDK 的
  **校验发生在 transport 层**，`_registeredTools[x].handler` 拿到什么就传什么，
  只有走客户端才判得到「拒收时一次都没落到服务端」。用例含：17 条与测试表逐字一致
  （新工具不写用例就红）、每条翻译到哪个服务端出口、写侧契约的归一与两档枚举、
  以及 `generate_image` 两种尺寸表达等价 + 一个都不给时传 `undefined`。
  门槛按实测 100 满档登记（`coverage.include` + `thresholds` 两处同批）。
- `tests/f13-projection-shapes.test.ts` 加一条形状判据：`src/server/mcp/**` 的
  inputSchema 里不许出现 `z.any(`（配合成反证）。

## Tests

- 登记表同步收口：`AS_NEVER_LEDGER` 里 `src/server/mcp/workshop-mcp.ts` 那两条**已删**
  （登记表失去记账能力就是白表）。变异实测：把契约换回 `z.array(z.any())` →
  恰好新增那条判据红。

## Docs

- 台账 F13′ 结案；同族另一处另立 **F13″**（`parseDraftDto` 的元素级仍是
  `as Character[]`，修法是复用本批这份契约，但先要定「脏元素是丢弃还是保留」的口径
  —— 那条路径读的是用户自己的草稿）。
- 一条只有落笔时才知道的事写进 F13′：MCP 的入参校验发生在 SDK 从 zod 推出的
  **JSON Schema** 上，所以 `z.unknown().transform(...)` 会让「字段缺省」变成
  「必填」并被直接拒（实测 `expected nonoptional, received undefined`）；
  要缺省可用必须 `.default()` + `.transform()`。
