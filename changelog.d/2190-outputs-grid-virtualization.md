## Changed

项目「产出」页签的网格改**行级虚拟化**（audit §C.1 F4a / ISSUE #2190）：产出数随
项目历史任务数只增不减、每卡挂媒体缩略图（视频那支还 `autoPlay`），全量 `map` 的
挂载成本与 DOM 规模线性上涨，而一屏可见只有个位数张。

- 虚拟项 = **一行 2~4 张卡**（响应式多列不能照抄 ModelLibrary 的单列行虚拟器）；
  列数按文档型滚动容器宽度推（镜像旧 Tailwind 断点：基础 2 / ≥640→3 / ≥1024→4）。
- 滚动容器是 `DocumentFrame` 的文档型滚动锚（新增 `data-document-scroll` 可寻址），
  `useVirtualizer` 挂它；行高 = 卡宽 + 文字区预算，逐行 `measureElement` 实测校准。
- 未量测环境（挂载首帧 / jsdom 无 ResizeObserver）⇒ 全量渲染兜底（与 ModelLibrary
  的 `measured` 守卫同形 —— 虚拟器在无读数环境里 `getVirtualItems()` 为空）。
- 固有取舍（audit 原文）：视频缩略图滚出视口即卸载、滚回重新起播 —— 不在视图层
  另加缓存绕它。用例钉「未量测兜底全量渲染」与「空态不吞」两件事（虚拟化本体由
  库承担，断言落在接管条件与兜底形态上）。
