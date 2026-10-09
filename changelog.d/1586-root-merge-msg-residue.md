## Removed

- **仓库根那份 `.merge_msg` 删掉，并给这一族文件配了判据**（ISSUE #1586）。它是上一次解冲突时手写的一份合并说明（27 行），用 `git commit -F .merge_msg` 喂给提交之后忘了删，随一次 squash 合并进了 `master`。它不报错、不会过期、也没有任何读者 —— 只能靠人偶然翻到。

## Added

- **R9 补上「根目录只放工程配置」的第二个形态**（`scripts/check-file-structure.cjs`；规范 §12.8.6）：根目录顶层出现 `MERGE_MSG` / `COMMIT_EDITMSG` / `SQUASH_MSG` / `TAG_EDITMSG` / `MERGE_HEAD` 这一族名字即阻断（不区分大小写、带不带前导点都认）。判据**认名不认内容** —— 那类文件的内容看起来完全正当（一份说清「解了哪几处冲突」的说明文字），按内容判断抓不住它；而「名字 + 出现位置只可能是 `.git/`」是这一族唯一的稳定特征。刻意**不**扩成「根目录白名单」：完整清单会变成第二份要人维护的东西，这里要拦的只是一个封闭的名字集合。
- **`.gitignore` 同步登记这几个名字**（第二道防线）：R9 管跑钩子的检出，`.gitignore` 管没跑钩子的检出与 `git add .` 那一下 —— 只有钩子挡不住 `--no-verify`，只有 `.gitignore` 挡不住 `git add -f`，两道都要。
- **回归测试四条名字各核一次阻断 + 一条反面对照**：`merge-msg-notes.md` / `.prettierignore` 这类根文件放行，防止把「名字在这一族里」悄悄做成「根目录有额外文件就报」。变异核过：把判据那一支关掉，四条阻断用例当场红。

## Docs

- 规范 §12.8.6 新增（现场 / 为什么按内容判断抓不住它 / 两道防线 / 回归测试）；§12.8 的 R9 摘要行与 `scripts/check-file-structure.cjs` 的头部规则表同批更新；`AGENTS.md` 硬规则 12 同步一句；`docs/generated/12-代码组织与文件结构.md` 随 `pnpm doc:render` 重渲染。
