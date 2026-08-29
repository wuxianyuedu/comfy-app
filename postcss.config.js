/* PostCSS 配置。具名导出再默认导出，避免 import/no-anonymous-default-export
 * （匿名默认导出无法被 ESLint 静态分析，且不便在别处复用该对象）。 */
const postcssConfig = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default postcssConfig;
