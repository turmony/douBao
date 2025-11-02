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
    historyList: [],
    startTime: 0,
    waitingTime: '00:00',
    timerInterval: null,
    currentProcessingImageUrl: '',
    isUserScrolling: false,
    scrollTop: 0
  },

  onLoad() {
    this.generateCode();
    
    wx.getSystemInfo({
      success: (res) => {
        this.windowHeight = res.windowHeight;
      }
    });
    
    this.lastScrollTop = 0;
    this.scrollDebounceTimer = null;
  },
  
  onPageScroll(e) {
    const currentScrollTop = e.scrollTop;
    
    if (this.scrollDebounceTimer) {
      clearTimeout(this.scrollDebounceTimer);
    }
    
    const scrollingUp = currentScrollTop < this.lastScrollTop;
    
    if (scrollingUp && currentScrollTop > 100) {
      if (!this.data.isUserScrolling) {
        this.setData({ isUserScrolling: true });
        console.log('用户向上滚动 - 暂停自动滚动');
      }
    }
    else if (!scrollingUp) {
      this.scrollDebounceTimer = setTimeout(() => {
        this.checkIfNearBottom(currentScrollTop);
      }, 150);
    }
    
    this.lastScrollTop = currentScrollTop;
  },
  
  checkIfNearBottom(currentScrollTop) {
    const query = wx.createSelectorQuery();
    query.select('.history-section').boundingClientRect();
    query.exec((res) => {
      if (res && res[0]) {
        const historyHeight = res[0].height + res[0].top;
        const distanceToBottom = historyHeight - currentScrollTop - this.windowHeight;
        
        if (distanceToBottom < 300 && this.data.isUserScrolling) {
          this.setData({ isUserScrolling: false });
          console.log('用户接近底部 - 恢复自动滚动');
        }
      }
    });
  },

  onUnload() {
    this.cleanupAllTimers();
  },
  
  cleanupAllTimers() {
    console.log('清理所有定时器和监听器');
    
    if (this.data.watcher) {
      try {
        this.data.watcher.close();
      } catch (err) {
        console.error('关闭监听器失败:', err);
      }
      this.setData({ watcher: null });
    }
    
    if (this.data.timerInterval) {
      clearInterval(this.data.timerInterval);
      this.setData({ timerInterval: null });
    }
    
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    
    if (this.scrollTimer) {
      clearTimeout(this.scrollTimer);
      this.scrollTimer = null;
    }
    
    if (this.scrollDebounceTimer) {
      clearTimeout(this.scrollDebounceTimer);
      this.scrollDebounceTimer = null;
    }
  },

  generateCode() {
    wx.showLoading({ title: '生成中...' });
    
    this.cleanupAllTimers();
    
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
          historyList: [],
          waitingTime: '00:00',
          currentProcessingImageUrl: '',
          isUserScrolling: false
        });
        
        this.watchSession();
        
        wx.showToast({
          title: '绑定码已生成',
          icon: 'success'
        });
      } else {
        wx.showModal({
          title: '生成失败',
          content: res.result.error || '未知错误',
          showCancel: false
        });
      }
    }).catch(err => {
      wx.hideLoading();
      console.error('生成绑定码失败:', err);
      wx.showModal({
        title: '错误',
        content: '生成绑定码失败: ' + (err.message || '网络错误'),
        showCancel: false
      });
    });
  },

  handleRefresh() {
    wx.showModal({
      title: '确认更换',
      content: '更换后旧的绑定码将立即失效,是否继续?',
      success: (res) => {
        if (res.confirm) {
          this.refreshCode();
        }
      }
    });
  },

  refreshCode() {
    wx.showLoading({ title: '更换中...' });
    
    this.cleanupAllTimers();
    
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
          historyList: [],
          waitingTime: '00:00',
          currentProcessingImageUrl: '',
          isUserScrolling: false
        });
        
        this.watchSession();
        
        wx.showToast({
          title: '已更换绑定码',
          icon: 'success'
        });
      } else {
        wx.showModal({
          title: '更换失败',
          content: res.result.error || '未知错误',
          showCancel: false
        });
      }
    }).catch(err => {
      wx.hideLoading();
      console.error('更换绑定码失败:', err);
      wx.showModal({
        title: '错误',
        content: '更换绑定码失败: ' + (err.message || '网络错误'),
        showCancel: false
      });
    });
  },

  watchSession() {
    console.log('开始监听 session,绑定码:', this.data.bindCode);
    
    try {
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
              this.updateSessionUI(session);
            } else {
              console.log('没有找到匹配的session文档');
            }
          },
          onError: (err) => {
            console.error('监听失败:', err);
            this.setData({
              errorMsg: '实时监听失败,已切换为轮询模式'
            });
            if (!this.pollingTimer) {
              this.startPolling();
            }
          }
        });
      
      this.setData({ watcher });
      this.startPolling();
    } catch (err) {
      console.error('创建监听器失败:', err);
      this.setData({
        errorMsg: '创建监听失败,使用轮询模式'
      });
      this.startPolling();
    }
  },
  
  startPolling() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
    }
    
    console.log('启动轮询机制');
    this.pollingTimer = setInterval(() => {
      console.log('轮询查询 session...');
      db.collection('sessions')
        .where({
          code: this.data.bindCode
        })
        .get()
        .then(res => {
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

  startTimer() {
    if (this.data.timerInterval) {
      clearInterval(this.data.timerInterval);
    }
    
    const startTime = Date.now();
    this.setData({ startTime });
    
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;
      const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
      
      this.setData({
        waitingTime: timeStr
      });
      
      if (this.data.currentProcessingImageUrl) {
        const historyList = this.data.historyList;
        const index = historyList.findIndex(item => 
          item.imageUrl === this.data.currentProcessingImageUrl
        );
        
        if (index >= 0 && historyList[index].isStreaming && !historyList[index].finalTime) {
          const updatePath = `historyList[${index}].waitTime`;
          this.setData({
            [updatePath]: timeStr
          });
        }
      }
    }, 1000);
    
    this.setData({ timerInterval: interval });
  },

  stopTimer() {
    if (this.data.timerInterval) {
      clearInterval(this.data.timerInterval);
      this.setData({ timerInterval: null });
    }
  },

  updateSessionUI(session) {
    console.log('开始更新UI,session:', session);
    
    const statusTextMap = {
      'waiting': '等待截图上传',
      'uploading': '截图上传中...',
      'processing': '正在分析图片...',
      'analyzing': '正在分析图片...',
      'streaming': '正在生成回答...',
      'completed': '分析完成',
      'error': '处理失败'
    };

    const newStatus = session.status;
    const oldStatus = this.data.sessionStatus;
    
    console.log('状态变化:', oldStatus, '->', newStatus);

    if (session.imageUrl && session.imageUrl !== this.data.currentProcessingImageUrl) {
      console.log('检测到新图片上传,立即显示');
      
      this.setData({
        currentProcessingImageUrl: session.imageUrl
      });
      
      if (oldStatus === 'waiting') {
        console.log('开始计时');
        this.startTimer();
      }
      
      this.createImmediateHistoryItem(session);
    }

    const statusText = statusTextMap[newStatus] || `状态: ${newStatus}`;
    console.log('状态文本:', statusText);
    
    this.setData({
      sessionStatus: newStatus,
      statusText: statusText,
      errorMsg: session.errorMsg || ''
    });

    if (session.imageUrl && session.imageUrl === this.data.currentProcessingImageUrl) {
      if ((newStatus === 'streaming' || newStatus === 'analyzing') && session.partialAnswer) {
        console.log('流式更新,部分答案长度:', session.partialAnswer.length);
        this.updateStreamingAnswer(session);
      }
      else if (newStatus === 'completed' && session.answer) {
        console.log('分析完成,答案长度:', session.answer.length);
        this.finalizeAnswer(session);
      }
    }

    if (newStatus === 'error') {
      console.log('状态为错误,停止计时');
      this.stopTimer();
      
      this.updateHistoryError(session);
      
      this.setData({
        currentProcessingImageUrl: '',
        sessionStatus: 'waiting',
        statusText: '等待截图上传'
      });
    }
  },

  createImmediateHistoryItem(session) {
    console.log('立即创建历史记录项,显示图片');
    
    wx.cloud.getTempFileURL({
      fileList: [session.imageUrl]
    }).then(res => {
      console.log('临时链接获取结果:', res);
      
      if (res.fileList && res.fileList.length > 0 && res.fileList[0].status === 0) {
        const newItem = {
          id: session.imageUrl,
          imageUrl: session.imageUrl,
          tempImageUrl: res.fileList[0].tempFileURL,
          answer: '',
          isStreaming: true,
          status: 'waiting',
          timestamp: new Date().toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
          }),
          waitTime: '00:00'
        };
        
        const exists = this.data.historyList.some(item => 
          item.imageUrl === session.imageUrl
        );
        
        if (!exists) {
          this.setData({
            historyList: [...this.data.historyList, newItem]
          }, () => {
            console.log('历史记录已创建,滚动到最新图片');
            // 强制滚动到最新图片,让用户立即看到
            this.scrollToBottomIfNeeded(true);
          });
        } else {
          console.log('记录已存在,跳过创建');
        }
      } else {
        console.error('获取临时链接失败:', res);
        this.setData({
          errorMsg: '获取图片失败,请重试'
        });
      }
    }).catch(err => {
      console.error('获取图片链接失败:', err);
      this.setData({
        errorMsg: '获取图片失败: ' + (err.message || '网络错误')
      });
    });
  },

  scrollToBottomIfNeeded(force = false) {
    if (this.scrollTimer) {
      clearTimeout(this.scrollTimer);
    }
    
    if (force || !this.data.isUserScrolling) {
      this.scrollTimer = setTimeout(() => {
        wx.pageScrollTo({
          scrollTop: 999999,
          duration: 300,
          success: () => {
            console.log('自动滚动到底部成功');
            this.setData({ isUserScrolling: false });
          },
          fail: (err) => {
            console.error('滚动失败:', err);
          }
        });
      }, 100);
    } else {
      console.log('用户正在查看历史,跳过自动滚动');
    }
  },

  updateStreamingAnswer(session) {
    const index = this.data.historyList.findIndex(item => 
      item.imageUrl === session.imageUrl
    );
    
    if (index >= 0) {
      const item = this.data.historyList[index];
      if (item.isStreaming) {
        this.setData({
          [`historyList[${index}].answer`]: session.partialAnswer,
          [`historyList[${index}].status`]: 'streaming'
        });
        
        console.log('流式答案已更新');
      }
    } else {
      console.log('未找到对应的历史记录');
    }
  },

  finalizeAnswer(session) {
    console.log('完成答案输出');
    
    this.stopTimer();
    const waitTime = this.data.waitingTime;
    
    const index = this.data.historyList.findIndex(item => 
      item.imageUrl === session.imageUrl
    );
    
    if (index >= 0) {
      this.setData({
        [`historyList[${index}].answer`]: session.answer,
        [`historyList[${index}].isStreaming`]: false,
        [`historyList[${index}].status`]: 'completed',
        [`historyList[${index}].waitTime`]: waitTime,
        [`historyList[${index}].finalTime`]: waitTime,
        sessionStatus: 'waiting',
        statusText: '等待截图上传',
        currentProcessingImageUrl: ''
      });
      
      console.log('答案已完成,最终时长:', waitTime);
    } else {
      console.log('未找到对应的历史记录');
    }
  },

  updateHistoryError(session) {
    const index = this.data.historyList.findIndex(item => 
      item.imageUrl === session.imageUrl
    );
    
    if (index >= 0) {
      const waitTime = this.data.waitingTime;
      this.setData({
        [`historyList[${index}].isStreaming`]: false,
        [`historyList[${index}].status`]: 'error',
        [`historyList[${index}].answer`]: session.errorMsg || '处理失败',
        [`historyList[${index}].waitTime`]: waitTime,
        [`historyList[${index}].finalTime`]: waitTime,
        waitingTime: '00:00'
      });
    }
  },

  previewImage(e) {
    const index = e.currentTarget.dataset.index;
    const item = this.data.historyList[index];
    
    if (!item || !item.tempImageUrl) {
      wx.showToast({
        title: '图片加载中',
        icon: 'none'
      });
      return;
    }
    
    const urls = this.data.historyList
      .filter(h => h.tempImageUrl)
      .map(h => h.tempImageUrl);
    
    wx.previewImage({
      current: item.tempImageUrl,
      urls: urls
    }).catch(err => {
      console.error('预览图片失败:', err);
      wx.showToast({
        title: '预览失败',
        icon: 'none'
      });
    });
  },

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
            content: '未找到匹配的数据,请确认已在客户端输入绑定码',
            showCancel: false
          });
        }
      })
      .catch(err => {
        wx.hideLoading();
        console.error('手动查询失败:', err);
        wx.showModal({
          title: '查询失败',
          content: '错误: ' + (err.message || '网络错误'),
          showCancel: false
        });
      });
  },

  formatTime(timestamp) {
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }
});