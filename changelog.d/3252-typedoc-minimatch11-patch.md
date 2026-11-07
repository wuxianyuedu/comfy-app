## Fixed

**每日档 `API 文档生成与自检` 不再崩在 `mini.matchOne is not a function`**（ISSUE #3252）：

- 现场：`typedoc@0.28.20` 的 `dist/node-utils.js:328` 在 `glob()` 里调
  `mini.matchOne(childPath, row, true)`；而 `pnpm-workspace.yaml` 的安全 override
  `'minimatch@10': '11.0.1'` 把 typedoc 依赖的 minimatch 顶到 11，**11 删掉了这个
  实例方法** ⇒ 目录遍历第一步就抛 `TypeError`，typedoc 退 6，`docs/api/**` 拿不到产物。
- 这是「override 只看 registry 元数据（ESM / exports / engines）就上线」的代价：
  装载面相同不等于实例 API 相同，已被实测证伪并记进 override 的注释。
- 处置：override 保留（其余消费方不受影响），给 typedoc 打一处最小补丁
  （`patches/typedoc@0.28.20.patch`）：`mini.set.some((row) => mini.matchOne(f, row, true))`
  → `mini.match(f.join("/"), true)`。minimatch 11 的 `match(f, partial)` 内部就是
  逐个 row 以 partial 求值，语义等价；`childPath` 是分段落数组，按 `/` 拼回路径。
- 读数：本机 `node scripts/check-docs-api.cjs` 修前 `typedoc exit code 6`，修后
  `[ok] 已生成并自检通过：2863 份产物（392 个模块页）`。
- ⚠️ typedoc 升级后先确认新版本是否已兼容 minimatch 11；兼容则删掉这条 patch。
