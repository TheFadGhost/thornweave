/**
 * @file Zero-dependency ES-module bundler for Thornweave's own sources.
 * Handles exactly the module style this repo uses: single-line named imports,
 * `export function/class/const` declarations, relative .js specifiers only.
 * Emits an IIFE assigning exports onto a registry, in dependency order.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function parseImports(src) {
  const deps = [];
  const re = /import\s*\{([^}]*)\}\s*from\s*['"](\.[^'"]+)['"]\s*;?/g;
  let m;
  while ((m = re.exec(src))) {
    const names = m[1].split(',').map((s) => s.trim()).filter(Boolean)
      .map((s) => (s.includes(' as ') ? s.split(/\s+as\s+/) : [s, s]))
      .map(([imp, local]) => ({ imp, local }));
    deps.push({ spec: m[2], names });
  }
  return deps;
}

export function bundle(entryPath, { root = ROOT, offline = false } = {}) {
  const order = [];
  const modules = new Map();
  const visiting = new Set();
  const visited = new Set();

  const load = (absPath) => {
    if (visited.has(absPath)) return;
    if (visiting.has(absPath)) throw new Error(`import cycle at ${absPath}`);
    visiting.add(absPath);
    const src = readFileSync(absPath, 'utf8');
    const id = relId(absPath, root);
    const deps = parseImports(src).map((d) => {
      const depAbs = resolve(dirname(absPath), d.spec);
      load(depAbs);
      return { ...d, id: relId(depAbs, root) };
    });
    modules.set(id, transform(src, id, deps, offline));
    order.push(id);
    visiting.delete(absPath);
    visited.add(absPath);
  };

  load(resolve(root, entryPath));

  const body = order.map((id) => modules.get(id)).join('\n\n');
  const guard = offline
    ? 'function __noNet(){ throw new Error("network requests are disabled in the offline export"); }\n'
    : '';
  return {
    code: `(function () {\n'use strict';\nconst __tw = {};\nfunction __tw_mod(id, fn) { __tw[id] = fn(); }\n${guard}${body}\nreturn __tw[${JSON.stringify(relId(resolve(root, entryPath), root))}];\n})();`,
    modules: order,
  };
}

function relId(abs, root) {
  return abs.slice(root.length + 1).replace(/\\/g, '/');
}

function transform(src, id, deps, offline) {
  let code = src.replace(/^#!.*\n/, '');
  code = code.replace(/^\s*\/\/[^\n]*$/gm, '');
  for (let i = 0; i < 30; i++) {
    code = code.replace(/\/\*[\s\S]*?\*\//, '');
  }
  if (offline) {
    code = code
      .replace(/\bfetch\b/g, '__noNet(1)')
      .replace(/\bXMLHttpRequest\b/g, '__noNet(2)')
      .replace(/\bWebSocket\b/g, '__noNet(3)')
      .replace(/\bEventSource\b/g, '__noNet(4)');
  }
  const exportNames = [];
  code = code
    .replace(/export\s+function\s+([A-Za-z_$][\w$]*)/g, (_, n) => { exportNames.push(n); return `function ${n}`; })
    .replace(/export\s+class\s+([A-Za-z_$][\w$]*)/g, (_, n) => { exportNames.push(n); return `class ${n}`; })
    .replace(/export\s+const\s+([A-Za-z_$][\w$]*)/g, (_, n) => { exportNames.push(n); return `const ${n}`; });
  code = code.replace(/import\s*\{[^}]*\}\s*from\s*['"][^'"]+['"]\s*;?/g, '');
  code = code.replace(/^\s*import\s+['"][^'"]+['"]\s*;?\s*$/gm, '');

  const destructures = deps.map((d) => {
    const parts = d.names.map((n) => (n.imp === n.local ? n.imp : `${n.imp}: ${n.local}`));
    return `const { ${parts.join(', ')} } = __tw[${JSON.stringify(d.id)}];`;
  }).join('\n');

  const exportObj = `return { ${exportNames.join(', ')} };`;
  return `__tw_mod(${JSON.stringify(id)}, function () {\n${destructures}\n${code}\n${exportObj}\n});`;
}
