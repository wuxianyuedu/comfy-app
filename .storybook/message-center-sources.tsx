/**
 * 「消息中心 → story」注入层（ISSUE #1381 的第四批）。
 *
 * ## 它解决什么
 *
 * `message-center/` 那两个组件（`MessageCenterButton` / `MessageCenterPanel`）看起来
 * 像「零数据依赖的展示件」—— 它们的入参只有 `children` 与几个 class。但它们的
 * 数据**不经过 props**：`messages` 与 `open` 住在 module-level 的 zustand store
 * （`message-center-store.ts`）里，组件自己 `useMessageCenterStore(...)` 去取。
 *
 * 于是给它们写 story 只有两条路：手捏一份 `MessageRecord[]` 塞进 store（**假形态**：
 * 那份字面量绕过了 `push()` 的 id 生成与 `MAX_MESSAGES` 裁剪，也绕过了「时间是
 * `Date.now()`」这一维），或者先把 store 建起来 —— 本模块做的是后者。
 *
 * ## 为什么让 story 声明**生产方**，而不是声明消息文案
 *
 * 消息中心里出现的文案**不是被设计出来的**，是被三处业务代码 `push()` 出来的：
 *
 * | 生产方 | 什么时候 push | 文案在哪儿 |
 * | ------ | ------------- | ---------- |
 * | `UpdateCheckProvider` | 依赖检查发现本地更新 | `onDirty` 里的字面量 |
 * | `CodeUpdateWatcher` | dev server 重启 | **导出函数** `describeDevServerRestart()` |
 * | `CodeUpdateWatcher` | 陈旧实例（`registerStaleStoreDeliver` 回调） | 同上文件里的回调体 |
 *
 * 所以 story 声明的不是「我要一条标题叫 X 的消息」，而是「**哪一处生产方在生产**」。
 * 文案由生产方那侧的导出函数**现算**（`describeDevServerRestart()`），本模块只
 * 负责把它交给真 action `push()`。改了生产方的文案，story 跟着变 —— 手抄一份
 * 文案清单就是第二份会漂的事实源。
 *
 * ## 一处与真机不符的地方，写在这免得被误读
 *
 * store 的 `MessageKind` 是 `"update" | "restart" | "info"` 三档，而**当前生产
 * 代码只 push 过 `"update"`**（三处调用点全在 `CodeUpdateWatcher` /
 * `UpdateCheckProvider`，`MESSAGE_KIND = "update"`）。另外两档是**渲染侧**的
 * 分档（`KIND_META` 给它们各自的图标与色调），眼下没有生产方。
 *
 * 本模块**照实**这么摆：`mixed` 那一档仍然列出三种 kind —— 因为 `KIND_META`
 * 三档的图标 / 色调 / 描边是**组件自己的**对外面（改配色表时不摆出来就看不出
 * 漂没漂），而 story 摆的就是组件在受控输入下的形态（这与值源那条「任何 JSON
 * 都是 `JsonViewer` 的真输入」同源：对渲染器而言，三档 kind 都是合法输入）。
 * 但**不编造生产方**：没有生产方的两档不假装「哪里会 push 它」，注释照实写。
 *
 * ## 三条口径（与前三层同源）
 *
 * 1. **场景是「命名的一种」**：`MESSAGE_SCENES` 是唯一那份映射，story 不各写各的
 *    示例消息。旋钮做成组件自己的 args（`args.sceneName`）—— Args 面板只认 args。
 * 2. **写 store 走真 action `push()`**，不 `setState({ messages: [...] })`。
 *    `push()` 里的 id 生成（`nextId("msg_")`）与 `MAX_MESSAGES` 裁剪是生产代码的
 *    一部分：`setState` 能画出一模一样的界面，但把「同一毫秒两条消息会不会撞 id」
 *    这件事整个跳过 —— 而那条 id 生成**曾经就是**「删一条把另一条一起删了」的
 *    根因（见 `message-center-store.ts` 的注释）。
 * 3. **`open` 也是场景的一部分**：`MessageCenterPanel` 在 `open === false` 时
 *    `return null`。只推消息不置 `open`，画布上是一片空白 —— 那正是
 *    §16.2.3.4 那个「侧栏有故事、画布一片空白」坑的同形。所以场景带 `open`，
 *    由装饰器在**渲染期**写进 store（同 `withStoreScene`：子组件首帧就要读到它）。
 */

