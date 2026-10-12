## Added

- **把「视图层 store selector 不许现拼对象 / 现造新数组」固化成判据**（ISSUE #1780）。selector 里写对象字面量（`useStore((s) => ({ a: s.a, b: s.b }))`）或 `.map` / `.filter` 这类造新数组的调用，**每次 store 写入都返回新引用** ⇒ 该字段没变也照样重渲染，子组件的 `React.memo` 一起失效。
  - 落点是 `eslint.config.js` 的一条 `no-restricted-syntax`（两条 selector：对象字面量体 / 条内 `.map·.filter·.slice·.concat·.sort`），而不是新的 `check-*.cjs` —— B 组每次提交都跑、报错直接指到行号，也不必再新增一份会静默失效的清单（与 router 错误信封那条同一理由）。
  - selector **按 store hook 名限定**（单一出处 `STORE_SELECTOR_HOOKS`），不能按 `/^use[A-Z]/` 泛匹配：`useState(() => ({ ... }))` / `useMemo(() => rows.slice(0, 8), [])` 是合法且常见的写法，泛匹配实测会把本仓数十处 `useMemo` 造对象的写法全报出来。
  - `tests/store-selector-shape.test.ts` 三层守：① 真扫 `src/**` 断言存量为零（**扫描必须容忍换行** —— 单行版实测对注入的反模式毫无反应）；② 清单与仓库里真实的 `create<...>()` store 双向同步（漏登记新 store 当场红）；③ 拿 eslint 的 `Linter` 验两条 selector 真的会响（反模式报、原始值/`.reduce` 成原始值不报、普通 React hook 不报）。

## Docs

- 规范 01 §1.2 补一句判据出处；07 §7.15.1 那条「面板此前在视图里用 `useShallow` 现拼」的旁注指向本判据。
