## Fixed

- **用例的「环境早退」：一条报绿的用例，一条断言都没跑**（ISSUE #1485，规范 §11.17）。`src/components/studio/hooks/use-css-color-token.test.ts` 的 SSR 分支原先写成 `if (typeof window !== "undefined") return;` —— 它把本用例的结论挂在了**运行环境的一个全局默认值**上（注释里还把那句「vitest 的默认环境是 node」写成了前提）。默认档一换（或该文件被挪进另一个 project），它照样报绿，而 `N passed` 里有一份是空的 —— 正是本仓库反复踩的「绿有两种含义」里坏的那一种（§11.13.1 / §11.7 同族）。
  - 修法是**把条件造出来**：`vi.stubGlobal("window", undefined)` + 断言 + `afterEach(vi.unstubAllGlobals)`，与 `src/lib/app-events.test.ts` 既有样板同形。变异核过：把 stub 去掉，在 jsdom 默认档下当场红（旧写法在那里是绿的）。

## Changed

- **`vitest.config.ts` 的环境档从「一条全局 `node`」改成 `projects` 两个档**（ISSUE #1485，规范 §11.17）。进 jsdom 档的用例面 `JSDOM_TEST_GLOBS` 只在**两种整目录一致的形状**上声明：① 该目录下全部用例都要 jsdom（实测 26 个目录）；② `.test.tsx`（实测 116/116 完全相关）。
  - **文件头继续保留、继续承重**：实测（vitest 5.0.3）文件头的 `@vitest-environment` **优先级高于 project 的 `environment`** —— 把 183 份文件头摘掉跑一遍，**178 份当场红**。`projects` 只决定「没写文件头时跑在哪」，两份东西各管一半。
  - **混合目录保持 node 档**（实测 20 个）：按目录一刀切会把 **260 份 node 用例**误升进 jsdom，而放错的两个方向**不对称** —— node 档下碰 DOM 会当场红（响的），jsdom 档下跑纯逻辑**不报错、只是变慢**（**静默的**）。量化账：按目录切最多省 51/183 处注释（其余 133 份与 node 用例同目录），却要写 57 条 glob 去摘少数派 —— 不值当。
  - **共享项收进 `SHARED_TEST_OPTIONS`**：`projects` 里每一档**不继承**声明方的 `test` 选项，写在根 `test` 上而没生效的项会静默用 vitest 出厂值。实测踩过一次（`setupFiles` 漏搬 → 整仓 `toBeInTheDocument` 变「Invalid Chai property」、2 条用例当场红）。

## Added

- **`scripts/check-test-environment.cjs`**（进 pre-commit D 组）判两件，纯文本、零网络、实测 < 1s：
  - ① **环境早退** —— 用例体内「按环境决定跑不跑」的裸 `return` 一律阻断。`typeof` 后面**只认环境全局白名单**：首版写成「任意标识符」时 `if (typeof input === "string") return input;`（类型收窄）被当场误报 —— 一个会误报的判据活不过一次评审。
  - ② **目录档与文件头矛盾** —— 只判「jsdom 档里的用例声明 `node`」，不判反方向（「node 档目录里声明 jsdom」是正当写法，文件头优先级更高；按「与 project 同名」的口径实测一次报 **37 处**误报）。
  - 判据自己**不许静默降级**：解析不到 `projects` 的形状时判失败，不退回「没有目录档」。glob 翻译的 `**/` 必须翻成「零层或多层目录」，否则 `src/config/**/*.test.ts` 匹配不到 `src/config/x.test.ts`（实测：目录档整条失效而判据照样报 OK）。
- **`tests/test-environment-gate.test.ts`**（进 C 组固定清单）：跑真脚本，钉住上面两条误报口径与「解析失败即红」——把白名单放宽、或把字符串删空（首版 bug：剥注释时把 `"undefined"` 删空，正则连同哨兵一起失配），都当场红。
- 规范 **§11.17**（现状 / 分档口径 / 三条实测边界 / 判据口径 / 这一档不做什么）。
