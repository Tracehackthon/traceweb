import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';

const require = createRequire(import.meta.url);
const ts = require('typescript');
let sequence = 0;

/** Only transport is synthetic. Runtime and its pure dependencies remain actual source. */
export async function loadWebRuntime({ workspaceRequest, productCommandRequest, native = true }) {
  const key = `trace-runtime-authority-${++sequence}`;
  globalThis[key] = { workspaceRequest, productCommandRequest, native };
  const moduleURL = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  const storageURL = moduleURL(`
    const transport = globalThis[${JSON.stringify(key)}];
    export const workspaceRequest = (...args) => transport.workspaceRequest(...args);
    export const productCommandRequest = (...args) => transport.productCommandRequest(...args);
    export const storageLabel = 'synthetic test transport';
  `);
  const capabilityURL = moduleURL(`
    export const hasNativeCapabilityBridge = () => globalThis[${JSON.stringify(key)}].native;
    const forbidden = () => { throw new Error('Real capability execution forbidden in authority test'); };
    export const nativeWorkEnvironment = forbidden, readNativeWork = forbidden,
      runNativeWork = forbidden, searchPublic = forbidden;
  `);
  const sourcePath = fileURLToPath(new URL('../../src/react/runtime.ts', import.meta.url));
  const source = await readFile(sourcePath, 'utf8');
  const rewriteImports = context => sourceFile => ts.visitNode(sourceFile, function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const name = node.moduleSpecifier.text;
      const replacement = name === './workspace-storage' ? storageURL
        : name === './capability-client' ? capabilityURL
          : name.startsWith('.') ? pathToFileURL(resolve(dirname(sourcePath), name)).href : name;
      return ts.factory.updateImportDeclaration(node, node.modifiers, node.importClause,
        ts.factory.createStringLiteral(replacement), node.attributes);
    }
    return ts.visitEachChild(node, visit, context);
  });
  const result = ts.transpileModule(source, {
    fileName: sourcePath,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    transformers: { before: [rewriteImports] },
  });
  const loaded = await import(moduleURL(`${result.outputText}\n// isolated transport ${key}`));
  return { WebRuntime: loaded.WebRuntime, dispose: () => { delete globalThis[key]; } };
}