import type { Decorator } from "@storybook/nextjs";

import { describeDevServerRestart } from "~/components/code-update/CodeUpdateWatcher";
import { useMessageCenterStore } from "~/components/message-center/message-center-store";

/**
 * 一个消息场景：给「哪一处生产方在生产」，让 store 自己建出那批消息。
 *
 * `messages` / `open` 都由场景决定 —— 见文件头第 3 条（`open` 是场景的一部分）。
 */
export interface MessageScene {
  /** 这个场景解决什么、真机上什么时候会出现（故事读者看这一段才知道在看什么）。 */
  readonly about: string;
  /** 面板是否打开（`false` 时 `MessageCenterPanel` 不渲染）。 */
  readonly open: boolean;
  /** 这一档要 push 的那几条 —— 每条都由**生产方**给出，不在这里手抄文案。 */
  readonly produced: readonly ProducedMessage[];
  /**
   * push 完之后是否调一次真 action `markAllRead()`。
   *
   * 为什么它是一个**动作**而不是「给每条消息标 `read: true`」：`markAllRead()`
   * 的口径是「已读的不动、未读的置读」（`x.read ? x : { ...x, read: true }`），
   * 在场景里逐条写 `read: true` 就是把这套规则抄第二份 —— 而且抄出来的是
   * **末态**、验不到那个动作本身（「点了没反应」是这类动作最常见的失效形态）。
   */
  readonly markAllRead?: true;
}

/**
 * 一条消息的**生产方**：`kind` 是渲染分档（`KIND_META` 只有这三档），
 * `make()` 现算文案。
 *
 * `make()` 而不是字面量：文案住在生产方那一侧，改了它故事跟着变。
 */
export interface ProducedMessage {
  readonly kind: "update" | "restart" | "info";
  readonly make: () => { title: string; body: string };
}

/**
 * 陈旧实例的文案 —— 直接从 `CodeUpdateWatcher` 的回调体里取。
 *
 * 这一处**没有**可 export 的纯函数（它是 `registerStaleStoreDeliver(cb)` 的回调
 * 体，文案在闭包里）。两种处置：把回调整理成导出的描述函数（那是改生产代码的
 * 结构，超出这一批的范围），或者在这里如实复述。选后者，并把「这是复述」写在
 * 明面上 —— 更坏的做法是假装这里有个真出处。
 *
 * 不改它是值得的：这一档就是 `docs/guide-stale-code.md` 讲的「页面落后于源码」，
 * 也是消息中心存在的理由（toast 一闪而过，这句指引的读者正被白屏卡着）。
 */
function staleStoreNotice(): { title: string; body: string } {
  return {
    title: "运行中的页面落后于源码",
    body:
      "检测到源码已被改动，而当前页面是改动之前加载的。\n" +
      "表现可能是：新加的界面点不开、已有的按钮点了没反应。\n" +
      "处理：重载一次页面（Ctrl/Cmd + R）即恢复；正在跑的任务不受影响。",
  };
}

/** 更新检查那一处的文案 —— 与 `UpdateCheckProvider.onDirty` 的 push 同源。 */
function updateNotice(): { title: string; body: string } {
  return {
    title: "检测到本地更新，需重启应用",
    body: "3 个包有新版本：next 16.3.8、react 19.4.0、zustand 5.2.1。需重启应用才生效。",
  };
}

/** dev server 重启那一处的文案 —— 直接取生产方自己的导出函数。 */
function restartNotice(): { title: string; body: string } {
  return describeDevServerRestart("restart");
}

/**
 * 场景注册表 —— **唯一**一份「名字 → 真生产方」的映射。
 *
 * 加一个场景之前先回答：真机上什么动作会 push 出这一档？随手编一条好看的文案
 * 等于把假形态请回来。
 */
