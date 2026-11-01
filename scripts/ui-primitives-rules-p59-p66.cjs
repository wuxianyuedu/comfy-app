#!/usr/bin/env node
// @ts-nocheck -- UI 基元判据的规则表分片：P59 ~ P66（事件收口 / 分页 / 节流 / 忙碌位 / 轮询 …）
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
/* 引擎 helper 按本片实际用量解构（core no-unused-vars 守着）；跨片搬规则时同步增删。 */
const { stripCommentsCached, countNestedMinMax } = require("./ui-primitives-engine.cjs");

module.exports = {
  P59: {
    label: "视图 / 逻辑 / 服务端里手写数值夹取（应使用 ~/lib/clamp 的 clamp / clampInt）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 已用出口的文件跳过（换用出口即自动合规）。 */
      if (/from "~\/lib\/clamp"/.test(t2)) {
        return 0;
      }
      return countNestedMinMax(t2);
    },
  },

  /* ── P60「把一个可能带空白 / 缺省的外来串归一成大写记号」（硬闸，§16.2.4.64）
   * 全库 26 处各写一遍 `(x ?? "").trim().toUpperCase()` 这一族，而它们
   * **不是同一件事**：差别只在「要不要吃空白」上 —— 而这一条决定**匹配成败**
   *（ComfyUI 的类型字段带尾随空白、模式码来自用户输入）。
   * 收口前的实况是同一个文件里两种写法并存（`model-mode-contract.ts` 的
   * `builtInModeContract` trim、`modeContractEntries` 不 trim）。
   *
   * 判据取**两种形态**，它们共同的特征是「从缺省 / 空白里取值」：
   *   ① `(x ?? "").toUpperCase()` —— 明确处理了缺省；
   *   ② `.trim().toUpperCase()` —— 明确处理了空白。
   * **刻意不数 `x.toUpperCase()`**（`x` 是类型上非空的 `string`）：那是
   * 「把已知值画成大写展示」，不是「归一外来串」，数进来会逼人改坏代码
   *（`log-store` 的行内级别、`StyleSwitcher` 的档名展示都是这一档）。
   *
   * 出口：`~/lib/upper-token` 的 `upperToken` / `upperTokenOr`。
   */
  P60: {
    label: "视图 / 逻辑 / 服务端里自写大写归一（应使用 ~/lib/upper-token 的 upperToken）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 已用出口的文件跳过（换用出口即自动合规）。 */
      if (/from "~\/lib\/upper-token"/.test(t2)) {
        return 0;
      }
      /* ② 先数（含 `.trim()` 的形态一并数进来）。
       * ① 再数**不带 `.trim()`** 的 `?? ""` 形态 —— 否则
       * `(x ?? "").trim().toUpperCase()` 会被两种形态各数一次（重复计）。 */
      const trimmed = (t2.match(/\.\s*trim\(\)\s*\.\s*toUpperCase\s*\(/g) ?? []).length;
      const plain = (t2.match(/\?\?\s*(?:"[^"]*"|'[^']*')\s*\)\s*\.toUpperCase\s*\(/g) ?? [])
        .length;
      return trimmed + plain;
    },
  },

  /* ── P61「跨组件广播一条应用事件」（硬闸，§16.2.4.65）──────────────────
   * 全库 5 条自定义事件散在 9 个文件里，事件名与载荷的类型**分开两处**：
   * `comfyapp:canvas-store-changed` 的名字定义在 `lib/project-canvas` 却
   * **不导出**（视图侧 3 处硬编码字符串）、`canvas:produce` 的载荷类型只在
   * 读侧有个 `as {...}` 断言、`open-task` 与
   * `comfyapp:local-workflows-path-changed` 的**派发方已经消失**（死监听，
   * 没有任何构建 / 测试会报它）。
   *
   * 判据取**两种形态**：
   *   ① `new CustomEvent(` —— 自建应用事件；
   *   ② `window.addEventListener("…:…"` —— 订阅一个**带命名空间冒号**的事件名
   *     （应用事件的命名空间形态，与 `keydown` / `change` / `resize` 这类
   *     DOM 原生事件名区分开）。
   * 两个条件都**只认带冒号或 `new CustomEvent`** 的写法：`addEventListener("click")`
   * 这类 DOM 事件不在本条账里。
   *
   * 出口：`~/lib/app-events` 的 `emitAppEvent` / `subscribeAppEvent` +
   * `AppEvents` 表（事件名与载荷同处定义）。
   */
  P61: {
    label:
      "视图 / 逻辑 / 服务端里裸写应用事件（应使用 ~/lib/app-events 的 emitAppEvent / subscribeAppEvent）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 已用出口的文件跳过（换用出口即自动合规）。 */
      if (/from "~\/lib\/app-events"/.test(t2)) {
        return 0;
      }
      const dispatched = (t2.match(/\bnew CustomEvent\s*\(/g) ?? []).length;
      const namespaced = (
        t2.match(
          /\.(?:add|remove)EventListener\s*\(\s*(?:[A-Za-z_$][\w$]*\s*,\s*)?["'][a-z][\w-]*:[\w:-]+["']/g,
        ) ?? []
      ).length;
      return dispatched + namespaced;
    },
  },

  /* ── P62「把一组 props 转成另一个键的 props」（硬闸，§16.2.4.66）──────
   * 全库 42 处 `onChange={(e) => FUNC(e.target.value)}` 这一族：都做同一件事
   *（把 DOM 事件里取出的**值**交给只关心值的回调），而写法分四派，每一派都
   * 编译、都运行、类型都对 —— 差别只在几个从没被写下来的决定上：
   * 取 `target.value` 还是 `target.checked`；要不要就地 `Number(...)`；
   * 过滤规则写在谁那里；对象改写的**键名**靠人眼对齐（写错一个字符就静默
   * 写到另一个字段上）。
   *
   * 判据取**两种形态**（都以「事件对象的取值」为锚，不取函数名）：
   *   ① `X => FUNC(X.target.value)` —— 文本类控件的改写样板；
   *   ② `X => FUNC(X.target.checked)` —— 复选框 / 开关的改写样板。
   * **刻意不数**带语句体的处理（`onChange={(e) => { … }}`）：那一族里常常要
   * 在同一个事件里做别的事（读 `scrollHeight` 调高度、按值分派多个字段），
   * 数它只会逼人把多步逻辑塞进一个表达式去迎合判据。那一侧的合规由
   * `readTextInput` 提供（取值仍只有一处），判据够不着、也不该硬够。
   *
   * 出口：`~/lib/form-props` 的 `textHandler` / `checkedHandler` /
   * `numberHandler` / `bindKey` / `readTextInput`。
   */
  P62: {
    label:
      "视图里自写「事件值 → 值回调」的改写样板（应使用 ~/lib/form-props 的 textHandler / checkedHandler）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 已用出口的文件跳过（换用出口即自动合规）。 */
      if (/from "~\/lib\/form-props"/.test(t2)) {
        return 0;
      }
      const value = (
        t2.match(
          /=>\s*[A-Za-z_$][\w$.[\]?]*\(\s*[A-Za-z_$][\w$]*\.(?:target|currentTarget)\.value\s*\)/g,
        ) ?? []
      ).length;
      const checked = (
        t2.match(
          /=>\s*[A-Za-z_$][\w$.[\]?]*\(\s*[A-Za-z_$][\w$]*\.(?:target|currentTarget)\.checked\s*\)/g,
        ) ?? []
      ).length;
      return value + checked;
    },
  },

  /* ── P63「给一个列表做分页 / 窗口切片」（硬闸，§16.2.4.67）────────────
   * 全库做「从一个列表里切出一段」的算术，而它们是**三种方向相反的窗口**，
   * 此前从未被写下来：倒序分页（第 1 页最新）、尾部窗口（恒取最后 N 条）、
   * 平行分块（从头按片长切）。三者的边界处理各异，而每一种差异都是静默的：
   * 空列表让 `end` 变负、页码越界不钳回（「看着第 1 页、state 里却是第 9 页」）、
   * `pageSize` 传 0 让 `ceil(total / 0)` 变成 `Infinity` 页。
   *
   * 判据取**三种形态**：
   *   ① `… . length - … * …` —— 倒序分页的偏移算式（含 `Math.max(0, …)`
   *     那种「防负」包法）；
   *   ② `Math.ceil(… / …)` —— 总页数 / 总块数；
   *   ③ **接收者像集合**的 `.slice(-N)` —— 尾部窗口的字面写法。
   * **刻意不数**通用字符串 `slice`（`slice(0, 6)` 取短码、`slice(1)` 去前缀
   * 到处都是，数它只会逼人改坏代码）；③ 的接收者必须像集合
   *（`logs` / `items` / `entries` / `lines`…）而非任意字符串 ——
   * `id.slice(-4)` 与 `.toString(36).slice(-4)` 是**取短码**（显示位数），
   * 与「取列表尾部 N 条」不是同一件事。
   *
   * 出口：`~/lib/page-window` 的 `tailPages` / `countAfterPage` /
   * `tailWindow` / `chunkRange` / `LOG_MODAL_MAX_ROWS`。
   */
  P63: {
    label:
      "自写分页 / 窗口切片的算术（应使用 ~/lib/page-window 的 tailPages / tailWindow / chunkRange）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 已用出口的文件跳过（换用出口即自动合规）。 */
      if (/from "~\/lib\/page-window"/.test(t2)) {
        return 0;
      }
      const offset = (
        t2.match(/\.length\s*-\s*[A-Za-z_$][\w$.[\]?]*\s*\*\s*[A-Za-z_$0-9][\w$.[\]?]*/g) ?? []
      ).length;
      const ceilDiv = (
        t2.match(/Math\.ceil\s*\(\s*[A-Za-z_$][\w$.[\]?]*\s*\/\s*[A-Za-z_$0-9][\w$.[\]?]*\s*\)/g) ??
        []
      ).length;
      const tail = (
        t2.match(
          /\b(?!Date\b)(?:logs?|items?|entries|rows?|lines?|list|arr|all|values?|records?|history|sessions?|segments?|collected|out)\b[\w$.[\]?]*\.slice\(\s*-\s*(?:[A-Za-z_$][\w$]*|\d+)\s*\)/g,
        ) ?? []
      ).length;
      return offset + ceilDiv + tail;
    },
  },

  /* ── P64「把一次进度回调节流后写进 state」（硬闸，§16.2.4.68）─────────
   * `watchTask` 的 `onProgress` 是**高频**回调（SSE 每帧一次，一次生成可调
   * 几百次），而全库 6 处把它直接接到 `setState` 上，六处**没有一处节流**。
   * 差别不在「怎么写这一行」，而在三个从未被写下来的决定上：多久写一次、
   * 同值要不要短路、卸载之后还写不写。
   *
   * 判据取**「进度回调」这一形态**：
   * `onProgress: (…) => setXxx(` 或 `onProgress: (…) => { … setXxx(…` ——
   * 即「订阅回调用的是 setter」。**刻意不取 `setProgress(` 这个函数名**：
   * 那条名字在全库既是「进度」也是「上传进度」「提取进度」
   *（`use-dynamic-workflow-form` 的 `onUploadProgress` 就是另一条通道），
   * 按名字数会连「不是订阅回调的写入点」一起算进来。
   *
   * 出口：`~/components/ui/use-throttled-progress` 的 `useThrottledProgress`
   *（单值）/ `useThrottledProgressMap`（按条目）/ `createThrottleGate`（只判闸门）。
   */
  P64: {
    label:
      "把高频进度回调直接写进 state（应使用 ~/components/ui/use-throttled-progress 的 useThrottledProgress / useThrottledProgressMap / createThrottleGate）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 已用出口的文件跳过（换用出口即自动合规）。 */
      if (/from "~\/components\/ui\/use-throttled-progress"/.test(t2)) {
        return 0;
      }
      /* 只认「订阅回调里写 state」：`onProgress:` 之后同一段里出现 setter。 */
      const hits =
        t2.match(/onProgress\s*:\s*\([^)]*\)\s*=>\s*(?:\{[\s\S]{0,400}?)?set[A-Z][\w$]*\s*\(/g) ??
        [];
      return hits.length;
    },
  },

  /* ── P65「一次异步动作的忙碌位的复位写在成功路径上」（硬闸，§16.2.4.71）──
   * 全库 20 处「先置忙碌位、跑完再复位」的执行态把复位写在**成功路径**上
   *（`await …; setBusy(false);`）而不是 `finally` 里。差别是静默的：
   * 动作只要抛错（网络异常、`await` 之后那一行 `setXxx` 抛、`runAsyncAction`
   * 之外的任何一行），忙碌位就**永远停在 true** —— 界面从此显示「正在保存…」，
   * 按钮再也点不动，只有刷新页面才恢复。设置页的 6 个启动 / 关闭动作、
   * 工坊两个批处理、影片台、训练页、登录页都在这一族里。
   *
   * 判据锚**「复位的位置」**这一形态，不锚 API、不锚名字：
   *   · `setX(true)` 与 `setX(false)` 同现（该 setter 有忙 / 闲两态）；
   *   · 两者之间跨了 `await`（它是「一次异步动作」的执行态，不是同步开关）；
   *   · 而 `setX(false)` 之前**没有** `finally` / `catch`（复位只在成功路径上）。
   * **刻意不数**「复位写在 `finally` 里」的那些 —— 那形态本身是对的
   *（`use-workflow-detail-loader` 的竞态令牌、`use-custom-nodes-settings`
   * 的按子包忙碌位都属于这一类），数它们只会逼人改坏代码。
   *
   * 出口：`~/components/ui/use-busy-action` 的 `useBusyAction`（复位绑在
   * `finally` 上、卸载守卫、不吞错），store 级忙碌位见
   * `~/components/update-check/update-check-store` 的 `runChecking`。
   */
  P65: {
    label:
      "把一次异步动作的忙碌位复位写在成功路径上（应使用 ~/components/ui/use-busy-action 的 useBusyAction）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 已用出口的文件跳过（换用出口即自动合规）。 */
      if (/from "~\/components\/ui\/use-busy-action"/.test(t2)) {
        return 0;
      }
      const decl = /const\s*\[\s*\w+\s*,\s*(set[A-Z][\w$]*)\s*\]\s*=\s*(?:React\.)?useState\s*\(/g;
      const setters = new Set();
      let m;
      while ((m = decl.exec(t2)) !== null) {
        setters.add(m[1]);
      }
      let hits = 0;
      for (const setter of setters) {
        const off = new RegExp(String.raw`\b` + setter + String.raw`\(\s*false\s*\)`);
        if (!off.test(t2)) {
          continue;
        }
        const on = new RegExp(String.raw`\b` + setter + String.raw`\(\s*true\s*\)`, "g");
        let o;
        while ((o = on.exec(t2)) !== null) {
          /* 取置忙之后的一段，够跨过动作体（含 NDJSON 流式消费那种长回调）。 */
          const window = t2.slice(o.index, o.index + 1500);
          const offAt = window.search(off);
          if (offAt < 0) {
            continue;
          }
          const awaitAt = window.search(/\bawait\b/);
          if (awaitAt < 0 || awaitAt > offAt) {
            continue;
          }
          const before = window.slice(0, offAt);
          if (/\bfinally\b/.test(before) || /\bcatch\b/.test(before)) {
            continue;
          }
          hits++;
        }
      }
      return hits;
    },
  },

  /* ── P66「一次异步动作的重入闸门」（硬闸，§16.2.4.69）──────────────────
   * 同一件事全库有三种做法：**没有**闸门（靠读 state 判，而 `setState` 是
   * 异步的，同一次事件循环里两次点击都读到 `false`）、**自建 ref 闸门**
   *（`const xxRef = useRef(false)` + 读它判重入 + 置位 / 复位各一处）、
   * 以及出口。第二族此前散在五个文件里，每个都写了同一段样板、且复位分散。
   *
   * 判据锚**「自建的重入闸门」这一形态**：一个 `useRef` 声明的名字带
   * `busy` / `pending` / `inflight` / `locked` / `running` / `checked`，
   * 且在同一段里有 **写**（`.current = …`）与**至少两处读**（判重入 + 复位）。
   * `useReentrancyLock` 自己那份实现在 EXEMPT_FILES 里显式登记。
   *
   * **刻意不数**纯「最近一次的值」ref（`justDraggedRef` / `prevXRef` /
   * `projectIdRef` 这类镜像 ref）：它们只读不写、或只写一次，不是闸门。
   * 形态上的分界线是**名字所指的语义**与**写 + 两读**这两个条件同时成立。
   *
   * 出口：`~/components/ui/use-reentrancy-lock` 的 `useReentrancyLock`（同步 `tryEnter` /
   * `exit`）/ `createReentrancyLock`（跨组件实例、非 hook 场景）。
   */
  P66: {
    label:
      "自建「同一时刻只跑一件」的重入闸门（应使用 ~/components/ui/use-reentrancy-lock 的 useReentrancyLock / createReentrancyLock）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 已用出口的文件跳过（换用出口即自动合规）。 */
      if (/from "~\/components\/ui\/use-reentrancy-lock"/.test(t2)) {
        return 0;
      }
      const decl = /(?:const|let)\s+(\w+)\s*=\s*(?:React\.)?useRef\s*\(/g;
      let m;
      let hits = 0;
      while ((m = decl.exec(t2)) !== null) {
        const name = m[1];
        /* 只认「闸门语义」的名字 —— 镜像 ref / 计数 ref 不算。 */
        if (!/busy|pending|inflight|locked|running|checked/i.test(name)) {
          continue;
        }
        const window = t2.slice(m.index, m.index + 900);
        const writes = (window.match(new RegExp(String.raw`\b` + name + String.raw`\.current\s*=`, "g")) ?? [])
          .length;
        const reads = (window.match(new RegExp(String.raw`!?\b` + name + String.raw`\.current`, "g")) ?? []).length;
        if (writes >= 1 && reads >= 2) {
          hits++;
        }
      }
      return hits;
    },
  },
};
