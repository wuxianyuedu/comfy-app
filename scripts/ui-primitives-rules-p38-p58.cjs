#!/usr/bin/env node
// @ts-nocheck -- UI 基元判据的规则表分片：P38 ~ P58（元素几何 / 客户端边界 / 帧调度 / 复制反馈 / 入参收窄 …）
/**
 * `ui-primitives-rules.cjs` 的规则表分片（ISSUE #1811）。
 *
 * 85 条判据的 `count` 实现合计 2754 行 —— 按 R5「单文件超 900 行须拆」的尺子，
 * 一张表放不下，于是按 P 编号区间切成四份；四份都是**同构的对象片段**，
 * 由 `ui-primitives-rules.cjs` 用 `{...a, ...b}` 合并成 `RULES`。
 *
 * 切法只跟**编号区间**走（不按档位）：档位表 `RULE_TIER_IDS` 是另一维度，
 * 把它和「实现住在哪一份」绑在一起，会让「改判据所属档位」变成跨文件搬家。
 * 合并顺序即对象键顺序，与拆分前逐字一致。
 */
const {
  stripCommentsCached,
  stripP71AllowBlocks,
  countNestedMinMax,
  countNonContainment,
  scanJsxAttrs,
  readJsxAttrsPastTag,
  parseJsxProps,
  countButtonTitle,
  isBusySlotName,
  isP81IconName,
} = require("./ui-primitives-engine.cjs");


