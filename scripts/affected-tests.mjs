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

import {
  KNOWN_FAILED_CASES,
  describeKnownFailedCases,
  vitestExcludeArgs,
} from "./quality-gate-shared.mjs";

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
  // 像素基线按平台分文件：少一档不是「那一档没跑」，而是判失败并顺手生成半套未入库的
  // PNG。这条守的是「视觉层在真正执行它的那台机器上到底有没有基线」，与本次改动无关。
  "tests/visual-baseline-pairing.test.ts",
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
  // 从 Prisma→Drizzle 迁移起每次 500 而零红 —— 新增一处就是重新装上那个消音器，
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
];

/** @typedef {{test: (rel: string) => boolean, why: string}} WideTrigger */
/** @typedef {{mode: "subset" | "all", tests: string[], reasons: Record<string, string>, excludeArgs?: string[], excludedCases?: string[]}} Resolution */

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
 * @param {{changedPaths: string[], testFiles: string[], sourceFiles: string[], readText: (rel: string) => string | null, knownFailedCases?: import("./quality-gate-shared.mjs").KnownFailedCase[]}} input
 * @returns {Resolution}
 */
export function resolveAffectedTests({
  changedPaths,
  testFiles,
  sourceFiles,
  readText,
  knownFailedCases = [],
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

  /* 已知基线红（登记表单点定义在 `quality-gate-shared.mjs`，与 `run-tests.mjs` /
   * 一键门禁同一份）：被点名的**用例**要跳掉，否则别线的红会让无关提交落不了地。
   * 固定清单不受影响 —— 那几条是全库不变量的执行者，没有「先放行」的余地。
   *
   * 粒度是**用例**（ISSUE #1282 收尾）：这里**不再把文件从增量面剔掉**，只把
   * 「要跳哪几条」带给 vitest（`-t '<负前瞻正则>'`）。改之前是 `picked.delete(文件)`，
   * 一条红会把同文件其余已绿的断言一起从增量面摘走（实测 1 + 17）。剔除是被打印的，
   * 不是静默的：`__excludedCases` 原样回给调用方，由它打印。 */
  const excludedCases = knownFailedCases.filter((c) => picked.has(c.file));
  const out = withFixed("subset", picked);
  if (excludedCases.length > 0) {
    out.reasons.__skipped = describeKnownFailedCases(excludedCases).join(" ");
    out.excludedCases = describeKnownFailedCases(excludedCases);
    out.excludeArgs = vitestExcludeArgs(excludedCases);
  }
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
    "这种没人筛过的形态（真断言红已经是 0，不是挡路的那件事）。规范 §13.5.8 / §11.13\n"
  );
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--fixed-only")) {
    process.stdout.write(FIXED_STRUCTURAL_TESTS.join(" ") + "\n");
    return 0;
  }
  // `--exclude-args`：只打印「跳过已知基线红用例」要给 vitest 加的 `-t <模式>`。
  // 单独一个出口是因为调用方（`run-affected-tests.mjs`）的 stdout 协议是
  // 「一行空格分隔的测试路径」，把参数混进去会让那条协议多一种形态。
  if (argv.includes("--exclude-args")) {
    // 每行**一个参数**（`-t` 一行、模式一行），不是空格分隔 —— 模式里必然含空格
    // （全名用 `" > "` 连接），按空白切会把它拆碎，排除项静默失效。这条协议
    // 与「测试路径一行」不同，是因为两者的元素形状不同：路径不含空格，模式含。
    // 模式里包含**全部**登记项，不按本次改动面筛：`-t` 是全局过滤器，模式里每条
    // 都锚定到唯一全名，没进本次运行面的条目不会匹配到任何东西 —— 于是「打印哪些
    // 条目」不影响判决，少一层「两条命令算出不同清单」的分叉。
    const args = vitestExcludeArgs(KNOWN_FAILED_CASES);
    process.stdout.write(args.length === 0 ? "" : args.join("\n") + "\n");
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
          knownFailedCases: KNOWN_FAILED_CASES,
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
