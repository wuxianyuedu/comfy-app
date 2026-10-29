## Fixed

- **装配层白名单的"收益数字"与今天的产物对不上**（ISSUE #2678，P3）：三处文字把**一次读数的
  绝对体积**写成了常态，而它们描述的是「今天躺着什么」——
  `scripts/standalone-private-inputs.mjs` 的 `STATIC_ALLOWED_TOPLEVEL` 注释写着
  「实测这一层今天躺着 `src/` 11.7 MB、`changelog.d/` 3.3 MB、`data/llm-secret.key`、
  `Comfy APP.lnk`、`build-launcher/`」，下面 `RUNTIME_SRC` 那段又写「`src/` 11.7 MB，
  里面还有 377 个测试文件」，规范 §7.6 那一格把同一批数写成「实测挡掉 …」，
  `scripts/build-desktop.mjs` 的 §装配 注释与文件头（后者是 ISSUE #2574 逐字引过去的）同文。
  一次真装配（`node scripts/build-desktop.mjs`，exit 0）的读数是：`.next/standalone`
  顶层只有 `.next / node_modules / package.json / public / scripts / server.js / src`
  七个条目、装配那一跳 **`过 filter 6740 条、挡掉 0 条`**，而 `src/` 里**恰好三个文件**
  （`kill-process-tree.ts` / `executable-resolve.ts` / `platform.ts`，全是 `RUNTIME_SRC`
  放行件，**0 个测试文件**）—— `changelog.d` / `data` / `.env` / `.lnk` / `build-launcher`
  一件都不在场，因为 `pnpm build` 收尾那一步（同一份清单）先剥过一轮。
  数字不是"算错了"，是**它们从来只是那一台机、那一趟的读数**，被写成了现在时。
- **改法：机制句 + 当场读数，旧绝对数不再留在行动依据的位置**。这些判据的价值写成两条
  **不依赖上游是否干净**的性质：私有输入即使 file tracing 再失控也到不了装配层
  （少一个"先拷进来再删"的窗口），以及不必把整棵仓库读进内存再剪枝。
  载荷实体化那处的 `404 MB → 245 MB` 同理处理：明写它是**当时那一趟的对比**，
  今天的载荷由运行时那行 `static 体积 …MB` 当场念（#2574 起念得出），
  并补一句「这条选择本身不依赖那两个数——留 store 的问题是 `.pnpm` 的软链语义在
  standalone 里不可解析，不是体积」。
  ⚠️ **没有把这些数改写成「历史上曾经是 11.7 MB」继续留着**：那正是 #2580 / #2671 已经
  否掉的形状（旧数留着，下一个人照样照数决策）。要历史有 git 与 #1217 / #489 那两张单。
- **顺手把「`挡掉 0 条` 是常态」写在读数旁边**：`§装配` 那段注释与 `cpSeen` / `cpRejected`
  的计数注释各补一句 —— 0 不是计数器坏了（同一份 filter 在临时夹具上读 `过 7 条、挡 2 条`），
  并给出**交叉证人**：`挡掉 M 条` 与 `pruneStaticToAllowList` 打印的「已剔除…顶层条目」
  应当同向（0 挡 ⇒ 0 剔），不一致才是白名单或计数漂了。
  这一次就是靠"读数为 0 但账上说会挡一堆"这个矛盾才发现本单的，成本应当只付一次。
- **不新写判据**（AGENTS 硬规则 24 末句 / 27 末段）：注释里的自然语言数字没有可判的形状，
  而"扫注释里的数与产物实测对不对得上"正是一条会误报一片的启发式 —— 它要读文件、
  还要知道哪台机哪一趟。这一族的归宿是单子与当场读数，不是又一轮门禁。
- 生成的镜像同批：`docs/standards/launch-and-build.md` §7.6 那一格改完后
  `pnpm run doc:render -- --only docs/standards/launch-and-build.md` 重渲染（没用无参全量档）。
  本单的清点面比立案时说的更宽：立案写「全仓实测就这两处」，处理时按
  `grep -rn "11\.7 MB|3\.3 MB|377 个测试"` 重扫，实际命中**三个文件六处**
  （`build-desktop.mjs` 两处、`standalone-private-inputs.mjs` 两处、规范一处，
  另加 §载荷实体化那处同类对比数），已全部改掉并在回执里订正那句清点。