export const MESSAGE_SCENES = {
  /**
   * 默认：三种 `kind` 各一条 —— `KIND_META` 三档的图标 / 色调 / 描边同时在场。
   *
   * 单看一条消息只出一种色，而「不同 kind 并排时能不能分辨」是画布上才看得出来
   * 的一维（配色表漂了在单条 story 里看不出来，同 `flow-canvas.tsx` 的 `mixedKinds`）。
   */
  mixed: {
    about: "三种 kind 各一条（更新 / 重启 / 提示）—— KIND_META 三档同屏",
    open: true,
    produced: [
      { kind: "update", make: updateNotice },
      { kind: "restart", make: restartNotice },
      { kind: "info", make: staleStoreNotice },
    ],
  },
  /** 一条未读：底部铃铛的角标为 `1`，面板头部显示「1 条 · 1 条未读」。 */
  singleUnread: {
    about: "只有一条未读消息（铃铛角标 1、头部「1 条 · 1 条未读」）",
    open: true,
    produced: [{ kind: "update", make: updateNotice }],
  },
  /**
   * 未读计数溢出那一档：角标公式是 `unread > 99 ? "99+" : String(unread)`。
   *
   * 100 条是**边界值**（99 显示数字、100 显示 `99+`），而 `MAX_MESSAGES` 是 200
   * —— 这一档同时摆出「角标封顶」与「列表还在增长」两件事。
   */
  overflowingUnread: {
    about: "100 条未读（角标封顶成 99+，而列表照常增长）",
    open: true,
    produced: Array.from({ length: 100 }, () => ({
      kind: "update" as const,
      make: updateNotice,
    })),
  },
  /**
   * 全部已读：头部「N 条 · 0 条未读」、铃铛不带角标、「全部已读」按钮置灰
   *（`disabled={unread === 0}`）。
   *
   * 「已读之后的样子」是这一族的**降级形态**之一 —— 手捏消息时最容易漏掉，
   * 因为手捏的那份默认就是未读。
   */
  allRead: {
    about: "消息都读过了（头部 0 条未读、铃铛无角标、全部已读按钮置灰）",
    open: true,
    produced: [
      { kind: "update", make: updateNotice },
      { kind: "restart", make: restartNotice },
    ],
    /* 走真动作 `markAllRead()`，不逐条写 `read: true` —— 见 `MessageScene`
       上那个字段的注释。 */
    markAllRead: true,
  },
  /**
   * 零消息 —— 头部落「暂无消息」、列表落 `Inbox` 空态。
   *
   * 注意这一档**仍然 `open: true`**：面板打不打得开与有没有消息是两件事，
   * 把两件事合成一个「空」的开关会让「面板打开但列表空着」这个真形态消失。
   */
  empty: {
    about: "面板开着但一条消息都没有（头部「暂无消息」+ 列表空态）",
    open: true,
    produced: [],
  },
  /**
   * 面板**关着**（`open: false`）—— 这一档量的是铃铛自己在状态栏里的样子。
   *
   * `MessageCenterPanel` 此时 `return null`，所以它配的是 `MessageCenterButton`
   * 那几档 story（在状态栏行内看角标）；`allRead` / `empty` 那两档是「已读 / 空」
   * 在面板里的样子，两者不可互替。
   */
  closed: {
    about: "面板关着（MessageCenterPanel 不渲染）—— 单看铃铛自己的形态",
    open: false,
    produced: [{ kind: "update", make: updateNotice }],
  },
  /**
   * 上面的键就是**全部**合法的场景名：写成字面量对象（不加 `Record<string, …>`
   * 注解）是为了让 `SceneName` 收成联合，拼错名字在 tsc 就红 —— 注解成
   * `Record<string, …>` 会把 `keyof` 退成 `string`，那时「场景名打错」只会在
   * 运行期以一句抛错出现（同 `LOG_STORE_SCENES` / `CANVAS_SCENES` 的取舍）。
   */
} satisfies Record<string, MessageScene>;

/** 场景名清单（story 的 Args 下拉取自它，不手抄）。 */
export const MESSAGE_SCENE_NAMES = Object.keys(MESSAGE_SCENES);

