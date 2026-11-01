## Fixed

- **「取那一段函数体」的四处落空形状，原先都会静默放宽成一个更大的区间**
  （ISSUE #2660 的第五批收窄，对象 `tests/shell-self-launch.test.ts`）。
  这一份文件是 #2660 普查里 `slice(indexOf(…))` 站点最密的一份：**18 处**，
  其中 17 处现在走四件显式工具（`fnBody` 严格化 / `sliceBetween` / `windowOf` / `since`），
  剩下 1 处（`debugImplAt`）本来就有 `toBeGreaterThan(-1)` 守卫，没为改而改。

  先量再改（只读探针，量具 = 该文件自己那份本地 `stripComments` 的同款三步）：
  12 处代表站点逐条复算，**11 处全部在场**；第 12 处探针报了 `start = -1`，
  查下去是**我的探针把标记写错了**（那一格的真标记是 `#[cfg(debug_assertions)]` 换行加签名，
  而它本来就带 `toBeGreaterThan(-1)` 守卫 —— 记在这里是因为"探针报错"和"仓里真落空"
  长得一模一样，只有回去看那一行才能分开）。所以这批**不改变任何判决**，
  它买的是"下一次改名/格式化时不许静默换判定对象"。量出来最刺眼的一个数：

  ```
  find_owned_orchestrator 那一段：从起点到文件尾 = 15395 字符
  ```

  也就是「认亲不许退化成按名字/路径/端口猜」那条反向断言，实际判的是那一个函数**之后的一切**
  —— 包括与认亲无关的进程预筛、回收、启动页写入。它今天绿是因为后面确实没出现那几个名字。

  ### 四条变异（都按字节快照还原：`sha1sum` 与快照逐字相同、`git status` 只剩测试文件）

  1. **改名一个只被"终点标记"用到的函数**（`fn start_own_orchestrator(` → `…_v2(`）：

     ```
     新：AssertionError: 在 fn start_self_orchestration( 之后找不到终点标记
        fn start_own_orchestrator( —— 区间要么空掉、要么放宽成「这一位之后的全部」，
        两种都让落在它上面的断言不再判它声称的那一段: expected -1 to be greater than 37128
     老：slice(37128, -1) 区间长度 = 23602 字符，四条 toContain 的**目标行全在这段里** ⇒ 绿
     ```

     这一条是本批最值的：**老那一版不是给出一条指不到原因的红，而是直接绿**——
     "回收残留 + 起自己那一份"这四件事只要在该函数之后的任何位置同现，判据就满足。
  2. **把反向断言要挡的名字写进那一个函数里**（`find_owned_orchestrator` 体内加一行
     `let _probe = "tasklist";`）⇒ 新代码红（`expected 'pub fn find_owned_orchestrator() -> O…'
     not to match /CommandLine|tasklist|wmic/i`）—— 这是**收窄之后牙齿还在**的证明。
  3. **把同一个名字写进后面的函数里**（`is_probable_node_process` 体内）⇒
     新代码绿（`Tests 1 passed`），老那一版红：

     ```
     老那一版判的区间长度 = 15435 字符（到文件尾）· not.toMatch ⇒ 红（假红：那一行在别的函数里）
     ```

     2+3 一起构成"收窄是对的"的双向证据：**收窄不是放松判据**，它撤掉的是误伤，
     保住的是违例。
  4. **`fn collect(` 整对签名改名**（两处一起改）⇒ 新代码红在起点守卫
     （`找不到起点标记 fn collect(: expected -1 to be greater than -1`）；
     同一输入下老那一版的读数：

     ```
     老那一版：indexOf(fn collect() = -1 · collectBody 长度 = 0 ·
       not.toMatch(let self_launch=) ⇒ 恒真（假绿）
     ```

     就是 #2660 正文命名的那一形，逐字对上。

  ### 一处**没能验证到**的守卫，写清楚而不是当成果记

  `fnBody` 我把 `return end > 0 ? rest.slice(0, end) : rest;` 改成了找不到收尾就红。
  但我**走不到**那个分支：试着把 `shell_launch.rs` 最后一个顶格 `}` 缩进之后，
  读数仍是 `end = 169`（该函数自己的收尾还在原位）⇒ 新旧行为相同、都不红。
  要触发它得让"该函数之后整个文件再无顶格 `}`"，那是格式化器级的事件。
  ⇒ 这条留着是因为它的失败模式是"红并说清原因"，而不是"静默判整段尾部"，
  但**它不是这批实测修好的格子之一**，别按四条读成四条已验证。

  ### 两件刻意没做

  - **这份文件里那份本地 `stripComments`**（带 HTML 注释开关那一型）没换成共享件：
    它在 `tests/strip-comments-single-source.test.ts` 的台账里登记为
    「带 HTML 注释开关的一型」，换过去会改变该判据看到的文本 —— 那是 #1192 那条账的活，
    而 #1192 已关 ⇒ 要做得另立单。本批只把 `read()` 的用法保持原样，
    没有新增剥注释面（也就不需要 #2925 那个前提之外的东西）。
  - **`scripts/dev-launcher.ps1` / `Cargo.toml` 那两格的 `#` 注释语法缺口**归 **ISSUE #2934**；
    「执行链三份地图」归 **ISSUE #2914**（P2，等 owner 选案）。

  执行面：本文件 33 条绿、`eslint` 退 0、`pnpm exec tsc --noEmit` 退 0。
