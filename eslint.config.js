module.exports = [
  {
    ignores: [
      "node_modules/**",
      "coverage/**",
      "results/**",
      "Polygon_List/**",
      "public/**",
      "scraper/**",
      "scripts/**"
    ]
  },
  {
    files: ["server.js", "app/**/*.js", "__tests__/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        console: "readonly",
        process: "readonly",
        module: "readonly",
        require: "readonly",
        __dirname: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly"
      }
    },
    rules: {
      "no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
      "no-undef": "error",
      "prefer-const": "error"
    }
  },
  {
    files: ["__tests__/**/*.js"],
    languageOptions: {
      globals: {
        describe: "readonly",
        test: "readonly",
        expect: "readonly",
        jest: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly"
      }
    }
  }
];
