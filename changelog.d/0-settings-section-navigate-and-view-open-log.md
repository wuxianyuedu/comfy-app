## Added

- **跨屏跳转现在能带目标设置分区**：`workspace:navigate` 事件载荷从 `{ view }` 扩成
  `{ view, section? }`（`src/lib/app-events.ts`）——`section` 只在 `view === "settings"`
  时有意义。设置是一页到底的分区目录，此前只切到「设置」会落在默认分区（`llmLocal`），
  于是像 ComfyUI 页那条黄条出口「去设置里配置」（文案写的是「设置 → 创作后端」）点下去
  还得让用户自己再到左侧分区树里找一次。
- 落点沿用仓库既有的「跨屏一次性载荷」惯例（同 `pendingCanvasWorkflow` / `canvasSeedNew`）：
  容器（`src/app/workspace/page.tsx`）持 `pendingSettingsSection`、逐层经
  `WorkspaceViewStack` / `SettingsView` 传给 `useSettingsPage`，由设置页**落定后回调消费**
  并清空载荷（下次从顶栏 / 侧栏进设置仍落默认分区）。载荷是字符串（`src/lib` 不得反向
  依赖视图层），合法性由设置页按 `SETTINGS_SECTIONS` 收敛，非法 id 当没给。
- **应用运行日志记录每个界面打开的耗时**：新增 `src/components/studio/ViewOpenReport.tsx`
  （`ViewOpenReport` + `withViewOpenReport`），在**内容真的挂载**那一刻补记一条 app-runtime
  日志（`界面打开：<屏名> 耗时 <n>ms`，屏名取自 `pageHeaderTitle()` 这唯一出处，`view` /
  `durationMs` 落进结构字段）。`WorkspaceViewStack` 在视图激活后的 effect 里取一次
  `performance.now()` 当「打开时刻」，与其视图成对存放、经 context 交给测量点。耗时对应的
  是「这一屏成为当前页」到「内容挂载」两端的差。

## Fixed

- **跳转落到设置页时左侧停在第一项**：收口前的写法在 hook 挂载的 effect 里**立刻**消费
  载荷（`setSection` + 回调），而设置页首帧多处于加载态 —— 外壳还没铺出分区节，载荷已被
  清空，等就绪外壳挂上时跳转目标已经丢了；即便载荷还在，容器停在顶部也会让
  `useSectionScrollSpy` 的初始回调把第一个分区判为当前项。现在载荷改为**落定才消费**：
  `useSettingsPage` 拆出一次性 `pendingJump`（不挂载即消费），`SettingsShell` 新增
  `jumpSection` / `onJumpApplied`，在 `useLayoutEffect` 里**瞬时**（`behavior: "auto"`）
  滚到目标节、命中锚点才回调消费；三态外壳没有分区节时不消费，等就绪后补落。
- **懒加载视图量不到耗时**：`next/dynamic`（`ssr:false`）走 Loadable，分块未到位时先渲染
  占位（默认 `null`），包在外层的探针在激活那一刻就挂载、量到的恒为 0。测量点因此放进
  分块解析后的组件本体（`lazyView` 的 loader 链里 `withViewOpenReport`），视图 id 由
  `lazyView` 自动登记进 `LAZY_VIEWS`，即时加载的视图在视图栈里补包一层。
