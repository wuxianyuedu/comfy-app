#!/usr/bin/env node
/**
 * affected-tests.mjs — 提交前的「改到哪、测到哪」增量测试层
 *
 * 干什么：读**暂存区**的改动清单，解析出「这批改动牵扯到哪些测试文件」，连同
 * **固定结构守护清单**一起打给 `vitest run` 的位置参数。`.githooks/pre-commit`
 * 的 C 组只调用它一次（规范 §13.5 的口径：需要 vite 的测试并入同一行
 * `vitest run`，别新起一次冷启）。
 *
 * 为什么要这一层：全量 437 个文件实测是十分钟量级（规范 §11.13 的三档对照），
 * 挂在每次提交上不可用；而「只跑固定几个结构守护」又漏掉改动的直接消费方 ——
 * 表现是提交时绿、下一次全量才红，红还归因不到人。这一层买的是
 * 「改的代码有对应用例时，那次提交就跑到它」。
 *
 * 判据（方向一律是「宁可多跑，不许漏跑」）：
 *   ① 改动的测试文件本身；
 *   ② 同名兄弟：改 `x.ts` → 跑 `x.test.ts`；改快照 `__snapshots__/x.test.tsx.snap`
 *      → 跑 `x.test.tsx`；
 *   ③ **反向 import 闭包**：谁 import 了改动文件、谁又 import 了那些文件……沿 import
 *      图走到测试为止（含 `~/` 与 `@/` 别名、相对说明符按**引用方位置**解析、目录
 *      import 命中 `dir/index.*` 的 barrel 转出口）。只看「谁直接 import」不够：
 *      视图层的常态是 `X.test → Panel → X.tsx`，只走一跳时改 `X.tsx` 会解析出
 *      「受影响 0 个用例」（实测撞到过），那这句承诺就是空话。
 *   ④ 改动路径以字面量出现在测试文本里：门禁用例用 `execFileSync` 起被测脚本、
 *      主题用例按路径读 CSS，这类消费不是 import，只有整串匹配抓得住。
 *      同族：改 `scripts/<name>.cjs|mjs|py` 时按名字配 `tests/<name>.test.ts`。
 *
 * ⚠️ 闭包只跟着**静态写出来的**说明符走，两类它抓不到：运行时拼出来的路径
 * （`import(base + name)`、`path.join(dir, …)`）、以及解析目录之外的消费方。
 * 遇到公共地基（`vitest.config.ts`、`tests/setup.ts`、`package.json` / lockfile、
 * `.githooks/**`）被改时明确**放弃收窄**：只跑固定清单，并把放弃的理由打到 stderr。
 * 放弃是被看见的，不是静默降级。
 *
 * 兜底**刻意不是跑全量**，拦路石是两条实测（不是「全量带基线红」—— 真断言红今天是 0，
 * 见规范 §11.13 的复核行）：① 全量在钩子那一档（`--maxWorkers=4`）要 **32m35s**
 * （560 files / 6887 passed 全绿），把它塞进 wide 提交等于每次动 lockfile 等半小时；
 * ② 这一层的正确形态是**只跑解析出来的那份清单**，wide 时「不带位置参数」被钩子刻意
 * 阻断（空参数 = 谁都没筛过，红也归不了因），而把全量清单拼进 argv 在 Windows 上还会撞
 * 命令行长度上限。⇒ 翻兜底的前置是先造一条**显式的全量通道**并接受那半小时，
 * 不是等基线红清零（那件事已经发生了）。规范 §13.5.8。
 *
 * 用法：
 *   node scripts/affected-tests.mjs                # 读暂存区（pre-commit 用）
 *   node scripts/affected-tests.mjs --changed a b  # 手工指定改动清单（调试用）
 *   node scripts/affected-tests.mjs --json         # 连命中原因一起打
 *   node scripts/affected-tests.mjs --fixed-only   # 只要固定清单
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { KNOWN_FAILED_FILES } from "./quality-gate-shared.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(HERE, "..");

/**
 * 固定结构守护清单：与本次改动无关、每次提交都要跑的那批。它们守的是**全库级**
 * 不变量（日志通道单点、容器单入口、core 主干单一来源、lib 的 Node-only 声明、
 * barrel 出口纪律、mock 目标存在性、仓储基类纯净、平台侧 CI 配置的在不在与规范
 * 口径一致）——这些不会因为「本次没改到」而变得安全。这一份是**唯一出处**，
 * 钩子不再自己抄一遍。
 */
