# 节点镜像：把「换台机器就要重来一遍」的那几件预先装好（ISSUE #1993）

这份指南回答一个问题：**仓库里有什么东西能让「新接一台构建节点」这件事快起来**，以及
它**不能**替你做什么。

一句话：`node scripts/ci-image-plan.mjs` 打印三条命令（造镜像 / 装进宿主机 / 钉身份），
镜像是**人**装机的产物 —— 仓库不碰 docker（理由见最后一节）。

> 口径与决策记录在规范 §13.5.3.4.1.2；「这台机长自哪一版」那一步的读数是
> `scripts/ci-image-identity.mjs`（§13.5.3.4.1.1）；同一份读数里还有一行
> 「容器格（Job 级 `image:`）」，那是流水线侧的例外档（§13.5.3.4.1.3），与本文讲
> 「装这台机」是两件事 —— 而**此刻那一档是空的**：这台节点没开容器能力，两格写
> `image:` 会在起格之前被平台答 `Runner does not enable Docker.`（§13.5.3.4.1.5）。

---

## 1. 它替你省的是哪一段（以及哪一段省不掉）

自托管节点上没有 docker daemon，`.cnb.yml` 里也没有、也不该有**构建环境级**的
`image:`（`pipeline.docker.*` 与 stage 级 `image:` 都不生效，后者还会让整格起不来 ——
Job 级 `image:` 是另一档，见 §13.5.3.4.1.3）。所以「节点上该
有什么」全靠一台一台机器去装，而代价是逐条量过的：

| 那件事                       | 代价                                                           | 出处                       |
| ---------------------------- | -------------------------------------------------------------- | -------------------------- |
| `pnpm install` 冷装          | 约 8 分钟（`--frozen-lockfile`）                               | AGENTS 硬规则 26 / §13.6.3 |
| Playwright 的 headless shell | ~120 MiB，而**这台节点一次取不完一个大响应**（0 字节 + 120s）  | §13.5.3.10「第七跑」       |
| Python                       | 三条装通道挨个试，唯一真跑通过的是官方 embed 包（下载 + 解压） | §13.5.3.5.1                |
| `cargo build --release` 首次 | 拉整棵 Rust 依赖树 + 编译壳                                    | §7                         |

`node scripts/ci-image-plan.mjs` 铺的就是**前三行**。它**省不掉**的：

- `next build`、`vitest`、Playwright 跑用例、`cargo build` 的墙钟 —— 那些依赖**当次源码**，
  任何预装都替不掉；
- 「今天这台机器的网络通不通」—— 预装只是把下载挪到了**造镜像的那台机器上**，而那也是
  一次网络动作。

**别把整棵检出烤进镜像。** 那样「这一跑跑的是哪份源码」会变得不可追 —— 而
`镜像身份` 那一档存在的全部意义就是让环境**可见**（§13.5.3.5 反复红过的根因是
「环境是隐形的」）。镜像只装 `package.json` + `pnpm-lock.yaml` 说的那些**依赖**与二进制。

## 2. 怎么用（三条命令，人复制粘贴）

```powershell
# 0) 先看一眼它打算怎么做（版本号全部现读，不给版本时它会去镜像源取一版）
node scripts/ci-image-plan.mjs --node-version v24.22.0

# 1) 造镜像（在一台有 docker 的机器上；`-f -` 直接吃 stdin 喂进来的 Dockerfile）
node scripts/ci-image-plan.mjs --dockerfile --node-version v24.22.0 |
  docker build --build-arg NODE_VERSION=v24.22.0 -t comfyapp-ci:ci-node-v1 -f - .

# 2) 装进宿主机（`docker cp` 拷出来，不挂载宿主目录）
docker create --name comfyapp-ci-ci-node-v1 comfyapp-ci:ci-node-v1 true
docker cp comfyapp-ci-ci-node-v1:/ — > /tmp/comfyapp-ci-rootfs.tar
docker rm -f comfyapp-ci-ci-node-v1
```

