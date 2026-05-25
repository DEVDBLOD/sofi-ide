/**
 * Monaco Editor setup: registers completion providers and configures IntelliSense.
 * Called once via the editor's onMount callback.
 */

let registered = false;

export function setupMonaco(monaco: any) {
  if (registered) return;
  registered = true;

  // ── TypeScript / JavaScript diagnostics ───────────────────────────────────
  const tsDefaults = monaco.languages.typescript.typescriptDefaults;
  tsDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
    noSuggestionDiagnostics: false,
  });
  tsDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
    strict: true,
    noImplicitAny: true,
    strictNullChecks: true,
    noUnusedLocals: false,
    noUnusedParameters: false,
    allowNonTsExtensions: true,
    allowJs: true,
    esModuleInterop: true,
    noEmit: true,
    lib: ["esnext", "dom", "dom.iterable"],
  });

  const jsDefaults = monaco.languages.typescript.javascriptDefaults;
  jsDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
    noSuggestionDiagnostics: false,
  });
  jsDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    allowNonTsExtensions: true,
    allowJs: true,
    checkJs: true,
    esModuleInterop: true,
    noEmit: true,
    lib: ["esnext", "dom"],
  });

  // ── Python completion provider ─────────────────────────────────────────────
  const PY_KEYWORDS = [
    "False", "None", "True", "and", "as", "assert", "async", "await",
    "break", "class", "continue", "def", "del", "elif", "else", "except",
    "finally", "for", "from", "global", "if", "import", "in", "is",
    "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try",
    "while", "with", "yield",
  ];

  const PY_BUILTINS = [
    "abs", "aiter", "all", "anext", "any", "ascii", "bin", "bool",
    "breakpoint", "bytearray", "bytes", "callable", "chr", "classmethod",
    "compile", "complex", "copyright", "credits", "delattr", "dict", "dir",
    "divmod", "enumerate", "eval", "exec", "exit", "filter", "float",
    "format", "frozenset", "getattr", "globals", "hasattr", "hash", "help",
    "hex", "id", "input", "int", "isinstance", "issubclass", "iter", "len",
    "license", "list", "locals", "map", "max", "memoryview", "min", "next",
    "object", "oct", "open", "ord", "pow", "print", "property", "quit",
    "range", "repr", "reversed", "round", "set", "setattr", "slice",
    "sorted", "staticmethod", "str", "sum", "super", "tuple", "type",
    "vars", "zip",
  ];

  const PY_EXCEPTIONS = [
    "ArithmeticError", "AssertionError", "AttributeError", "BaseException",
    "BlockingIOError", "BrokenPipeError", "BufferError", "BytesWarning",
    "ChildProcessError", "ConnectionAbortedError", "ConnectionError",
    "ConnectionRefusedError", "ConnectionResetError", "DeprecationWarning",
    "EOFError", "EnvironmentError", "Exception", "FileExistsError",
    "FileNotFoundError", "FloatingPointError", "FutureWarning", "GeneratorExit",
    "IOError", "ImportError", "ImportWarning", "IndentationError", "IndexError",
    "InterruptedError", "IsADirectoryError", "KeyError", "KeyboardInterrupt",
    "LookupError", "MemoryError", "ModuleNotFoundError", "NameError",
    "NotADirectoryError", "NotImplemented", "NotImplementedError", "OSError",
    "OverflowError", "PendingDeprecationWarning", "PermissionError",
    "ProcessLookupError", "RecursionError", "ReferenceError", "ResourceWarning",
    "RuntimeError", "RuntimeWarning", "StopAsyncIteration", "StopIteration",
    "SyntaxError", "SyntaxWarning", "SystemError", "SystemExit", "TabError",
    "TimeoutError", "TypeError", "UnboundLocalError", "UnicodeDecodeError",
    "UnicodeEncodeError", "UnicodeError", "UnicodeTranslateError",
    "UnicodeWarning", "UserWarning", "ValueError", "Warning", "ZeroDivisionError",
  ];

  const PY_SNIPPETS: Array<{
    label: string;
    detail: string;
    insert: string;
    doc?: string;
  }> = [
    {
      label: "def",
      detail: "Define a function",
      insert: "def ${1:function_name}(${2:args}):\n\t${3:pass}",
      doc: "Define a new function",
    },
    {
      label: "class",
      detail: "Define a class",
      insert: "class ${1:ClassName}${2:(object)}:\n\tdef __init__(self${3:, args}):\n\t\t${4:pass}",
      doc: "Define a new class",
    },
    {
      label: "if",
      detail: "If statement",
      insert: "if ${1:condition}:\n\t${2:pass}",
    },
    {
      label: "ife",
      detail: "If / else statement",
      insert: "if ${1:condition}:\n\t${2:pass}\nelse:\n\t${3:pass}",
    },
    {
      label: "ifei",
      detail: "If / elif / else statement",
      insert: "if ${1:condition}:\n\t${2:pass}\nelif ${3:condition}:\n\t${4:pass}\nelse:\n\t${5:pass}",
    },
    {
      label: "for",
      detail: "For loop",
      insert: "for ${1:item} in ${2:iterable}:\n\t${3:pass}",
    },
    {
      label: "fori",
      detail: "For loop with enumerate",
      insert: "for ${1:i}, ${2:item} in enumerate(${3:iterable}):\n\t${4:pass}",
    },
    {
      label: "while",
      detail: "While loop",
      insert: "while ${1:condition}:\n\t${2:pass}",
    },
    {
      label: "try",
      detail: "Try / except block",
      insert: "try:\n\t${1:pass}\nexcept ${2:Exception} as ${3:e}:\n\t${4:raise}",
    },
    {
      label: "tryf",
      detail: "Try / except / finally block",
      insert: "try:\n\t${1:pass}\nexcept ${2:Exception} as ${3:e}:\n\t${4:raise}\nfinally:\n\t${5:pass}",
    },
    {
      label: "with",
      detail: "With statement",
      insert: "with ${1:expression} as ${2:var}:\n\t${3:pass}",
    },
    {
      label: "import",
      detail: "Import module",
      insert: "import ${1:module}",
    },
    {
      label: "from",
      detail: "From import",
      insert: "from ${1:module} import ${2:name}",
    },
    {
      label: "lambda",
      detail: "Lambda function",
      insert: "lambda ${1:args}: ${2:expression}",
    },
    {
      label: "lc",
      detail: "List comprehension",
      insert: "[${1:expr} for ${2:item} in ${3:iterable}]",
    },
    {
      label: "lci",
      detail: "List comprehension with condition",
      insert: "[${1:expr} for ${2:item} in ${3:iterable} if ${4:condition}]",
    },
    {
      label: "dc",
      detail: "Dict comprehension",
      insert: "{${1:key}: ${2:value} for ${3:item} in ${4:iterable}}",
    },
    {
      label: "sc",
      detail: "Set comprehension",
      insert: "{${1:expr} for ${2:item} in ${3:iterable}}",
    },
    {
      label: "main",
      detail: "Main guard",
      insert: "if __name__ == \"__main__\":\n\t${1:main()}",
    },
    {
      label: "print",
      detail: "print()",
      insert: "print(${1})",
    },
    {
      label: "pf",
      detail: "Print f-string",
      insert: "print(f\"${1}\")",
    },
    {
      label: "dunder",
      detail: "__init__ method",
      insert: "def __init__(self${1:, args}):\n\t${2:pass}",
    },
    {
      label: "prop",
      detail: "@property",
      insert: "@property\ndef ${1:name}(self):\n\treturn self._${1:name}",
    },
    {
      label: "staticm",
      detail: "@staticmethod",
      insert: "@staticmethod\ndef ${1:name}(${2:args}):\n\t${3:pass}",
    },
    {
      label: "classm",
      detail: "@classmethod",
      insert: "@classmethod\ndef ${1:name}(cls${2:, args}):\n\t${3:pass}",
    },
    {
      label: "type",
      detail: "Type annotation",
      insert: "${1:variable}: ${2:type} = ${3:value}",
    },
    {
      label: "dataclass",
      detail: "@dataclass",
      insert: "from dataclasses import dataclass\n\n@dataclass\nclass ${1:ClassName}:\n\t${2:field}: ${3:type}",
    },
    {
      label: "async def",
      detail: "Async function",
      insert: "async def ${1:function_name}(${2:args}):\n\t${3:pass}",
    },
    {
      label: "await",
      detail: "Await expression",
      insert: "await ${1:coroutine}",
    },
  ];

  const CompletionItemKind = monaco.languages.CompletionItemKind;
  const InsertTextRule = monaco.languages.CompletionItemInsertTextRule;

  monaco.languages.registerCompletionItemProvider("python", {
    triggerCharacters: [".", "(", " ", "\t"],
    provideCompletionItems(model: any, position: any) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const suggestions: any[] = [];

      // Keywords
      for (const kw of PY_KEYWORDS) {
        suggestions.push({
          label: kw,
          kind: CompletionItemKind.Keyword,
          insertText: kw,
          range,
          detail: "keyword",
        });
      }

      // Built-in functions
      for (const fn of PY_BUILTINS) {
        suggestions.push({
          label: fn,
          kind: CompletionItemKind.Function,
          insertText: `${fn}($1)`,
          insertTextRules: InsertTextRule.InsertAsSnippet,
          range,
          detail: "builtin function",
        });
      }

      // Exceptions
      for (const ex of PY_EXCEPTIONS) {
        suggestions.push({
          label: ex,
          kind: CompletionItemKind.Class,
          insertText: ex,
          range,
          detail: "exception",
        });
      }

      // Snippets
      for (const snip of PY_SNIPPETS) {
        suggestions.push({
          label: snip.label,
          kind: CompletionItemKind.Snippet,
          insertText: snip.insert,
          insertTextRules: InsertTextRule.InsertAsSnippet,
          range,
          detail: snip.detail,
          documentation: snip.doc,
          sortText: `0_${snip.label}`, // appear first
        });
      }

      return { suggestions };
    },
  });

  // ── TypeScript/JavaScript: extra snippets on top of Monaco's built-in ─────
  for (const lang of ["javascript", "typescript"]) {
    const JS_SNIPPETS: Array<{ label: string; detail: string; insert: string }> = [
      {
        label: "cl",
        detail: "console.log()",
        insert: "console.log(${1})",
      },
      {
        label: "ce",
        detail: "console.error()",
        insert: "console.error(${1})",
      },
      {
        label: "fn",
        detail: "Arrow function",
        insert: "const ${1:name} = (${2:args}) => {\n\t${3}\n}",
      },
      {
        label: "afn",
        detail: "Async arrow function",
        insert: "const ${1:name} = async (${2:args}) => {\n\t${3}\n}",
      },
      {
        label: "iife",
        detail: "IIFE",
        insert: "((${1:args}) => {\n\t${2}\n})(${3})",
      },
      {
        label: "imp",
        detail: "ES6 import",
        insert: "import ${1:name} from \"${2:module}\"",
      },
      {
        label: "impc",
        detail: "ES6 named import",
        insert: "import { ${1:name} } from \"${2:module}\"",
      },
      {
        label: "exp",
        detail: "ES6 export default",
        insert: "export default ${1}",
      },
      {
        label: "expc",
        detail: "ES6 named export",
        insert: "export { ${1} }",
      },
      {
        label: "prom",
        detail: "New Promise",
        insert: "new Promise((resolve, reject) => {\n\t${1}\n})",
      },
      {
        label: "try",
        detail: "Try / catch block",
        insert: "try {\n\t${1}\n} catch (${2:error}) {\n\t${3:console.error(${2:error})}\n}",
      },
      {
        label: "class",
        detail: "Class definition",
        insert: "class ${1:ClassName}${2: extends ${3:Base}} {\n\tconstructor(${4:args}) {\n\t\t${5:super(${4:args})}\n\t}\n\n\t${6}\n}",
      },
      {
        label: "for",
        detail: "For...of loop",
        insert: "for (const ${1:item} of ${2:iterable}) {\n\t${3}\n}",
      },
      {
        label: "fori",
        detail: "For loop with index",
        insert: "for (let ${1:i} = 0; ${1:i} < ${2:array}.length; ${1:i}++) {\n\t${3}\n}",
      },
      {
        label: "fetch",
        detail: "Fetch API call",
        insert:
          "const ${1:response} = await fetch(\"${2:url}\", {\n\tmethod: \"${3:GET}\",\n\theaders: { \"Content-Type\": \"application/json\" },\n})\nconst ${4:data} = await ${1:response}.json()",
      },
    ];

    monaco.languages.registerCompletionItemProvider(lang, {
      triggerCharacters: [".", "(", " "],
      provideCompletionItems(model: any, position: any) {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        return {
          suggestions: JS_SNIPPETS.map((snip) => ({
            label: snip.label,
            kind: CompletionItemKind.Snippet,
            insertText: snip.insert,
            insertTextRules: InsertTextRule.InsertAsSnippet,
            range,
            detail: snip.detail,
            sortText: `0_${snip.label}`,
          })),
        };
      },
    });
  }
}
