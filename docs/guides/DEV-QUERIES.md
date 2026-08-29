# 开发诊断命令速查(DEV QUERIES)

> 环境注意:以下命令在 Windows + Git Bash 下实测可用(shell 用 Git Bash,不要用 cmd/PowerShell 语法)。
> 配套规范:[提交与 Code Review](../standards/13-提交与-code-review.md)、[样式与 Tailwind](../standards/03-样式与-tailwind.md)。
> 最后实测:2026-08-29。

## 1. TypeScript 检查

```bash
# 全量类型检查(tsconfig 已开 noUnusedLocals,未使用的 import 会报 TS6133/TS6196 error)
npm run typecheck

# 全量输出里只看某个文件的报错(把 AgentPanel 换成任意文件名片段)
npx tsc --noEmit 2>&1 | grep -i "AgentPanel"
```

## 2. ESLint

```bash
# 单文件 lint(项目里 no-unused-vars 是 warn 级,不会让 eslint 本身失败,但 tsc 会拦)
npx eslint src/components/studio/AgentPanel.tsx

# 提交门槛 = lint + typecheck
npm run check

# 自动修复(导入排序等)
npx eslint src --fix
```

## 3. 判断一段代码是不是死代码(有没有使用方)

```bash
# 查组件/符号在定义处之外有没有被引用(把 AgentPanel 换成任意符号名)
grep -rn "AgentPanel" src --include="*.tsx" --include="*.ts" | grep -v "AgentPanel.tsx"

# 输出为空 = 只有定义没有使用方,大概率是死代码(或仅从 index.ts 转导出、尚未接入页面)
```

## 4. 内联 SVG → lucide-react 迁移

项目图标统一走中央组件 `src/components/ui/Icon.tsx`(字符串 key → lucide 图标映射),组件里用 `<Icon name="plus" size={16} />`。

```bash
# 找出所有还带内联 <svg> 的文件(迁移目标清单)
grep -rln "<svg" src --include="*.tsx"

# 数量统计
grep -rln "<svg" src --include="*.tsx" | wc -l

# 迁移前先确认图标是否已在中央映射里(没有就先在 Icon.tsx 的 import 和 ICON_MAP 各加一行)
grep -in "smile" src/components/ui/Icon.tsx
```

## 5. Tailwind 检查

```bash
# 透明度写法规范(standards/03 §3.1):只有预设档 /5 /10 /15 /20 /25 /30 ... 可直接写,
# /6 这类非预设值必须写成 /[0.06]。排查违规的单数字非预设透明度(命中里只有 /5 是合法的):
grep -rEn --include="*.tsx" -e "-[a-z]+-?[0-9]*/[0-9]\b" src

# 列出全部 颜色/透明度 组合及次数,人工核对非预设档(/12、/18、/22 等两档位违规也逃不掉):
grep -rEoh --include="*.tsx" -e "[a-z]+-?[0-9]*/[0-9]+" src | sort | uniq -c | sort -rn

# 检查自定义工具类(如 u-title)是否真的存在于 globals.css,防止拼错类名静默失效
grep -n "u-title" src/app/globals.css

# 统计两种透明度写法的占比(括号形式应为绝对主流)
grep -roh --include="*.tsx" -e "white/\[[0-9.]*\]" src | wc -l
grep -roh --include="*.tsx" -e "white/[0-9]\+" src | wc -l
```

## 6. 查看可用脚本

```bash
grep -n "\"check\"\|typecheck\|\"test\"" package.json
```

## 7. Node 网络超时(装依赖失败必看)

**症状**:`pnpm add` / `npm install` 报 `ERR_PNPM_META_FETCH_FAIL` / `UND_ERR_CONNECT_TIMEOUT`,npmmirror 镜像也超时;但 `curl` 访问同一地址正常。

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
npx tsc --noEmit 2>&1 | grep -i "你改的文件名"
npx eslint src/path/to/File.tsx
npm run check
```
