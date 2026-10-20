## Added

- **缓存槽的第二增量：动作落地，开关仍默认关**（`scripts/ci-slot-apply.mjs`）
  （ISSUE #2022 第二步，接 #2038 那一批读数）。执行档回答的是「这一跑的依赖从哪儿来」：
  命中 ⇒ 把槽的整棵 `node_modules` 接成一条链交给作业、跳过 install；未命中 ⇒ 在
  `COMFY_CI_CACHE_ROOT/<键>` 里**就地装**、写指纹、再交接给作业；没配槽 / 算不出键 /
  盘不够 / 抢不到锁 ⇒ 一律**退回作业内普通装并打印原因**（槽是优化，把它做成前提就是
  「没配缓存的机器一律红」那一型判据）。`ci-install-deps.mjs` 的默认安装出口前面加了
  一把闸：`COMFY_CI_SLOT=1` 才问槽 —— 不开时行为与本增量之前逐字相同。为什么不同批
  打开：`Install dependencies` 每一次构建都过，键算错一次的代价是所有 PR 装不上
  （规范 §13.5.3.4.3 里那条纪律）。

- **机制是照着四个实测数写的，不是反过来**（本机同一天）：建链 **12 KB**（摘掉回收 0 KB）；
  一个槽的净盘 —— 表观 982 MiB / 83,664 个文件里只有 2,599 个（3.1%）是 `nlink==1` 的
  独占数据（1.7 MiB），删掉实测**回收 52 MiB** ⇒ 配额按键控个数（4）而不是按 GB，按 `du`
  那个 3.5G 定会把配额定成假数；冷装两把读数 69s（全量检出）/ 52.6s（只放依赖面输入），
  节点侧那一跳的同日对照见 #2022-ci-slot-node-evidence 那份碎片（普通装 51s / 建槽 69.2s /
  命中 ≈2s —— 本碎片写作时手上只有更早一天的一个读数，别拿它当现行系数）；接过去以后 `tsc --noEmit` 退 0 且**不需要 `.next/`**、`vitest`
  三份 29 条全绿 —— 挑的三份里 `check-allow-builds` 是真去读 `node_modules/.pnpm` 事实的
  那一条、`db-schema-ready` 是要 `require` 原生 `.node` 的那一条，`.bin` 也是从链里解析起来的
  （真实进程命令行 `<job>\node_modules\.bin\..\@typescript\native\bin\tsc`）。

- **三条只有跑起来才知道的边界**：① 作业的运行期写入落进槽里（`.vite` / `.vite-temp` /
  eslint 的 `node_modules/.cache/eslint*`，mtime 对得上起跑时刻），而 `.pnpm` 一个条目都没多
  ⇒ 树只读、缓存可写，所以锁只管「装」那一跳；② **有一笔生命周期写入接不过来** ——
  本仓 `postinstall` 写的是检出的 `.git/config`（`core.hooksPath` + `git lfs install --local
  --manual`），不在 `node_modules` 里 ⇒ 复用路径显式补跑那支脚本（后果不是这一跑红，
  而是这一跑里后续任何一次 `git checkout` 把 LFS 文件拿回一段指针文本）；③ 槽里只需要
  `DEP_FILES` + `patches/`：装出来的闭包与拿整棵检出装的逐条相同（虚拟 store 1379 vs 1379、
  两侧差集 0），前提是把 `package.json` 的 `scripts` 摘掉 —— 复制面因此与算键那份同源，
  不另列清单。

- **两处散文变成执行者**：「绝不穿过链装」现在是 `clearJobLink`（真装之前先摘掉作业那条
  指进槽的链，只摘 reparse point，顺着链删就是删槽）；「退 0 就算装上」也不再被相信 ——
  装完先验槽里那棵产物在不在，不在就删半套、不写指纹。另把 `DEP_FILES` /
  `FINGERPRINT_FILE` / `pnpmInstallFingerprint` 抽到叶子 `ci-deps-face.mjs`，断掉
  「装不装」与「接谁」之间那条环（`ci-install-deps.mjs` 原样转出这三个名字，调用方不变）。

- **还缺的一格**：平台侧三档收益（命中 / 未命中 / 键变）的实测 —— 本增量给的是机制与本机的
  数，节点上那三个数要开关真的拨一次才取得到。判据：`tests/ci-slot-apply.test.ts`，
  含一条量具自证：`statfsFreeBytes` 在真实路径上必须读出正数 —— 「读不到」按这里口径
  会被判成「不够」，于是机制在唯一需要它的地方静默退回普通装而日志照样绿。
  「接口存在」与「接口在这台机器上有读数」是两件事，`os.loadavg()` 在 Windows 上恒 0 是先例。
