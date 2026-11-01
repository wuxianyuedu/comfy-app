## Fixed

- **「全仓只有一处启动派发循环」这一格判的是一份 11 项手抄清单；同一份文件里另有两条
  `indexOf` 取不到时的恒真形状**（ISSUE #2660 的第三批收窄，对象
  `tests/dispatch-startup-points.test.ts`）。三处都改了，都不动被测面。

  ### 一、自称「全仓」的那份手抄清单

  `loopCallSites()` 的头注写的是「全仓（src + scripts）里出现 `startDispatchLoop(` 调用的文件」，
  而函数体第一行是一份 11 项数组。当场读数：

  ```
  $ git show HEAD:tests/dispatch-startup-points.test.ts | sed -n '/function loopCallSites/,/^}/p' \
      | grep -c "src/lib/comfyui/executor-outputs.ts"
  0
  ```

  少判的代价由变异给出（往那份清单外的 `executor-outputs.ts` 注入一行 `startDispatchLoop(50);`）：

  ```
  AssertionError: expected [ 'src/instrumentation.ts', …(1) ] to deeply equal [ 'src/instrumentation.ts' ]
  Tests  1 failed | 7 passed (8)
  ```

  ⇒ 改完会红；老那一版**根本不读这份文件**（上面那个 0 是它自己的读数，不是我印象里的）。
  现在面从 `src/**` + `scripts/**` 派生，排除 `*.test.*` —— 排除的理由有出处：
  `src/lib/comfyui/executor-dispatch.test.ts:451` 那两行 `mod.startDispatchLoop(50)` 是行为用例的
  正当夹具，把它算成"第二个启动点"是误报。

  **成本带量具**：派生面 1371 份（去掉 test/spec），只读探针实测「读 + 按原文 prefilter」**188ms**、
  命中 3 份；只对幸存者剥注释再判形状，所以这一格在 vitest 里是 **378ms**。
  （第一版我让两处各扫一遍，同一格 1151ms —— 扫一次存成常量后降到这个数。）

  ### 二、`slice(indexOf(标记))` 在标记消失时切成一个字符

  Edge 分支那两条「不许出现 `startDispatchLoop` / `startReaper`」的接收者是
  `src.slice(src.indexOf('process.env.NEXT_RUNTIME === "edge"'))`。把那个标记改成
  `"edge-runtime"`（等价改写，语义没变）后的当场读数：

  ```
  老那一版：indexOf(edge 标记) = -1 · slice 结果 = "\n" · 长度 1
  老那一版对这一份 1 字符文本判：not.toMatch(startDispatchLoop) ⇒ 通过（假绿）
  而它上游那份真身里 startDispatchLoop 出现次数 = 1
  ```

  也就是说标记一改，这两条判据就从「判 Edge 分支」退化成「判一个换行符」，而账面全绿 ——
  这一形本单第一批已经命名过（剥/切落空 ⇒ 反向断言恒真）。改法是先验起点 `not.toBe(-1)`，
  红话点名找不到的是哪个标记。

  ### 三、`-1 < 正数` 让「启动顺序」判据反过来通过

  三条标记（`installStreamCapture` / `startReaper` / `startDispatchLoop`）的在场性原先没验，
  直接拿 `indexOf` 比大小。删掉 `m.startReaper());` 那一行，老那一版两条排序各自的判语是：

  ```
  老① installStreamCapture < startReaper ⇒ false      （这条会红 —— 偶然拦住）
  老② startReaper < startDispatchLoop     ⇒ true       （这条不红 —— 启动点被删反而通过）
  ```

  **两条都要如实报**：这一形不是"全仓没人拦"，是老那一版只有第一条偶然拦住、第二条是盲的，
  而拦住时给的是 `-1 < 26` 这种指不出原因的读数。改后由在场性断言点名：

  ```
  AssertionError: src/instrumentation.ts 里找不到 startReaper —— 拿 -1 比大小会恒真，这条顺序判据就不判了
  ```

  ### 四、顺手补的那一格：每份读进来的文本不许是空文

  `code(rel)` 现在带一条「剥完注释不许是空文」。变异：把 `runner-state.ts` 写成只剩一段注释 ⇒

  ```
  AssertionError: src/lib/comfyui/runner-state.ts：剥完注释是空文，落在它身上的反向断言恒真
  Tests  1 failed | 7 passed (8)
  ```

  红的是「执行链里没有内存队列」那一条本身（它先读空文、当场停），
  那组里的三条 `not.toMatch` 因此不会再各自冒充"已判过"。

  四次改动都用字节快照还原（`cp` 回来 + `sha1sum` 与快照逐字相同 + `git status` 只剩测试文件）。

### 一处刻意**没**收（这条比收了什么更值得记）

「执行链里没有内存队列 / 计数器 / 出队函数」那份 5 项手抄清单**这批改完了形状没动面**：
按批 2 那条前缀规则派生出的 17 份面上，`.queue` / `s.active` / `processQueue` / `executor-scheduler`
的**代码态命中都是 0**（用唯一实现 `stripComments(…, {trailing:true})` 量的；我第一次拿"整行注释"
粗筛时 `reaper.ts` 报了一个 `.queue` 命中，用真实现一量是注释里的 —— 又一次「量具不对，结论就不对」），
所以扩面不改判决；**但那份清单里的 `queue-status.server.ts` 根本不在那条前缀规则里** ——
同一条规则换一格就会少判一份。这说明「执行链」这个词在本仓有三份各自定义的地图
（批 2 的 9 项、这里的 5 项、派生的 17 项），该收成一处、而不是由各批自己挑一条规则。
⇒ 另立 **ISSUE #2914**（P2，两案由 owner 选），本批不动它。
