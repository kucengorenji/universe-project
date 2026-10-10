// Names a module uses without declaring or importing them, found with a scope walk over the AST (rollup's parser,
// which ships with vite). Browser globals are allowed. The town's methods are spread over several files,
// where a forgotten import would only fail when that code path first runs.
import { readFileSync } from 'node:fs';
import { parseAst } from 'rollup/parseAst';

const GLOBALS = new Set(['Math', 'Object', 'Array', 'Number', 'String', 'Boolean', 'Set', 'Map', 'WeakMap', 'WeakSet', 'Promise', 'JSON', 'Date', 'Error', 'TypeError', 'RangeError', 'Symbol', 'Infinity', 'NaN', 'undefined', 'isFinite', 'isNaN', 'parseInt', 'parseFloat', 'performance', 'document', 'window', 'location', 'history', 'navigator', 'localStorage', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'globalThis', 'Float32Array', 'Uint8Array', 'Uint16Array', 'Uint32Array', 'Int32Array', 'Float64Array', 'ArrayBuffer', 'Event', 'KeyboardEvent', 'matchMedia', 'getComputedStyle', 'URL', 'URLSearchParams', 'AbortController', 'Intl', 'structuredClone', 'queueMicrotask', 'devicePixelRatio', 'innerWidth', 'innerHeight', 'arguments', 'Reflect', 'Proxy', 'BigInt', 'fetch', 'Response', 'Request', 'Image', 'HTMLElement', 'screen', 'crypto', 'TextDecoder', 'TextEncoder', 'Blob', 'AudioContext', 'ResizeObserver', 'IntersectionObserver', 'MutationObserver', 'import', 'decodeURIComponent', 'encodeURIComponent', 'Worker', 'ImageData', 'Int8Array', 'Int16Array', 'Uint8ClampedArray', 'OffscreenCanvas', 'Path2D', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLCanvasElement', 'addEventListener', 'removeEventListener', 'self', 'WebAssembly', 'Atomics', 'SharedArrayBuffer', 'DataView', 'BigInt64Array']);

function patternNames(p, out) {
  if (!p) return;
  switch (p.type) {
    case 'Identifier': out.add(p.name); break;
    case 'ObjectPattern': p.properties.forEach((q) => patternNames(q.type === 'RestElement' ? q.argument : q.value, out)); break;
    case 'ArrayPattern': p.elements.forEach((q) => patternNames(q, out)); break;
    case 'RestElement': patternNames(p.argument, out); break;
    case 'AssignmentPattern': patternNames(p.left, out); break;
  }
}
const FN = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
function hoistVars(node, out) { // var declarations and function declarations inside, not crossing function boundaries
  if (!node || typeof node.type !== 'string') return;
  if (node.type === 'VariableDeclaration' && node.kind === 'var') node.declarations.forEach((d) => patternNames(d.id, out));
  for (const key of Object.keys(node)) {
    const v = node[key];
    if (Array.isArray(v)) v.forEach((c) => { if (c && typeof c.type === 'string' && !FN.has(c.type) && c.type !== 'ClassDeclaration') hoistVars(c, out); });
    else if (v && typeof v.type === 'string' && !FN.has(v.type) && v.type !== 'ClassDeclaration') hoistVars(v, out);
  }
}
function blockNames(stmts, out) {
  for (const s of stmts) {
    if (s.type === 'VariableDeclaration' && s.kind !== 'var') s.declarations.forEach((d) => patternNames(d.id, out));
    else if (s.type === 'FunctionDeclaration' || s.type === 'ClassDeclaration') out.add(s.id.name);
    else if (s.type === 'ExportNamedDeclaration' && s.declaration) blockNames([s.declaration], out);
    else if (s.type === 'ExportDefaultDeclaration' && s.declaration?.id) out.add(s.declaration.id.name);
  }
}

export function undefinedIdentifiers(code) {
  const ast = parseAst(code);
  const missing = new Set();
  const visit = (node, scopes) => {
    if (!node || typeof node.type !== 'string') return;
    const here = (names) => scopes.concat([names]);
    switch (node.type) {
      case 'Program': { const n = new Set(); node.body.forEach((s) => { if (s.type === 'ImportDeclaration') s.specifiers.forEach((sp) => n.add(sp.local.name)); }); blockNames(node.body, n); hoistVars(node, n); node.body.forEach((c) => visit(c, here(n))); return; }
      case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression': {
        const n = new Set(); node.params.forEach((p) => patternNames(p, n)); if (node.type === 'FunctionExpression' && node.id) n.add(node.id.name);
        if (node.body.type === 'BlockStatement') { blockNames(node.body.body, n); hoistVars(node.body, n); }
        node.params.forEach((p) => visit(p, here(n)));
        if (node.body.type === 'BlockStatement') node.body.body.forEach((c) => visit(c, here(n))); else visit(node.body, here(n));
        return; }
      case 'BlockStatement': case 'StaticBlock': { const n = new Set(); blockNames(node.body, n); node.body.forEach((c) => visit(c, here(n))); return; }
      case 'ForStatement': case 'ForInStatement': case 'ForOfStatement': { const n = new Set(); const d = node.init ?? node.left; if (d?.type === 'VariableDeclaration') d.declarations.forEach((x) => patternNames(x.id, n)); for (const k of ['init', 'left', 'right', 'test', 'update', 'body']) visit(node[k], here(n)); return; }
      case 'SwitchStatement': { visit(node.discriminant, scopes); const n = new Set(); node.cases.forEach((c) => blockNames(c.consequent, n)); node.cases.forEach((c) => { visit(c.test, here(n)); c.consequent.forEach((s) => visit(s, here(n))); }); return; }
      case 'CatchClause': { const n = new Set(); patternNames(node.param, n); visit(node.body, here(n)); return; }
      case 'ClassDeclaration': case 'ClassExpression': { visit(node.superClass, scopes); node.body.body.forEach((m) => { if (m.computed) visit(m.key, scopes); visit(m.value, scopes); }); return; }
      case 'MemberExpression': visit(node.object, scopes); if (node.computed) visit(node.property, scopes); return;
      case 'Property': if (node.computed) visit(node.key, scopes); visit(node.value, scopes); return;
      case 'LabeledStatement': visit(node.body, scopes); return;
      case 'BreakStatement': case 'ContinueStatement': return;
      case 'ImportDeclaration': case 'ExportSpecifier': return;
      case 'MetaProperty': return;
      case 'VariableDeclarator': patternDefaults(node.id, scopes); visit(node.init, scopes); return;
      case 'Identifier': if (!scopes.some((s) => s.has(node.name)) && !GLOBALS.has(node.name)) missing.add(node.name); return;
    }
    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end') continue;
      const v = node[key];
      if (Array.isArray(v)) v.forEach((c) => visit(c, scopes)); else if (v && typeof v === 'object') visit(v, scopes);
    }
  };
  const patternDefaults = (p, scopes) => { // default values inside patterns are expressions
    if (!p) return;
    if (p.type === 'AssignmentPattern') { patternDefaults(p.left, scopes); visit(p.right, scopes); }
    else if (p.type === 'ObjectPattern') p.properties.forEach((q) => { if (q.type === 'RestElement') patternDefaults(q.argument, scopes); else { if (q.computed) visit(q.key, scopes); patternDefaults(q.value, scopes); } });
    else if (p.type === 'ArrayPattern') p.elements.forEach((q) => patternDefaults(q, scopes));
  };
  visit(ast, []);
  return [...missing].sort();
}

