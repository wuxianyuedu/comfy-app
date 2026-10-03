<!-- ⚠️ 本文件为自动生成产物（`pnpm doc:render`），请勿手改。
编辑态文档（单一事实 + 占位符）见：`docs/guides/DEV-QUERIES.md`。改动请回源文件，再重新生成。 -->

# 开发诊断命令速查(DEV QUERIES)

> 环境注意:以下命令在 Windows + Git Bash 下实测可用(shell 用 Git Bash,不要用 cmd/PowerShell 语法)。
> 配套规范:[提交与 Code Review](../standards/13-提交与-code-review.md)、[样式与 Tailwind](../standards/03-样式与-tailwind.md)。
> 最后实测:2026-08-29。

## 1. TypeScript 检查

```bash
# 全量类型检查(tsconfig 已开 noUnusedLocals,未使用的 import 会报 TS6133/TS6196 error)
pnpm typecheck

# 全量输出里只看某个文件的报错(把 AgentPanel 换成任意文件名片段)
pnpm exec tsc --noEmit 2>&1 | grep -i "AgentPanel"
```

## 2. ESLint

```bash
# 单文件 lint(项目里 no-unused-vars 是 warn 级,不会让 eslint 本身失败,但 tsc 会拦)
pnpm exec eslint src/components/studio/AgentPanel.tsx

# 提交门槛 = lint + typecheck
pnpm check

# 自动修复(导入排序等)
pnpm exec eslint src --fix
```

## 3. 判断一段代码是不是死代码(有没有使用方)

```bash
# 查组件/符号在定义处之外有没有被引用(把 AgentPanel 换成任意符号名)
grep -rn "AgentPanel" src --include="*.tsx" --include="*.ts" | grep -v "AgentPanel.tsx"

# 输出为空 = 只有定义没有使用方,大概率是死代码(或仅从 index.ts 转导出、尚未接入页面)
```

## 4. 内联 SVG → lucide-react 迁移

2026-08-29 已完成主体迁移(127 处替换)。剩余 ~20 个文件的内联 `<svg>` 是规范豁免项(03 §3.4:非 24×24 viewBox、渐变/图表/特效、实心填充无对应变体、品牌图形),不要盲目替换。

静态图标直接 import lucide;数据驱动/可序列化的 key 走中央组件 `<Icon name>`(`src/components/ui/Icon.tsx`,新图标先加 ICON_MAP)。

```bash
# 回归监控:新增的内联 <svg> 清单(排除豁免文件后应保持为空增量)
grep -rln "<svg" src --include="*.tsx"

# 迁移前先确认图标是否已在中央映射里(走 Icon 组件时)
grep -in "smile" src/components/ui/Icon.tsx
```

## 5. Tailwind 检查

