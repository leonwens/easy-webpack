class WebpackRunPlugin {
  apply(compiler) {
    compiler.hooks.run.tap('WebpackRunPlugin', () => {
      console.log('开始编辑');
    });
  }
}

class WebpackDonePlugin {
  apply(compiler) {
    compiler.hooks.run.tap('WebpackDonePlugin', () => {
      console.log('结束编辑');
    });
  }
}
module.exports = {
  WebpackRunPlugin,
  WebpackDonePlugin
};
