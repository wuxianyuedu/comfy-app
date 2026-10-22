## Added

- **单子另两格有了读数：谁提的（`COMFYAPP_DEV_HANDLE`）与按什么优先级（平台原生 `--priority`）
  （ISSUE #2175，规范 §13.10.10）**：`pnpm ship` 阶段 0 原来只念「这次变更挂在哪张单子上」，
  而一张单还有两格是空的。**先验再动**的读数：issue 是被 token 的**账号本体**创建的 —— 跨
  #2135 / #2149 / #2156 / #2157 / #2163 五张单、跨并行会话回读，`author.username` 与那串
  `…+<账号>@noreply.cnb.cool` 子地址**逐字相同**，所以「这台机器上这几张单是谁提的」平台答不出来；
  而 `docs/guides/git-identity.md` §4 那条「给每份检出配一个 git author 子地址」的通道**只存在于
  提交那一侧**（squash 合并保留 author），单子上没有这一格。于是留痕写在单子自己身上：
  `.env` 新增一条 `COMFYAPP_DEV_HANDLE`（进程环境同名优先，回落 `.env` 用的是 `app-port.mjs`
  那一份最小解析器，不重抄第二份）+ 单子标签 `dev:<短名>`，本轮**只对 Windows 开发者**要求配它；
  优先级走平台原生 `--priority`，词表写进规范（`P0` 挡在所有人的主干前面 / `P1` 本迭代内要有人动 /
  `P2` 平台默认值，**没被判断过的单子才会落在这里** / `P3` 记录性、可以不做）。
  **两格都是读数、一次也不参与退码**（新模块 `scripts/ship-ticket.mjs` 的 `issueAuthoring`，平台形态由调用方
  注入、判据里不摸 `process.platform`）：做成「不填就红」的闸只会收获一串随手填的 `P0`，
  与 §13.10.8「随手挂一张别人开着的单子」是同一型事故；也不许拿标签冒充优先级（标签没有仓库级词表、
  没有任何判据会红）。出口从一条变成**两条**，这是实测逼出来的：`create-issue` 收 `--labels` 但
  **不落地**（#2174 建完回读 `labels: []`，而同一条命令的 `--priority P1` 落地了），要再跑一次
  `post-issue-labels --number <号> --labels dev:<短名>` 才算按下去 —— 只给一条命令的出口就是
  「话说了、事没做」（§13.5.12 那一族）。缺单或没配留痕时才念这两行，都在场就只念身份那一行。
  回归见 `tests/ship.test.ts` 的 `issueAuthoring` / `readDevHandle` 两组（含「非 Windows 未配 ⇒
  不点名要求」「`.env.example` 里注释掉的形态不算配了」「没有 `.env` ⇒ null 而不是『读不出来』」
  三条负控制）；口径同步进 `.qoder/skills/ship/SKILL.md` 第 7 条、AGENTS 硬规则 14、
  `docs/guides/git-identity.md` §4 与 `.env.example`。本批自己就是示范：#2174 建成 `P1` 并补了
  `dev:yuedu-win` 标签。
- **`ship` 多一个模块：`scripts/ship-ticket.mjs`（「单子」那一族搬过去）**：`ship-core.mjs` 加上
  这两格之后是 **943 行**，被 `check-infra-file-size.cjs` 的 900 行硬闸当场拦下（提交没过去，
  这条记录就是它的现场）。拆法是按职责而不是凑数：`ship-core` 判的是**外部执行者的形状**
  （平台 build / PR / git 输出 → 三态结论），而 `ticketReading` / `issueAuthoring` / `readDevHandle` /
  `fragmentHead` 判的是**碎片与单子的口径**，两条变化方向不同；新模块**零依赖** `ship-core`，
  反向只由它取 `fragmentHead` 一处（首行的读法仍是一份实现，PR 正文与单子读数共用）。
