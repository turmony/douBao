const db = wx.cloud.database();

Page({
  data: {
    bindCode: '',
    expireTime: 0,
    expireTimeStr: '',
    sessionStatus: 'waiting',
    statusText: '等待截图上传',
    errorMsg: '',
    watcher: null,
    // 新增：历史记录列表
    historyList: [],
    // 新增：计时相关
    startTime: 0,
    waitingTime: '00:00',
    timerInterval: null
  },

  onLoad() {
    this.generateCode();
  },

  onUnload() {
    // 停止监听
    if (this.data.watcher) {
      this.data.watcher.close();
    }
    // 停止计时器
    if (this.data.timerInterval) {
      clearInterval(this.data.timerInterval);
    }
    // 停止轮询
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
    }
  },

  // 生成绑定码
  generateCode() {
    wx.showLoading({ title: '生成中...' });
    
    wx.cloud.callFunction({
      name: 'generateCode'
    }).then(res => {
      wx.hideLoading();
      
      if (res.result.success) {
        this.setData({
          bindCode: res.result.code,
          expireTime: res.result.expireTime,
          expireTimeStr: this.formatTime(res.result.expireTime),
          sessionStatus: 'waiting',
          statusText: '等待截图上传',
          errorMsg: '',
          historyList: [],  // 清空历史记录
          waitingTime: '00:00'
        });
        
        // 开始监听session变化
        this.watchSession();
        
        wx.showToast({
          title: '绑定码已生成',
          icon: 'success'
        });
      } else {
        wx.showModal({
          title: '生成失败',
          content: res.result.error,
          showCancel: false
        });
      }
    }).catch(err => {
      wx.hideLoading();
      console.error('生成绑定码失败:', err);
      wx.showModal({
        title: '错误',
        content: '生成绑定码失败: ' + err.message,
        showCancel: false
      });
    });
  },

  // 更换绑定码
  handleRefresh() {
    wx.showModal({
      title: '确认更换',
      content: '更换后旧的绑定码将立即失效，是否继续？',
      success: (res) => {
        if (res.confirm) {
          this.refreshCode();
        }
      }
    });
  },

  // 调用更换绑定码云函数
  refreshCode() {
    wx.showLoading({ title: '更换中...' });
    
    // 先停止旧的监听和计时器
    if (this.data.watcher) {
      this.data.watcher.close();
    }
    if (this.data.timerInterval) {
      clearInterval(this.data.timerInterval);
    }
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
    }
    
    wx.cloud.callFunction({
      name: 'refreshCode'
    }).then(res => {
      wx.hideLoading();
      
      if (res.result.success) {
        this.setData({
          bindCode: res.result.code,
          expireTime: res.result.expireTime,
          expireTimeStr: this.formatTime(res.result.expireTime),
          sessionStatus: 'waiting',
          statusText: '等待截图上传',
          errorMsg: '',
          historyList: [],  // 清空历史记录
          waitingTime: '00:00'
        });
        
        // 重新开始监听
        this.watchSession();
        
        wx.showToast({
          title: '已更换绑定码',
          icon: 'success'
        });
      } else {
        wx.showModal({
          title: '更换失败',
          content: res.result.error,
          showCancel: false
        });
      }
    }).catch(err => {
      wx.hideLoading();
      console.error('更换绑定码失败:', err);
      wx.showModal({
        title: '错误',
        content: '更换绑定码失败: ' + err.message,
        showCancel: false
      });
    });
  },

  // 监听session变化
  watchSession() {
    console.log('开始监听 session，绑定码:', this.data.bindCode);
    
    const watcher = db.collection('sessions')
      .where({
        code: this.data.bindCode
      })
      .watch({
        onChange: (snapshot) => {
          console.log('收到数据库更新:', snapshot);
          console.log('文档数量:', snapshot.docs.length);
          
          if (snapshot.docs.length > 0) {
            const session = snapshot.docs[0];
            console.log('Session数据:', session);
            console.log('Session状态:', session.status);
            console.log('Session图片:', session.imageUrl);
            console.log('Session回答:', session.answer);
            this.updateSessionUI(session);
          } else {
            console.log('没有找到匹配的session文档');
          }
        },
        onError: (err) => {
          console.error('监听失败:', err);
          this.setData({
            errorMsg: '实时监听失败: ' + err.message
          });
        }
      });
    
    this.setData({ watcher });
    
    // 同时启动轮询作为备用方案
    this.startPolling();
  },
  
  // 添加轮询作为备用方案
  startPolling() {
    // 每3秒轮询一次数据库
    this.pollingTimer = setInterval(() => {
      console.log('轮询查询 session...');
      db.collection('sessions')
        .where({
          code: this.data.bindCode
        })
        .get()
        .then(res => {
          console.log('轮询结果:', res);
          if (res.data.length > 0) {
            const session = res.data[0];
            console.log('轮询获取到 session:', session);
            this.updateSessionUI(session);
          }
        })
        .catch(err => {
          console.error('轮询查询失败:', err);
        });
    }, 3000);
  },

  // 开始计时
  startTimer() {
    // 如果已有计时器，先清除
    if (this.data.timerInterval) {
      clearInterval(this.data.timerInterval);
    }
    
    this.setData({
      startTime: Date.now()
    });
    
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.data.startTime) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;
      this.setData({
        waitingTime: `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      });
    }, 1000);
    
    this.setData({ timerInterval: interval });
  },

  // 停止计时
  stopTimer() {
    if (this.data.timerInterval) {
      clearInterval(this.data.timerInterval);
      this.setData({ timerInterval: null });
    }
  },

  // 更新UI
  updateSessionUI(session) {
    console.log('开始更新UI，session:', session);
    
    const statusTextMap = {
      'waiting': '等待截图上传',
      'uploading': '截图上传中...',
      'processing': '正在分析图片...',
      'analyzing': '正在分析图片...',  // 添加这个状态
      'completed': '分析完成',
      'error': '处理失败'
    };

    const newStatus = session.status;
    const oldStatus = this.data.sessionStatus;
    
    console.log('状态变化:', oldStatus, '->', newStatus);

    // 状态从 waiting 变为其他状态时，开始计时
    if (oldStatus === 'waiting' && newStatus !== 'waiting') {
      console.log('开始计时');
      this.startTimer();
    }

    // 更新基础状态
    const statusText = statusTextMap[newStatus] || `状态: ${newStatus}`;  // 如果没有映射，直接显示状态
    console.log('状态文本:', statusText);
    
    this.setData({
      sessionStatus: newStatus,
      statusText: statusText,
      errorMsg: session.errorMsg || ''
    });

    // 如果有新的图片和回答，添加到历史记录
    if (session.imageUrl && session.answer) {
      console.log('检测到图片和回答，准备添加到历史记录');
      console.log('图片URL:', session.imageUrl);
      console.log('回答:', session.answer);
      
      // 检查是否已存在（避免重复添加）
      const exists = this.data.historyList.some(item => 
        item.imageUrl === session.imageUrl && item.answer === session.answer
      );
      
      console.log('是否已存在:', exists);
      
      if (!exists) {
        // 停止计时
        this.stopTimer();
        
        const waitTime = this.data.waitingTime;
        console.log('等待时间:', waitTime);
        
        // 获取临时链接
        console.log('开始获取临时链接...');
        wx.cloud.getTempFileURL({
          fileList: [session.imageUrl]
        }).then(res => {
          console.log('临时链接获取结果:', res);
          
          if (res.fileList && res.fileList.length > 0) {
            const newItem = {
              id: Date.now(),  // 唯一标识
              imageUrl: session.imageUrl,  // 云存储路径
              tempImageUrl: res.fileList[0].tempFileURL,  // 临时访问路径
              answer: session.answer,
              timestamp: new Date().toLocaleString('zh-CN', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
              }),
              waitTime: waitTime  // 记录等待时间
            };
            
            console.log('新记录:', newItem);
            
            // 添加到历史记录数组末尾
            const newHistoryList = [...this.data.historyList, newItem];
            console.log('更新后的历史记录数量:', newHistoryList.length);
            
            this.setData({
              historyList: newHistoryList,
              sessionStatus: 'waiting',
              statusText: '等待截图上传',
              waitingTime: '00:00'
            });
            
            console.log('历史记录已更新');
            
            // 震动提示
            wx.vibrateShort();
            
            // 滚动到底部
            setTimeout(() => {
              wx.pageScrollTo({
                scrollTop: 999999,
                duration: 300
              });
            }, 100);
          } else {
            console.error('临时链接返回为空');
          }
        }).catch(err => {
          console.error('获取图片链接失败:', err);
          this.setData({
            errorMsg: '获取图片失败: ' + err.message
          });
        });
      }
    } else {
      console.log('没有图片或回答');
      console.log('imageUrl:', session.imageUrl);
      console.log('answer:', session.answer);
    }

    // 如果出错，震动提示并停止计时
    if (newStatus === 'error') {
      console.log('状态为错误，停止计时');
      this.stopTimer();
      wx.vibrateShort();
    }
  },

  // 预览图片
  previewImage(e) {
    const index = e.currentTarget.dataset.index;
    const item = this.data.historyList[index];
    
    // 获取所有图片的临时路径
    const urls = this.data.historyList.map(h => h.tempImageUrl);
    
    wx.previewImage({
      current: item.tempImageUrl,
      urls: urls
    });
  },

  // 手动查询数据（调试用）
  handleManualQuery() {
    console.log('手动查询数据...');
    wx.showLoading({ title: '查询中...' });
    
    db.collection('sessions')
      .where({
        code: this.data.bindCode
      })
      .get()
      .then(res => {
        wx.hideLoading();
        console.log('手动查询结果:', res);
        
        if (res.data.length > 0) {
          const session = res.data[0];
          console.log('找到 session:', session);
          this.updateSessionUI(session);
          
          wx.showToast({
            title: '查询成功',
            icon: 'success'
          });
        } else {
          console.log('未找到匹配的 session');
          wx.showModal({
            title: '查询结果',
            content: '未找到匹配的数据，请确认已在客户端输入绑定码',
            showCancel: false
          });
        }
      })
      .catch(err => {
        wx.hideLoading();
        console.error('手动查询失败:', err);
        wx.showModal({
          title: '查询失败',
          content: '错误: ' + err.message,
          showCancel: false
        });
      });
  },

  // 格式化时间
  formatTime(timestamp) {
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }
});