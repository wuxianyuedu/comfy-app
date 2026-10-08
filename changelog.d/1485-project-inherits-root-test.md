## Fixed

- **订正一条写反了的口径：`projects` 是**继承**声明方 `test` 选项的（ISSUE #1485）**。
  `vitest.config.ts` 里原先立着一个 `SHARED_TEST_OPTIONS` 常量、两个 project 各 spread
  一次，理由写的是「`projects` 不继承声明方 `test` 的选项（实测）」。本轮按仓库规矩先去
  **复现那次实测** —— 结论是**当时那次测量站不住**（vitest 5.0.3）：

  | 配置形状 | `task.timeout` | `setupFiles` |
  | --- | --- | --- |
  | `setupFiles` / `testTimeout` 写在根 `test`、inline project 只写 `include` | **30000（继承到了）** | **生效**（`jest-dom` 匹配器在） |
  | 同上 + project 上 `extends: false`（负对照） | **5000（出厂值）** | **不生效**（`Invalid Chai property`） |

  ⇒ 「继承」是**机制**（`extends: false` 是关掉它的开关，实测那一档退回 5000 且匹配器消失）。
  当年那 2 条红是真的，但**归因错了**：那时根 `test` 上确实没有那几项（后来才抽成常量），
  红的是「抽出去之后没 spread 回来」，不是「继承失效」。所以共享项回到了根 `test` 上。

- **`scripts/check-test-environment.cjs` 在原文上找 `projects:` —— 解释性注释里出现这个词
  就会把解析带偏**（本轮改配置那一步当场撞出来的）。`parseProjectGlobs()` 原先直接
  `text.indexOf("projects:")`，而 `vitest.config.ts` 的注释里正当会写出
  `projects: [{ test: {…} }]` 这样的形状说明 —— 于是命中的是**注释里那一处**、
  `[` 也落在注释里，两个档一个都解析不出来（是 `found < 2` 那条兜底把它拦下的：
  **没有兜底就会退回「没有目录档」＝判据②静默消失、照样报 OK**）。
  修法是新增 `blankComments()`（**只抹注释、长度不变**，字符串原样保留 ——
  不能复用上面那个 `stripCommentsAndStrings()`，它把字符串换成 `""`、偏移会变，
  而这里要拿偏移去切数组、还要读 `include: JSDOM_TEST_GLOBS` 的标识符）。
  - **负对照**：撤掉 `blankComments()` + 在 `test: {` 之前加一段带 `projects: [假的]`
    的注释 → 判据判失败；恢复后 OK。
  - 判据自测 `tests/test-environment-gate.test.ts` **补了一条执行者**（注释里两处
    `projects:`、解析仍认真正的那个键），同一负对照下**恰好红这一条**。
    这一格必须**改注释本身**才有执行者 —— 只把 `projects:` 换个写法的变异抓不到它。

## Changed

- **共享项从「常量 + 两处 spread」回到根 `test`，一处定义两档都拿**：删掉
  `SHARED_TEST_OPTIONS`（`setupFiles` / `globals` / `testTimeout` / `hookTimeout` /
  `maxWorkers` / `expect.poll` 写在根 `test` 上），配置里那条会把人带偏的注释一并重写。
  验收口径两条，都是**可复算**的：
  - `vitest list` 的 `[project] … > 用例名` **逐行零差异**（7160 条，改前改后同一份）；
  - 新判据 `tests/test-config-inheritance.test.ts` 用 **vitest 自己的 `createVitest()`**
    （`vitest/node`）把配置**解析**出来逐档核 —— 不自己写一份继承规则或 glob 引擎
    （#1509 的坑：手写 glob 引擎把 `src/components/ui` 误判成「已覆盖」，删完当场被
    `vitest list` 揭穿）。

## Tests

- **新增 `tests/test-config-inheritance.test.ts`（进 pre-commit C 组固定清单）**，判四件：
  1. **两档都拿到了**共享项（失效形态正是一档落后）；
  2. `environment` **按档分叉**、没被抬到根级（jsdom 档下跑纯逻辑**不报错、只是变慢**，
     静默的那一侧）；根级项按**白名单**判，新增一项先回答「它是不是共享项」；
  3. project 里**不再重复声明**共享项（同一件事两个来源）；
  4. 共享项**声明在根 `test` 上** —— 这条是变异核验逼出来的：把根上的 `globals: false`
     整行删掉，**解析结果一个字不变**（`configDefaults.globals` 本来就是 `false`），
     只按值判就等于允许它被顺手删掉。
  - **变异核验七条**（都当场红）：摘掉根 `setupFiles`（1 红）/ 根上加 `environment`（1 红）/
    jsdom 档写 `extends: false`（2 红）/ 某档重复声明 `globals`（1 红）/
    删根 `globals`（1 红，靠上面第 4 条）/ 删根 `maxWorkers`（2 红）/ 删根 `expect.poll`（1 红）。

## Docs

- 规范 11 **§11.17.3 从「三条实测出来的边界」改成四条**，第三条整段重写成上面那张对照表 +
  验收手法 + 两处「解析值判不出来」的口径；同节新增一条实测口径：
  **`clearMocks` 在 vitest 5 起默认开着，但别拿它当 `restoreAllMocks` 用** ——
  实测实现替换（`vi.spyOn(...).mockImplementation`）**跨用例留着**，还原它的是
  `restoreMocks` / `mockReset`。仓里 49 处 `vi.clearAllMocks()` 全在钩子里、与新默认重复，
  26 处 `vi.restoreAllMocks()` **不重复 / 是承重的**；**量完的处置是不动**（删那 49 处会把
  「复位了哪些东西」从钩子里挪到一个远处的配置值上，正是本仓库反复踩的「依赖隐式默认值 = 静默」）。
- `docs/guides/TESTING.md` 订正一处**比代码落后两轮**的段落：它还写着
  「为什么不用 `projects` 按目录分档 …… 当前全局 node + 逐文件 opt-in，维持」——
  分档那两轮（#1502 / #1509）已经做了，那段结论是上一轮的。改写成「分档做了、
  **没有**按目录一刀切（那会把 260 份 node 用例误升进 jsdom）」并指向 §11.17；
  同时补上「共享项写在根 `test`、别复制成两份」这一条。
