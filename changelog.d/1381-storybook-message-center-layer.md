## Added

- **Storybook 第四层注入：消息中心（ISSUE #1381）**。`MessageCenterButton` / `MessageCenterPanel` 的入参只有 `children` 与几个 class，从 props 那侧看是纯展示件 —— 而数据住在 `message-center-store`（zustand）里，组件自己 `useMessageCenterStore(...)` 取。`.storybook/message-center-sources.tsx` 把这件事换成流程：story 声明**「哪一处生产方在生产」**（更新检测 / dev server 重启 / 陈旧实例），文案由生产方**现算**、条目经真 action `push()` 落板。
  - 三条口径：场景收的是**生产方**而非手抄文案；条目走 `push()` 而非 `setState({ messages })`（后者跳过 `nextId("msg_")` 与 `MAX_MESSAGES` 裁剪 —— 那条 id 生成曾经就是「删一条把另一条一起删了」的根因）；`open` 是场景的一部分、装饰器在渲染期置好（只推消息不置 `open` ⇒ 面板 `return null` ⇒ 画布一片空白，与 §16.2.3.4 那个坑同形）。
  - 「全部已读」走真动作 `markAllRead()`（场景的 `markAllRead: true`），不逐条写 `read: true` —— 后者摆的是末态、验不到动作本身。
  - `MessageCenterPanel` 是全屏的（`fixed` + `top-title-bar`）而外壳全局挂它，于是「面板开着」的场景会把 `MessageCenterButton` 自己的 story 整个盖住。出口是 `parameters.messagePanelHidden: true`（外壳不挂面板，组件照常从 store 读到 `open`），刻意不是全局默认。
  - 8 条 story（面板 5 / 铃铛 3），覆盖三种 `kind` 同屏、未读计数溢出（`> 99` 那档边界）、全部已读、零消息、面板关闭。
- `tests/storybook-message-center-sources.test.ts`（7 条，进 `FIXED_STRUCTURAL_TESTS`）。写它的过程中有**四处**断言自己先假绿过，全是「拿名字在场当判据」：`toContain("h-auto")` 被文件里另外 4 处满足、被解释口径的注释满足（不剥注释=自打自）、被**更前面**那颗同标签满足（非贪婪正则也不行）、装饰器名被 **import 那一行**满足。四条现在都按「剥注释 + 定位到具体那一处」判，并做了**七向变异实测**（逐条 `read: true` / `setState` 替代 `push` / 拿掉 `h-auto` / 摘装饰器 / `messagePanelHidden` 取值摘掉 / 面板恒挂 / story 不声明该参数）—— 全拦下。

## Fixed

- **消息中心的「标记已读」按钮缺 `h-auto`，多段正文溢出卡片**（由本批新 story 的截图看出来）。那颗 `<Button>` 没给 `size`，落进缺省档的 `h-8`（**32px 定高**），而它的内容是「标题 + 正文」——正文可能是多段（陈旧实例那条 `body` 就含换行，`whitespace-pre-wrap` 照实换行）。真浏览器实测：`<li>` 高 62px、正文底 205px，**超出卡片下沿 39px**，两张卡片叠在一起；修后 `<li>` 117px、正文底落在卡内。`tsc` / `eslint` / 构建 / 既有门禁**全绿**，只有截图看得出来。同文件另外两颗按钮本来就有 `h-auto`。
- `describeDevServerRestart()` 从模块私有改为导出 —— 消息中心那条「应用服务已重启」的文案住在这里，story 侧现算它、不手抄第二份（改文案时两处一起漂的形态）。

## Docs

- 规范 16 新增 **§16.2.3.14**（第四层注入的形状、与前三层不同的接线点、那四种假绿形状与七向变异）；`docs/guide-storybook.md` 的注入层表与「每层有哪些场景」表补上这一层，并在契约判据那节记下「否定/在场断言一律剥注释 + 定位到具体那一处」。
