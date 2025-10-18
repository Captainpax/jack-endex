import js from '@eslint/js'
import globals from 'globals'
import vue from 'eslint-plugin-vue'
import { defineConfig, globalIgnores } from 'eslint/config'

const sharedLanguageOptions = {
  ecmaVersion: 'latest',
  sourceType: 'module',
  globals: {
    ...globals.browser,
    ...globals.node,
    ...globals.vitest,
  },
}

const sharedRules = {
  'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
}

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,mjs,cjs,ts}'],
    extends: [js.configs.recommended],
    languageOptions: { ...sharedLanguageOptions },
    rules: { ...sharedRules },
  },
  {
    files: ['**/*.vue'],
    extends: [...vue.configs['flat/recommended']],
    languageOptions: { ...sharedLanguageOptions },
    rules: { ...sharedRules },
  },
])
