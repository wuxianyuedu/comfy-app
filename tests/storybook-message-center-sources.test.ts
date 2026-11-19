/**
 * 「消息中心 → story」注入层契约判据（ISSUE #1381，§16.2.3.14）：失效形态都是「画布有内容、看的不是真形态」——
 * 手捏 `MessageRecord[]` 跳过 `push()` 的 id 生成与 `MAX_MESSAGES` 裁剪（曾致「删一条连带删另一条」）；不置 `open`
 * 则面板 `return null`；`allRead` 逐条写 `read: true` 而非走 `markAllRead()`；装饰器漏挂则 `messageScene` 没人读。判接线与形状。
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/* 「先剥注释再正则」的唯一实现（§12.18 / ISSUE #1192）：本文件里有两条**否定**
   断言（「不许出现 `setState({ messages: … })`」「不许逐条写 `read: true`」），
   而这两种写法正是上面注释里解释「为什么不能这么干」时**必须写出**的字符串 ——
   不剥注释就是自打自（判据红在文档行上）。 */
import { stripComments } from "./helpers/strip-comments";

const ROOT = resolve(".");
const SOURCES = join(ROOT, ".storybook", "message-center-sources.tsx");
const PREVIEW = join(ROOT, ".storybook", "preview.tsx");
const PROVIDERS = join(ROOT, ".storybook", "data-sources.tsx");
const PANEL_STORY = join(
  ROOT,
  "src",
  "components",
  "message-center",
  "MessageCenterPanel.stories.tsx",
);
const BUTTON_STORY = join(
  ROOT,
  "src",
  "components",
  "message-center",
  "MessageCenterButton.stories.tsx",
);
const PANEL = join(ROOT, "src", "components", "message-center", "MessageCenterPanel.tsx");

const sources = readFileSync(SOURCES, "utf8");
const preview = readFileSync(PREVIEW, "utf8");
const providers = readFileSync(PROVIDERS, "utf8");
const panelStory = readFileSync(PANEL_STORY, "utf8");
const buttonStory = readFileSync(BUTTON_STORY, "utf8");
const panel = readFileSync(PANEL, "utf8");

/* 否定断言（`not.toMatch`）一律拿**剥了注释**的这一份判 —— 见上面那段说明。 */
const sourcesCode = stripComments(sources);
const panelCode = stripComments(panel);