module.exports = {
  P38: {
    label:
      "视图 / 逻辑层里手写元素几何的算术（应使用 ~/lib/dom-rect 的 offsetWithin / readLineHeight 等，量测接线走 use-element-box）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 已用出口的文件跳过。 */
      if (/use-element-box/.test(t2)) return 0;
      let hits = 0;
      /* ① 两个 rect 相减 / 相加（面板内偏移、相对定位）。 */
      const rectDiff =
        /getBoundingClientRect\s*\(\s*\)[\s\S]{0,120}?[-+]\s*[\s\S]{0,120}?getBoundingClientRect\s*\(\s*\)/g;
      hits += (t2.match(rectDiff) || []).length;
      /* ② 行高估算：`scrollHeight` 与另一个量做除法。 */
      const lineHeight = /scrollHeight\s*[/]|[)]\s*[/]\s*\w*[Ll]ines?\.length/g;
      hits += (t2.match(lineHeight) || []).length;
      /* ③ 用 `clientHeight` / `clientWidth` 算落点（除以 2、加偏移）。 */
      const viewportMath =
        /client(?:Height|Width)\s*[/]\s*2\b|client(?:Height|Width)\s*[+-]\s*\w/g;
      hits += (t2.match(viewportMath) || []).length;
      /* ④ 自己接线量测：`new ResizeObserver(` **且**手写等值判断落状态。 */
      if (
        /new\s+ResizeObserver\s*\(/.test(t2) &&
        /prev\.(?:width|height|client\w+|scroll\w+)\s*===\s*(?:next|rect|box|el|element)\b/.test(
          t2,
        )
      ) {
        hits += 1;
      }
      return hits;
    },
  },

  /* ── P39「等一帧再做事」（硬闸，§16.2.4.42）────────────────────────────
   * 形态取「**裸的一帧调度**」，而不取「有没有调 `requestAnimationFrame`」：
   * `use-fps` 与 `WorkflowEditorInner` 的贴合循环是**帧循环**（`step` 自递归
   * 采样 / 收敛判断），不是「等这一轮落定再做下一件事」，形态不同、不该算。
   *
   * ⚠️ 判据要同时看两样 —— 「调了 rAF」且「回调体里没有再次 rAF 自己」：
   * 只数前者会把上面那两处循环算进来（它们是合法的采样器）。
   *
   * ⚠️ 取消是可选的**写法**，但「不取消」是这条账里真实的一半缺陷：三处
   * `use-custom-nodes-settings` 与 `json-viewer` 的高亮注入都写在 effect 里而
   * 没有清理，effect 因依赖抖动重跑时旧帧仍会落地（往已经翻走的面板上滚一次）。
   * 出口的返回取消函数就是为这件事存在的，判据不单独数它 —— 换用出口即自动有。
   *
   * 出口：`~/lib/next-frame` 的 `onNextFrame`（一帧，读刚渲染出来的 DOM）与
   * `afterNextPaint`（两帧，等三方布局库重排完成）。
   */
  P39: {
    label:
      "视图 / 逻辑层里裸写「等一帧再做事」的调度（应使用 ~/lib/next-frame 的 onNextFrame / afterNextPaint）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 已用出口的文件跳过。 */
      if (/from\s+"~\/lib\/next-frame"/.test(t2)) return 0;
      let hits = 0;
      const re =
        /(?:window\.)?requestAnimationFrame\s*\(\s*\(?\s*(\w+)?\s*\)?\s*=>/g;
      let m;
      while ((m = re.exec(t2)) !== null) {
        const param = m[1];
        /* 帧循环：回调体内再次 rAF（`step` / `tick` 这类自递归采样器）。
         * 取回调体前 900 字符，够跨过循环里的收敛判断与视口下发。 */
        const body = t2.slice(m.index, m.index + 900);
        if (
          param &&
          new RegExp(`requestAnimationFrame\\s*\\(\\s*${param}\\b`).test(body)
        ) {
          continue;
        }
        /* 双 rAF（`rAF(() => rAF(cb))`）同样计入 —— 它是同一件事的另一档。 */
        hits += 1;
      }
      return hits;
    },
  },

  /* ── P40「复制到剪贴板之后给什么反馈」（硬闸，§16.2.4.43）──────────────
   * 形态取「**调了剪贴板写入出口**」，而不取「有没有 `navigator.clipboard`」——
   * 后者已在 P5 收口（全库只剩 `~/lib/browser-io` 一处实现）。P5 之后剩下的
   * 问题变成：**成败之后界面说什么**，而它在 14 个落点里有六种答案：
   *
   *   · 完全静默（`void copyText(…)`）—— ShellTabs / DebugChainFooter /
   *     ResultCard / ErrorPanel ×2 / `log-export`，其中三处连注释里的理由都不一样
   *    （「按钮上有 flash」/「用户可手动选中」/ 干脆没写）；
   *   · `useFlashState` 亮一下 —— ProjectOutputs / WorkflowNodeJsonPopover /
   *     settings 的 `UsageTestDialog`；
   *   · `toast.success` + `toast.error` —— `use-history-detail-actions` 的复制路径；
   *   · 进 `runAsyncAction` 的成功文案 —— `use-history-list` 的「重试」实为复制；
   *   · 三态 `setOutcome("done" | "failed")` —— `logs/LogRow`；
   *   · 只判 `if (await copyText(…))` 不写失败分支 —— settings 页的加载错误复制。
   *
   * 也就是说 —— **「复制失败了界面说不说、成功了亮不亮」取决于它是哪一处写的**。
   * 用户可见结果是**不同的**：同一句「剪贴板不可用」在一种写法下能落到眼前、
   * 在另一种下连按钮都不变（用户以为复制成功了）。
   *
   * 出口：`~/components/ui/use-copy-feedback` 的 `useCopyFeedback` —— 把
   * 「写剪贴板 → 按成败执行调用处给的反馈」收一次；反馈形态（flash / toast /
   * 行内）仍由调用处决定（那是表现层选择，与 `~/lib/async-action` 同款口径）。
   */
  P40: {
    label:
      "视图 / 逻辑层里裸调 copyText 而不接反馈出口（应使用 ~/components/ui/use-copy-feedback 的 useCopyFeedback）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 已用出口的文件跳过；出口自身的实现文件也跳过。 */
      if (/use-copy-feedback/.test(t2)) return 0;
      if (t2.includes("~/lib/browser-io")) {
        /* 允许「只是 import 了 copyText 但没调」的情形 —— 计数靠下面的调用。 */
      }
      let hits = 0;
      /* `copyText(` / `copyLogText(` 的**调用**（不是 import 行）。 */
      const re = /\bcopy(?:Text|LogText)\s*\(/g;
      let m;
      while ((m = re.exec(t2)) !== null) {
        const line = t2.slice(
          Math.max(0, t2.lastIndexOf("\n", m.index)),
          m.index,
        );
        if (line.includes("import") || line.includes("export function"))
          continue;
        hits += 1;
      }
      return hits;
    },
  },

  /* ── P41「REST 路由的入参收窄」（硬闸，§16.2.4.44）────────────────────
   * 形态取**两样之一**：① 手写 `isRecord` 收窄守卫；② POST 路由里
   * 「取 JSON 体 → 判是不是对象 → 回 400」那一段入参收窄。
   *
   * ⚠️ 「必填字段校验」不在这条账里：每个端点的字段语义各不相同
   *（`messages` 不能为空 / `image` 必须存在 / `stage` 要能解析），那是域判据。
   * 这条账管的是**在那之前**的公共三步 —— 读得到 JSON 吗、它是不是对象、
   * 不是的话回什么信封。
   *
   * ⚠️ 收口前的实测分歧正是它的价值：5 个文件逐字相同的 12 行；`custom-nodes`
   * 与 `llm/test` 用 `req.json().catch(() => ({}))` —— **畸形 JSON 被静默当成
   * 空对象**，于是同一个坏请求在一种写法下回 `400 请求格式错误`、在另一种下
   * 走到「字段缺失」分支回一句完全无关的话；`workshop/logs` 又把 `isRecord`
   * 就地展开成 `typeof body === "object" && body !== null`；**`llm/test` 与
   * `llm/models` 的 `await currentServerUser();` 丢弃了返回值** —— 鉴权写了
   * 但没判（这两处另有独立修复，见 §16.2.4.44 ③）。
   *
   * 出口：`~/server/lib/request-body` 的 `readJsonRecord`（读 + 判 + 回 400
   * 一次给全）/ `isRecord`（`unknown` 收窄的唯一实现处）。
   */
  P41: {
    label:
      "REST 路由里自写入参收窄 / 自己定义 isRecord（应使用 ~/server/lib/request-body 的 readJsonRecord / isRecord）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 出口自身的实现文件跳过。 */
      if (/server\/lib\/request-body/.test(t2)) return 0;
      let hits = 0;
      /* ① 自己定义 `isRecord`（9 处里 8 处是逐字相同的实现）。 */
      hits += (t2.match(/function\s+isRecord\s*\(/g) || []).length;
      /* ② 入参收窄三步：`req.json()` + 400 信封。 */
      if (
        /(?:req|request)\.json\s*\(/.test(t2) &&
        /NextResponse\.json\(\s*\{[^}]*error/.test(t2)
      ) {
        hits += 1;
      }
      return hits;
    },
  },

  /* ── P42「错误文案里的『动作前缀』」（硬闸，§16.2.4.45）─────────────────
   * `~/lib/error-message` 的 `errorMessage` 早已是「详情」那一半的唯一出口，
   * 但「**是哪个动作失败了**」那一半在收口前有四种写法并存：
   *
   *   · 模板串硬拼 —— `` `工作流列表加载失败：${errorMessage(e, "未知错误")}` ``
   *     （`use-workflow-library` ×2、`server/film/orchestrator` ×2、
   *     `use-cancel-task`）；
   *   · `+` 拼 —— `"无法读取文件：" + errorMessage(e, "未知错误")`
   *     （`use-workflow-import`）；
   *   · **绕开 `errorMessage`** —— `"读取配置失败：" + String(e)`
   *     （`use-custom-nodes-settings` ×4）、
   *     `` `${err instanceof Error ? err.message : "未知错误"}` ``
   *     （`usage-field-editor`）、`"启动解析进程失败：" + e.message`
   *     （`api/custom-nodes` ×2）；
   *   · 动作名被当成 `errorMessage` 的 **fallback 参数** ——
   *     `errorMessage(e, "保存失败")`。这一档**不算违规**（结果自然就是
   *     「保存失败」），但它表达不了「动作 + 详情」两段式，所以本条判据
   *     只管前三档。
   *
   * 第三档才是真正的缺陷：`String(e)` 对 `new Error("")` 产出 `"Error"`、
   * 对 tRPC 的对象抛值产出 `"[object Object]"`，而且**绕过网络层翻译** ——
   * 同一个文件里其它落点走 `errorMessage`，于是用户会在同一块面板上看到
   * 两种质量并存的文案。
   *
   * 判据取**「动作前缀 + 冒号 + 紧跟一个错误取值动作」这个签名**：
   *
   *   ① 一个以动作名结尾的字符串字面量 / 模板串尾，紧跟全角或半角冒号；
   *   ② 冒号之后 40 字符内出现 `errorMessage(` / `String(e…)` / `.message` /
   *      `instanceof Error` 之一。
   *
   * 两个条件同时成立才计 —— 只数冒号会把任何「标题：正文」的界面文案算上
   *（那是合法的），只数 `String(` 会把日志里的其它转换算上。
   *
   * 出口：`~/lib/error-message` 的 `errorText(e, action, fallback?)`。
   */
  P42: {
    label:
      "视图 / 逻辑 / 服务端里自拼错误文案的「动作前缀」（应使用 ~/lib/error-message 的 errorText）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 已用出口的文件跳过（与 P39/P40 同款：换用出口即自动合规）。 */
      if (/\berrorText\s*\(/.test(t2)) return 0;
      let hits = 0;
      /* ① 「…：」紧跟 ② 错误取值动作。冒号可为全角或半角（+ 空格）。 */
      const re = /[：:]\s*\+?\s*\$?\{?/g;
      let m;
      while ((m = re.exec(t2)) !== null) {
        /* 前缀那一侧必须有**出错语义**的字面量 —— 否则只是普通的
         * 「标题：正文」界面文案（判据太宽会逼人改坏文案）。
         *
         * 词表取实测出来的四类：`失败` / `异常` / `错误` / `无法`（含「不能」
         * 与「读取不出来」这类）。`无法读取文件：` 是这条账里的真实落点，
         * 只认「失败」会把那一处整个漏掉 —— 而漏掉的那一半恰恰是最常见的一档。 */
        const before = t2.slice(Math.max(0, m.index - 40), m.index);
        if (!/(失败|异常|错误|出错|无法|不能|未找到|不存在)/.test(before))
          continue;
        const after = t2.slice(m.index, m.index + 60);
        if (
          /errorMessage\s*\(/.test(after) ||
          /String\s*\(\s*(?:e|err|error)\b/.test(after) ||
          /\bcatch(?:Message|Message)\s*\(/.test(after) ||
          /instanceof\s+Error/.test(after) ||
          /\b(?:e|err|error)\.message\b/.test(after)
        ) {
          hits += 1;
        }
      }
      return hits;
    },
  },

  /* ── P43「复制失败时那句提示」（硬闸，§16.2.4.46）───────────────────────
   * 这是 P40 的**下一层**。P40 把「成败之后界面说不说」收口之后，剩下的是
   * **说了什么** —— 实测 10 个落点给失败提示时每一处都手写同一句话，而有
   * **5 种变体**（`请手动选中后复制` ×5 / `请手动选中复制` ×1（漏了「后」）/
   * `请在下方展开后手动选中复制` ×2 / `请手动选中日志后复制` ×1 /
   * `请到创作台手动重跑` ×1）。
   *
   * 判据取**固定句的语义内核**「剪贴板不可用」（浏览器拒绝写剪贴板的唯一原因，
   * 与落点无关），而不取「复制失败」四个字 —— 后者是**标题**，与
   * `errorText` 的动作前缀同族，各面板本来就该说得不一样。
   *
   * 出口：`~/components/ui/use-copy-feedback` 的 `copyFailureText(target?)` ——
   * 固定句走出口、**界面位置**（只有调用处知道的事）经参数注入。
   */
  P43: {
    label:
      "视图 / 逻辑层里手写「复制失败」的固定提示句（应使用 ~/components/ui/use-copy-feedback 的 copyFailureText）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 已用出口的文件跳过（换用出口即自动合规）。 */
      if (/\bcopyFailureText\s*\(/.test(t2)) return 0;
      return (t2.match(/剪贴板不可用/g) || []).length;
    },
  },

  /* ── P44「把一段文本按最大长度截断」（硬闸，§16.2.4.48）──────────────────
   * 全库十余处各写一遍「超长就切一刀」，而**长度上限、截断方向、省略标记**
   * 三件事各写各的：上限 600 / 2000 / 4000 / 8000 散落，标记有 `…` /
   * `\n…(truncated)` / `…(truncated, 原始 N 字符)` / **什么都不加**。
   *
   * ⚠️ **上半限的判据要取对，否则误报会把判据逼成噪音**：本仓库里
   * `slice(0, 8)` / `slice(0, 12)` 大量出现在「id / sha 短码」上
   * （`taskId.slice(0, 12)`、`hash.digest("hex").slice(0, 8)`），那些**不是**
   * 本条账 —— 短码本来就是完整标识，旁边的 `…` 是显示约定而不是「这段被切了」。
   * 两条账的分界是**量级**：prose 的预算是「一句话 / 一行」（≥ 24），
   * 短码是「几个字符」（≤ 16）。判据因此取 **N ≥ 24**。
   *
   * 判据：`slice(0, N)` / `substring(0, N)`（N ≥ 24）**且**同一条语句里
   * 出现省略标记（`…` / `truncated`）—— 两个条件同时成立。
   * 出口：`~/lib/text-clamp` 的 `clampText`（上限走具名常量，见该模块）。
   */
  P44: {
    label:
      "视图 / 逻辑 / 服务端里自写文本截断（应使用 ~/lib/text-clamp 的 clampText）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 已用出口的文件跳过（换用出口即自动合规）。 */
      if (/\bclampText\s*\(/.test(t2)) return 0;
      return (
        t2.match(
          /\.(?:slice|substring)\(0, *(?:2[4-9]|[3-9][0-9]|[0-9]{3,})\)[^;\n]{0,40}(?:…|truncated)/g,
        ) || []
      ).length;
    },
  },

  /* ── P45「一个异步动作重试几次、退避多久」（硬闸，§16.2.4.49）────────────
   * 三处各写一份重试策略（WS 重连 / history 轮询 / Ollama 就绪），形状只有
   * 两种（指数退避 + 上限 / 固定间隔 + 有界次数），但**没有任何一处说明
   * 为什么这一处用指数、那一处用固定**。
   *
   * 判据取**指数退避的算术**这个签名 —— `… * 2 ** …`（含 `Math.pow(2, …)`）
   * 与本项目的「退避」语义**一一对应**：固定间隔里不出现 `2 **`，而
   * `2 **` 在本仓库唯一的用途就是退避（没有第二类用法）。
   * 这条判据**不**数固定间隔的循环（那太宽 —— `for (let i = 0; i < 5; i++)`
   * 到处都是），固定间隔一侧由具名常量（`retry-policy` 的 `*.baseMs` /
   * `*.maxAttempts`）在 Code Review 与 import 侧约束。
   *
   * 出口：`~/lib/retry-policy` 的 `backoffDelayMs` + 具名策略。
   */
  P45: {
    label:
      "视图 / 逻辑 / 服务端里自写指数退避算术（应使用 ~/lib/retry-policy 的 backoffDelayMs）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      if (/\bbackoffDelayMs\s*\(/.test(t2)) return 0;
      return (t2.match(/\* *2 *\*\*|Math\.pow\( *2 *,/g) || []).length;
    },
  },

  /* ── P46「把一个日期写成可读格式」的**只写日期**那一档（硬闸，§16.2.4.50）─
   * `time-format` 早先收了「相对时间」与「时刻」，但「只写日期」那一档
   * （`YYYY-MM-DD` 在历史日期桶 / 消息中心 / 按天文件名三处各拼一遍；
   * `MM-DD` 行首前缀又一份）与**本地时间戳**（`YYYY-MM-DD HH:mm:ss` 在 6 处
   * runtime / 日志模块逐字相同）没有出口。
   *
   * 判据取**手拼日期的形态**：「`getFullYear()` 后面紧跟 `}-`」（即
   * `` `${d.getFullYear()}-…` `` 这个串）。它精确到「正在把年拼进一个日期串」，
   * 不会命中 `getMonth()` 的其它用法（如 `isSameDay` 的比较）。
   * 出口：`~/lib/time-format` 的 `formatDate` / `formatShortDate` /
   * `formatLocalStamp` / `formatCompactStamp`。
   */
  P46: {
    label:
      "视图 / 逻辑 / 服务端里手拼日期串（应使用 ~/lib/time-format 的 formatDate 家族）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      if (/\bformat(?:Date|ShortDate|LocalStamp|CompactStamp)\s*\(/.test(t2))
        return 0;
      return (t2.match(/getFullYear\(\)\}-/g) || []).length;
    },
  },
  /* ── P47「扩展名 ⇄ MIME 类型」的映射表（硬闸，§16.2.4.51）──────────────
   * 同一件事在全库有 **6 份互不相同的映射表**，而它们互相矛盾：
   * `image/avif` 只在其中两份里有、`image/webp` 在一份里缺，`api/generated`
   * 那份还多背了 `text/plain` / `application/json`（它服务磁盘上的任意产物）。
   * 同一个上传文件在「走 resolveMediaBytes 兜底」与「走 prepare 路由落盘」
   * 两条路径上会得到不同的扩展名与 Content-Type。
   *
   * 判据锚**映射表的形态**：一条形如 `"image/xxx": "ext"` 或 `".ext": "image/xxx"`
   * 的字面量对。它精确到「正在把扩展名与 MIME 记成一张表」，不会命中
   * 单个 `?? "image/png"` 兜底（那是调用处的域选择，另算）。
   * 出口：`~/lib/media/mime-ext` 的 `mimeForExt` / `extForMime` /
   * `extOfPath` / `stemOfPath` / `contentTypeForPath`。
   */
  P47: {
    label:
      "视图 / 逻辑 / 服务端里自写「扩展名 ⇄ MIME」映射表（应使用 ~/lib/media/mime-ext）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 已用出口的文件跳过（换用出口即自动合规）。 */
      if (
        /\b(?:mimeForExt|extForMime|extOfPath|stemOfPath|contentTypeForPath)\s*\(/.test(
          t2,
        )
      )
        return 0;
      const mimeToExt =
        t2.match(/"\w[\w.+-]*\/[-\w.]+"\s*:\s*"[a-z0-9]{2,5}"/g) || [];
      const extToMime =
        t2.match(
          /"\.?[a-z0-9]{2,5}"\s*:\s*"(?:image|video|audio)\/[-\w.+]+/g,
        ) || [];
      return mimeToExt.length + extToMime.length;
    },
  },

  /* ── P48「`unknown` 当宽松对象视图读」（硬闸，§16.2.4.52）────────────────
   * 收口前全库有 **四份**这个实现，而它们**各叫各的名字**：
   *   workflow-utils 的叫 `asRecord`、`lib/comfyui/raw` 的也叫 `asRecord`、
   *   `api-channel-core` 的**叫 `isPlainRecord` 却不排除数组**、
   *   `use-param-wiring` 的叫 `isPlainRecord`（真排除数组）。
   * 第三处最危险：与 `~/lib/is-record` 的严格版**同名不同义**。
   *
   * 判据锚**转成视图**的那一处形态：`typeof X === "object" && X !== null`
   * 之后紧跟 `as Record<string, unknown>`（同一变量名，反向引用钉住）。
   * 出口：`~/lib/is-record` 的 `isRecord` / `isPlainRecord` / `asRecord`。
   *
   * ⚠️ **判据刻意不数另外两种形态**（写宽了会逼人改坏代码）：
   *   · `typeof e === "object" && e !== null && "message" in e` —— 这是
   *     「就地读一个字段」，用出口要写成 `asRecord(e)?.message` 再判类型，
   *     反而多一层（`error-message.ts` / `repository-user.ts` 属此类）；
   *   · 取反早退守卫（`if (typeof body !== "object" || body === null) return null`）——
   *     取反早退的**守卫**，收窄后立刻用掉，没有「视图」这回事
   *     （`api-error.ts` / `comfy-readiness-client.ts` 属此类）。
   *   第一版判据把这两种一起算进来，实测报出 **24 处**，其中一半是上面两种 ——
   *   与 P44「N ≥ 24」、P45「不数固定间隔」同一条教训：**判据太宽会逼人改坏**。
   * 豁免 `is-record.ts` 自身（定义处）。
   */
  P48: {
    label:
      "视图 / 逻辑 / 服务端里自写「unknown 当宽松对象视图」（应使用 ~/lib/is-record 的 isRecord / asRecord）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      if (/from "~\/lib\/is-record"/.test(t2)) return 0;
      /* 锚**转成视图**的形态：`typeof X === "object" && X !== null` 之后
       * 紧跟 `as Record<string, unknown>`。**不**数「收窄后取一个字段」
       * （`typeof e === "object" && e !== null && "message" in e`）与
       * 「取反早退」（`if (typeof body !== "object" || body === null) return null`）
       * —— 那些是**就地读字段**，不是「把 unknown 变成一个可下钻的视图」，
       * 硬套出口只会逼人写 `asRecord(x)?.field` 再拼一层。
       * 同一变量名（`\1` 反向引用）是判据的一部分：`A !== null` 却 `as` 的是
       * 另一个变量时，这不是同一个视图。 */
      return (
        t2.match(
          /typeof (\w+) === "object" && \1 !== null[\s\S]{0,40}?as Record<string, unknown>/g,
        ) || []
      ).length;
    },
  },

  /* ── P49「把一段文本变成安全的文件名片段」（硬闸，§16.2.4.53）──────────
   * 同一件「非法字符换成 `_`」在全库有 **四份各不相同的正则**，差异没有
   * 一处写下来：保留点与不保留点、保留 CJK 与吃掉 CJK 互相矛盾
   * （同一个中文名在 bgm 上传路径被保留、在工坊产出目录被替换成下划线）。
   *
   * 判据锚**那条替换形态**：`replace(/[^…]/g, "_")` —— 精确到「把一批字符
   * 换成下划线」。不数别的 `replace`（`.` → `-`、空格归一都不在此列）。
   * 出口：`~/lib/safe-name` 的 `safeFileNameSegment` / `safeDisplayName`。
   */
  P49: {
    label:
      "视图 / 逻辑 / 服务端里自写文件名安全化（应使用 ~/lib/safe-name 的 safeFileNameSegment / safeDisplayName）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      if (/\b(?:safeFileNameSegment|safeDisplayName)\s*\(/.test(t2)) return 0;
      return (t2.match(/replace\(\/\[\^[^\]]*\]\+?\/g, *"_"\)/g) || []).length;
    },
  },

  /* ── P50「把一个数字按某档精度写成字符串」（硬闸，§16.2.4.54）──────────
   * 全库 26 处 `toFixed(`，四派写法都编译、都运行、类型都对，差别只在
   * **几个语义决定**上：小数位从哪来、末尾的零要不要留、整数要不要也进
   * 格式化、大数值要不要绕开。还有一处更隐蔽的
   * `(Math.round(v * 100) / 100).toFixed(2)` —— **两层舍入**。
   *
   * 判据锚 `toFixed(` **这个 API 本身**：它是本条账唯一的签名
   *（`Math.round(v * 100) / 100` 那类写法里也必然有一个 `toFixed`）。
   * 不数 `Math.round(` 或 `padStart(` —— 那些是别的账（像素取整 / 补零），
   * 数进来会逼人改坏代码。
   *
   * 出口：`~/lib/number-format` 的 `fixed` / `trimmed` / `trimFixed` /
   * `alphaText`。
   */
  P50: {
    label:
      "视图 / 逻辑 / 服务端里自写数字精度格式化（应使用 ~/lib/number-format）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 已用出口的文件跳过（换用出口即自动合规）。 */
      if (/from "~\/lib\/number-format"/.test(t2)) return 0;
      return (t2.match(/\.toFixed\(/g) || []).length;
    },
  },

  /* ── P51「把一组值去重 / 合并成有序集合」（硬闸，§16.2.4.55）────────────
   * `[...new Set(xs)]` 与 `Array.from(new Set(xs))` 混用，而比选型更要紧的
   * 是**排序口径也不一**（`localeCompare` 与手写 `for` 循环挑字段做键）。
   *
   * 判据锚两处**形态**，两个条件同时成立：
   *   ① `.sort((…) => …localeCompare(…)` —— 手写「按当前区域设置排序」。
   *      不数不带比较器的 `.sort()`（按字符串码位排是**另一个判据**，
   *      合法且另有所指），也不数数值比较器；
   *   ② 手写按字段去重（`const X = new Set(); … for (…) { if (X.has(k)) continue; X.add(k); … }`）
   *      —— **手写按字段去重**。这一条必须与 ① 同时成立，否则会把
   *      「Set 当索引用」（`seen` 做已读标记、邻接表 `incoming[id] = new Set()`）
   *      一起算进来 —— 那些**不是**去重集合，数进来会逼人改坏代码。
   *
   * 出口：`~/lib/ordered-set` 的 `unique` / `uniqueSorted` / `uniqueBy` /
   * `union` / `compareText`。
   */
  P51: {
    label:
      "视图 / 逻辑 / 服务端里自写去重合并 / 区域设置排序（应使用 ~/lib/ordered-set）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 已用出口的文件跳过（换用出口即自动合规）。 */
      if (/from "~\/lib\/ordered-set"/.test(t2)) return 0;
      return (
        t2.match(
          /\.sort\(\s*\(\s*\w+\s*,\s*\w+\s*\)\s*=>[^;\n]{0,80}localeCompare\(/g,
        ) || []
      ).length;
    },
  },

  /* ── P52「拼一个 data: URL / 读回它的载荷」（硬闸，§16.2.4.56）──────────
   * `data:${mime};base64,${…}` 手拼 3 处，读回的一侧 6 处各写一遍
   * 「找第一个逗号、后面就是 base64」。而写法**互相矛盾**：
   * `slice(indexOf(",") + 1)` 在缺逗号时会把**整个 data URL** 当 base64
   * 交给解码器（它跳过非法字符）→ 静默解出垃圾字节。
   *
   * 判据取**三条只在本条账出现的形态**：
   *   ① 字面量 `data:${…};base64,${…}`（模板串拼接）；
   *   ② `indexOf(",")` —— 精确到「从这里切 base64 载荷」这个动作；
   *   ③ `split(",")` **且同文件出现 `startsWith("data:")`** ——
   *      **更差的那一种写法**（至少判了有没有逗号，但把整个串 split 一遍）。
   *      ⚠️ 这一条必须一起数：与 P13「只数合规的那种、漏掉更差的那种」
   *      同款 —— 判据漏掉更差的写法，被拦下的就永远只是合规者
   *      （`video-task-util` 的 HEAD 版本正是 `split(",")` 那一档）。
   *      但 `split(",")` 在本仓库另有 CSV 解析的用法（`.split(",")`
   *      切 ANSI 分段 / 切节点白名单），故**两个条件同时成立**才计：
   *      `data:` 前缀与它同现，说明这个文件确实在处理 data URL。
   * **刻意不数 `startsWith("data:")`** —— SSE 帧前缀也是这个写法
   *（`lib/llm/browser` / `lib/llm/server` 的 `data: {...}`），
   * 数进来会把**流式解析**误判成本条账（那是另一件事）。
   * 代价是 `character-portrait-client` 的 HEAD 版本（只用了
   * `startsWith("data:")` 作判据）不会被本判据数到 —— 它的**实质**是
   * 「这是不是内联 media」，已由 `isInlineMedia` 收口，出口侧契约
   *（`tests/ui-primitives-coverage.test.ts`）从另一侧钉住。
   *
   * 出口：`~/lib/media/data-url` 的 `isDataUrl` / `isInlineMedia` /
   * `toDataUrl` / `wrapBase64` / `toBase64` / `parseDataUrl` 与
   * `base64PayloadOf` 七个（见规范 §16.2.4.56）。
   */
  P52: {
    label:
      "视图 / 逻辑 / 服务端里自拼或自切 data URL（应使用 ~/lib/media/data-url）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 已用出口的文件跳过（换用出口即自动合规）。 */
      if (/from "~\/lib\/media\/data-url"/.test(t2)) return 0;
      const writes = t2.match(/data:\$\{[^}]{0,40}\};base64,\$\{/g) || [];
      const cuts = t2.match(/indexOf\(",\"\)/g) || [];
      /* ③ 两个条件同时成立才计：`split(",")` 与 `data:` 前缀同现
       *（`split(",")` 在本仓库另有 CSV 解析的用法）。 */
      const splitCuts =
        t2.includes('startsWith("data:")') || t2.includes("data:${")
          ? t2.match(/split\(",\"\)/g) || []
          : [];
      return writes.length + cuts.length + splitCuts.length;
    },
  },

  /* ── P53「在元素上自己实现一个键盘动作」（硬闸，§16.2.4.57）────────────
   * 全库 **3 处**各写一遍键判别（`ShellTabs` / `TitleBarTabs` 的页签、
   * `ScriptMarkdownEditor` 的 Tab 缩进），而它们对三件事各判各的：
   *   · **键名叫什么** —— `" "` 还是 `"Space"`、要不要大小写归一
   *     （无修饰单键的 `event.key` 是**带 Shift 的大写字符**）；
   *   · **要不要 `preventDefault`** —— 混在同一个 `if` 里，看不出谁决定的；
   *   · **`event.repeat` 收不收** —— 按住空格会连发。
   *
   * 判据取**一个 `onKeyDown` 里直接拿 `event.key` 与字面量比**这个形态。
   * 键名比对只许经 `~/lib/keyboard` 的 `normalizeKeyName` / `isKeyIn`
   * 或 `~/components/ui/simple-key-handler`（两者共用同一份归一规则）。
   *
   * **不数** `if (event.key === …)` 出现在别处的形态？——数量是全部：
   * 收口后本仓库所有「元素上的键动作」都走这两个出口，`use-hotkey`
   * （全局监听）与 `use-enter-commit`（输入框）另有各自更细的判据，
   * 它们的实现文件在 `EXEMPT_FILES.P53` 里显式登记。
   */
  P53: {
    label:
      "视图里手写 onKeyDown 的键判据（应使用 ~/components/ui/simple-key-handler 或 ~/lib/keyboard 的归一）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 已用出口的文件跳过（换用出口即自动合规）。 */
      if (
        /from "~\/lib\/keyboard"/.test(t2) ||
        /from "~\/components\/ui\/simple-key-handler"/.test(t2)
      ) {
        return 0;
      }
      /* 形态：**键盘事件**的 `.key` 与一个字面量比。
       *
       * ⚠️ 锚点必须落在**事件对象**上，不能只锚 `.key` —— 本仓库的
       * `UsageField.key`（结果字段名）也叫 `.key`，只锚 `.key` 会一次报出
       * 6 处「`f.key === "mode"`」这种**数据字段比较**（实测）。
       * 故要求左侧是**键盘事件名**（`event` / `e` 及 `…Event` 结尾者）。
       * 这也把「`onKeyDown` 只转发不判键」正确放过（那条不是本判据的账）。
       *
       *  **已知边界（刻意不判）**：把键名**解构**出来再比
       *（`({ key }: KeyboardEvent) => key === "Tab"`）不在本判据内 ——
       *  那个 `key` 已经脱离了「事件对象」这个名字，机器判不出它是事件字段
       *  还是数据字段。与 P37「忙碌位」、P30「错误位」同款：
       *  按名字判的部分只判能判的那一半，剩下的一半由 Review 兜。 */
      return (
        t2.match(
          /\b(?:e|ev|evt|event|[A-Za-z]+Event)\.key\s*[!=]==?\s*["'`]/g,
        ) || []
      ).length;
    },
  },

  /* ── P54「剥掉 / 判断 SGR」（硬闸，§16.2.4.58）────────────────────────
   * 同一条形态 `\x1b\[[0-9;:]*m` 在 **4 处**各写一遍，而它们**判据不同**：
   *   · `lib/log/log-ansi` 的 `SGR_RE` —— 转义符必须在；
   *   · `logs/log-record` 的 `stripSgr` —— 连**残缺颜色码**（只剩 `[90m`）
   *     一起剥，少剥这层会在面板上显示成 `[[OK]【[90m[OK[0m] …`；
   *   · `logs/log-row-style` 的 `hasAnsi` —— 只判不改；
   *   · 会话横幅的写侧与读侧**各持一份**同样的颜色码位字面量（写侧改色、读侧
   *     就认不出自己写的横幅）—— 那一对已随一次启动一份文件撤掉（ISSUE #1326，
   *     `BANNER_ANSI` 与 `session-banner.server.ts` 一并移除）。
   *
   * 判据锚**转义符字面量本身**（`\x1b[` 或 `\u001b[`）—— 它只该出现在
   * 出口里。`\x1b` 单独出现（如光标移动）不在此列：那是另一条账。
   */
  P54: {
    label:
      "视图 / 逻辑 / 服务端里自写 SGR 转义序列（应使用 ~/lib/log/log-ansi 的 hasSgr / stripSgr / stripAnsi）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 形态：转义符字面量（`\\x1b` 或 `\\u001b`）后面在**同一个序列内**
       *  出现 `m` 收尾 —— 即「一条 SGR」。中间形态在本仓库有两种写法
       *  （正则里的 `\\[`、字符串里的 `[`），故不把「中间长什么样」写进判据；
       *  单独的 `\\x1b`（光标移动 / 清屏）不在此列。 */
      return (t2.match(/(?:\\x1b|\\u001[bB]).{0,16}?m/g) || []).length;
    },
  },

  /* ── P55「标识符的书写法换算」（硬闸，§16.2.4.59）──────────────────────
   * 全库只有 1 处（`lib/shell/overlay-z` 的 `zClass`），但它把判据写在
   * 表达式里：`replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)` —— 而换算
   * 结果必须与 `globals.css` 的 `@theme` 变量逐字一致，**写错时静默**
   *（Tailwind 找不到类名不报错，只是那一层没有 `z-index`）。
   *
   * 判据锚**那条替换形态**：`/[A-Z]/g` 且同串出现 `${` 插值（即「大写字母
   * 前插连字符」）。不数别的 `[A-Z]` 用法（`toUpperCase()`、校验正则）。
   *
   * 出口：`~/lib/case-token` 的 `toKebabCase` / `toCamelCase`。
   */
  P55: {
    label:
      "自写驼峰 ⇄ kebab 换算（应使用 ~/lib/case-token 的 toKebabCase / toCamelCase）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 已用出口的文件跳过（换用出口即自动合规）。 */
      if (/from "~\/lib\/case-token"/.test(t2)) return 0;
      return (t2.match(/replace\(\/\[A-Z\]\/g[^;\n]{0,60}\$\{/g) || []).length;
    },
  },

  /* ── P56「把一段路径拼成可展示的相对路径 / 超长时省略中段」（硬闸，§16.2.4.60）
   * 同一件「把一条文件系统路径变成界面上的一行」散着三种各写各的写法，而它们对
   * 三件事各判各的：**相对谁**（`path.relative(REPO_ROOT,…)` / `(LOG_ROOT,…)` /
   * 原样绝对路径）、**分隔符**（`.replace(/\\/g,"/")` ×8 /
   * `.split(path.sep).join("/")` ×2 / 不归一）、**超长怎么办**（视图清一色
   * `truncate` 只留头部 —— 而路径的语义在尾部，用户看到的恰好是被切掉的那一段）。
   *
   * 判据锚**「手工把路径变成展示文本」的三种形态**：
   *   ① `path.relative(` —— 相对化，出口是 `toDisplayPath`；
   *   ② `split(/[\\/]/).pop()` / `.split("/").pop()` —— 取末段，出口是
   *     `lastSegments` / `toDisplayPath`（`path.basename` 不算：它是 Node API，
   *     在「解析已有路径」里是正确的，本条管的是展示）；
   *   ③ `.replace(/\\/g, "/")` —— 分隔符归一，出口是 `normalizeSlashes`。
   *
   * **刻意不数** `path.join` / `path.resolve` / `path.dirname`（那些在拼路径、
   * 不是展示），也不数 `path.basename`（同上）。
   *
   * 出口：`~/lib/path-display` 的 `toDisplayPath` / `stripPathPrefix` /
   * `lastSegments` / `ellipsisMiddle` / `normalizeSlashes`。
   */
  P56: {
    label:
      "视图 / 逻辑 / 服务端里手工把路径变成展示文本（应使用 ~/lib/path-display 的 toDisplayPath / lastSegments / normalizeSlashes）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      if (/from "~\/lib\/path-display"/.test(t2)) return 0;
      /* `path.relative` 有**两种用途**：展示（本条账）与**包含判据**
       *（`const rel = path.relative(root, p); if (rel.startsWith("..") || …)`
       *  是判断「这个路径在不在 root 里」的标准写法 —— 那不是展示）。
       * 只数**紧接着不是包含判据**的那些：锚点取 `path.relative(` 之后 150 字符内
       * 没有 `startsWith("..")` / `isAbsolute`。 */
      const relative = countNonContainment(t2);
      /* 取末段：两种写法（正则分隔符 / 字面 "/"）—— 与 P50「更差的写法也要数」
       * 同款：只数规范的那一种，被拦下的就永远只是合规者。 */
      /* `/[\\/]/` 与 `"/"` 两种分隔符写法都数（与 P50/P52「更差的写法也要数」
       * 同款）。锚点：`.split(/[...]/).pop()` 或 `.split("/").pop()`。 */
      const tail =
        (t2.match(/\.split\(\/\[[^\]\n]*\]\/\)\.pop\(\)/g) || []).length +
        (t2.match(/\.split\("\/"\)\.pop\(\)/g) || []).length;
      const slashes = (t2.match(/\.replace\(\/\\\\\/g,\s*"\/"\)/g) || [])
        .length;
      const sepJoin = (t2.match(/\.split\(path\.sep\)\.join\("\/"\)/g) || [])
        .length;
      return relative + tail + slashes + sepJoin;
    },
  },

  /* ── P57「透传 props 给底层元素前先剔掉自己的私有字段」（硬闸，§16.2.4.61）
   * 十几个基元都有同一段「摘掉自己的私有字段、剩下 `...rest` 透传」，
   * 而**剔除表各写各的**：类型侧 `extends Omit<Base, "a" | "b">` 与运行时侧
   * 的解构是**两份**，必须逐字一致而没有任何机器判据。表里有、解构里漏 →
   * 该字段**静默透传给 DOM**（React 19 只给一条 console 警告），`value` /
   * `onChange` 这类漏掉的表现是「双份受控」：界面有值但状态没变。
   *
   * 判据锚**「类型侧写了一张私有字段表」这个形态**：`Omit<` 后面紧跟一个
   * **字符串字面量联合**（`Omit<X, "a" | "b">`）。出口是 `~/lib/dom-props`
   * 的 `OmitOwnProps`（表只写一遍 → 类型与运行时同源）。
   *
   * **刻意不数** `Omit<SomeModel, "id">` 这类**数据模型**的排除（它们不是
   * 「透传给 DOM 的属性」，`Omit` 在这里只是表达「这条记录还没有 id」）。
   * 形态上的分界线是 **Omit 的基类型**：只有 `React.ComponentProps<…>` /
   * `HTMLAttributes<…>` / base-ui 的 `…Primitive.…Props` / `LucideProps` /
   * `typeof <组件>` 这类「底层元素的属性集」才是本条账；`Omit<LogEntry, "seq">`
   * 那类数据记录一律不算。
   */
  P57: {
    label:
      "自写「剔掉私有 prop 再透传」的剔除表（应使用 ~/lib/dom-props 的 OmitOwnProps / splitDomProps）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      if (/from "~\/lib\/dom-props"/.test(t2)) return 0;
      /* 形态：`Omit<` 的基类型是**底层元素 / 组件的属性集**，且第二个参数是
       * 字符串字面量键（`"a" | "b"` 或跨行的 `| "c"`）。 */
      const base =
        "(?:React\\.)?(?:ComponentProps|HTMLAttributes|InputHTMLAttributes|ImgHTMLAttributes|VideoHTMLAttributes|ButtonHTMLAttributes|AnchorHTMLAttributes|LabelHTMLAttributes|TextareaHTMLAttributes)|LucideProps|[A-Za-z]*Primitive\\.[A-Za-z.]+Props|typeof\\s+\\w+";
      const oneLine = new RegExp(
        "\\bOmit\\s*<\\s*(?:" + base + ')[^;]{0,200}?,\\s*"[^"]+"',
        "g",
      );
      const multiLine = new RegExp(
        "\\bOmit\\s*<[^;]{0,200}?(?:" +
          base +
          ')[^;]{0,300}?\\n\\s*\\|[^;]{0,200}?"[^"]+"',
        "g",
      );
      return (
        (t2.match(oneLine) || []).length + (t2.match(multiLine) || []).length
      );
    },
  },

  /* ── P58「给一个异步结果加超时」（硬闸，§16.2.4.62）
   * `Promise.race` + `setTimeout` 的样板散在六处，对三件事各判各的：
   * **定时器谁来清**（`.finally` / 两个分支各清一次 / 三个分支各清一次 /
   * 只有一个分支清）、**超时之后干什么**（`reject` / `resolve` 一个哨兵值 /
   * 杀子进程再 fail）、**时长与文案**。
   *
   * 判据锚**「一个定时器在赛跑里把 Promise 结算掉」这个形态**，两种写法都数：
   *   ① **`Promise.race(` 与 `setTimeout(` 同现** —— 最常见的一档。单看
   *     `Promise.race` 会把「两路来源谁先到用谁」那种**正确的**用法误判
   *     （`comfyui/status` 的「权威查询 vs 抢跑探测」：没有定时器、没有要清的
   *     东西，那不是这条账），故两条必须同现；
   *   ② **`setTimeout(() => … resolve(` / `reject(`** —— 手写「定时器到点就把这个
   *     Promise 结算掉」的那一档（`waitForImage` 的 `reject` / `runFFmpeg` 的
   *     `resolve` 哨兵），它们**不用** `Promise.race` 而靠「谁先结算谁算数」，
   *     一样要清定时器、一样各写各的。
   *
   * **刻意不数**：
   *   · `new Promise((r) => setTimeout(r, ms))`（「等一会儿」的 sleep，没有赛跑、
   *     没有对手 —— 但它与两个出口同属「定时器」一族，收在同一文件的 `sleep` 里）；
   *   · `setTimeout(() => void fail(…))` 这种**看门狗 / 防抖**（定时器到点**做事**，
   *     不结算任何 Promise，也不在这条账里 —— 实例是 `executor-ws.armWatchdog`
   *     与 `runner-state` 的三处 debounce）。
   *
   * 出口是 `~/lib/with-timeout` 的 `withTimeout`（超时抛错）/
   * `withTimeoutResult`（超时给兜底值）—— 两者共用一条「胜出即清定时器」的收尾。
   */
  P58: {
    label:
      "自写「给异步结果加超时」的定时器样板（应使用 ~/lib/with-timeout 的 withTimeout / withTimeoutResult）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      if (/from "~\/lib\/with-timeout"/.test(t2)) return 0;
      /* 「必须清掉」是本条账的一半：有 `setTimeout` 却没有 `clearTimeout` 的文件
       * 是**另一种**形态（该等一个窗口就等完，没有别的路径能先赢 ——
       * `external-open.detectFolderHelper` 就是这一种），不属于本条。 */
      if (!/\bclearTimeout\s*\(/.test(t2)) return 0;
      const races = /\bsetTimeout\s*\(/.test(t2)
        ? (t2.match(/\bPromise\.race\s*\(/g) || []).length
        : 0;
      /* ② 定时器回调里结算 Promise（`resolve(` / `reject(` 就在 setTimeout 的
       * 回调体内）。锚点取「setTimeout」与「resolve/reject」在**同一条语句的
       * 200 字符内**同现 —— 手写那几档的写法都是
       * `setTimeout(() => reject(new Error(…)), ms)` 或
       * `const t = setTimeout(() => { … resolve({…}); }, ms)`。 */
      /* `[\s\S]` 而非 `[^;]`：回调体里常有 `;`（`cp.kill("SIGKILL");` 后面
       * 才是 `resolve(…)`），用 `[^;]` 会把那一档**静默漏掉**（漏掉的又恰好是
       * 更完整的那个写法 —— 与 P13/P52「更差的写法也要数」同一课）。 */
      const settles = (
        t2.match(
          /\bsettimeout\s*\([\s\S]{0,200}?\b(?:resolve|reject)\s*\(/gi,
        ) || []
      ).length;
      /* ③ 定时器回调里调一个**本地的结算助手**（`finish(` / `settle(` / `done(`）——
       * `waitForDetachMediator` 就是这样写的：它把「这一轮结束」收成 `finish()`
       *（内部判重入 + resolve），定时器到点调它。只看 `resolve(` 会漏掉这一档。
       * 这几个名字在本仓库的语义是「本轮到此为止」。 */
      const settledByHelper = (
        t2.match(
          /\bsetTimeout\s*\([\s\S]{0,200}?\b(?:finish|settle|done)\s*\(/gi,
        ) || []
      ).length;
      return races + settles + settledByHelper;
    },
  },

  /* ── P59「把一个数夹进一个区间」（硬闸，§16.2.4.63）────────────────────
   * 全库 19 处手写 `Math.min` / `Math.max` 的夹取，四派写法都编译、都运行、
   * 类型都对，差别只在**参数顺序**（`Math.min(max, Math.max(min, x))` 与
   * `Math.max(min, Math.min(max, x))` 都有人写）、**取整在内层还是外层**、
   * 以及**非有限数怎么办**（`Math.max(0, NaN)` 是 `NaN`，会一路静默传播）。
   *
   * 判据锚**两种 Math 的嵌套**这个形态签名：`Math.max(` 里包着 `Math.min(`、
   * 或反过来 —— 这正是「夹取」的形状，而**纯 max(max) / min(min) 不是**
   *（`NodeFrost` 的 `Math.max(1, 1 / Math.max(zoom, 0.01))` 是取值不是夹取），
   * 故要求**两种不同**的 Math 函数嵌套。
   *
   * 刻意**不数**「半个夹取」（`Math.max(0, x)` 只有一个边界）：那表达的是
   * 「不许为负 / 不许超过 n」，不是「放进区间」，换成 `clamp(x, 0, Infinity)`
   * 只会更绕。落点见 `LogPanel` / `log-virtual` 的防负索引。
   *
   * 出口：`~/lib/clamp` 的 `clamp` / `clampInt`。
   */
};
