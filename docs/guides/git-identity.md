# 提交身份：同一台机器上区分开发者 / 仓库 / Agent

> 适用对象：一台机器上有多个人、多个检出，或同一个人有多个仓库的场景。
> 回答一个问题：**提交信息里的那一格身份，怎么让它说清「这是谁、在哪个仓库干的」？**

## 1. 先说读数：哪一格才是你该配的

`git log` 每一笔有**两个**身份，它们不是一回事：

| 格            | 谁写的                                    | 会被流程改写吗                                         | 能不能用来区分   |
| ------------- | ----------------------------------------- | ------------------------------------------------------ | ---------------- |
| `author`      | 写代码的那个人（`%an` / `%ae`）          | 平台 squash 合并**保留作者、只换 committer**（本仓实测） | **可以**         |
| `committer`   | 最后把提交落进仓库的那个人（`%cn` / `%ce`） | 平台合并后一律是平台账号，本地 rebase / cherry-pick 也会换掉 | **不要** |

所以「谁提交的」这件事只认 `%ae`（author email）。`git log --pretty=format:'%h %ae %s'`
就是最小可用的自查。

## 2. 当前身份来自哪个文件

git 的配置是**多层叠加、后者压前者**，出问题时唯一的目击者是 `--show-origin`：

```bash
git config --show-origin --get-all user.name
git config --show-origin --get-all user.email
```

- 带 `--get-all` 打出来的是**全部层**（系统 / 全局 / include / 本地，按读取顺序）；
- 带 `--get` 打出来的是**生效值**（最后一条）。

实测三条优先级，配的时候必须知道：

1. `--local`（`.git/config`）压住一切，包括 `includeIf` 引进来的值 ——
   这种「被 local 悄悄盖住」的情况报错时不会给任何提示；
2. 同一个文件里 `[user]` 段写在 `[includeIf]` **前面**也没关系，
   `includeIf` 引入的值仍然更靠后、因而生效（实测）；
3. 两条 `includeIf` 同时命中时，**写在后面的那条胜**（实测）。

## 3. 方案：用 `includeIf` 按仓库 / 目录分身份

git 原生支持条件加载，不需要脚本、不需要 hook、对各家 IDE 与图形客户端透明。

### 3.1 按 remote 地址分（推荐：换检出目录也不失效）

```ini
# ~/.gitconfig
[includeIf "hasconfig:remote.*.url:https://cnb.cool/moon-read/comfy-app-t3.git"]
	path = ~/.gitident-comfy-app-t3

[includeIf "hasconfig:remote.*.url:git@cnb.cool:moon-read/another-repo.git"]
	path = ~/.gitident-another-repo
```

每份身份文件只有两行，放在**仓库外面**（放进仓库会被 `git status` 看见）：

```ini
[user]
	name = dev1
	email = dev1@example.com
```

实测要点（本机 git 2.39.5）：

- `hasconfig:remote.*.url:` 匹配的是 **remote 的 URL 原文**，不做任何归一化 ——
  `https://…` 与 `git@…` / `ssh://…` 是**两回事**（`url.insteadOf` 也不参与匹配）。
  所以照 `git remote -v` 复制，别按「应该是同一个仓库」自己换算；
- 通配只有 `*`（任意串）与 `**`（含 `/` 的任意串），**且 `**` 在 `hasconfig:remote.*.url:` 上不生效**
  —— 想按组织批量分配就写成 `https://cnb.cool/moon-read/*`；
- 没有 remote 的仓库（刚 `git init`）不会命中任何一条，回落全局值 —— 这是想要的行为。

### 3.2 按检出目录分（同一台机器、多人共用一份布局时）

```ini
[includeIf "gitdir:~/work/dev1/"]
	path = ~/.gitident-dev1

[includeIf "gitdir:~/work/dev2/"]
	path = ~/.gitident-dev2
```

两个坑，都是实测出来的：

1. **路径必须以 `/` 结尾**。不带尾斜杠的 `gitdir:/x/repo` 在普通仓库里**一条都不命中**
   （不是「误匹配到 `repo2`」那么温和，是彻底失效）；
   ⚠️ 唯一例外是 **worktree**：`gitdir` 指向的是 `<repo>/.git/worktrees/<名字>`，
   这个路径**不带尾斜杠**才命中，带了反而落空；
2. `~/` 会被展开（实测），但**别写通配上层目录** `~/work/*/` —— 那会让底下所有仓库
   共用同一份身份，等于没配。

## 4. 与「多个 Agent 共用一个账号」的关系

本仓的 NPC / Agent 工作区把身份钉在**系统级** `/etc/gitconfig`（`user.name` 与
`user.email` 各一条），任何检出都是同一个值 —— 跨仓库、跨 Agent 完全不可区分。
可区分的那一层在**平台账号**上，不在 git 配置里：CNB 按邮箱
`<任意串>+<账号>@noreply.cnb.cool` 归属提交，`+` 后面那截是子地址，账号对得上就仍归你。
所以「想让页面归到同一个人、但日志里分得开」的正确形态是：

```ini
[user]
	name = agent-e4
	email = <同一串>+cnb.dQh7kaCfAPA@noreply.cnb.cool
```

真要区分**人**（而不是区分**机器人**）时，别靠改 git 身份 —— 那会让平台上的提交归属散掉。
更稳的留痕是分支名（`feat/<repo>-xxx`）与 commit scope（`feat(comfyui):`），
口径见规范 §13.2 / §13.6。

> ⚠️ **这一节只覆盖提交**。issue / 单子那一侧**没有 git author 这一格可配**：实测
> `cnb issues get-issue` 回读的 `author.username` 与那串 `…+<账号>@noreply.cnb.cool` 子地址
> 在并行检出之间**逐字相同**（issue 是被 token 的账号本体创建的），所以「谁提的这张单」平台答不出来。
> 单子的留痕走另一条路：`.env` 的 `COMFYAPP_DEV_HANDLE` + 单子上的 `提单人:<短名>` 标签
> （领取 / 结束释放用 `处理人:<短名>`，见规范 §13.10.11），
> 优先级走平台原生 `--priority` —— 口径与那两条命令的实测形态见规范 §13.10.10，
> `pnpm ship` 阶段 0 会把这一格念出来（是读数，不拦）。

## 5. 已经提交的历史怎么办

改写作者 = 改写历史。共享分支（含所有从它分出去的分支）**别动** ——
本仓还有 pre-push 复算门禁，动了会让所有人的基线错位。只读查询够用：

```bash
git log --author=<email> --pretty=format:'%h %ae %ad %s' --date=short
git shortlog -sne --all          # 谁提交了多少，一眼看分布
git log --pretty=format:'%ae' | sort | uniq -c | sort -rn   # 当前分支的身份分布
```

## 6. 自查清单

- [ ] `git config --show-origin --get-all user.email` 里**没有**意外的 `.git/config` 那条；
- [ ] `git config --get user.email` 的生效值是这条仓库该有的那个；
- [ ] `includeIf` 用的 URL 与 `git remote -v` **逐字一致**（含协议与 `.git` 后缀）；
- [ ] 目录形态的 `gitdir:` 带尾斜杠（worktree 除外）；
- [ ] 提交前 `git log -1 --pretty='%an <%ae>'` 复核一次（squash 合并之后作者仍是你）。