export const FIXED_STRUCTURAL_TESTS = [
  "tests/a11y-axe-stories.test.ts",
  "tests/single-logger-channel.test.ts",
  "tests/container-single-access.test.ts",
  "tests/core-spine-single-source.test.ts",
  "tests/lib-node-only-declarations.test.ts",
  "tests/core-barrel-entry-discipline.test.ts",
  "tests/test-mock-targets.test.ts",
  "tests/repository-base-purity.test.ts",
  // 「平台侧没有自动兜底」这件事现在是文档口径 + 仓库现实两头都要对上：加回一份
  // `.cnb.yml` 不会让任何现有判据变红（规范 §13.5.3 的结论只写在正文里），而它一旦
  // 存在就会被读成「有 CI 兜底」——绿灯可信度的地基不能靠人记得住。
  "tests/no-platform-ci-config.test.ts",
  // 条件性 skip 的登记表：全绿里的 `N skipped` 不说明「绿的是哪一种」，尤其产物级探针
  // （没构建过的检出上整块不判）。这条守住「每个暗掉的站点都有人登记它为什么暗」。
  "tests/conditional-skip-registry.test.ts",
  // 本层自己的判据必须在**每一次**提交里跑：解析器一旦把「自己」算漏了，
  // 只有这一条能发现（它守的是「增量层还在增量」这件事本身）。
  "tests/affected-tests.test.ts",
  // 「拿正则断言源码形状」前要先剥注释 —— 这件事仓里已各自内联了 18 份（ISSUE #1192），
  // 而 §12.12 的孪生判据抓不到（每份都远小于 60 行）。台账双向都拦：新增一份 = 红，
  // 收敛掉一份却没收紧台账 = 红。它守的是「这张表还有没有记账能力」，与本次改动无关，
  // 所以必须进固定清单（只在受影响时才跑，等于让下一次复制悄悄过去）。
  "tests/strip-comments-single-source.test.ts",
  // 软断言的**使用面**（规范 §11.18）：`expect.soft` 只该用在「一张清单逐项判」的
  // 循环体里，落在循环外会把真正的原因吞掉（软断言失败后下一行照跑、抛 TypeError，
  // 报告里只剩那条 TypeError）。它同时是判据自己的门禁自测 —— 口径（同行循环、
  // 折行循环头、循环之后的语句）每一条都得有人钉住，而这些口径是「下一次新增
  // 一处软断言」时才走得进的路径，所以必须进固定清单（与本次改动无关也照跑）。
  "tests/soft-assertion-gate.test.ts",
  // 并发档位的**使用面**（规范 §11.19）：`it.concurrent` 不是免费的旋钮 ——
  // 同步阻塞的用例改它零收益（实测 7.75s → 7.75s），真起进程的用例改它要和
  // 真资源（临时目录 / 库 / 端口）的隔离一起改（实测红 2 条），而它与上一轮
  // 刚收口的 `expect.poll` **机制上互斥**（实测 20/20 红、次序反转 0/20 红）。
  // 它同时是判据自己的门禁自测 —— 三条口径（并发 × poll / 缺隔离声明 /
  // 折行站点）每一条都得有人钉住，而它们是「下一次有人想给用例加并发」时才
  // 走得进的路径，所以必须进固定清单（与本次改动无关也照跑）。
  "tests/test-concurrency-gate.test.ts",
  // 类型层断言（`expectTypeOf` / `assertType`）的**执行者在场**（规范 §11.20）：
  // 这两者在 vitest 里**没有牙**（实测 `expectTypeOf<string>().toEqualTypeOf<number>()`
  // 跑 `vitest run` 是 Tests 1 passed），唯一执行者是 `tsc --noEmit`，而 tsc 只按
  // `tsconfig.json` 的 include 面收文件。所以判据钉的是「站点落在 include 面里吗」——
  // 站点一旦出界，全仓断言**同时变装饰品且没有任何一处报错**（实测收窄 include 之后
  // tsc 与 vitest 双双报绿）。它同时是判据自己的门禁自测 —— 该放的（`.test-d.ts` /
  // 零站点 / 夹具字符串里）与该拦的（出界 / 折行站点 / 解析失败）每一条都得有人钉住，
  // 而它们是「下一次有人加类型层断言」时才走得进的路径，所以必须进固定清单。
  "tests/type-assertion-gate.test.ts",
  // `ctx.annotate` 的**消费方在场**（规范 §11.21）：它写下的注释只有失败时在 text
  // reporter 里可见，`--reporter=json` 的产物里一个字都没有，唯一读数通道是
  // programmatic API —— 所以「挂一把没人读的注释」比不写更坏（让人以为有人管）。
  // 判据因此只判一件事：有站点就必须登记消费方。它同时是判据自己的门禁自测 ——
  // 该放的（零站点 / 台账在场 / 夹具字符串里）与该拦的（台账缺 / 折行站点 /
  // 台账解析不了）每一条都得有人钉住，而它们是「下一次有人挂注释」时才走得进的路径，
  // 所以必须进固定清单（与本次改动无关也照跑）。
  "tests/annotate-consumer-gate.test.ts",
  // `ctx.task.meta` 写下的数据**有读的人在**（规范 §11.22）：它是相邻那两条里唯一
  // 能从 CLI 那侧读到的通道（实测自定义键原样落进 `--reporter=json` 的报告、绿的用例
  // 也带），但门禁链跑 vitest 没带 `--reporter=json` / `--outputFile` —— 写了没人读，
  // 数据落进空气而表面上像「已经登记了」。判据只判一件事：有站点就必须登记消费方。
  // 它同时是判据自己的门禁自测 —— 该放的（零站点 / 台账在场 / 无关的 meta 用法 /
  // 夹具字符串里）与该拦的（台账缺 / 折行站点 / 台账解析不了）每一条都得有人钉住，
  // 而它们是「下一次有人往报告里塞事实」时才走得进的路径，所以必须进固定清单。
  "tests/task-meta-consumer-gate.test.ts",
  // `test.todo` 的**消费方在场**（规范 §11.24）：它零成本、且没有任何东西在读它
  // （退出码 0，而门禁链只看退出码）—— 一条 todo 就是一份「这件事还没有人做」的
  // 声明挂在没人看的地方。它同时是判据自己的门禁自测 —— 该放的（零站点 / 台账在场 /
  // 夹具字符串里）与该拦的（台账空 / 台账缺 / 折行站点 / 台账解析不了 / `describe.todo`）
  // 每一条都得有人钉住，而它们是「下一次有人留一条还没做的用例」时才走得进的路径，
  // 所以必须进固定清单（与本次改动无关也照跑）。
  "tests/test-todo-gate.test.ts",
  // 测试层裸 sleep 的**使用面**（规范 §11.14）：它是「升级后把新写法当默认」这一档
  // 里唯一**没有执行者**的一条 —— §11.14 写的执行者是「review 拦下」，而上一轮清掉的
  // 6 个文件是抽样：同一个数在两次盘点里从 20 变成 38，不是「修完又长回来」，而是没有
  // 判据在数（同族先例：check-comment-language.cjs 自称在钩子里跑、实际一个执行者都没有）。
  // 它同时是判据自己的门禁自测 —— 该拦的（赌时间 / 空声明 / 棘轮上涨 / --update 放水）
  // 与该放的（声明豁免 / 折行站点 / 夹具字符串 / 没被 await 的 Promise / 声明作用半径）
  // 每一条都得有人钉住，而它们是「下一次有人在用例里等异步」时才走得进的路径，
  // 所以必须进固定清单（与本次改动无关也照跑）。
  "tests/test-sleep-gate.test.ts",
  // `waitFor` / `expect.poll` 的**边界**（规范 §11.14.3）：`check-test-sleep.cjs` 管住了
  // 裸 sleep 那一半，而更大量的一半（全仓 211 处 `await waitFor`）此前一条判据都不认识。
  // 判的不是「有没有 waitFor」（它没被废弃），是「两种正当形态之外都不许有」：
  // 等 DOM（jest-dom 匹配器与 expect.poll 类型不兼容）与假定时器窗口内，两者由判据
  // 自己认出来；其余一切等值的 `await waitFor` 都是越界。
  // 它同时是判据自己的门禁自测 —— 该拦的（等值）与该放的（等 DOM / 假定时器 / 本地同名
  // helper / 夹具文件）每一条都得有人钉住，都是「下一次有人写等待」时才走得进的路径，
  // 所以必须进固定清单（与本次改动无关也照跑）。
  "tests/test-waitfor-gate.test.ts",
  // 参数化用例 `it.for` ⇄ `it.each` 的存量棘轮（规范 §11.15）：§11.15 那句
  // 「本仓库已全部转换完」此前没有执行者，实测又长出 2 处 —— 同 check-test-sleep 的病。
  // 它同时是判据自己的门禁自测 —— 该拦的（`it.each` / `describe.each` / `test.each` /
  // `--update` 上涨）与该放的（棘轮内 / 本地同名 helper / 夹具字符串 / 夹具文件）
  // 每一条都得有人钉住，都是「下一次有人写参数化用例」时才走得进的路径，
  // 所以必须进固定清单（与本次改动无关也照跑）。
  "tests/test-it-each-gate.test.ts",
  "tests/form-field-wiring-gate.test.ts",
  // 配置的**共享项有没有真的落到两档上**（规范 §11.17.3）：这一档的口径在本仓库
  // 写反过一次（「`projects` 不继承声明方 `test` 的选项」），共享项因此被复制成
  // 两份 spread；本轮复现那次实测、订正口径并让共享项回到根 `test`。
  // 判据用 vitest 自己的 `createVitest()` 读**解析后**的配置逐档核 ——
  // 「口径改对了」不等于「以后不会写回去」，而这条判据的对象正是那一步。
  // 它同时钉住两件解析值判不出来的事（`globals: false` 删掉解析值不变、
  // `environment` 不许抬到根级），所以与本次暂存改动无关也照跑，进固定清单。
  "tests/test-config-inheritance.test.ts",
  // router 层的错误信封：裸 `throw new Error` 会被 tRPC 归成 INTERNAL_SERVER_ERROR，
  // 「越权与不存在同形」就只剩一句没有判据的话（台账 E8）。这条同时验 eslint 配置里
  // 那条 selector **真的会响** —— 「配置写在」与「配置在跑」是两件事（§11.7 同源），
  // 而它守的是「下一次新增一处就红」，与本次改动无关，所以进固定清单。
  "tests/router-error-envelope.test.ts",
  // 「挂载即欠执行者」：root.ts 每挂一条 procedure，就必须有测试真的调用它。
  // 这条判据的对象正是「router 挂了、接口能通、却从来没人跑过」这一族（台账 E3），
  // 而它守的是**下一次新增** —— 与本次暂存改动无关，只在受影响时才跑等于形同虚设。
  "tests/trpc-surface-executors.test.ts",
  // 产物布局的单一出处判据：`src/` 里出现第二处「产物根 / 产物地址 / 地址→磁盘」就红。
  // 这条守的是「同一句布局被抄七遍、其中两遍对同一个输入结论相反」那一族（台账 A8
  // 第二段：成片合成因此每条镜头必败），而它必须在**新增**时响 —— 与本次暂存改动
  // 有没有碰到 media/ 目录无关，所以进固定清单。
  "tests/artifact-layout-single-source.test.ts",
  // 客户端写的 REST 地址必须有落点：`src/**` 里以引号 / 反引号 / `}` 紧接 `/api/`
  // 的字面量，得能在 `src/app/**` 的目录形状里找到一个 route handler。这条守的是
  // 「路径写得很像真的、handler 根本不存在」那一族（台账 E3‴：三条实测 404，
  // 调用点一句 `catch {}` 就咽成空态，全仓库没有一条判据红过）—— 新增一条假地址
  // 与本次暂存改动无关也必须响，所以进固定清单。
  // ⚠️ `}` 那一档原本是整类语法豁免（理由是「前面是 `}` 的一定是 ComfyUI 的接口」），
  // 台账 E14 把它改成了默认判 + 按整条地址登记：`` `${base}/api/custom-nodes/manifest` ``
  // 也是 `}` 开头而它是同源地址，那条死地址就是从这格躲过去的。
  "tests/rest-endpoint-targets.test.ts",
  // 组件工作台的注入层（`.storybook/data-sources.tsx`）—— story 的**公共依赖**，
  // 而它守的那条口径（「不给数据依赖型组件 mock 假形态」）恰好最容易悄悄失效：
  // 往注册表里塞一份手写示例对象，所有依赖它的 story 一起变成「看着正常、真机上
  // 不对」，画布上完全看不出来。这条同时管点目录有没有进 tsc / eslint 的扫描面
  //（那是一个「写了没人看」的位置）—— 与本次暂存改动无关也必须响，故进固定清单。
  "tests/storybook-data-sources.test.ts",
  // 「调用点的形状错误不许被咽掉」（台账 F13）：`as never` 逐处登记 + 投影参数不许是
  // unknown + `.select(… as never)` 这个形状零存在。这一族的实际事故是 `train.cancel`
  // 数据层迁移之后每次 500 而零红 —— 新增一处就是重新装上那个消音器，
  // 与本次暂存改动无关也必须响，所以进固定清单。
  "tests/f13-projection-shapes.test.ts",
  // 「判据自己有没有执行者」：`doc:check` 接进 pre-commit D 组之后的在位判据。
  // 它必须进固定清单而不是只跟着改动走 —— 改 `.githooks/**` 会让本脚本**放弃收窄、
  // 只跑固定清单**（实测 `--changed .githooks/pre-commit` 的清单里不含任何按路径
  // 引用的用例），于是「有人把这一步摘回手动档」那次改动恰好不会跑到这条守卫，
  // 表现不是红而是「文档又开始说谎而全绿」。这一族是零执行者判据（规范 §13.5.8）。
  "tests/doc-check-hook-wiring.test.ts",
  // `docs/api/**` 生成物与源同步的判据（ISSUE #1329 收尾）。同上一族：这一步的
  // 触发面与三向比对都是**下一次新增/删模块**时才响的守卫，而它挂的那一步在钩子里
  // 带 `--staged`（改了 src/lib 才跑）—— 只跟着改动走的话，「有人把 --staged 抹掉、
  // 让它对每个提交重生成 31s」那次改动恰好落到 `.githooks/**` 上、本脚本放弃收窄，
  // 于是这条守卫不在清单里。表现是所有人被拖慢，然后开始 `--no-verify`。
  "tests/check-docs-api.test.ts",
  // 「页面内广播通道只剩一端」（台账 E9）：`AppEvents` 表里每一条都必须既有派发方
  // 又有订阅方。装机实测到三个死端（两条死监听 + 一条没人听的广播），它们的共同
  // 表现是「界面该刷新的时候没刷新」，而没有任何构建 / 测试会报它 ——
  // 与本次暂存改动无关也必须响，所以进固定清单。
  "tests/app-event-pairing.test.ts",
  // 门槛自己的启动面（C 组的 vitest 是怎么被起来的）：清单是位置参数，长度随改动面
  // 增长，一旦顶到平台命令行上限就会退化成「组 C 红、但一条用例都没跑、原因读不出」。
  // 这是「判据在场却零执行」的门禁静默失效，必须与本次暂存改动无关也必须响。
  "tests/hook-affected-launch.test.ts",
  // 「Storybook 基建的配置契约」：stories glob 写错、漏引 globals.css、漏主题装饰器、
  // 启动器漏 SKIP_ENV_VALIDATION —— 这四种错法**构建全都成功**（侧栏空着 / 裸 DOM /
  // 只有 dark 一态 / 崩在 env.js 却看不出是配置问题），没有任何构建期或运行期判据会红。
  // 与本次暂存改动无关也必须响（它是「下一次有人改配置」的守卫），所以进固定清单。
  "tests/storybook-config.test.ts",
  // 「故事文件的枚举来源」：`cva()` 返回的是函数、运行时没有 `.variants`，
  // 写成 `Object.keys(xVariants.variants.轴)` 时 tsc 会红，而 Storybook 的表现是
  // **加载期**抛 `Cannot read properties of undefined` —— 侧栏列着故事、画布一片
  // 空白，与「这个 story 挂了」的直觉对不上。配置契约那条（上面那份）对「故事
  // 文件自己怎么写」无感，这一条补的就是它。与本次暂存改动无关也必须响
  // （它是「下一次有人写故事」的守卫），所以进固定清单。
  "tests/storybook-cva-variant-source.test.ts",
  // 「组件覆盖率」：上面两条守的是**已经写下的 story 怎么写**，对「`ui/` 下大多
  // 数文件根本没有 story」天然无感 —— 于是「只有 3 个示例」这句话写进文档、
  // 过期了也没人知道（F6 的组件覆盖率那一格就是这么挂着的）。这条把事实变成
  // 可枚举的：现算「被 story import 的 `ui/` 组件」与基线比，只许升不许降，
  // 并核理由表（NO_STORY_REASON）与磁盘对得上。与本次暂存改动无关也必须响
  // （它是「下一次有人新增组件 / 删 story」的守卫），所以进固定清单。
  "tests/storybook-component-coverage.test.ts",
  // 「故事面」：title 缺了 Storybook 按路径自动生成条目（落在侧栏哪个分组取决于
  // 推导规则）、真组件没接上（画布上摆的是别的）、必填 props 没给 args（组件在
  // 画布上抛）、同目录两套分组前缀 —— 四种错法**构建全绿、画布也画得出来**，
  // 上面那三条 storybook 判据对它们都无感。与本次暂存改动无关也必须响
  // （它是「下一次有人写故事」的守卫），所以进固定清单。
  "tests/storybook-story-surface.test.ts",
  // 「三层注入层的接线」（store / React Flow / 整屏容器，ISSUE #1381 的第三批）：
  // 前三条 storybook 判据守的是「值源不许是假数据」「故事怎么写」「一个组件被
  // 看过了没有」，对「吃 store / 吃画布上下文 / 整屏容器」这三族天然无感 ——
  // 而它们的失效形态全都是「画布上照样有内容」（手捏条目、假 provider、
  // 占位子件），没有任何构建期或运行期判据会红。与本次暂存改动无关也必须响
  // （它是「下一次有人写这三族 story」的守卫），所以进固定清单。
  "tests/storybook-injection-layers.test.ts",
  // 「画布帧的视口口径」（装不下要显式认账）：框架是**一个常量**（560px），而节点
  // 渲染器的尺寸是消费方的事 —— 渲染器比框高、又没传 `fit` 时，钉住的视口会把内容
  // 切掉一截（实测 `fanOut` 切 151px、`twoNodes` 切 79px、`mixedKinds` 切 51px），
  // 而 tsc / eslint / 构建 / 上面那条注入层判据全绿、只有画布上少一块。它与「三层
  // 注入的接线」是两件事（那条判的是「给的是不是真的那一份」，这条判的是
  // 「装不装得下」），所以单独一份。与本次暂存改动无关也必须响（它是「下一次有人
  // 用自定义渲染器摆画布」的守卫），所以进固定清单。
  "tests/storybook-fit-viewport.test.ts",
  // 「消息中心注入层」（ISSUE #1381 的第四批）：`message-center/` 那两个组件的入参
  // 只有 `children`，数据**不经过 props**（住在 zustand store 里）—— 前几条 storybook
  // 判据对它们天然无感，而它们的失效形态全是「画布上照样有内容」：手捏 `MessageRecord[]`
  // 跳过 `push()` 的 id 生成与条数裁剪（那条 id 生成曾经就是「删一条把另一条一起删了」
  // 的根因）、只推消息不置 `open` 让面板 `return null`（同 §16.2.3.4 那个「侧栏有故事、
  // 画布一片空白」）、`allRead` 逐条写 `read: true` 摆末态而验不到动作本身。
  // 本批实测还抓到一处真缺陷（标记已读那颗按钮缺 `h-auto`，定高 32px 吞掉多段正文、
  // 溢出卡片下沿 39px）—— 那是这一类 story 的**直接产物**。与本次暂存改动无关也必须响
  // （它是「下一次有人写这一族 story」的守卫），所以进固定清单。
  "tests/storybook-message-center-sources.test.ts",
  // 「eslint 增量缓存的依赖指纹」：`--cache` 的缓存键不含依赖树，而 `no-unsafe-*`
  // 是类型化规则 —— 依赖一变旧判决被整片重放，假红拦死提交、假绿洗掉真违规
  // （ISSUE #1399）。它的执行者是 `postinstall` 那一步，而改 `.githooks/**` 会让
  // 本层**放弃收窄、只跑固定清单**；接线断掉的那一刻正是这条判据要拦的动作，
  // 所以必须与本次暂存改动无关也必须响。
  "tests/eslint-cache-fingerprint.test.ts",
  // 「类型程序里 import 了一份不入库的生成件」（台账 E15 / ISSUE #1409）：注入层要的
  // 应用 origin 按检出路径现算、整目录 gitignore，而 `.storybook` 那两条通配在 tsconfig
  // 的 include 里 —— 两份决定各自都对，叠起来是「没跑过 storybook 的检出 tsc 必红」
  //（而 tsc 正是钩子 A 组，于是一份落库时全绿的提交拦住了从它分出去的每一次提交）；
  // 且 `exclude` 治不了它（拦不住 import 目标）。这条判据钉的是「被引方不许静态 import
  // 生成件」+「缺件时 tsc 真退 0」+「生成件字段与入库缺省值对齐」，它同样挂在
  // `postinstall` 那一步，改 `.githooks/**` 时本层只跑固定清单，所以必须无条件响。
  "tests/storybook-tsc-input.test.ts",
  // 「设计契约与主题取值会不会各自漂移」（docs/DESIGN.md 的执行者）：`doc:check` 的
  // 遍历面是 `SCOPED_DOC_DIRS`，只含 `docs/standards` 与 `docs/guides` —— `docs/` 根级
  // 那份契约**不在任何判据的面上**，于是「改了 token 的名或值、忘了改文档」一条都不会红，
  // 表现是文档开始说谎而全绿（规范 §13.5.8 的零执行者那一族）。它守的是「下一次有人改
  // globals.css 或改这份文档」，与本次暂存改动无关也必须响，所以进固定清单。
  "tests/design-md-contract-sync.test.ts",
  // 「减弱动态效果的三档分治」（规范 06 §6.7 的执行者）：那条条文原先写的是「所有
  // transition/animation 都要降级」，而实测 `prefers-reduced-motion` 命中 0 次 ——
  // 强制条文挂着零执行者，表现是「规范说做了而全绿」。它读的是 `globals.css` 的
  // **文本**，import 图追不到（改 CSS 不会把它拉进受影响清单），所以与上面那条同因、
  // 必须无条件响；第 ④ 档还兼管「组件改了 data-slot 名字而降级块仍指旧名」那一类静默失效。
  // 本轮（ISSUE #1437）它多守两条**没命中也不会报错**的机制（规范 02 §2.7.2 /
  // 10 §10.3.2）：`.value-tick` 定义了没人用只是死 CSS；`[data-exit-reminder]` 的
  // 兄弟组合子若被改成祖先选择器（读起来更合理），提醒就**永远不亮**而样式表里
  // 那条规则照旧「有定义」—— 两处都只在 CSS 与消费点的文本上，import 图同样追不到。
  "tests/reduced-motion-tiers.test.ts",
  // 「内嵌字体这条链有没有静默降级」：LFS 过滤器、`.githooks/pre-push`、postinstall
  // 里那步 `git lfs install --local --manual`、`@font-face` 的 family 与
  // `--font-title` 首选是否同名 —— 四环每一环失效都**不报错**，最坏的一种是
  // `*.ttf` 按原字节进历史（23 MB 摘不干净，只能重写共享远端）。它读的是配置文件
  // 与 index 形状，import 图一概追不到，所以与上面两条同因、必须无条件响。
  "tests/embedded-title-font.test.ts",
  // 「判据有没有执行者」这条纪律自己的执行者（ISSUE #1451 要求 2 / 规范 §13.5.12）。
  // 它必须进固定清单：与 `tests/doc-check-hook-wiring.test.ts` 同因 —— 改 `.githooks/**`
  // 会让本层放弃收窄、只跑固定清单，而「有人把 D 组那两步摘掉」与「有人新增一个
  // 无执行者的判定型脚本」这两次改动恰好都落在那一档上，跟着改动走等于专挑它不在
  // 的时机跑。它读的是 `.githooks/pre-commit` 与 `scripts/` 两份文本，import 图追不到。
  "tests/gate-executors.test.ts",
  // canonical / spacing 两份棘轮基线的形状守卫（ISSUE #1451 要求 2）：两处都
  // `total: 0`，它们是「零候选起步、只许新增就红」的语义载体 —— 有人为了让
  // `--check` 变绿去放宽基线（把 total 抬高）正是这一族要拦的动作，而它不在
  // 任何钩子步骤的 import 面上。与本次暂存改动无关也必须响，所以进固定清单。
  "tests/tw4-canonical-ratchet.test.ts",
  // 「用例的环境档」那两条判据（§11.17）的契约测试。它们守的是**下一次有人写用例**：
  // 「环境早退」是「绿有两种含义」里坏的那一种（用例报绿、一条断言都没跑），
  // 而它与某一次具体改动无关 —— 只在被改到时才跑等于专挑它不在的时机跑。
  // 同因：改 `.githooks/**` 会让本层放弃收窄、只跑固定清单。
  "tests/test-environment-gate.test.ts",
  // 「全量 e2e 也有主」（ISSUE #1545 / #1547）：`pnpm test:e2e` 此前是「人记得就跑」——
  // 实测的形态是没人在跑。现在它走 `scripts/e2e-run.mjs`，跑绿即记一条账；这条判据钉的是
  // 记账语义、几条账不接错、以及钩子那一步真判了它。
  // 它读的是 `scripts/e2e-run.mjs` / `scripts/freshness-ledger.mjs` 与两处接线文本，
  // import 图追不到，故进固定清单（与本次暂存改动无关也必须响）。
  "tests/e2e-run.test.ts",
  // 「每天首次自证」从一档扩到三档（ISSUE #1282 的续）：平台流水线删掉（ISSUE #623）之后，
  // **全量单测 + 覆盖率**与**产物级护栏（build + 数产物）**是两条一直没有执行者的判定档
  // （§13.5.3 的欠账表里只写着「按需手动跑」，而那句话没有任何东西在守）。它们被接进同一份
  // 判决里（`FRESHNESS_TRACKS` 的 `daily` / `dirty` 两栏），判据是「**改了就当天跑**」而不是
  // 「每天一次仪式」—— 十分钟量级的两档没必要每天都跑。
  // 这条判据读的是 `scripts/full-suite-run.mjs` / `scripts/artifact-run.mjs` /
  // `scripts/daily-run.mjs` 与钩子接线文本，import 图追不到，故进固定清单。
  "tests/daily-tracks.test.ts",
  // 「声明 ⇄ 读者」索引的契约测试（规范 §11.23）：本仓库的声明机制是一个一个事故里
  // 长出来的，每一种自带台账与判据，而没有任何一处说得出「一共有哪些声明、各自的读者
  // 是谁」。这一步把 scripts/.declaration-readers.json 当索引核（读者存在 + 执行者在
  // 门禁链里），它的判定口径（读者丢了 / 钩子步骤被摘掉 / 用例离开固定清单 / 索引静默
  // 降级 / 字段不全 / id 重复）都是「下一次有人加一种新声明机制」时才走得进的路径 ——
  // 只在被改到时才跑，等于专挑它不在的时机跑，故进固定清单。
  "tests/declaration-readers-gate.test.ts",
  // 门禁自测**别再手搓临时仓库样板**（规范 §11.16.1）：60 余份门禁自测判的是同一件事
  // （把 scripts/ 下的判据脚本当黑盒，在只放被测文件的临时仓库里跑一次），此前每份都
  // 手抄一遍 mkdtemp + workdir + 自己写的 run(args) + afterEach rmSync。这套四件套已收进
  // `tests/helpers/gate-repo.ts`，但**收口本身没有判据** —— 下一个人再写一份时，模板就在
  // 隔壁文件里、抄一遍照样全绿，而抄错的形态是静默的（少写 cwd / status 当 1 兜底 /
  // 忘了 stdio: pipe）。
  // 它同时是判据自己的门禁自测 —— 该拦的（手搓样板 / 棘轮上涨 / --update 放水）与该放的
  // （用了共享夹具 / 只造临时目录 / 拉别的可执行文件 / 夹具文件）每一条都得有人钉住，
  // 而它们是「下一次有人写门禁自测」时才走得进的路径，所以必须进固定清单。
  "tests/gate-repo-boilerplate-gate.test.ts",
  // 「`@theme` 声明的 token 清单」那份**文件快照**（规范 §11.9.1 / #1490 落地）：
  // `toMatchFileSnapshot` 把清单写成一份能独立打开、能单独 diff 的真文件，
  // 而它与源码之间的同步**没有任何机器判据** —— 它自己那条用例读的是
  // `src/app/globals.css` 的**文本**（正则扫 `@theme` 块），CSS 不在 import 图上，
  // 所以「改了 globals.css 而不带它」正好是它不在的时机。
  // 实测（本轮）：#1558 往 `@theme` 加了一颗 `--gradient-brand`（品牌渐变收成 token），
  // 基线没同批更新，这条红**直接落进 master 并留了一周**，期间从它分出去的每一次提交
  // 都带着它 —— 表现不是「某处坏了」，而是「一份人工 review 的产物与源码已经不一致，
  // 没有任何人被告知」。同因（读文本、import 图追不到、与本次改动无关也必须响），
  // 故进固定清单。
  "tests/theme-tokens-compile-source.test.ts",
  // 「jsx-a11y 的规则开关 ⇄ 判据」（规范 06 §6.12）：这个插件装着 39 条规则、
  // 而 `eslint-config-next` 只启用 6 条 —— 「半开」这件事此前没有任何东西在数
  //（`grep -c jsx-a11y eslint.config.js` 是 0，配置在 next 里）。本判据四向核：
  // 官方 recommended 集合全开、本仓与官方默认的每一处不同都在台账里登记、
  // 官方两份配置谁都没提到又未废弃的规则必须有一笔裁决、台账双向拦。
  // 它同时是判据自己的门禁自测 —— 该拦的（悄悄关掉一条、登记了却没关、
  // 登记不存在的规则、缺理由 / 缺 keeper、豁免指向不存在的文件、没人决定过的
  // 规则）与该放的（`--report` 恒 0）每一条都得有人钉住。改 `.githooks/**` 会让本层放弃收窄、
  // 只跑固定清单，而「有人偷偷关掉一条 a11y 规则」正是这类动作，故进固定清单。
  "tests/a11y-rules-gate.test.ts",
  // 同一判据的**加载与入口**那一半（#1623）：`a11y-rules-gate` 现在共进程判十来份
  // 台账（配置只求值一次），于是「判据怎么被加载起来」这件事必须有另一份判据守着 ——
  // 真加载只求值一次、每个导出都可调用、失败路径不吞、bin 形态的 `--report` 仍退 0。
  // 它同时是 `tests/helpers/a11y-effective-config.coverage.test.ts` 那份
  // 覆盖度账本的执行者（零消费导出 / 两个清单逐字同源）。
  "tests/check-a11y-rules.test.ts",
  "tests/helpers/a11y-effective-config.coverage.test.ts",
  // 「被门禁拦下先复算 master 基线」的执行者（规范 §13.6.2 第 1 步）：那段
  // `git worktree add ../.wt-base-check … && node scripts/check-*.cjs … && git worktree
  // remove` 此前只写在文档与注释里，于是「这一条本身还没有机器判据」是 §13.6.2 自己的
  // 原话。现在它是 `scripts/base-check.mjs` 的一条命令，判的是**可归因的事实**
  // （别线的红 / 你的红 / 无从复算 / 没跑起来 / 负载假红），而每一态的下一动作
  // 完全不同 —— 所以每一条都得有人钉住。其中「没跑起来」本身有**两条入口**
  // （退出码 127，与「一条用例都没收集到」—— 后者的退出码是 1，与「跑了且红」同形，
  // 只有输出里的指纹分得开，ISSUE #1652），两向都得钉：真红不许被吞成 inconclusive。
  // 它守的是「下一次有人被拦下时，那条纪律还在不在」，
  // 与本次暂存改动无关，进固定清单。
  "tests/base-check.test.ts",
  // 「不进钩子」的按需档 ⇄ 执行者的双向判据（规范 §13.5.4）：判据「不进钩子」是代价
  // 判据，它不回答「那谁在什么时候跑它」—— 上一轮把五条都补上了执行者，但补的是**散文**
  // （写进文档的表格不会自己响）。这条把那张表机器化：新增一个新鲜度档却忘了登记
  // ⇒ 那一档**谁都不判**（§13.5.12 的立案现场）。它同时是判据自己的门禁自测 ——
  // 双向（过期承诺 / 未登记）+ 判据自己不许静默降级（索引不存在 / 非法 JSON / 空 /
  // 低于地板 / 缺字段）每一档都得有人钉住，都是「下一次新增一条按需档」时才走得进的
  // 路径，所以必须进固定清单（与本次改动无关也照跑）。
  "tests/on-demand-duties-gate.test.ts",
  // 「前端响应镜像 ↔ 线上真实列」的契约（台账 E4 第一格）：镜像声明的每一列线上必须
  // 真的在发。交叉类型 `RouterOutputs[...] & { images?: … }` 补出来的字段，tsc 只查它
  // 存在、永远查不出服务端没发它 —— 于是那句读取恒为 `undefined`，而类型上是 optional
  // 连可选链都不会红，表现是界面上那一格永远空着而全绿（视频队列的封面与下载入口就是这么挂的）。
  // 它守的是「下一次任一侧改动」，而改 `task.list` 的 mapper 只会被 router 自己的用例拉进
  // C 组 —— 契约这一侧必须无条件响，所以进固定清单。
  "tests/task-list-wire-contract.test.ts",
  // 「全局 setup 里的 RTL 逐用例卸载真的注册上了吗」（ISSUE #1282 本轮 / §12.18）：
  // 这行注册在本仓库**长期是死的** —— `@testing-library/react` 只在
  // `typeof afterEach === "function"` 时注册自动清理，而本仓库 `globals: false`
  // ⇒ 那行 `if` 从不成立。后果是被打的不是任何一条断言，而是全量跑的
  // **unhandled error**（React scheduler 的活在 jsdom 环境拆掉后落地 ⇒
  // `window is not defined`）把退出码打非零 —— 现场读起来像「某份用例红了」，
  // 其实用例全绿，正是「红指向的东西不是判据」那一族。
  // 它同时是判据自己的门禁自测：本判据**真起一份探针用例**去跑（「setup 文件里
  // 出现过 cleanup」与「清理真的注册上了」是两件事，前者在把注册挪进永远不执行的
  // 分支里时照样为真），而它的输入是 `tests/setup.ts` / `vitest.config.ts` 两份
  // 文本 + 一次子进程，import 图一概追不到 —— 与本次暂存改动无关也必须响，
  // 故进固定清单。
  "tests/global-setup-cleanup.test.ts",
  // 「合并提交必须双亲」这条门槛的在位判据（ISSUE #1594 / 规范 §13.6.1）。
  // 它同时是判据自己的门禁自测（真仓库跑拓扑：普通提交放行 / 真合并放行 /
  // 声明是合并但单亲阻断 / `--amend` 一个合并提交放行 / 正文提到 Merge 不算声明 /
  // 非 git 目录放行）。必须进固定清单，理由与上面两条同：**改 `.githooks/**` 会让
  // 本层放弃收窄、只跑固定清单**，而「有人把 `.githooks/prepare-commit-msg` 摘掉 /
  // 少传 `$1` `$2`」那次改动恰好落在那一档上 —— 跟着改动走等于专挑它不在的时机跑，
  // 表现不是红而是「那条纪律又回到只写在文档里」。它读的是钩子文本 + git 拓扑，
  // import 图一概追不到。
  "tests/check-merge-parents.test.ts",
  // 「类型层声明 ⇄ 执行者」（ISSUE #1591 / 规范 §13.5.14）：19 条 tsc 错落进 `master`
  // 的共同根因是「声明（JSDoc / 类型注解）落后于实现」，而 `tsc` 那条判据缺的是
  // 「什么时候被敲」。这条把 `scripts/.tsc-diagnostic-executors.json` 当台账核：
  // 执行者在场 + 与姊妹索引逐行同源 + **声明行计数零增量**。
  // 它同时是判据自己的门禁自测（该拦的「涨了 / 落点没了 / 两处 reader 不一致 /
  // 空表 / 对侧读不到」与该放的「降了只提示 / --update 只许降」每一条都得有人钉住），
  // 而这些都是「下一次有人写一处新声明」时才走得进的路径 —— 跟着改动走等于专挑它
  // 不在的时机跑。它读的是两份台账 + 目录扫描，import 图一概追不到，故进固定清单。
  "tests/tsc-diagnostic-executors.test.ts",
  // 「提交信息里的声明 ⇄ 事实」（ISSUE #1605 / 规范 §11.23）：`ad81a912` 那次 squash
  // 的提交信息自称「§13.5.13 / §13.6.3 两节照旧保留」，而两节一次都不出现 —— 62 份
  // 文件被退回。这一族的执行者是 `--base` 那条链（`pnpm check:base:batch`，本地钩子
  // **天然看不到**：丢失发生在平台侧 squash 那一刻），而这条用例守的是**口径**：
  // 三种句式各拦什么 / 窗口只许连接物（第一版自由窗口在真历史上 8 处误报）/
  // 「只扫改动文件」与 `ls-tree` 的路径转义各是一处**静默少查**（实测各贡献 2 处假红）。
  // 这些都是「下一次有人想加一种句式」时才走得进的路径，跟着改动走等于专挑它不在的
  // 时机跑；它读的是真 git 历史，import 图追不到，故进固定清单。
  "tests/check-commit-claims.test.ts",
  // 棘轮的 `--update` 拒涨（规范 §11.25 / 台账 E5）：24 个「带 --update 且把基线写回去」
  // 的判据脚本里，实测有**七家的拒涨那一支从来没生效**，且失效写法有三种 ——
  // UPDATE 分支无条件写基线（dead-exports / circular-deps / comment-language /
  // tw4-canonical / tw4-spacing）、
  // 判断用的 `prev` 在 `--update` 之路上恒为 null（theme-colors，那一支是死代码）、
  // `if (before && …)` 在**已经清到 0 的基线**上整个短路（theme-colors / overlay-z，
  // 而今天四家的基线正是 0 处）—— 它们的 `note` 里都逐字写着「只许降不许升」。
  // 这条必须在**每一次**提交里跑，两个理由都不容让步：① 它读的是 `scripts/` 下脚本的
  // **行为**，import 图一概追不到（改判据脚本不会把它带进受影响集）；② 它同时是
  // 判据自己的门禁自测 —— 「新增一个带 --update 的判据却没有归类」「某一家的拒涨被摘掉」
  // 都只在新增那一次才拦得住，而新增脚本的人不会想到去跑一个名字不相干的测试文件。
  // 实测成本：13 家 × 两格 + 6 格完整性 = 32 格约 60s（每格建沙箱、跑两到三次判据、
  // 比对基线字节；其中 tw4-canonical 每次要起 Tailwind 引擎，单家就占 35s，
  // 所以那一行按实测登记了 120s 预算）。
  "tests/ratchet-update-guards.test.ts",
  // 「一屏一个名字」（ISSUE #1423 / 规范 16 §16.2.4.73）：页头标题、侧栏项、页签
  // 三处说的必须是同一个名字 —— 而它在代码里的失效形态**没有任何构建期或运行期
  // 判据会红**：屏名被抄成视图里的裸字面量时，tsc / eslint / 渲染用例 / P83
  // （只管字阶档）全绿，屏上只是多出第二个名字、标题区再吃掉一行。同一条账的
  // 另一半（文案是否同义反复）只能靠 review，机器守住的是**形态**：页头走同一个
  // 基元、`viewLabel` 不许只是 `label` 的同义扩写、标题里不许连写两个屏名。
  // 它读的是源码 + 注册表，import 图追不到（改一个视图的标题不会把这条带进
  // 受影响集）—— 跟改动走等于专挑它不在的时机跑，故进固定清单。
  "tests/page-name-single-source.test.ts",
];

