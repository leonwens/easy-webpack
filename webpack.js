const { SyncHook } = require('tapable');
const fs = require('fs');
const path = require('path');

const parser = require('@babel/parser');
const types = require('@babel/types');
const traverse = require('@babel/traverse').default;
const generator = require('@babel/generator').default;

function tryExtensions(modulePath, extensions) {
  if (fs.existsSync(modulePath)) {
    return modulePath;
  }
  for (let i = 0; i < extensions.length; i++) {
    let filePath = modulePath + extensions[i];
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }
  throw new Error(`无法找到${modulePath}`);
}

function toUnixPath(filePath) {
  return filePath.replace(/\\/g, '/');
}
const baseDir = toUnixPath(process.cwd());
class Compiler {
  constructor(webpackOptions) {
    this.options = webpackOptions;
    this.hooks = {
      run: new SyncHook(),
      done: new SyncHook()
    };
  }
  run(callback) {
    this.hooks.run.call();
    const onCompiled = (err, stats, fileDependencies) => {
      for (let filename in stats.assets) {
        let filePath = path.join(this.options.output.path, filename);
        fs.writeFileSync(filePath, stats.assets[filename], 'utf8');
      }
      callback(err, {
        toJson: () => stats
      });
      fileDependencies.forEach(dep => {
        fs.watch(dep, () => this.compile(onCompiled));
      });
      this.hooks.done.call();
    };
    this.compile(onCompiled);
  }
  compile(callback) {
    let compilation = new Compilation(this.options);
    compilation.build(callback);
  }
}
class Compilation {
  constructor(webpackOptions) {
    this.options = webpackOptions;
    this.modules = [];
    this.chunks = [];
    this.assets = [];
    this.fileDependencies = [];
  }
  buildModule(name, modulePath) {
    let sourceCode = fs.readFileSync(modulePath, 'utf8');
    let moduleId = './' + path.posix.relative(baseDir, modulePath);
    let module = {
      id: moduleId,
      names: [name],
      dependencies: [],
      _source: ''
    };

    let loaders = [];
    let { rules = [] } = this.options.module;
    rules.forEach(rule => {
      let { test } = rule;
      if (modulePath.match(test)) {
        loaders.push(...rule.use);
      }
    });
    sourceCode = loaders.reduceRight((code, loader) => {
      return loader(code);
    }, sourceCode);

    //通过loader翻译后的内容一定得是js内容，因为最后得走我们babel-parse，只有js才能成编译AST
    //第七步：找出此模块所依赖的模块，再对依赖模块进行编译
    //7.1：先把源代码编译成 [AST](https://astexplorer.net/)
    let ast = parser.parse(sourceCode, { sourceType: 'module' });
    traverse(ast, {
      CallExpression: nodePath => {
        const { node } = nodePath;
        if (node.callee.name === 'require') {
          let depModuleName = node.arguments[0].value; //获取依赖的模块
          let dirname = path.posix.dirname(modulePath); //获取当前正在编译的模所在的目录
          let depModulePath = path.posix.join(dirname, depModuleName); //获取依赖模块的绝对路径
          let extensions = this.options.resolve?.extensions || ['.js']; //获取配置中的extensions
          depModulePath = tryExtensions(depModulePath, extensions); //尝试添加后缀，找到一个真实在硬盘上存在的文件
          //7.3：将依赖模块的绝对路径 push 到 `this.fileDependencies` 中
          this.fileDependencies.push(depModulePath);
          //7.4：生成依赖模块的`模块 id`
          let depModuleId = './' + path.posix.relative(baseDir, depModulePath);
          //7.5：修改语法结构，把依赖的模块改为依赖`模块 id` require("./name")=>require("./src/name.js")
          node.arguments = [types.stringLiteral(depModuleId)];
          //7.6：将依赖模块的信息 push 到该模块的 `dependencies` 属性中
          module.dependencies.push({ depModuleId, depModulePath });
        }
      }
    });
    let { code } = generator(ast);
    module._source = code;

    module.dependencies.forEach(({ depModuleId, depModulePath }) => {
      let existModule = this.modules.find(item => item.id === depModuleId);
      if (existModule) {
        existModule.names.push(name);
      } else {
        let depModule = this.buildModule(name, depModulePath);
        this.modules.push(depModule);
      }
    });
    return module;
  }
  build(callback) {
    let entry = {};
    if (typeof this.options.entry === 'string') {
      entry.main = this.options.entry;
    } else {
      entry = this.options.entry;
    }
    for (let entryName in entry) {
      let entryFilePath = path.posix.join(baseDir, entry[entryName]);
      this.fileDependencies.push(entryFilePath);
      let entryModule = this.buildModule(entryName, entryFilePath);
      this.modules.push(entryModule);
      let chunk = {
        name: entryName,
        entryModule,
        modules: this.modules.filter(item => item.names.includes(entryName))
      };
      this.chunks.push(chunk);
    }
    this.chunks.forEach(chunk => {
      let filename = this.options.output.filename.replace('name', chunk.name);
      this.assets[filename] = getSource(chunk);
    });
    callback(
      null,
      {
        chunks: this.chunks,
        modules: this.modules,
        assets: this.assets
      },
      this.fileDependencies
    );
  }
}
function getSource(chunk) {
  return `
        (()=>{
            var modules = {
                ${chunk.modules.map(
                  module => `"${module.id}": (module)=>{
                    ${module._source}
                }`
                )}
            };
            var cache = {};
            function require(moduleId){
                var cachedModule = cache[moduleId];
                if(cachedModule !== undefined){
                    return cachedModule.exports
                }
                var module = (cache[moduleId] = {
                    exports: {}
                });
                modules[moduleId](module, module.exports, require);
                return module.exports;
            }
            var exports = {};
            ${chunk.entryModule._source}
        })()
    `;
}
function webpack(webpackOptions) {
  const compiler = new Compiler(webpackOptions);
  const { plugins } = webpackOptions;
  for (let plugin of plugins) {
    plugin.apply(compiler);
  }
  return compiler;
}

module.exports = {
  webpack
};
