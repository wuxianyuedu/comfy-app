## Fixed

- perf: 22 处 `filter` 回调里的 `includes`/`find` 线性查找改为先建 `Set`/`Map` 再查（O(n×m) → O(n+m)），覆盖设置/工坊/工作室视图与 lib/server；重复项去重语义不变，新增大图裁剪、同名角色、重复模式计数的回归用例（#5226）。