/** @typedef {{test: (rel: string) => boolean, why: string}} WideTrigger */
/** @typedef {{mode: "subset" | "all", tests: string[], reasons: Record<string, string>}} Resolution */

const WIDE_REASON = {
  config: "全局测试配置（预算 / include / setupFiles）",
  setup: "每条用例的 setupFiles",
  deps: "依赖与脚本面，任何用例都可能受影响",
  types: "全局类型口径",
  hooks: "门槛自身",
};

/**
 * 改了这些就无所谓「收窄」：它们被每一条用例隐式消费，而这件事不出现在任何
 * import 语句里。命中即放弃收窄并说明原因。
 * @type {WideTrigger[]}
 */
const WIDE_TRIGGERS = [
  { test: (p) => p === "vitest.config.ts", why: WIDE_REASON.config },
  { test: (p) => p === "tests/setup.ts", why: WIDE_REASON.setup },
  {
    test: (p) =>
      p === "package.json" ||
      p === "pnpm-lock.yaml" ||
      p === "pnpm-workspace.yaml",
    why: WIDE_REASON.deps,
  },
  { test: (p) => p === "tsconfig.json", why: WIDE_REASON.types },
  { test: (p) => p.startsWith(".githooks/"), why: WIDE_REASON.hooks },
];

/**
 * 与 `vitest.config.ts` 的 `include` 同一口径；漂移由 `tests/affected-tests.test.ts` 盯着。
 * @param {string} rel
 * @returns {boolean}
 */
