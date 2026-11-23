/* 首页就是创作台（ISSUE #4881）：访问 / 直接渲染与 /workspace 相同的内容，
 * URL 停在 /，不再把地址改写成 /workspace。/workspace 路由原样保留（外链、
 * 书签与既有用例不失效）。这里只 re-export workspace 页面的默认导出 ——
 * 单份实现，不复制第二份页面代码（硬规则 20）。 */
export { default } from "./workspace/page";
