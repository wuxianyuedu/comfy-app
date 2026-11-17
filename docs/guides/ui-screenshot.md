# UI 改动怎么截「改后真实运行」图

> 对应规范 [§13.12](../standards/13-提交与-code-review.md#1312-ui-改动改完要截图在诉求单里回复issue-3630)（硬规则 31）。
> 这条纪律的承重处在「**看得见**」：本仓现有判据（tsc / lint / 构建 / 门禁）一次也看不出
> 「构建期全绿、画布上看着有点不对」那一类缺陷 —— 那些事故都是逐张看截图才抓到的。

## 一句话

```bash
pnpm screenshot /settings      # 起应用 → 无头 chromium 打开 /settings → 明暗两态各截一张
```

Windows 上也可以双击 `tools\start\take-screenshot.ps1`（逻辑是同一份 `scripts/devtools/screenshot.mjs`）。

> **Git Bash（MSYS）注意**（ISSUE #4161）：以 `/` 开头的路由参数会被 MSYS 路径
> 转换翻成 Windows 路径（实测 `/settings` → `D:/Program Files/Git/settings`，
> 导航到非法 URL）。出口任选其一：`MSYS_NO_PATHCONV=1 pnpm screenshot /settings`；
> 路由以 `//` 开头（双斜杠不参与转换）；或去掉开头斜杠（`pnpm screenshot settings`）。
> 脚本对能识别的改写形状会自动恢复，恢复不了会给指向本注记的报错。

## 前置（一次性）

| 需要什么                 | 怎么装                                                          | 缺了会怎样                                                                   |
| ------------------------ | --------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Node + pnpm + 依赖       | `pnpm install`                                                  | 脚本起不来                                                                   |
| 浏览器二进制（chromium） | `pnpm exec playwright install chromium chromium-headless-shell` | 脚本会把这条命令原样打出来（它不自动下载）                                   |
| 本地 `.env`              | `pnpm env:init`                                                 | **应用起不来**（dev server 的环境预检会直接退出，不会「先打印 Ready 再崩」） |

> 仓库里**本来就有**这套能力：`@playwright/test` 是 devDependency、e2e 那 20 多份 spec 天天在用。
> 此前缺的只是「把某一屏拍下来」这一格入口，于是每次 UI 改动都以「当前无可用的图形化运行与截图环境」收场。

## 常用姿势

```bash
pnpm screenshot /settings                      # 默认：明暗两态各一张
pnpm screenshot /settings --theme dark         # 只截暗色
pnpm screenshot / --out D:\tmp\home.png        # 指定落点（一个文件放两态没意义 ⇒ 只截一张）
pnpm screenshot /workspace --full-page         # 整页而不是只截视口
pnpm screenshot /settings --wait-for "text=本地模型"  # 等某个元素出现再截（首屏数据落定的可靠信号）
pnpm screenshot / --no-server                  # 应用已经在跑，别自己起
pnpm screenshot --help                         # 全部选项
```

**设置页分区直达**（ISSUE #4163）：`/settings` 支持用 hash 指向某个分区
（与分区节的 DOM 锚点同形），不用再写一次性脚本点击 + 滚动：

```bash
pnpm screenshot "/settings#settings-comfyui"   # 直达「创作后端」分区
pnpm screenshot "/settings#settings-sizePresets" --theme dark  # 直达「尺寸配置表」
```

分区 id 见 `SETTINGS_SECTIONS`（`use-settings-page-types.ts`）：appearance /
sidebar / appUpdate / llmLocal / llmRemote / comfyui / database / backup /
dataLocation / sizePresets / exit / logs。

> Git Bash 下 `/` 开头的路由会被 MSYS 路径转换改写（#4161）：加
> `MSYS_NO_PATHCONV=1`、把路由写成 `//` 开头、或去掉开头斜杠均可；
> 脚本对能识别的改写形状会自动恢复。

- **路由**就是应用内地址（`/settings`、`/workspace`、项目页等）。
- **视口**缺省 1440×900（`--width` / `--height` 可改）。
- **等多久**：默认等「网络空闲」+ 静置 2s（`--settle`）。首屏是异步加载时（转圈那种），
  用 `--wait-for` 点名要等的那个元素 —— 那比猜「加载完了没」可靠。
- **图落本机**：`log/screenshots/<路由>-<主题>.png`（`/log/` 已被 `.gitignore` 忽略 —— 截图是交付读数，不是仓库产物）。
- 应用没在跑时脚本会**自己起**（`scripts/dev.mjs`，与 `pnpm dev` 同一条入口），截完**收掉自己起的那棵进程树**。

## 明暗两态

本仓主题走 `next-themes`（`<html>` 上的 `dark` class，持久化键 `theme`，见 `src/app/ThemeProvider.tsx`），
脚本在首帧前就把 `localStorage.theme` 写成目标态 ⇒ 渲染出来就是那一态，不必等用户点切换。

规范 §13.12.2 要求：**改了暗色 / 主题 / 状态色，明暗两态各一张**；改了交互，截到能看见交互结果那一帧
（展开的面板、选中态、hover、报错提示），别只截静止首屏 —— 那种帧 `pnpm screenshot` 截不到，
请用系统截图工具补那一张。

## 传到诉求单

上传走现成命令（**不新造第二套**，形状见 `cnb-upload-attachment` skill）：

```bash
pnpm exec cnb issues upload-image --repo moon-read/comfy-app-t3 --file "<上面打印的路径>" --number <诉求单号>
pnpm exec cnb issues comment --number <诉求单号> --body "改后截图：<asset_link> · <改了哪、请核什么>"
```

- 发到**本次诉求那张 Issue**（任务派发者发起的那张单），不是另开一帖、不是只贴进 PR 描述。
- 正文带一句人话：改了哪一处、哪几张对应哪态、希望对方核什么。
- `upload-image` 返回 `asset_link` 即上传成功；**别在发之前用 GET 回读探活**（那一跳恒 404，是「还没发布」不是「上传失败」）。

## 发不出图时怎么办

按 §12.18「先找现成出口」，按顺序试：

1. `pnpm screenshot`（本仓自己的无头截图，**首选**）；
2. 应用已经在跑 ⇒ `pnpm screenshot /路由 --no-server`；
3. 浏览器没装 ⇒ 脚本会打出安装命令，装完再试；
4. 本机根本没有可运行环境（容器 / 无头 CI / 缺 `.env`）⇒ **如实写明「本次截不了图 + 原因 + 建议怎么人工复核」**，
   不拿文字描述冒充截图、不跳过这一格。

兜底那一档不是「交付完了」，是「这一格没做」—— 交付总结里要写出来。

## 什么不算 UI 改动

见规范 §13.12.1：判据是「用户看不看得见」，不是「改了哪个目录」。纯逻辑 / 数据层 / 脚本 / 文档 /
配置 / 门禁 / 依赖升级（没动到渲染结果）不算；拿不准就按「算」处理 —— 贴一张的成本远低于漏贴后返工一轮。
