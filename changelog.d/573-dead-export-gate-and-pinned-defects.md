## Added

- **`src/lib` 的零消费导出成为机器判据（规范 §12.16，`scripts/check-dead-exports.cjs` + 棘轮基线 `scripts/.dead-exports-baseline.json`，接入 pre-commit 与 CI）**。§12.15 早就给了「死代码该接线还是该删」的口径，但它**只有口径、没有判据** —— 那批 `Result` / 7 个零 `new` 调用点的错误类 / `eventBus` 全是人工读出来的。新判据只扫 `src/lib/**` 且**只认值导出**（函数 / 常量 / 类 / 枚举）：`export type` / `interface` 一律不看，因为「导出但零外部引用」的 566 个清单里 90% 是**同文件内使用的 props 类型**，纳入就只是噪音。基线按**符号**记账、只许降不许升，登记项还会反向核对（符号被接线或删除后必须从基线删掉）。
- **`tests/check-dead-exports.test.ts`（10 例）**：把脚本当黑盒跑在临时工作区上 —— 被消费放行 / 零消费阻断 / `type` 与 `interface` 不算死代码 / `export { a as b }` 只记别名 / `components` 不参与 / 测试文件不参与 / 棘轮三态（存量放行 + 新增阻断 + `--strict` 要求收紧）/ `--report` 只盘点。

## Fixed

- **`REAPER_ENABLED=false` 关不掉 reaper（`core/config.ts`）**：`z.coerce.boolean()` 等价于 `Boolean(value)`，而 `Boolean("false") === true` —— 按惯例写 `=false` 或 `=0` 都会被读成**打开**，且没有任何提示。reaper 会**杀进程**，误判代价比一般配置项高得多。现改为按**布尔字面量**解析（`1/true/yes/on` 与 `0/false/no/off`，大小写与空白不敏感，空串视为「没给」落默认值），其余取值一律 **fail-fast 且报出字段名**（拼错成 `ture` 静默取真值等于把同一缺陷换个写法再犯一次）。
- **LLM 流式回答会「答到一半就没了」且界面上没有任何报错（`llm/browser.ts`）**：`json.error` 抛出的 Error 被**同一个** `catch` 重新接住，而该 `catch` 只在文案命中 `/LLM|请求|fetch/i` 时才 rethrow —— 于是 `data: {"error":"上游鉴权失败"}` 被静默丢弃、前面收到的半截正文作为**正常回答**返回。现在把「解析」与「处置」分开：坏帧（JSON 语法错误）跳过并继续，语义错误（服务端明确报错）立刻中断整条流。
- **末帧缺换行符时整条被丢弃（同文件）**：读取循环 `break` 之后再未冲刷缓冲，`data: {"token":"tail"}`（无 `\n`）被整条丢掉 —— 用户可见表现是「回答最后一个字丢了」。现在流结束后按结尾帧再分发一次。
- **`getDrizzleStudioStatus()` 的 `up` 恒为 `false`（`drizzle-studio/lifecycle.ts`）**：端口上确实有实例在跑、但不是本应用拉起时，状态会被读成「未运行」，调用方据此去重拉一个（或反过来以为无实例可关）。现在缓存最近一次探测结论（2s TTL），缓存缺失/过期按 `false` 返回。
- **`getNodeConfig()` 兜底记录的 icon 多一个 `}`（`comfyui/node-registry.ts`）**：`"\u{2699}\uFE0F}"` 会带着多余括号出现在未知节点的卡片上。这类「原样渲染的字符串」既不会报错、也没有任何门禁能发现，故一并补上 `node-registry.test.ts`（50 例）锁数据契约（icon 干净、字段完整、三级回落、`getAllNodeTypes` 调用时重算）。

## Removed

- **`src/lib/llm/index.ts`（零消费 barrel）**：全库（含测试 / 脚本）零引用，各消费方都直接引 `@/lib/llm/<子模块>`。按规范 §12.15 第三条（无等价实现、也无明确落地时机的通用抽象）删除。

## Fixed

- **master 上有 3 个文件其实没通过 prettier，而格式棘轮一直是绿的（`FilmStudio.tsx` / `use-film-studio.ts` / `VideoStudio.tsx`）**：合并提交 `c2bd0d6`（解 PR #607 与 master 的冲突）按 master 的格式口径**手工**重排了这几个文件，但**没有跑 prettier** —— 于是 tailwind 类序与超宽文案换行都停在「看起来重排过、实际不合规」的中间态，而棘轮基线是 `{}`、门禁每次都说 0 个文件。这次治理顺带把它们真正格式化，并**刷新随类序变化的快照**（`FilmStudio.test.tsx.snap`）。
  > 这条值得记一笔：格式棘轮按**文件**记账，判的是「这个文件此刻干不干净」—— 它当时确实跑过、也确实报绿，只是**上一个提交的绿不能替代这一个提交的绿**。手工解冲突时最容易漏的就是「冲突文件的另一半格式」。