export function isTestPath(rel) {
  return (
    (rel.startsWith("src/") || rel.startsWith("tests/")) &&
    /\.test\.tsx?$/.test(rel)
  );
}

/** import 说明符不带扩展名，按候选逐个试（含目录形式的 barrel）。 */
const EXT_CANDIDATES = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".js",
  ".jsx",
  ".mjs",
  ".json",
  "/index.ts",
  "/index.tsx",
  "/index.mjs",
];

/**
 * 把一条 import 说明符解析成仓库内相对路径的候选集合。
 * 别名 `~/` `@/` → `src/`；相对路径按**引用方所在文件**解析；裸包名返回空。
 * @param {string} spec
 * @param {string} fromFile
 * @returns {string[]}
 */
export function specCandidates(spec, fromFile) {
  const clean = spec.split("?")[0];
  if (!clean) return [];
  let base;
  if (clean === "~" || clean === "@") base = "src";
  else if (clean.startsWith("~/") || clean.startsWith("@/"))
    base = "src/" + clean.slice(2);
  else if (clean.startsWith("./") || clean.startsWith("../")) {
    const fromDir = fromFile ? path.posix.dirname(fromFile) : ".";
    base = path.posix.normalize(path.posix.join(fromDir, clean));
  } else return [];
  return EXT_CANDIDATES.map((ext) => base + ext);
}