```bash
# 规范写法(standards/03 §3.1):透明度一律斜杠百分比 /6(小数 /1.5 合法);
# 渐变 bg-linear-to-*;CSS 变量任意值 -(--x);断词 wrap-break-word;
# important 修饰符写后缀(bg-subtle! 而非 !bg-subtle)。排查 v3 旧写法(均应为 0):
grep -rEn --include="*.tsx" --include="*.ts" -e "/\[0\.[0-9]+\]" src
grep -rEn --include="*.tsx" --include="*.ts" -e "bg-gradient-to-" src
grep -rEo --include="*.tsx" --include="*.ts" -e "\[var\(--[a-zA-Z0-9-]+\)\]" src
grep -rEn --include="*.tsx" --include="*.ts" -e "break-words" src
# important 前缀只能按 className 字符串判(全局搜 !x 会撞上 JS 前缀否定):
grep -rEn --include="*.tsx" --include="*.ts" -e 'className="[^"]*![a-z]' src

# 批量迁移脚本(幂等,只处理上面前四类模式):
grep -rlE --include="*.tsx" --include="*.ts" -e "/\[0\.[0-9]+\]|bg-gradient-to-|\[var\(--|break-words" src | tr -d '\r' | while IFS= read -r f; do node scripts/tw4-canonical-codemod.cjs "$f"; done

# 任意值 → spacing 倍数(min-h-[22px] → min-h-5.5):判据交给 Tailwind 引擎
# (换算后的裸数值必须真能编出规则、且声明里带 var(--spacing) 才改写),
# 顺带按 P80 把同值 w-K/h-K 合并成 size-K。dry-run 默认,加 --write 落盘:
node scripts/tw4-spacing-canonical.mjs
node scripts/tw4-spacing-canonical.mjs --write

# 全量 canonical 汇总(更名/别名/遗留类,与编辑器 suggestCanonicalClasses 同源:
# 直接问 design system 的 canonicalizeCandidates「有没有另一种写法生成相同 CSS」)。
# 与上面那个互补:那条管"任意值↔spacing",这条管 "!x / break-words / data-[x]: /
# has-[:x]: / flex-shrink / translate-y-[-1px] / aspect-[4/3] / bg-gradient-to-*" 等。
# 约 15s 扫完 src,默认只读。两类文件它不动:--write 跳过 .snap(排序会变,只能
# vitest -u 重生成)与 *.test.*(里面的类名多是断言样本,负样本改了会把判据改坏,
# 报告里单列出来由人判断;确认要同步再加 --with-tests)。没有同名测试文件的
# 孤儿快照永远跳过——任何用例都不会校验它。
node scripts/tw4-canonical-report.mjs
node scripts/tw4-canonical-report.mjs --write       # 落盘(快照仍需 vitest -u)
node scripts/tw4-canonical-report.mjs --with-tests # 连测试文件一起改(自己先看清)

# 检查自定义工具类(如 u-title)是否真的存在于 globals.css,防止拼错类名静默失效
grep -n "u-title" src/app/globals.css
```

## 5.1 TypeScript：同一属性指定两次

编辑器报 `ts(2783) 多次指定了 "x"`（**项目钉的 `typescript6` 对此不报** —— 同一处
代码命令行全绿、编辑器标红），所以只能按语法形态扫：

```bash
node scripts/report-ts-duplicate-keys.mjs              # 汇总（默认不含 *.test.*）
node scripts/report-ts-duplicate-keys.mjs --with-tests # 连测试一起扫
node scripts/report-ts-duplicate-keys.mjs --json
```

## 6. 查看可用脚本

```bash
grep -n "\"check\"\|typecheck\|\"test\"" package.json
```

## 7. Node 网络超时(装依赖失败必看)

**症状**:`pnpm add`(历史上用 `npm install`,现应改为 `pnpm`)报 `ERR_PNPM_META_FETCH_FAIL` / `UND_ERR_CONNECT_TIMEOUT`,npmmirror 镜像也超时;但 `curl` 访问同一地址正常。

**原因**:本机 `dns.lookup`(getaddrinfo)对 registry 域名只返回失效的 IPv6,Node 的 fetch/https 全部卡死在连接 IPv6 上;curl 和显式 IPv4 的 TLS 均正常。

**诊断与解法**(已验证):

```bash
# 确认 getaddrinfo 只给了 IPv6(family:6)→ 即为本问题
node -e "require('dns').lookup('registry.npmmirror.com', {all:true}, (e,a)=>console.log(e||a))"

# 解法:preload 补丁强制 IPv4,只对本次命令生效,不改系统配置
NODE_OPTIONS="--require ./scripts/force-ipv4-dns.cjs" pnpm install
NODE_OPTIONS="--require ./scripts/force-ipv4-dns.cjs" pnpm add -D <包名>
```

补丁实现见 `scripts/force-ipv4-dns.cjs`(tsconfig checkJs 会检查它,改动需保持 JSDoc 注解)。

## 8. 验证改动后的标准收尾流程

```bash
# 改完代码后的最小验证组合(先看目标文件,再跑全量门槛)
pnpm exec tsc --noEmit 2>&1 | grep -i "你改的文件名"
pnpm exec eslint src/path/to/File.tsx
pnpm check
```
