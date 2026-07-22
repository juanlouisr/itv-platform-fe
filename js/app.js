/*
 * PseudoStudio - application bootstrap (frontend-only, no web worker).
 *
 * Workspace can come from:
 *   - localStorage (saved progress, restored on refresh), or
 *   - the bundled DEFAULT problem, or
 *   - a Google Drive folder (setup.ini -> instruction.md + code files).
 *
 * Wires Monaco, multi-file models, providers (completion / hover / definition),
 * cross-file cmd/ctrl+click navigation, tabs, sidebar (instruction + files).
 */
(function () {
  const NS = (window.PseudoStudio = window.PseudoStudio || {});
  const STORAGE_KEY = "pseudostudio:workspace:v1";



  function defaultState() {
    return {
      source: "default",
      instruction: "",
      files: [{ name: "untitled.pseudo", content: "" }],
    };
  }

  // ---------- boot ----------
  NS.boot = function () {
    const monaco = window.monaco;
    NS.registerLanguage(monaco);

    // ---- DOM ----
    const container = document.getElementById("editor");
    const tabsEl = document.getElementById("tabs");
    const sidebarEl = document.getElementById("file-list");
    const instructionEl = document.getElementById("instruction");
    const statusLang = document.getElementById("st-lang");
    const statusPos = document.getElementById("st-pos");
    const statusSource = document.getElementById("st-source");
    const bootErrEl = document.getElementById("boot-error");
    if (bootErrEl) bootErrEl.addEventListener("click", function () { bootErrEl.style.display = "none"; });

    // ---- mutable workspace state (referenced by providers via closure) ----
    let models = [];
    let byName = {};
    let INDEX = { modules: {}, functions: {}, fieldsByModule: {}, files: {} };
    let currentInstruction = "";
    let currentSource = "default";
    let currentFolderId = null;
    let currentFolderUrl = null;
    let originalDriveState = null;
    let debounce = null;
    let statusTimer = null;

    // ---- persistence ----
    function snapshot() {
      return {
        version: 1,
        source: currentSource,
        folderId: currentFolderId,
        folderUrl: currentFolderUrl,
        instruction: currentInstruction,
        files: models.map(function (m) { return { name: m.name, content: m.model.getValue() }; }),
        originalDriveState: originalDriveState,
        savedAt: Date.now(),
      };
    }
    function saveState(state) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); return true; }
      catch (e) { console.warn("saveState failed", e); return false; }
    }
    function loadSavedState() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const s = JSON.parse(raw);
        if (!s || !Array.isArray(s.files) || !s.files.length || typeof s.instruction !== "string") return null;
        return s;
      } catch (e) { return null; }
    }
    function clearState() { try { localStorage.removeItem(STORAGE_KEY); } catch (e) {} }

    // ---- model factory ----
    function createModels(fileList) {
      return (fileList || []).map(function (f) {
        const uri = monaco.Uri.parse("inmemory://pseudo/" + f.name);
        const model = monaco.editor.createModel(f.content || "", NS.LANGUAGE_ID, uri);
        model.onDidChangeContent(function () {
          clearTimeout(debounce);
          debounce = setTimeout(function () {
            INDEX = rebuildIndex();
            saveState(snapshot());
          }, 600);
        });
        return { name: f.name, uri: uri, model: model };
      });
    }

    // ---- symbol index ----
    function rebuildIndex() {
      const idx = { modules: {}, functions: {}, fieldsByModule: {}, files: {} };
      models.forEach(function (f) {
        const lines = f.model.getLinesContent();
        idx.files[f.name] = f;
        let moduleName = null;
        let inState = false;
        let curFn = null;
        for (let ln = 0; ln < lines.length; ln++) {
          const line = lines[ln];
          const mModule = /^\s*MODULE\s+([A-Za-z_]\w*)/.exec(line);
          if (mModule) {
            moduleName = mModule[1];
            idx.modules[moduleName] = { uri: f.uri, name: moduleName, line: ln + 1, col: line.indexOf(moduleName) + 1 };
            inState = false;
            continue;
          }
          if (/^\s*STATE\s*:/.test(line)) { inState = true; continue; }
          const mFn = /^\s*FUNCTION\s+([A-Za-z_]\w*)\s*\(([^)]*)\)(?:\s*:\s*([A-Za-z_]\w*))?/.exec(line);
          if (mFn) {
            inState = false;
            const name = mFn[1];
            const params = parseParams(mFn[2], ln, line);
            curFn = { uri: f.uri, name: name, line: ln + 1, col: line.indexOf(name) + 1, params: params, returnType: mFn[3] || null, locals: [] };
            (idx.functions[name] = idx.functions[name] || []).push(curFn);
            continue;
          }
          if (/^\s*END\s+FUNCTION/.test(line)) { curFn = null; inState = false; continue; }
          if (inState && moduleName) {
            const mField = /^\s*([A-Za-z_]\w*)\s*(?::\s*([A-Za-z_]\w*))?\s*(\/\/.*)?$/.exec(line);
            if (mField && mField[1]) {
              (idx.fieldsByModule[moduleName] = idx.fieldsByModule[moduleName] || []).push({
                uri: f.uri, name: mField[1], type: mField[2] || null, line: ln + 1, col: line.indexOf(mField[1]) + 1,
              });
            }
            continue;
          }
          if (curFn) {
            const mAsgn = /^\s*([A-Za-z_]\w*)\s*=(?!=)/.exec(line);
            if (mAsgn) {
              const eqIndex = line.indexOf("=");
              const rhs = line.substring(eqIndex + 1).trim();
              curFn.locals.push({
                name: mAsgn[1],
                uri: f.uri,
                line: ln + 1,
                col: line.indexOf(mAsgn[1]) + 1,
                rhs: rhs,
                type: null
              });
            }
          }
        }
      });
      inferLocalTypes(idx);
      return idx;
    }
    function parseParams(raw, ln, line) {
      const out = [];
      (raw || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (p) {
        const parts = p.split(":");
        const rawName = parts[0].trim();
        const type = parts[1] ? parts[1].trim() : null;
        const name = rawName.replace(/^(\.\.\.)?/, "").trim();
        out.push({ name: name, type: type, line: ln + 1, col: line.indexOf(p) + 1 });
      });
      return out;
    }
    function inferLocalTypes(idx) {
      function findFn(name) {
        const list = idx.functions[name];
        return (list && list.length) ? list[0] : null;
      }
      function getModuleOf(uri) {
        for (const k in idx.modules) {
          if (idx.modules[k].uri.toString() === uri.toString()) return k;
        }
        return null;
      }
      function getFieldInModule(modName, fieldName) {
        const fs = idx.fieldsByModule[modName];
        return fs ? (fs.find(function (f) { return f.name === fieldName; }) || null) : null;
      }
      function getFuncInModule(modName, funcName) {
        const list = idx.functions[funcName];
        if (!list) return null;
        const found = list.find(function (f) {
          return getModuleOf(f.uri) === modName;
        });
        return found || null;
      }

      Object.values(idx.functions).flat().forEach(function (fn) {
        const fnModule = getModuleOf(fn.uri);
        const localTypeMap = {};

        fn.params.forEach(function (p) {
          if (p.type && idx.modules[p.type]) {
            localTypeMap[p.name] = p.type;
          }
        });

        fn.locals.forEach(function (lcl) {
          if (!lcl.rhs) return;
          let inferredType = null;

          // 1. Member call: obj.method(...)
          const mMemberCall = /^([A-Za-z_]\w*)\s*\.\s*([A-Za-z_]\w*)\s*\(/.exec(lcl.rhs);
          if (mMemberCall) {
            const objName = mMemberCall[1];
            const methodName = mMemberCall[2];
            let objType = localTypeMap[objName] || null;
            if (!objType && fnModule) {
              const fld = getFieldInModule(fnModule, objName);
              if (fld && fld.type && idx.modules[fld.type]) {
                objType = fld.type;
              }
            }
            if (objType) {
              const meth = getFuncInModule(objType, methodName);
              if (meth && meth.returnType && idx.modules[meth.returnType]) {
                inferredType = meth.returnType;
              }
            }
          } else {
            // 2. Simple function call: func(...)
            const mSimpleCall = /^([A-Za-z_]\w*)\s*\(/.exec(lcl.rhs);
            if (mSimpleCall) {
              const funcName = mSimpleCall[1];
              const callee = findFn(funcName);
              if (callee && callee.returnType && idx.modules[callee.returnType]) {
                inferredType = callee.returnType;
              }
            } else {
              // 3. Direct assignment: x = y
              const mVar = /^([A-Za-z_]\w*)$/.exec(lcl.rhs);
              if (mVar) {
                const sourceVarName = mVar[1];
                let varType = localTypeMap[sourceVarName] || null;
                if (!varType && fnModule) {
                  const fld = getFieldInModule(fnModule, sourceVarName);
                  if (fld && fld.type && idx.modules[fld.type]) {
                    varType = fld.type;
                  }
                }
                if (varType) {
                  inferredType = varType;
                }
              }
            }
          }

          if (inferredType) {
            lcl.type = inferredType;
            localTypeMap[lcl.name] = inferredType;
          }
        });
      });
    }
    function loc(uri, line, col, len) {
      const c = col || 1;
      const l = (typeof len === "number") ? len : 1;
      return { uri: uri, range: new monaco.Range(line, c, line, c + l) };
    }

    // ---- definition resolver ----
    function findFunction(name, preferUri) {
      const list = INDEX.functions[name];
      if (!list || !list.length) return null;
      if (preferUri) {
        const p = list.find(function (f) { return f.uri.toString() === preferUri.toString(); });
        if (p) return p;
      }
      return list[0];
    }
    function moduleOf(uri) {
      for (const k in INDEX.modules) if (INDEX.modules[k].uri.toString() === uri.toString()) return k;
      return null;
    }
    function fieldInModule(moduleName, fieldName) {
      const fs = INDEX.fieldsByModule[moduleName];
      return fs ? (fs.find(function (f) { return f.name === fieldName; }) || null) : null;
    }
    function funcInModule(moduleName, funcName) {
      const list = INDEX.functions[funcName];
      if (!list) return null;
      const found = list.find(function (f) {
        return moduleOf(f.uri) === moduleName;
      });
      return found || null;
    }
    function enclosingFn(uri, position) {
      const fnList = Object.values(INDEX.functions).flat();
      let best = null;
      fnList.forEach(function (f) {
        if (f.uri.toString() === uri.toString() && f.line <= position.lineNumber) {
          if (!best || f.line > best.line) {
            best = f;
          }
        }
      });
      return best;
    }
    function typeOfVar(name, uri, position) {
      const mod = moduleOf(uri);
      if (mod) {
        const f = (INDEX.fieldsByModule[mod] || []).find(function (x) { return x.name === name; });
        if (f && f.type && INDEX.modules[f.type]) return f.type;
      }
      if (position) {
        const fn = enclosingFn(uri, position);
        if (fn) {
          const p = fn.params.find(function (pp) { return pp.name === name; });
          if (p && p.type && INDEX.modules[p.type]) return p.type;
          for (let i = fn.locals.length - 1; i >= 0; i--) {
            const lcl = fn.locals[i];
            if (lcl.name === name && lcl.line <= position.lineNumber) {
              if (lcl.type && INDEX.modules[lcl.type]) return lcl.type;
              break;
            }
          }
        }
      }
      return null;
    }
    function resolveVar(name, model, position) {
      const uri = model.uri;
      const fn = enclosingFn(uri, position);
      if (fn) {
        const p = fn.params.find(function (pp) { return pp.name === name; });
        if (p) return loc(fn.uri, p.line, p.col, p.name.length);
        for (let i = fn.locals.length - 1; i >= 0; i--) {
          const lcl = fn.locals[i];
          if (lcl.name === name && lcl.line <= position.lineNumber) return loc(lcl.uri, lcl.line, lcl.col, lcl.name.length);
        }
      }
      const mod = moduleOf(uri);
      if (mod) {
        const f = fieldInModule(mod, name);
        if (f) return loc(f.uri, f.line, f.col, f.name.length);
      }
      return null;
    }
    function resolveDefinition(model, position) {
      const word = model.getWordAtPosition(position);
      if (!word || !word.word) return null;
      const lineText = model.getLineContent(position.lineNumber);
      const before = lineText.substring(0, word.startColumn - 1).trimEnd();
      const name = word.word;
      if (before.endsWith(".")) {
        const base = /([A-Za-z_]\w*)\s*\.$/.exec(before);
        if (base) {
          const t = typeOfVar(base[1], model.uri, position);
          if (t) {
            const fn = funcInModule(t, name);
            if (fn) return loc(fn.uri, fn.line, fn.col, fn.name.length);
          }
        }
        return null;
      }
      if (INDEX.modules[name]) { const m = INDEX.modules[name]; return loc(m.uri, m.line, m.col, m.name.length); }
      if (INDEX.functions[name]) { const f = findFunction(name, model.uri); if (f) return loc(f.uri, f.line, f.col, f.name.length); }
      return resolveVar(name, model, position);
    }

    // ---- initial workspace (saved > default) ----
    const initial = loadSavedState() || defaultState();
    models = createModels(initial.files);
    byName = {};
    models.forEach(function (m) { byName[m.name] = m; });
    INDEX = rebuildIndex();
    currentInstruction = initial.instruction;
    currentSource = initial.source || "default";
    currentFolderId = initial.folderId || null;
    currentFolderUrl = initial.folderUrl || null;
    originalDriveState = initial.originalDriveState || null;

    // ---- editor ----
    const editor = monaco.editor.create(container, {
      model: models[0].model,
      theme: "atom-one-dark",
      fontFamily: '"Fira Code", "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
      fontLigatures: true,
      fontSize: 14,
      lineHeight: 22,
      letterSpacing: 0.4,
      minimap: { enabled: true, renderCharacters: false, maxColumn: 80 },
      smoothScrolling: true,
      cursorBlinking: "smooth",
      cursorSmoothCaretAnimation: "on",
      renderWhitespace: "selection",
      scrollBeyondLastLine: false,
      roundedSelection: true,
      automaticLayout: true,
      tabSize: 4,
      padding: { top: 12, bottom: 12 },
      bracketPairColorization: { enabled: true },
      guides: { indentation: true, highlightActiveIndentation: true },
      stickyScroll: { enabled: true },
      "semanticHighlighting.enabled": true,
      definitionLinkOpensInPeek: false,
    });
    NS.editor = editor;

    // F12 / peek: route Monaco's openCodeEditor across models.
    try {
      const svc = editor._codeEditorService;
      if (svc && typeof svc.openCodeEditor === "function") {
        svc.openCodeEditor = function (input, source, sideBySide) {
          const uri = input.resource || (input.options && input.options.resource);
          const target = uri && monaco.editor.getModel(uri);
          if (!target || !source) return false;
          if (source.getModel() !== target) { source.setModel(target); openTabByUri(target.uri); }
          const sel = input.options && (input.options.selection || input.options.range);
          if (sel) {
            const range = new monaco.Range(sel.startLineNumber, sel.startColumn, sel.endLineNumber, sel.endColumn);
            source.revealRangeInCenterIfOutsideViewport(range);
            source.setSelection(range);
            source.focus();
          }
          return true;
        };
      }
    } catch (e) { console.warn("openCodeEditor override failed", e); }

    // Cmd/Ctrl + click -> go to definition (capture phase, authoritative).
    container.addEventListener("mousedown", function (e) {
      if (e.button !== 0) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      const pos = editor.getTargetAtClientPoint(e.clientX, e.clientY);
      if (!pos || !pos.position) return;
      const srcModel = editor.getModel();
      const tgt = resolveDefinition(srcModel, pos.position);
      if (!tgt) return;
      e.preventDefault();
      e.stopPropagation();
      const target = monaco.editor.getModel(tgt.uri);
      if (!target) return;
      if (srcModel !== target) { editor.setModel(target); openTabByUri(target.uri); }
      editor.revealRangeInCenterIfOutsideViewport(tgt.range);
      editor.setSelection(tgt.range);
      editor.focus();
    }, true);

    // ---------- providers ----------
    monaco.languages.registerCompletionItemProvider(NS.LANGUAGE_ID, {
      triggerCharacters: ["."],
      provideCompletionItems: function (model, position) {
        const word = model.getWordUntilPosition(position);
        const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
        const lineText = model.getLineContent(position.lineNumber);
        const before = lineText.substring(0, word.startColumn - 1);
        const suggestions = [];
        const md = function (s) { return { value: s }; };

        const member = /([A-Za-z_]\w*)\s*\.\s*([A-Za-z_]?\w*)$/.exec(before);
        if (member) {
          const base = member[1];
          const t = typeOfVar(base, model.uri, position);
          if (t && INDEX.modules[t]) {
            Object.keys(INDEX.functions).forEach(function (fnName) {
              if (funcInModule(t, fnName)) {
                suggestions.push({
                  label: fnName, kind: monaco.languages.CompletionItemKind.Function,
                  insertText: fnName + "($0)", insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                  detail: t + "." + fnName + "()",
                  documentation: md(NS.DB_DOCS[fnName] || ("Function **" + fnName + "** of module " + t + ".")),
                  range: range,
                });
              }
            });
          }
          if (suggestions.length) return { suggestions: suggestions };
        }

        Object.keys(NS.KEYWORD_DOCS).forEach(function (kw) {
          let insert = kw, rules;
          if (kw === "IF") { insert = "IF ${1:cond} THEN\n\t$0\nEND IF"; rules = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet; }
          else if (kw === "ELSEIF") { insert = "ELSEIF ${1:cond} THEN\n\t$0"; rules = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet; }
          else if (kw === "ELSE") { insert = "ELSE\n\t$0"; rules = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet; }
          else if (kw === "FUNCTION") { insert = "FUNCTION ${1:name}(${2:params}):\n\t$0\nEND FUNCTION"; rules = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet; }
          else if (kw === "FOR") { insert = "FOR ${1:i} = ${2:0} TO ${3:n} DO\n\t$0\nEND FOR"; rules = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet; }
          else if (kw === "WHILE") { insert = "WHILE ${1:cond} DO\n\t$0\nEND WHILE"; rules = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet; }
          else if (kw === "MODULE") { insert = "MODULE ${1:Name}\n\tSTATE:\n\t\t$0\n\t\nEND MODULE"; rules = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet; }
          else if (kw === "RETURN") { insert = "RETURN $0"; rules = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet; }
          suggestions.push({ label: kw, kind: monaco.languages.CompletionItemKind.Keyword, insertText: insert, insertTextRules: rules, detail: "keyword", documentation: md(NS.KEYWORD_DOCS[kw]), range: range });
        });
        Object.keys(NS.CONSTANT_DOCS).forEach(function (c) {
          suggestions.push({ label: c, kind: monaco.languages.CompletionItemKind.EnumMember, insertText: c, detail: "constant", documentation: md(NS.CONSTANT_DOCS[c]), range: range });
        });
        Object.keys(NS.BUILTIN_DOCS).forEach(function (b) {
          suggestions.push({ label: b, kind: monaco.languages.CompletionItemKind.Function, insertText: b + "($0)", insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: "built-in function", documentation: md(NS.BUILTIN_DOCS[b]), range: range });
        });
        Object.keys(INDEX.functions).forEach(function (fnName) {
          const f = findFunction(fnName, model.uri);
          suggestions.push({ label: fnName, kind: monaco.languages.CompletionItemKind.Function, insertText: fnName, detail: "function  " + uriBasename(f.uri), documentation: md("Function **" + fnName + "** defined in `" + uriBasename(f.uri) + "` (line " + f.line + ")."), range: range });
        });
        Object.keys(INDEX.modules).forEach(function (modName) {
          suggestions.push({ label: modName, kind: monaco.languages.CompletionItemKind.Module, insertText: modName, detail: "module", documentation: md("Module **" + modName + "**."), range: range });
        });
        const curMod = moduleOf(model.uri);
        if (curMod) {
          (INDEX.fieldsByModule[curMod] || []).forEach(function (f) {
            suggestions.push({ label: f.name, kind: monaco.languages.CompletionItemKind.Field, insertText: f.name, detail: f.type ? "field: " + f.type : "field", documentation: md("Module field **" + f.name + (f.type ? ": " + f.type : "") + "**."), range: range });
          });
        }
        const fn = enclosingFn(model.uri, position);
        if (fn) {
          fn.params.forEach(function (p) {
            suggestions.push({
              label: p.name, kind: monaco.languages.CompletionItemKind.Variable, insertText: p.name,
              detail: p.type ? "parameter: " + p.type : "parameter",
              documentation: md("Parameter **" + p.name + (p.type ? ": " + p.type : "") + "** of " + fn.name + "."), range: range
            });
          });
          const seenLocals = {};
          fn.locals.forEach(function (lcl) {
            if (lcl.line <= position.lineNumber && !seenLocals[lcl.name]) {
              seenLocals[lcl.name] = true;
              suggestions.push({
                label: lcl.name, kind: monaco.languages.CompletionItemKind.Variable, insertText: lcl.name,
                detail: lcl.type ? "local: " + lcl.type : "local variable",
                documentation: md("Local variable **" + lcl.name + (lcl.type ? ": " + lcl.type : "") + "**."), range: range
              });
            }
          });
        }
        return { suggestions: suggestions };
      },
    });

    monaco.languages.registerHoverProvider(NS.LANGUAGE_ID, {
      provideHover: function (model, position) {
        const word = model.getWordAtPosition(position);
        if (!word || !word.word) return null;
        const lineText = model.getLineContent(position.lineNumber);
        const before = lineText.substring(0, word.startColumn - 1).trimEnd();
        const name = word.word;
        const md = function (s) { return { value: s }; };
        let value = null;
        if (before.endsWith(".")) {
          const base = /([A-Za-z_]\w*)\s*\.$/.exec(before);
          if (base) {
            const t = typeOfVar(base[1], model.uri, position);
            if (t && NS.DB_DOCS[name]) value = "### " + t + "." + name + "\n\n" + NS.DB_DOCS[name];
            else if (NS.PROPERTY_DOCS[name]) value = "### " + base[1] + "." + name + "\n\n" + NS.PROPERTY_DOCS[name];
          }
        } else if (NS.BUILTIN_DOCS[name]) value = NS.BUILTIN_DOCS[name];
        else if (NS.CONSTANT_DOCS[name]) value = "**" + name + "** \u2014 " + NS.CONSTANT_DOCS[name];
        else if (NS.KEYWORD_DOCS[name]) value = "### " + name + "\n\n" + NS.KEYWORD_DOCS[name];
        else if (INDEX.functions[name]) { const f = findFunction(name, model.uri); value = "### function " + name + "\n\nDefined in `" + uriBasename(f.uri) + "` at line " + f.line + ".\n\n*(\u2318/Ctrl + click to jump to definition)*"; }
        else if (INDEX.modules[name]) value = "### module " + name + "\n\n*(\u2318/Ctrl + click to jump)*";
        else { const v = resolveVar(name, model, position); if (v) value = "### " + name + "\n\nLocal variable in this function.\n\n*(\u2318/Ctrl + click to jump to definition)*"; }
        if (!value) return null;
        return { range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn), contents: [md(value)] };
      },
    });

    monaco.languages.registerDefinitionProvider(NS.LANGUAGE_ID, {
      provideDefinition: function (model, position) {
        const tgt = resolveDefinition(model, position);
        return tgt || null;
      },
    });

    // ---------- UI helpers ----------
    function uriBasename(uri) { return uri.path.split("/").pop(); }
    function fileIconClass(name) {
      const n = (name || "").toLowerCase();
      if (n.includes("transfer")) return "fi-transfer";
      if (n.includes("db") || n.includes("database")) return "fi-db";
      return "fi-file";
    }
    function escapeHtml(s) {
      return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
    }

    function renderSidebar() {
      sidebarEl.innerHTML = "";
      models.forEach(function (f) {
        const row = document.createElement("div");
        row.className = "file-row";
        row.dataset.uri = f.uri.toString();
        row.innerHTML =
          '<span class="file-ic ' + fileIconClass(f.name) + '"></span>' +
          '<span class="file-name">' + f.name + "</span>";
        row.addEventListener("click", function () { openModel(f); });
        sidebarEl.appendChild(row);
      });
    }
    function renderTabs() {
      tabsEl.innerHTML = "";
      const model = editor.getModel();
      if (!model) return;
      const activeUri = model.uri.toString();
      openTabs.forEach(function (t) {
        const tab = document.createElement("div");
        tab.className = "tab" + (t.uri.toString() === activeUri ? " active" : "");
        tab.innerHTML =
          '<span class="tab-ic ' + fileIconClass(t.name) + '"></span>' +
          '<span class="tab-name">' + t.name + "</span>" +
          (openTabs.length > 1 ? '<span class="tab-close" title="close">\u00d7</span>' : "");
        tab.addEventListener("click", function (e) {
          if (e.target.classList.contains("tab-close")) closeTab(t.uri.toString());
          else openModel(byName[t.name]);
        });
        tabsEl.appendChild(tab);
      });
      Array.from(sidebarEl.querySelectorAll(".file-row")).forEach(function (r) {
        r.classList.toggle("active", r.dataset.uri === activeUri);
      });
    }
    const openTabs = [];
    function openTabByUri(uri) { const name = uriBasename(uri); if (byName[name]) openModel(byName[name]); }
    function openModel(f) {
      if (editor.getModel() !== f.model) editor.setModel(f.model);
      if (!openTabs.some(function (t) { return t.uri.toString() === f.uri.toString(); })) openTabs.push({ name: f.name, uri: f.uri });
      editor.focus();
      renderTabs();
      updateStatus();
    }
    function closeTab(uriStr) {
      const i = openTabs.findIndex(function (t) { return t.uri.toString() === uriStr; });
      if (i < 0) return;
      openTabs.splice(i, 1);
      if (!openTabs.length) { openModel(models[0]); return; }
      const model = editor.getModel();
      if (model && model.uri.toString() === uriStr) {
        const next = byName[openTabs[Math.min(i, openTabs.length - 1)].name];
        if (next) editor.setModel(next.model);
      }
      renderTabs();
      updateStatus();
    }

    function renderInstruction(md) {
      if (!instructionEl) return;
      if (!md || !String(md).trim()) { instructionEl.innerHTML = '<p class="instr-empty">No instruction provided.</p>'; return; }
      let html;
      try { html = window.marked ? window.marked.parse(md) : "<p>" + escapeHtml(md).replace(/\n/g, "<br>") + "</p>"; }
      catch (e) { html = "<pre>" + escapeHtml(md) + "</pre>"; }
      if (window.DOMPurify) html = window.DOMPurify.sanitize(html);
      instructionEl.innerHTML = html;
    }

    function updateStatus() {
      statusLang.textContent = NS.LANGUAGE_NAME + "  \u00b7  Atom One Dark";
      const p = editor.getPosition();
      statusPos.textContent = p ? ("Ln " + p.lineNumber + ", Col " + p.column) : "";
      if (statusSource) statusSource.textContent = currentSource === "drive" ? "Drive" : "Default";
    }
    function flashStatus(msg) {
      const el = document.getElementById("st-msg");
      if (!el) return;
      el.textContent = msg;
      el.classList.add("show");
      clearTimeout(statusTimer);
      statusTimer = setTimeout(function () { el.classList.remove("show"); }, 4500);
    }
    function showError(msg) {
      if (!bootErrEl) { window.alert(msg); return; }
      bootErrEl.innerHTML = escapeHtml(msg);
      bootErrEl.style.display = "block";
    }

    // ---------- workspace lifecycle ----------
    function buildWorkspace(state) {
      editor.setModel(null);
      models.forEach(function (m) { m.model.dispose(); });

      const nm = createModels(state.files || []);
      if (!nm.length) { showError("That folder had no files."); return; }
      models = nm;
      byName = {};
      nm.forEach(function (m) { byName[m.name] = m; });
      INDEX = rebuildIndex();
      currentInstruction = (state.instruction != null) ? state.instruction : currentInstruction;
      openTabs.length = 0;
      renderInstruction(currentInstruction);
      renderSidebar();
      renderTabs();
      openModel(models[0]);
      updateStatus();
      updateDriveButton();
    }

    editor.onDidChangeCursorPosition(updateStatus);
    editor.onDidChangeModel(function () { renderTabs(); updateStatus(); });

    // ---------- loading / button helpers ----------
    function showLoading(text) {
      const overlay = document.getElementById("loading-overlay");
      const txt = document.getElementById("loading-text");
      if (overlay) {
        if (txt && text) txt.textContent = text;
        overlay.classList.add("active");
      }
    }
    function hideLoading() {
      const overlay = document.getElementById("loading-overlay");
      if (overlay) overlay.classList.remove("active");
    }
    function updateDriveButton() {
      const btnDrive = document.getElementById("btn-drive");
      if (!btnDrive) return;
      if (currentSource === "drive" && currentFolderId) {
        btnDrive.textContent = "Reload Drive";
        btnDrive.title = "Reload the workspace from Google Drive to reset all changes";
        btnDrive.classList.add("accent-glow");
      } else {
        btnDrive.textContent = "Load Drive";
        btnDrive.title = "Load a workspace from a Google Drive folder";
        btnDrive.classList.remove("accent-glow");
      }
    }

    // ---------- toolbar ----------
    document.getElementById("btn-format").addEventListener("click", function () {
      const action = editor.getAction("editor.action.formatDocument");
      if (action) action.run();
    });
    document.getElementById("btn-reset").addEventListener("click", function () {
      if (!window.confirm("Reset the workspace? This clears saved progress and restores the default problem.")) return;
      clearState();
      currentSource = "default"; currentFolderId = null; currentFolderUrl = null;
      buildWorkspace(defaultState());
      flashStatus("Reset to default problem.");
    });
    document.getElementById("btn-drive").addEventListener("click", async function () {
      const cfg = window.PS_CONFIG || {};
      if (!cfg.GOOGLE_CLIENT_ID) {
        showError("Google Drive is not configured. Set GOOGLE_CLIENT_ID in config.js (see its comments for the one-time Google Cloud setup), then redeploy.");
        return;
      }

      // If we already have the original drive files saved locally, restore offline!
      if (currentSource === "drive" && originalDriveState) {
        if (!window.confirm("Reload from Google Drive? This will reset all your local changes.")) return;
        showLoading("Reloading from Drive…");
        setTimeout(function () {
          try {
            buildWorkspace({ instruction: originalDriveState.instruction, files: originalDriveState.files });
            saveState(snapshot());
            flashStatus("Reloaded and reset workspace from local storage.");
          } catch (err) {
            showError("Reload failed: " + (err && err.message ? err.message : err));
          } finally {
            hideLoading();
          }
        }, 300);
        return;
      }

      // Otherwise, do a fresh load from Google Drive
      const url = window.prompt("Paste the Google Drive folder URL (or ID):", cfg.DEFAULT_FOLDER_URL || currentFolderUrl || "");
      if (url === null) return;
      const folderId = NS.drive.folderIdFromInput(url);
      if (!folderId) { showError("Could not read a folder ID from that URL."); return; }

      showLoading("Connecting to Google Drive…");

      try {
        const res = await NS.drive.loadFromDrive(cfg.GOOGLE_CLIENT_ID, folderId);
        currentSource = "drive"; currentFolderId = folderId; currentFolderUrl = url;
        
        // Backup the original drive files so we can restore them offline later!
        originalDriveState = {
          instruction: res.instruction,
          files: res.files.map(function (f) { return { name: f.name, content: f.content }; })
        };
        
        buildWorkspace({ instruction: res.instruction, files: res.files });
        saveState(snapshot());
        flashStatus("Loaded " + res.files.length + " file(s) from Drive.");
      } catch (err) {
        showError("Drive load failed: " + (err && err.message ? err.message : err));
      } finally {
        hideLoading();
      }
    });

    const btnCreateFile = document.getElementById("btn-create-file");
    if (btnCreateFile) {
      btnCreateFile.addEventListener("click", function () {
        if (sidebarEl.querySelector(".file-create-input")) {
          sidebarEl.querySelector(".file-create-input").focus();
          return;
        }

        const inputRow = document.createElement("div");
        inputRow.className = "file-row editing";
        inputRow.innerHTML =
          '<span class="file-ic fi-file"></span>' +
          '<input type="text" class="file-create-input" placeholder="filename.pseudo" />';
        
        sidebarEl.appendChild(inputRow);
        const input = inputRow.querySelector(".file-create-input");
        input.focus();

        let finished = false;
        function finishCreation() {
          if (finished) return;
          finished = true;
          let name = input.value.trim();
          if (name) {
            if (!name.endsWith(".pseudo")) {
              name += ".pseudo";
            }
            if (byName[name]) {
              alert("A file with this name already exists.");
              renderSidebar();
              return;
            }
            const uri = monaco.Uri.parse("inmemory://pseudo/" + name);
            const model = monaco.editor.createModel("", NS.LANGUAGE_ID, uri);
            model.onDidChangeContent(function () {
              clearTimeout(debounce);
              debounce = setTimeout(function () {
                INDEX = rebuildIndex();
                saveState(snapshot());
              }, 600);
            });
            const newFileObj = { name: name, uri: uri, model: model };
            models.push(newFileObj);
            byName[name] = newFileObj;
            INDEX = rebuildIndex();
            saveState(snapshot());
            renderSidebar();
            openModel(newFileObj);
          } else {
            renderSidebar();
          }
        }

        input.addEventListener("keydown", function (e) {
          if (e.key === "Enter") {
            finishCreation();
          } else if (e.key === "Escape") {
            renderSidebar();
          }
        });

        input.addEventListener("blur", function () {
          setTimeout(function () {
            if (document.activeElement !== input) {
              finishCreation();
            }
          }, 150);
        });
      });
    }

    // ---------- wire up ----------
    renderInstruction(currentInstruction);
    renderSidebar();
    renderTabs();
    openModel(models[0]);
    updateStatus();
    updateDriveButton();
    if (currentSource === "drive") flashStatus("Restored saved workspace from Drive.");

    // ---------- sidebar resizer ----------
    const resizer = document.getElementById("sidebar-resizer");
    const sidebar = document.querySelector(".sidebar");
    if (resizer && sidebar) {
      let isDragging = false;
      resizer.addEventListener("mousedown", function (e) {
        isDragging = true;
        resizer.classList.add("dragging");
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        e.preventDefault();
      });
      document.addEventListener("mousemove", function (e) {
        if (!isDragging) return;
        const containerRect = document.querySelector(".workspace").getBoundingClientRect();
        let newWidth = e.clientX - containerRect.left;
        if (newWidth < 220) newWidth = 220;
        if (newWidth > 600) newWidth = 600;
        sidebar.style.width = newWidth + "px";
        if (editor) editor.layout();
      });
      document.addEventListener("mouseup", function () {
        if (isDragging) {
          isDragging = false;
          resizer.classList.remove("dragging");
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
          try { localStorage.setItem("pseudostudio:sidebar-width", sidebar.style.width); } catch (err) {}
        }
      });
      try {
        const savedWidth = localStorage.getItem("pseudostudio:sidebar-width");
        if (savedWidth) sidebar.style.width = savedWidth;
      } catch (err) {}
    }

    const bootEl = document.getElementById("boot");
    if (bootEl) bootEl.style.display = "none";
  };
})();
