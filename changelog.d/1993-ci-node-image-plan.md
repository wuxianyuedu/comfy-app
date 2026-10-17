## Added

- **节点镜像：把「换台机器就要重来一遍」的那三件预先装好**（`scripts/ci-image-plan.mjs`，
  ISSUE #1993）。自托管节点上没有 docker daemon、`.cnb.yml` 里也没有 `image:`，于是
  「节点上该有什么」今天只能一台一台机器去装 —— 而代价逐条量过：`pnpm install` 冷装约
  8 分钟、Playwright 的 headless shell ~120 MiB（这台节点一次取不完一个大响应）、Python
  三条装通道。这三件都是「换台机器就重来一遍」的东西，预装进一张镜像就是它们该待的地方。
  本脚本**不碰 docker**：它只算命令（造镜像 / 装进宿主机 / 钉身份）与打包，理由是构建
  容器里没有 daemon、造镜像要网络而这层的判据一律不出网（规范 §13.5.3.4.1.2）。
  **它能省的只是这三件**：`next build` / `vitest` / Playwright 跑用例 / `cargo build` 的
  墙钟依赖当次源码，任何预装都替不掉；把整棵检出烤进镜像则会让「这一跑跑的是哪份源码」
  不可追，而那正是 `镜像身份` 那一档存在的理由。
  三个形状各有一条判据：层序（提交点写偏一层**不会报错**、只会让改一行代码就重装一遍）、
  版本**现读**（`engines.node` 下限 / `packageManager` / 锁文件根 importer / Node 补丁号由
  构建那一步从 `SHASUMS256.txt` 同源核对）、四件清单**一处定义两个出口**（构建期自证 ⇄
  装完逐件核对）。tarball 自写 ustar（不押宿主 `tar`）：权限位、符号链接、`mtime`/uid/gid
  归零 ⇒ 同一份输入两次打包逐字节相同。

## Docs

- **规范 §13.5.3.4.1.2（新增）**：把「用 docker 提速能提哪一段、替不掉哪一段」写死，
  并把层序、版本现读、四件清单、tarball 三种字节语义四条判据的口径挂上去。
- **新指南 `docs/guides/ci-node-image.md`**：人怎么用（三条命令 + 逐件核对 + 钉身份）、
  镜像里装什么/不装什么、以及为什么仓库不碰 docker。

## 验证

- `tests/ci-image-plan.test.ts`（新增 22 条）：`engines.node` 三段范围取最小下限、认不出
  的范围当场抛（不退回猜的版本）、只挑 `linux-x64` 有产物的版本；锁文件**取最后一段**
  `importers:`（本仓里它出现两次）、不串到 `packages:` 里同名包、带 scope 的包名与带
  peer 后缀的版本都读得对、真锁文件里那两件都读得到；Dockerfile 版本不写死、拒收形状不对
  的版本、层序两条反向复算（`COPY . .` 提前 / 清单 COPY 落后）、构建期自证不写成
  `command -v`（浏览器不在 PATH 上）；tarball 512 对齐 + 两次打包同 digest + 宿主 `tar`
  真解得出权限位与符号链接 + 不穿链接；`main` 缺版本时抛、CLI 缺版本时退非零、
  `--dockerfile` 只打正文、本文件 import 全部是 `node:*`。
