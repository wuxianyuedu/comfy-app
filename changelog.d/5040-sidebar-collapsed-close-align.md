## Fixed
- 侧栏折叠态两个 UI 细节（#5040）：① 已打开项悬停出现的关闭按钮此前压在图标右上角盖住图标，改为垂直居中、移到图标右侧的小圆徽（right-[-6px]/size-3）；② 打开态胶片 size-7 在折叠态 16px 内容盒里 overflow 让图标右偏 6px，改为折叠态 absolute inset-0 铺满按钮，图标与裸图标同列中心对齐。抽 OPEN_TAB_GLYPH_CLASS 让全局导航项与项目行共用；展开态定位与 pointerdown 链路不变。补组件用例与截图。
