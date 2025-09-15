module.exports = [
  { ignores: ["dist/**", "node_modules/**"] },

  // JavaScript files (cấu hình nhẹ)
  {
    files: ["**/*.{js,cjs}"],
    languageOptions: { ecmaVersion: "latest", sourceType: "commonjs" },
    rules: {},
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        // KHÔNG trỏ project => tránh lỗi project service
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: { import: pluginImport },
    rules: {
      "@typescript-eslint/interface-name-prefix": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  js.configs.recommended,
  prettier,
];