/** 说明符抽取：`from` / `import` / `require` / `vi.mock` / `jest.mock` 后的字符串字面量。
 *  可选左括号让动态 `import("x")` 与 `require("x")` 也走同一条。 */
const SPEC_RE =
  /(?:\bfrom|\bimport|\brequire|vi\.mock|jest\.mock)\s*\(?\s*["']([^"'\n]+)["']/g;

/**
 * 一份源码静态引用到的模块（候选路径集合，含 barrel 的 `dir/index.*` 形态）。
 * @param {string} text
 * @param {string} fromFile
 * @returns {Set<string>}
 */
function specifiersOf(text, fromFile) {
  const out = new Set();
  for (const m of text.matchAll(SPEC_RE)) {
    const spec = m[1];
    if (!spec) continue;
    for (const cand of specCandidates(spec, fromFile)) out.add(cand);
  }
  return out;
}

/**
 * @param {string} rel
 * @returns {string | null}
 */
function wideReasonFor(rel) {
  const hit = WIDE_TRIGGERS.find((t) => t.test(rel));
  return hit ? hit.why : null;
}

/**
 * 核心解析：改动清单 + 测试清单 +（注入的）读文件函数 → 该跑哪些测试。
 * 不碰 git、不碰真实磁盘，便于用例喂夹具。
 *
 * @param {{changedPaths: string[], testFiles: string[], sourceFiles: string[], readText: (rel: string) => string | null, knownFailed?: string[]}} input
 * @returns {Resolution}
 */
export function resolveAffectedTests({
  changedPaths,
  testFiles,
  sourceFiles,
  readText,
  knownFailed = [],
}) {
  /** @type {Record<string, string>} */
  const reasons = {};
  const picked = new Set();
  /**
   * @param {string} rel
   * @param {string} why
   */
  const add = (rel, why) => {
    if (!testFiles.includes(rel)) return;
    picked.add(rel);
    reasons[rel] = reasons[rel] ? `${reasons[rel]} + ${why}` : why;
  };
  /**
   * 固定清单永远并入 —— 空集是最危险的形态：`vitest run` 不带位置参数就是跑全量。
   * @param {"subset" | "all"} mode
   * @param {Iterable<string>} extra
   * @param {string} [note]
   * @returns {Resolution}
   */
  const withFixed = (mode, extra, note) => ({
    mode,
    tests: [...new Set([...FIXED_STRUCTURAL_TESTS, ...extra])].sort(),
    reasons: note ? { __note: note } : reasons,
  });

  const changed = new Set();
  /** @type {string[]} */
  const wide = [];
  for (const raw of changedPaths) {
    const rel = String(raw).trim().replace(/\\/g, "/");
    if (!rel) continue;
    const why = wideReasonFor(rel);
    if (why) wide.push(`${rel} —— ${why}`);
    changed.add(rel);
  }
  if (wide.length > 0) return withFixed("all", [], wide.join(" / "));

  const list = [...changed];
  for (const rel of list) {
    if (isTestPath(rel)) {
      add(rel, "自身");
    } else {
      // 兄弟测试：`x.ts` ⇄ `x.test.ts(x)`。必须先剥掉源码自己的扩展名，
      // 否则 `x.tsx` 会拼成 `x.tsx.test.ts` 这种查无此文件的名字。
      const stem = rel.replace(/\.(ts|tsx|mts|js|jsx|mjs)$/, "");
      if (stem !== rel) {
        add(stem + ".test.ts", "兄弟测试");
        add(stem + ".test.tsx", "兄弟测试");
      }
    }
    // 快照文件按其宿主测试算。
    if (rel.endsWith(".snap")) {
      const dir = path.posix.dirname(rel);
      if (path.posix.basename(dir) === "__snapshots__")
        add(
          path.posix.join(
            path.posix.dirname(dir),
            path.posix.basename(rel, ".snap"),
          ),
          "快照宿主",
        );
    }
    // 门禁脚本按名字配它的回归测试。
    const script = /^scripts\/(.+)\.(?:cjs|mjs|py)$/.exec(rel);
    if (script) {
      add(`tests/${script[1]}.test.ts`, "脚本同名回归");
      add(`tests/${script[1]}.test.tsx`, "脚本同名回归");
    }
  }

  /* ── ③ 反向 import 闭包 ────────────────────────────────────────────────
   * `importedBy` 按**候选路径**建键（不按「文件是否存在」过滤）：被删掉或改名的
   * 文件已经不在索引清单里，但它的消费方仍然静态写着那个说明符 —— 那些测试正是
   * 这次改动会打破的东西，按存在性过滤就会把它们连同改动一起漏掉。
   * 成本：读 1.2k 个源码文件 + 6.4k 条说明符，实测 <1s。 */
  const nodes = new Set([...sourceFiles, ...testFiles]);
  /** @type {Map<string, Set<string>>} */
  const importedBy = new Map();
  /** @type {Map<string, string>} */
  const texts = new Map();
  for (const from of nodes) {
    const text = readText(from);
    if (text === null || text === undefined) continue;
    texts.set(from, text);
    for (const cand of specifiersOf(text, from)) {
      let bucket = importedBy.get(cand);
      if (!bucket) importedBy.set(cand, (bucket = new Set()));
      bucket.add(from);
    }
  }

  /** @type {Map<string, number>} */
  const hops = new Map();
  const queue = [];
  for (const rel of list) {
    hops.set(rel, 0);
    queue.push(rel);
  }
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === undefined) continue;
    const hop = (hops.get(cur) ?? 0) + 1;
    for (const consumer of importedBy.get(cur) ?? []) {
      if (hops.has(consumer)) continue;
      hops.set(consumer, hop);
      queue.push(consumer);
    }
  }
  for (const [file, hop] of hops) {
    if (hop > 0 && isTestPath(file)) add(file, `反向 import ${hop} 跳`);
  }

  /* ── ④ 路径以字面量被引用（闭包抓不到的那类消费）──────────────────────── */
  for (const testFile of testFiles) {
    if (picked.has(testFile)) continue;
    const text = texts.get(testFile);
    if (text === undefined) continue;
    for (const rel of list) {
      if (rel !== testFile && text.includes(rel)) {
        add(testFile, "按路径引用");
        break;
      }
    }
  }

  /* 已知基线红（`KNOWN_FAILED_FILES` 单点定义，与 `run-tests.mjs` / 一键门禁同一份）：
   * 从**增量**面里剔掉，否则别线的红会让无关提交落不了地。固定清单不受影响 ——
   * 那几条是全库不变量的执行者，没有「先放行」的余地。剔除是被打印出来的，不是静默。 */
  const skipped = [...picked].filter((t) => knownFailed.includes(t));
  for (const t of skipped) picked.delete(t);

  const out = withFixed("subset", picked);
  if (skipped.length > 0) out.reasons.__skipped = skipped.join(" ");
  return out;
}

