App({
  onLaunch: function () {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      wx.cloud.init({
        env: 'cloud1-4gqsb5md4b57fce0', // 替换为你的云开发环境ID
        traceUser: true,
      });
    }
  }
});