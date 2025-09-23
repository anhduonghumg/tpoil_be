const tseslint = require('@typescript-eslint/eslint-plugin')
const pluginImport = require('eslint-plugin-import')
const js = require('@eslint/js')
const prettier = require('eslint-config-prettier')

module.exports = [
    { ignores: ['dist/**', 'node_modules/**'] },

    // JavaScript files
    {
        files: ['**/*.{js,cjs}'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
        },
        rules: {},
    },

    // TypeScript files
    {
        files: ['**/*.ts'],
        languageOptions: {
            parser: require('@typescript-eslint/parser'),
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
        },
        plugins: {
            '@typescript-eslint': tseslint,
            import: pluginImport,
        },
        rules: {
            ...tseslint.configs.recommended.rules,
            '@typescript-eslint/interface-name-prefix': 'off',
            '@typescript-eslint/explicit-function-return-type': 'off',
            '@typescript-eslint/explicit-module-boundary-types': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
        },
    },

    js.configs.recommended,
    prettier,
]