/* ── 以下是与 git / 真实磁盘打交道的部分（用例不覆盖这一段，纯转调）─────── */

/**
 * @param {string[]} args
 * @returns {string | null}
 */
function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 << 20,
    });
  } catch (err) {
    process.stderr.write(
      `[affected] git ${args.join(" ")} 失败：${err instanceof Error ? err.message : String(err)}\n`,
    );
    return null;
  }
}

/**
 * 暂存区改动。`--diff-filter` 保留 D：删掉的文件要去匹配「谁 import 了它」。
 * @returns {string[] | null}
 */
function stagedPaths() {
  const out = git(["diff", "--cached", "--name-only", "--diff-filter=ACMRD"]);
  if (out === null) return null;
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 参与 import 图的文件目录与扩展名：闭包要能穿过 `scripts/` 里的门禁脚本。 */
const SOURCE_DIRS = ["src/", "tests/", "scripts/", "tools/"];
const SOURCE_EXT_RE = /\.(ts|tsx|mts|js|jsx|mjs|cjs)$/;

/**
 * 一个 tracked 路径是否进 import 图（`.d.ts` 是纯声明，不做节点）。
 * @param {string} rel
 * @returns {boolean}
 */
export function isSourcePath(rel) {
  return (
    SOURCE_DIRS.some((dir) => rel.startsWith(dir)) &&
    SOURCE_EXT_RE.test(rel) &&
    !rel.endsWith(".d.ts")
  );
}

/**
 * `git ls-files` 走索引、不扫盘：未跟踪的临时文件不该进图。
 * @returns {string[] | null}
 */
function trackedPaths() {
  const out = git(["ls-files"]);
  if (out === null) return null;
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @param {string} rel
 * @returns {string | null}
 */
function readText(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), "utf8");
  } catch {
    return null;
  }
}

