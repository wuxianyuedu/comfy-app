## Fixed

- **`pnpm ship --message "多行…"` 到 node 手里已经不是多行了。** 本仓实测两条路径不同形：
  `pnpm exec node -e … "一行<换行>二行"` 收到**真换行**，而 `pnpm ship --message "一行<换行>二行"`
  （即 `pnpm run ship`）在 node 的 argv 里已成字面量 `\n` —— 屏幕上那条回显
  `node scripts/ship.mjs "--message" "一行\n二行"` 就是证据。后果不是排版：整条信息变成
  **一行 subject**，而当时 PR 标题取的正是 `git log -1 --pretty=%s` ⇒ 实测那样一份标题被平台拒
  （这一格后来由 #2064 改掉：标题现在取「分支相对主干的第一笔非常规提交」，不再看顶端那一笔）
  （`pulls post-pull` 响应可解析、`data` 里没有号），并且一旦提交成功，那一坨就进了历史。
- 现在提交前先认这个形状（`ship-core.mjs` 的 `looksNewlineMangled`：必须**同时**满足
  「没有真换行」与「出现字面量 `\n`」），命中就**停在 `git add` 与 `git commit` 之前**
  退 `1`，并把两条出口念出来：`--message-file <路径>`（多行信息的正路），或
  `pnpm exec node scripts/ship.mjs --message "…"`。故意不自动把 `\n` 还原成换行 ——
  那会反过来砸掉「提交信息里本来就在写 `\n`」这种正当内容，而这种文本没法机械区分。
  判据的代价写明：一行散文里恰好出现字面量 `\n` 且没有真换行会被拦一下，但拦下给的是出口，
  不是死路。
- 顺带把那条被引用成前提的注释订正：入口原先写「提交信息走 argv 直传，`spawnSync` 不经
  shell，所以多行与引号都是字面量」—— 这句**只对这一跳**成立（`spawnSync` 确实不解释），
  改写发生在更外层的 `pnpm run`。现在注释里把边界说清，并把「多行用 `--message-file`」
  写进 `README.md` 的那四条边界与 `.qoder/skills/ship/SKILL.md`（agent 侧入口）。
- 探针先红再修：新增两条（`looksNewlineMangled` 的 5 个形状 + `main()` 那一格钉「`git add`
  与 `git commit` 一条都不许伸出」）打在主干那份入口上是
  `AssertionError: expected 2 to be 1`（不拦就一路提交、push、建 PR 都伸手做完）；
  修后 45/45。反向保留「真换行 + 引号 + 反引号照原样进 `git commit --message=`」那一格，
  免得这条守卫把 `pnpm exec` 与 `--message-file` 两条正路也拦了。
