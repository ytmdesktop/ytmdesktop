module.exports = {
  "env": {
    "browser": true,
    "es6": true,
    "node": true
  },
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/eslint-recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:import/recommended",
    "plugin:import/electron",
    "plugin:import/typescript",
    "plugin:vue/vue3-recommended",
    "prettier"
  ],
  "rules": {
    "vue/multi-word-component-names": "off",
    "import/no-unresolved": "off"
  },
  "settings": {
    "import/resolver": {
      "typescript": {}
    }
  },
  "overrides": [
    {
      "files": ["*.ts"],
      "parser": "@typescript-eslint/parser",
      "parserOptions": {
        "project": true,
        "tsconfigRootDir": __dirname,
      }
    },
    {
      "files": ["*.vue"],
      "parser": "vue-eslint-parser",
      "parserOptions": {
        "parser": {
          "js": "espree",
          "ts": "@typescript-eslint/parser",
          "<template>": "espree"
        },
        "sourceType": "module"
      }
    },
    {
      "files": ["*.js"],
      "parser": "espree"
    }
  ]
}