describe("Storybook 消息中心注入层的契约（ISSUE #1381）", () => {
  it("场景名不认识时抛错，且条目走真 action push", () => {
    expect(sources).toContain("export const MESSAGE_SCENES");
    expect(
      sources,
      "场景名不认识要抛错 —— 静默回退会让「名字写错了」在画布上表现成「面板没打开」",
    ).toContain("消息场景里没有叫");
    /* 条目必须走真 action：`setState({ messages: [...] })` 能画出一模一样的界面，
       但把 id 生成与 `MAX_MESSAGES` 裁剪整个跳过 —— 那是这一层存在的理由。 */
    expect(sources, "必须走真 action push() —— 手捏 messages 会跳过 id 生成与条数裁剪").toContain(
      ".push(",
    );
    expect(sourcesCode, "不许直接 setState messages —— 那正是要防的假形态").not.toMatch(
      /setState\(\s*\{\s*messages/,
    );
  });

  it("场景带 open，装饰器在渲染前把它置好（否则面板 return null）", () => {
    expect(sources).toContain("readonly open: boolean");
    expect(
      sources,
      "置 open 是必要的 —— MessageCenterPanel 在 open === false 时 return null",
    ).toContain("setOpen(true)");
    /* 渲染期写 store（不是 useEffect）：面板**首次渲染**就读 open，
       effect 是提交之后才跑的，于是第一帧读到的仍是 false。 */
    expect(sources).toContain("export const withMessageScene: Decorator");
  });

  it("「全部已读」走真动作 markAllRead，不逐条写 read: true", () => {
    expect(sources).toContain("markAllRead");
    expect(sourcesCode, "场景不许逐条写 read: true —— 那摆的是末态，验不到动作本身").not.toMatch(
      /read:\s*true/,
    );
  });

  it("装饰器挂在 preview.tsx 的链上（没挂 = parameters 没人读，store 空着）", () => {
    /* 判的是 `decorators:` 那个**数组里的元素**，不是「文件里出现过这个名字」——
       后者会被 import 那一行满足：把装饰器从数组里摘掉之后 `toContain` 照样绿
       （实测过，正是这一处判据的第一个变异）。所以取 `decorators: [` 到配对 `]`
       之间的那一段。 */
    const start = preview.indexOf("decorators: [");
    expect(start, "preview.tsx 里找不到 decorators 数组").toBeGreaterThan(-1);
    const end = preview.indexOf("]", start);
    const chain = preview.slice(start, end + 1);
    expect(chain, "少挂 withMessageScene = parameters.messageScene 没人读，面板不打开").toContain(
      "withMessageScene",
    );
    /* 反向：挂上了但没人读也不成立 —— `withAppProviders` 要在链上（它读
       `parameters.messagePanelHidden`）。 */
    expect(chain, "withAppProviders 也要在链上").toContain("withAppProviders");
  });

  it("全屏面板盖住同屏要看的东西时，有显式出口（messagePanelHidden）", () => {
    /* 这三条判的是**代码**，所以一律拿剥了注释的那一份 —— 不剥的话，解释这条口径
       的散文里就写着这三个名字，把实现整段删掉判据照样绿（实测过：4a 把读取整句
       换成 `=== true;`、4b 把三元换成恒挂面板，两条变异都没被拦下）。 */
    const providersCode = stripComments(providers);
    const previewCode = stripComments(preview);
    const buttonStoryCode = stripComments(buttonStory);

    /* ① 读取：`withAppProviders` 真的**读** `parameters.messagePanelHidden`
       （只要求名字在场是不够的 —— 注释里也有）。 */
    /* 锚在**取值那一处**（`.messagePanelHidden ===`），不锚在 `parameters…` 上 ——
       后者会被**类型注解**里的 `{ messagePanelHidden?: unknown }` 满足：把取值整句
       换成 `=== true`（变异 4a）之后判据照样绿，因为那个名字在注解里还在。
       这正是本仓反复记着的「拿名字在场当判据」那一族。 */
    expect(
      providersCode,
      "withAppProviders 要读 parameters.messagePanelHidden —— 否则「开着面板」那一档会把按钮盖住",
    ).toMatch(/\.messagePanelHidden\s*===/);
    /* ② 生效：读到的值必须真的**改变挂载** —— 只是读出来不用，面板照样盖住画面。 */
    expect(providersCode, "读了不用等于没读：面板的挂载必须由 hideMessagePanel 决定").toMatch(
      /hideMessagePanel\s*\?[\s\S]{0,40}MessageCenterPanel/,
    );
    /* ③ 消费：那条 story 真的声明了这个参数（没人用 = 这一档白留）。 */
    expect(
      buttonStoryCode,
      "MessageCenterButton 的「开着面板」那一档要声明 messagePanelHidden",
    ).toMatch(/messagePanelHidden:\s*true/);
    /* ④ `withAppProviders` 仍挂在链上（摘了的话上面三条全落空）。 */
    const start = previewCode.indexOf("decorators: [");
    const end = previewCode.indexOf("]", start);
    expect(
      previewCode.slice(start, end + 1),
      "withAppProviders 不在装饰器链上 → messagePanelHidden 读不到",
    ).toContain("withAppProviders");
  });

  it("两个组件都有 story，且都接的是真组件", () => {
    /* SAFETY: 类型断言已复核 */
    for (const [story, name] of [
      [panelStory, "MessageCenterPanel"],
      [buttonStory, "MessageCenterButton"],
    ] as const) {
      expect(story, `${name} 的 story 没 import 真组件`).toContain(`from "./${name}"`);
      expect(story).toContain(`component: ${name}`);
    }
  });

  /**
   * 本批实测抓到的真缺陷：标记已读那颗 `<Button>` 没给 `size`，落进缺省 `h-8`（32px 定高），而内容是
   * 「标题 + 正文」（正文可多段）。实测 `<li>` 62px、正文底 205px、超出卡片下沿 39px；tsc / eslint / 构建全绿，
   * 只有真浏览器截图看得出。判据：本文件每颗「行内内容会换行」的 `<Button>` 必须带 `h-auto`（不按全部 Button 判，免得误报图标按钮）。
   */
  it("标记已读那颗按钮带 h-auto（定高会吞掉多段正文）", () => {
    /* 判这一颗 `<Button>` 自己的 `className`，不是「这一片里出现过 h-auto」。三种省事写法会假绿（实测）：非贪婪
       `<Button[\s\S]*?onClick={…markRead…}` 从更前面那颗本来就带 `h-auto` 的 `<Button` 起匹配；整份
       `toContain("h-auto")`（文件另 4 处）；不剥注释也不行 —— 解释「为什么必须 h-auto」的注释里就写着它。
       所以：先在剥了注释的副本上定位开标签，再只取该标签的属性串。 */
    /* 锚点是**调用点** `markRead(m.id)` 而不是 `onClick={() => markRead(` 的字面量：
       箭头体是表达式还是块体（`{ markRead(m.id); }`）属于写法细节
       （#2918 的 no-confusing-void-expression 清零就把这里改成了块体），
       而本条要钉的是「这颗按钮」，不是「箭头长什么形」。调用点全文件唯一。 */
    const open = panelCode.indexOf("markRead(m.id)");
    expect(
      open,
      "没在 MessageCenterPanel 里找到「标记已读」那颗 Button —— 改写法了？",
    ).toBeGreaterThan(-1);
    /* 往回找最近的 `<Button`（开标签的起点），往前取到该标签的 `>`。
       ⚠️ 不能拿 `indexOf(">", open)` —— `onClick={() => …}` 里的箭头 `=>` 自带一个
       `>`，取到的「标签」会截到 `onClick={() =` 为止（实测过：切出来 81 字符、
       连 `className` 都没进去，于是这条判据对**任何**写法都恒红/恒绿）。
       所以从 `className=` 之后找**属性串的收尾**（`>` 前一个字符不是 `=`）。 */
    const tagStart = panelCode.lastIndexOf("<Button", open);
    expect(tagStart, "找不到「标记已读」那颗按钮的开标签").toBeGreaterThan(-1);
    const close = /(?<!=)>/.exec(panelCode.slice(tagStart));
    expect(close, "找不到该开标签的收尾 `>`").not.toBeNull();
    const tag = panelCode.slice(tagStart, tagStart + close!.index + 1);
    expect(
      tag,
      "「标题 + 正文」那颗按钮必须 h-auto：缺省 size 带 h-8 定高，多段正文会溢出卡片",
    ).toContain("h-auto");
  });
});