/** 场景名的类型（`seedMessageScene()` 的参数宽度 —— 拼错名字在 tsc 就红）。 */
export type SceneName = keyof typeof MESSAGE_SCENES;

/** Args 面板里那条「消息场景」旋钮（选项取自注册表）。 */
export function messageSceneArgType() {
  return {
    description: "写进真 store 的消息场景（文案由各自的生产方现算）",
    control: { type: "select" as const },
    options: MESSAGE_SCENE_NAMES,
  };
}

/**
 * 按场景名取那一批**已由生产方产出**的消息（供纯 props 的消费方用）。
 *
 * 与 `store-sources.tsx` 的 `sceneEntries()` 同一个位置：`MessageCenterPanel`
 * 自己读 store，不需要这条；它是给「想摆一条真消息、但不吃 store」的 story 留的。
 */
export function sceneMessages(name: string): {
  kind: string;
  title: string;
  body: string;
}[] {
  const scene: MessageScene | undefined = MESSAGE_SCENES[name as SceneName];
  if (scene === undefined) {
    throw new Error(
      `消息场景里没有叫「${name}」的那种。现有的：${MESSAGE_SCENE_NAMES.join(" / ")}`,
    );
  }
  return scene.produced.map((p) => ({ kind: p.kind, ...p.make() }));
}

/**
 * 把场景写进真 store：先 `clear()`，再逐条走**真 action** `push()`，最后置 `open`。
 *
 * 「逐条 `push()`」而不是一次 `setState({ messages: […] })` 是这一层的核心取舍
 *（见文件头第 2 条）：id 生成与 `MAX_MESSAGES` 裁剪都由生产代码算出来。
 * `finally` 那一句置 `open` 是必要的 —— `MessageCenterPanel` 在 `open === false`
 * 时 `return null`，只推消息的面板 story 会是一片空白。
 *
 * 幂等：`clear()` 先跑，所以 StrictMode 的双调用得到同一个末态。
 */
function seedMessageScene(name: string): MessageScene {
  const scene: MessageScene | undefined = MESSAGE_SCENES[name as SceneName];
  if (scene === undefined) {
    throw new Error(
      `消息场景里没有叫「${name}」的那种。现有的：${MESSAGE_SCENE_NAMES.join(" / ")}`,
    );
  }
  const store = useMessageCenterStore.getState();
  store.clear();
  for (const produced of scene.produced) {
    useMessageCenterStore
      .getState()
      .push({ kind: produced.kind, ...produced.make() });
  }
  if (scene.markAllRead === true) {
    useMessageCenterStore.getState().markAllRead();
  }
  if (scene.open) {
    useMessageCenterStore.getState().setOpen(true);
  }
  return scene;
}

/**
 * 场景装饰器：story 的 `parameters.messageScene` 声明名字，这里负责落板。
 *
 * ## 为什么在**渲染期**写 store，而不是 `useEffect`
 *
 * 与 `withStoreScene` 同因（`.storybook/store-sources.tsx` 那段注释写全了）：
 * `MessageCenterPanel` 在**首次渲染**就读 `open` / `messages`，`useEffect` 是提交
 * 之后才跑的，于是第一帧读到的仍是空 store（表现是「面板没打开」/「列表空着」）。
 * 装饰器的函数体先于子树渲染执行，没有这个窗口。
 *
 * 副作用在渲染期平时是禁忌，这里的两个正当理由：① 写的是**外部单例**、不参与
 * React 的渲染树 diff；② `seedMessageScene()` 幂等（先 `clear()`），StrictMode
 * 的双调用不产生差异。另一条不是风格的原因：装饰器名不以大写字母开头，而
 * `react-hooks/rules-of-hooks` 判的就是这个 —— 里面调 hook 会被当场拦下。
 *
 * 缺席时**什么都不做**：不声明 `messageScene` 的 story 走真实 store（那正是
 * 「按钮在真状态栏里长什么样」那几档要的）。
 */
export const withMessageScene: Decorator = (Story, context) => {
  const name = (context.parameters as { messageScene?: unknown }).messageScene;
  if (typeof name === "string") seedMessageScene(name);
  return <Story />;
};