/**
 * 一次 `git ls-files` 出两份清单：测试（输出的候选）与 import 图的节点。
 * @returns {{testFiles: string[], sourceFiles: string[]} | null}
 */
function collectInputs() {
  const tracked = trackedPaths();
  if (tracked === null) return null;
  return {
    testFiles: tracked.filter(isTestPath),
    sourceFiles: tracked.filter(isSourcePath),
  };
}

/**
 * wide（放弃收窄）那一档打印给提交者看的话术。
 *
 * 为什么要单独成函数、并让用例钉住文本：这句话过去写的是「全量当前带别线基线红」，
 * 那是**假前提**（ISSUE #1393 在 master `9392a88f` 上重测：真断言红 0 条、
 * `KNOWN_FAILED_FILES` 是空数组；`--maxWorkers=4` 全量 560 files 全绿）。
 * 假理由每遇到一次 wide 提交就当着所有人的面重印一遍，久而久之就成了「谁也不去翻兜底」的
 * 默认解释 —— 所以它跟判据一样需要执行者，不能只改一次文本。规范 §13.5.8 / §11.13。
 * @param {string} note 放弃收窄的原因（哪个公共地基被改了）
 * @param {number} count 固定清单里的用例文件数
 */
export function wideFallbackNote(note, count) {
  return (
    `[affected] 放弃收窄（${note}）→ 只跑固定清单 ${count} 个。` +
    "兜底不是全量：wide 这一档跑全量实测要 32m35s，而钩子刻意不接受「空参数=全跑」" +
    "这种没人筛过的形态（真断言红已经是 0，不是挡路的那件事）。" +
    "要按名字跑全量（显式档，不受这条限制）：" +
    "`node scripts/run-affected-tests.mjs --full`。规范 §13.5.8 / §11.13\n"
  );
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--fixed-only")) {
    process.stdout.write(FIXED_STRUCTURAL_TESTS.join(" ") + "\n");
    return 0;
  }
  const ci = argv.indexOf("--changed");
  const changed =
    ci >= 0
      ? argv.slice(ci + 1).filter((a) => !a.startsWith("--"))
      : (stagedPaths() ?? []);
  const inputs = collectInputs();
  /** @type {Resolution} */
  const res =
    inputs === null
      ? {
          mode: "all",
          tests: [...FIXED_STRUCTURAL_TESTS].sort(),
          reasons: { __note: "读不到测试清单（git ls-files 失败）" },
        }
      : resolveAffectedTests({
          changedPaths: changed,
          testFiles: inputs.testFiles,
          sourceFiles: inputs.sourceFiles,
          readText,
          knownFailed: KNOWN_FAILED_FILES,
        });

  const extra = res.tests.filter((t) => !FIXED_STRUCTURAL_TESTS.includes(t));
  if (res.mode === "all") {
    process.stderr.write(
      wideFallbackNote(res.reasons.__note ?? "见 --json", res.tests.length),
    );
  } else {
    process.stderr.write(
      `[affected] 暂存 ${changed.length} 个文件 → 跑 ${res.tests.length} 个测试` +
        `（固定 ${FIXED_STRUCTURAL_TESTS.length} + 受影响 ${extra.length}）\n`,
    );
  }
  if (res.reasons.__skipped) {
    process.stderr.write(
      `[affected] 跳过已知基线红 ${res.reasons.__skipped.split(" ").length} 个` +
        `（${res.reasons.__skipped}）—— 清单在 scripts/quality-gate-shared.mjs，` +
        "修好后立刻删，别让它长期静默\n",
    );
  }
  // 空集绝不允许：`vitest run` 不带位置参数就是跑全量。
  const tests = res.tests.length > 0 ? res.tests : [...FIXED_STRUCTURAL_TESTS];
  process.stdout.write(
    argv.includes("--json")
      ? JSON.stringify({ ...res, tests }, null, 2) + "\n"
      : tests.join(" ") + "\n",
  );
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  process.exit(main());
}
