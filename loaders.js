module.exports = {
  loader1: source => {
    return source + '//给你的代码加点注释: loader1';
  },
  loader2: source => {
    return source + '//给你的代码加点注释: loader2';
  }
};
