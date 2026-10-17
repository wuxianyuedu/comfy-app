## Fixed

- **模型目录配置弹层：没配 ComfyUI 路径也报「● ComfyUI 已连接」**（规范 §5 排障手册新增一行）：
  现场是一台 `127.0.0.1:8188` 上**实测无人监听**的机器（8188..8193 逐个 `fetch` 全部
  `ECONNREFUSED`），服务端因此明确回了 `comfyReachable:false`，而弹层仍写着「已连接 · 共 0 个目录」，
  空列表那句还是「ComfyUI 中没有可识别的模型目录。」——两条都是假结论。
  根因在客户端：`use-model-folder-config.ts` 的 `comfyReachable` 初值是乐观的 `useState(true)`，
  而它落回真值靠一段「渲染期同步」`if (configQ.data && configQ.data !== prevCfgData)`。弹层随开随卸载、
  QueryClient 是模块级单例（staleTime 30s、gcTime 默认 5min）⇒ **第二次挂载首帧就带着缓存数据**，
  `prevCfgData` 的初值即那份数据 ⇒ 同步永不发生；随后 `refetch()` 拿回逐字相同的载荷，
  react-query 的结构共享（`replaceEqualDeep`）连引用都不换 ⇒ 仍然不同步。
  同一格把 `folders` 也冻在 `[]` ⇒ 第二次打开弹层时，**真有 86 个目录的实例也会显示成空列表**
  （实测：`totalCount` 从 2 掉到 0，而服务端回的是 2）。
  附带第二格：`load()` 用 `try { await refetch() } catch { setErr("网络错误") }` 判成败，
  而 v5 的 `refetch()` 失败时**不 reject**（它 resolve 一个带 `isError` 的结果）⇒ 那个 catch 是死代码，
  列表拉不下来时既不报错也不改状态。
  修法不是把默认值翻成 `false` 就完事，而是**不再镜像进 local state**：`folders` / `comfyReachable`
  直接从查询派生，于是没有「答案到了却没落到状态」这一格；视图再补一档 ——
  `loading` 时单说「正在检测 ComfyUI…」，「已连接 / 未连接 / 没测到」三种情形不再同形
  （与 §13.6.4.1 那条「拿不到测量 ≠ 测量结果是红的」同一个口径）。
  服务端同族的一处也一并收口：`model.ts` 的 `configList` 原本另搓
  `fetch(comfyBase()).then(res => res.ok)` —— 探根路径、把 HTTP 500 判成「进程没起」，
  正是 #685 收口掉的形态（显存爆掉的实例会被它假报「未连接」，与设置页状态行互相矛盾）。
  现改走全库唯一口径 `probeBaseOnce(comfyBase())`（**连上即存活**），地址与 `listModelFolders()`
  取同一个 ⇒ 两个答案不可能指向不同端口。
  回归：`use-model-folder-config.test.ts` 两条（缓存已热的第二次挂载 / `configList` 失败必须可见）、
  `ModelLibrary.integration.test.tsx` 一条（不可达时屏上不许出现「已连接」）、
  `model.test.ts` 一条（500 判活 + 断言探的是 `/system_stats`）。四条都做过变异复算：
  改回旧实现各自红。
