const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
module.exports = function loader(mocks = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const m = new Module(file, module);
    m.filename = file;
    m.paths = module.paths;
    cache.set(file, m);
    m.require = (name) => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.endsWith('?raw'))
        return {
          __esModule: true,
          default: fs.readFileSync(
            path.resolve(path.dirname(file), name.slice(0, -4)),
            'utf8',
          ),
        };
      if (name.startsWith('~shared/'))
        return load(path.join(root, 'src/shared', name.slice(8)) + '.ts');
      if (name.startsWith('.')) {
        const base = path.resolve(path.dirname(file), name);
        return load(
          fs.existsSync(base + '.ts')
            ? base + '.ts'
            : path.join(base, 'index.ts'),
        );
      }
      return require(name);
    };
    m._compile(
      ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
      }).outputText,
      file,
    );
    return m.exports;
  }
  return (relative) => load(path.join(root, relative));
};
