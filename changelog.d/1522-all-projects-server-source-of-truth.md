## Changed

- **「所有项目」屏改读「本地索引 ∪ 服务端」的并集，并给每一行标出处**（ISSUE #1522）。此前那一屏只读客户端索引（`canvas-store` 的 `listProjects()`），于是**「服务端有一行、索引里没有」的项目在界面上既看不见、也没有任何删除入口** —— 实测现场就是 `project` 表里那几行 `未命名*`（`reapAllEmptyDrafts` 早期版本只清索引、不清服务端留下的）。
  - 新增 `listProjectsWithServer()`：本地索引并上 `project.list`，同 id 取 `updatedAt` 较新的一侧（与 `hydrateFromServer` 的对账口径一致，同一份画布不会出现两行），每一行带 `origin`（`server` / `local` / `both`）。
  - 为什么不是「只读服务端」：这一屏有一条明确承诺「本地 · 可继续编辑」，而本地索引是**离线时唯一有的那一份** —— 只读服务端会在 dev server 未起时把「看不见一行」换成「全都看不见」。并集 + 标注是信息最全的那一支。
  - 拉取失败**不是空列表**：`ok: false` + 照常列本地项目，界面给一句「服务端列表这一轮没拉到」，不把「看不到」说成「不存在」。

## Added

- **服务端独有行的删除入口**（ISSUE #1522）。新增 `deleteProjectEverywhere(id, name)`：索引里有这行就交给原有出口 `deleteProject`（清索引 + 清 active-id + 删服务端三件事一处），索引里没有就本机无状态可清、只删服务端那一份 —— 这正是此前缺的那个口子。索引里没有的行此前在 UI 上完全没有调用点。
  - 删除确认的文案按出处分叉：删「仅服务端」那一行动的是**服务端**的副本（本机没有可回退的东西），说成同一句会让用户在删完一个别处的画布之后才知道删的是什么。
  - 卡片上的出处标只给「只在一侧」的行：`仅服务端` / `未同步`，`both` 是正常行、标出来是噪声。

## Tests

- `src/lib/project-canvas/canvas-store.test.ts` 新增两组：并集与出处标注（服务端独有 → `server`、两侧都有取较新的一侧 → `both`、本地更新时不把用户刚改的名字冲回去、拉不到服务端时 `ok=false` 且照常列本地项目），以及 `deleteProjectEverywhere`（索引里没有的行删服务端那一份、索引里有则两边一起删、悬空 active-id 一并清掉、服务端拒收说的是「没能从服务端删掉」）。
- `src/components/studio/works/hooks/UseWorksGallery.test.tsx`（新建，5 条）：挂载先清空草稿再取并集、拉取失败降级仍列本地项目、确认删除走 `deleteProjectEverywhere`（索引里没有的行也删得掉）、取消不动任何东西、refresh 重取。
