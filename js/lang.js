/*
 * PseudoStudio - the "Pseudo" language definition + Atom One Dark theme.
 * Exposes PseudoStudio.registerLanguage(monaco).
 */
(function () {
  const NS = (window.PseudoStudio = window.PseudoStudio || {});

  NS.LANGUAGE_ID = "pseudo";
  NS.LANGUAGE_NAME = "Pseudo";

  NS.registerLanguage = function (monaco) {
    if (monaco.languages.getLanguages().some((l) => l.id === NS.LANGUAGE_ID)) return;

    monaco.languages.register({ id: NS.LANGUAGE_ID, extensions: [".pseudo"], aliases: ["Pseudo", "pseudo"] });

    // ---- Monarch tokenizer ----
    monaco.languages.setMonarchTokensProvider(NS.LANGUAGE_ID, {
      defaultToken: "identifier",
      tokenPostfix: ".pseudo",
      ignoreCase: false,

      keywords: [
        "MODULE", "STATE", "FUNCTION", "END",
        "IF", "THEN", "ELSE", "ELSEIF",
        "RETURN", "IS", "NOT",
        "FOR", "WHILE", "DO", "TO", "IN",
        "BREAK", "CONTINUE",
        "AND", "OR", "XOR",
      ],
      constants: ["NIL", "TRUE", "FALSE", "ERROR"],
      builtins: ["Error", "Map", "Integer", "String", "Boolean", "any"],
      operators: ["=", "==", "<>", "!=", "<", ">", "<=", ">=", "+", "-", "*", "/", "MOD", "DIV", "->", "<-"],
      symbols: /[=<>!~?:&|+\-*/^%]+/,

      tokenizer: {
        root: [
          [/<\?[^?]*\?>/, "comment"],
          [/\/\/.*$/, "comment"],
          [/\/\*/, "comment", "@comment"],

          // strings
          [/"/, { token: "string.quote", bracket: "@open", next: "@string" }],
          [/'[^']*'/, "string"],

          // numbers
          [/\d+\.\d+/, "number.float"],
          [/\d+/, "number"],

          // declaration headers -> color the declared name
          [/\bMODULE\b/, { token: "keyword", next: "@moduledecl" }],
          [/\bFUNCTION\b/, { token: "keyword", next: "@funcdecl" }],

          // identifiers / keywords / constants / builtins
          [/[A-Za-z_]\w*/, {
            cases: {
              "@keywords": "keyword",
              "@constants": "constant",
              "@builtins": "type",
              "@default": "identifier",
            },
          }],

          // member access:  db.QUERY_ONE  /  result.error
          [/(\.)([A-Za-z_]\w*)/, ["delimiter", "method"]],

          // operators
          [/@symbols/, { cases: { "@operators": "operator", "@default": "delimiter" } }],

          // brackets & punctuation
          [/[[\](){}]/, "@brackets"],
          [/[,:;]/, "delimiter"],
          [/\s+/, "white"],
        ],

        moduledecl: [
          [/\s+/, "white"],
          [/[A-Za-z_]\w*/, { token: "type", next: "@pop" }],
          [/[^]/, { token: "@rematch", switchTo: "@root" }],
        ],
        funcdecl: [
          [/\s+/, "white"],
          [/[A-Za-z_]\w*/, { token: "function", next: "@pop" }],
          [/[^]/, { token: "@rematch", switchTo: "@root" }],
        ],

        string: [
          [/[^\\"]+/, "string"],
          [/\\./, "string.escape"],
          [/"/, { token: "string.quote", bracket: "@close", next: "@pop" }],
        ],
        comment: [
          [/[^*]+/, "comment"],
          [/\*\//, "comment", "@pop"],
          [/\*/, "comment"],
        ],
      },
    });

    // ---- Language configuration (comments, brackets, indentation) ----
    monaco.languages.setLanguageConfiguration(NS.LANGUAGE_ID, {
      comments: { lineComment: "//", blockComment: ["/*", "*/"] },
      brackets: [
        ["(", ")"],
        ["[", "]"],
        ["{", "}"],
      ],
      autoClosingPairs: [
        { open: "(", close: ")" },
        { open: "[", close: "]" },
        { open: "{", close: "}" },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
      ],
      surroundingPairs: [
        { open: "(", close: ")" },
        { open: "[", close: "]" },
        { open: "{", close: "}" },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
      ],
      indentationRules: {
        increaseIndentPattern: /^\s*(MODULE|STATE|FUNCTION|IF|ELSE|ELSEIF|FOR|WHILE)\b.*$/,
        decreaseIndentPattern: /^\s*(END|ELSE|ELSEIF)\b.*$/,
      },
    });

    // ---- Atom One Dark theme ----
    monaco.editor.defineTheme("atom-one-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "", foreground: "abb2bf", background: "282c34" },
        { token: "comment", foreground: "5c6370", fontStyle: "italic" },
        { token: "keyword", foreground: "c678dd" },
        { token: "constant", foreground: "d19a66" },
        { token: "number", foreground: "d19a66" },
        { token: "number.float", foreground: "d19a66" },
        { token: "string", foreground: "98c379" },
        { token: "string.quote", foreground: "98c379" },
        { token: "string.escape", foreground: "56b6c2" },
        { token: "function", foreground: "61afef" },
        { token: "method", foreground: "61afef" },
        { token: "type", foreground: "e5c07b" },
        { token: "operator", foreground: "56b6c2" },
        { token: "delimiter", foreground: "abb2bf" },
        { token: "identifier", foreground: "abb2bf" },
        { token: "white", foreground: "abb2bf" },
      ],
      colors: {
        "editor.background": "#282c34",
        "editor.foreground": "#abb2bf",
        "editorLineNumber.foreground": "#495162",
        "editorLineNumber.activeForeground": "#abb2bf",
        "editorCursor.foreground": "#528bff",
        "editor.selectionBackground": "#3e4451",
        "editor.inactiveSelectionBackground": "#2c313a",
        "editor.selectionHighlightBackground": "#3e4451aa",
        "editor.lineHighlightBackground": "#2c313a",
        "editor.lineHighlightBorder": "#282c34",
        "editorIndentGuide.background": "#3b4048",
        "editorIndentGuide.activeBackground": "#5c6370",
        "editorWidget.background": "#21252b",
        "editorWidget.border": "#181a1f",
        "editorSuggestWidget.background": "#21252b",
        "editorSuggestWidget.border": "#181a1f",
        "editorSuggestWidget.selectedBackground": "#2c313a",
        "editorSuggestWidget.selectedForeground": "#d7dae0",
        "editorSuggestWidget.highlightForeground": "#528bff",
        "editorHoverWidget.background": "#21252b",
        "editorHoverWidget.border": "#181a1f",
        "editorGutter.background": "#282c34",
        "editorError.foreground": "#e06c75",
        "editorWarning.foreground": "#d19a66",
        "editorInfo.foreground": "#61afef",
        "editorHint.foreground": "#56b6c2",
        "editorLink.activeForeground": "#61afef",
        "editorBracketMatch.background": "#3e4451aa",
        "editorBracketMatch.border": "#00000000",
        "editorOverviewRuler.errorForeground": "#e06c75aa",
        "editorOverviewRuler.warningForeground": "#d19a66aa",
        "scrollbarSlider.background": "#4b526488",
        "scrollbarSlider.hoverBackground": "#5a6275aa",
        "scrollbarSlider.activeBackground": "#5a6275cc",
        "peekViewResult.background": "#21252b",
        "peekViewTitle.background": "#21252b",
        "peekViewBorder": "#528bff",
      },
    });
  };
})();