> **`--dockerfile` 只打 stdout，不写文件。** 想看落盘的那一份用 `--write`
> （写出 `docker/ci-node.Dockerfile`，**别提交进仓库** —— 版本号全部现读，它是一次性
> 构建输入）：
>
> ```powershell
> node scripts/ci-image-plan.mjs --write --node-version v24.22.0
> # → [ci-image-plan] 已写出 docker/ci-node.Dockerfile（comfyapp-ci:ci-node-v1）
> ```
>
> 上面第 1 条那句提示也印在正文开头（Dockerfile 的 `#` 注释行，两种消费方式都不受伤）。
>
> **别写 `-f <(…)`**：进程替换是 POSIX shell 的语法，PowerShell / cmd 会把 `<(` 当成一个
> 文件名，报 `The system cannot find the file specified` —— 那条红读起来像「脚本没产出
> 文件」，实际是这两句根本不是同一件事。管道喂 stdin 在两个 shell 里是同一个写法。

> `node scripts/ci-image-plan.mjs` 的完整输出里还带着 `docker save`（跨机搬运）与
> `docker image inspect`（取 digest）两条，照抄即可 —— 那一段是**唯一出处**，别手写第二份。

装完之后逐件核对（与本脚本在镜像里做的构建期自证是**同一份清单**）：

```powershell
python3 --version
node --version
pnpm --version
test -x /root/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell
```

四件各自对应一条已经红过的判据：`python3` ↔ 假 comfy-cli（E2E `@critical`）、`node` ↔
`engines.node`、`pnpm` ↔ 三种落盘形态里只有一种 Node 起得来（§2.1.1）、浏览器 ↔
`browserExecutableExists()` 的落点。

## 3. 最后一格：把身份钉进去

镜像装好之后，`镜像身份` 那一档才从 `missing` 变成 `pinned`：

```powershell
docker image inspect --format "{{index .RepoDigests 0}}" comfyapp-ci:ci-node-v1
[Environment]::SetEnvironmentVariable("COMFYAPP_NODE_IMAGE", "comfyapp-ci:ci-node-v1", "Machine")
[Environment]::SetEnvironmentVariable("COMFYAPP_NODE_IMAGE_DIGEST", "sha256:…", "Machine")
```

**别用 `latest`**：标签可以移动，digest 不会。`latest` 下「回滚」与「诊断」都退化成
「再拉一次，看会不会不一样」。

## 4. 为什么仓库不碰 docker

`scripts/ci-image-plan.mjs` 只**算命令**、只**打包**，一行 `spawn("docker")` 都没有。
三个理由，每个都能独立成立：

1. **构建容器里没有 docker**（§13.5.3.4.1 已写死）：本脚本在流水线里跑时起不了任何容器，
   写 `spawn("docker", …)` 只会得到一条看不懂的红；
2. **造镜像需要网络**，而本仓的判据一律不出网（`pnpm test` 在离线容器里也要绿）；
3. **判据要能在本机跑**：层序、版本现读、tarball 的三种字节语义在本地全部可判 ——
   那才是这一层能长判据的部分（`tests/ci-image-plan.test.ts`）。

## 5. 交付物：tar 里的那三种字节语义

`--tar` 打出来的是「换台机器装进去」的那一份。它不能是 `tar -cf`，三件事决定了这一点：

| 那件事       | 不这么做会怎样                                                              |
| ------------ | --------------------------------------------------------------------------- |
| **权限位**   | 可执行文件在容器里 `EACCES`，而报错指不到这一层（§13.5.3.10 的姊妹形态）    |
| **符号链接** | `node_modules/.bin` 全是链接；穿过去会把同一份内容打很多遍，还会改变语义    |
| **可复现**   | `mtime`/uid/gid 归零 ⇒ 同一份输入两次打包**逐字节相同**，于是能按 sha256 钉 |

最后一条不是洁癖：它让「这一份装进去的东西」变成一句可核对的话（与 digest 那条口径同源）。

## 6. 已知边界

- **镜像基于 `node:24-bookworm`**：Debian 那份带 `glibc`，与 `better-sqlite3` 的预编译
  二进制对得上（alpine 是 musl，装出来是另一条链，不在这份声明的范围内）；
- **`playwright install --with-deps`** 会装一堆系统库（那是浏览器在 Linux 上真能起来的
  前提）；它比只装二进制慢，但那是**一次性**的；
- **本仓的构建节点今天仍然是裸装机**：这份镜像解决的是「下一台机器怎么装」，不改变
  `.cnb.yml` 里任何判据 —— `工具链自证` / `Python 可用性` / `浏览器安装` 该跑还跑，
  它们判的是**能力**，镜像是**期望身份**，两者不一致时以能力为准。
