const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const fs = require('fs');
const path = require('path');

// 读取配置文件
const configPath = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

exports.main = async (event, context) => {
  console.log('========== 开始处理上传请求 ==========');
  
  try {
    let code, imageBuffer, fileID;
    
    // 解析请求参数
    if (event.body) {
      const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';
      
      if (contentType.includes('application/octet-stream')) {
        code = event.queryStringParameters?.code;
        imageBuffer = Buffer.from(event.body, 'base64');
      } else {
        const requestData = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
        code = requestData.code;
        fileID = requestData.fileID;
        if (requestData.imageBase64) {
          imageBuffer = Buffer.from(requestData.imageBase64, 'base64');
        }
      }
    } else {
      code = event.code;
      fileID = event.fileID;
      if (event.imageBase64) {
        imageBuffer = Buffer.from(event.imageBase64, 'base64');
      }
    }
    
    // 验证参数
    if (!code) {
      return { success: false, error: '缺少绑定码参数' };
    }
    
    if (!imageBuffer && !fileID) {
      return { success: false, error: '缺少图片数据' };
    }
    
    // 验证绑定码
    const bindResult = await db.collection('bindings')
      .where({ code, status: 'active' })
      .get();
    
    if (bindResult.data.length === 0) {
      return { success: false, error: '绑定码无效或已过期' };
    }
    
    const binding = bindResult.data[0];
    const now = Date.now();
    
    if (binding.expireTime < now) {
      await db.collection('bindings').doc(binding._id).update({
        data: { status: 'expired' }
      });
      return { success: false, error: '绑定码已过期' };
    }
    
    console.log('绑定码验证通过, openid:', binding.openid);
    
    let uploadedFileID = fileID;
    
    // 上传图片
    if (imageBuffer) {
      const sizeInMB = imageBuffer.length / (1024 * 1024);
      console.log(`图片大小: ${sizeInMB.toFixed(2)} MB`);
      
      if (sizeInMB > 10) {
        return { success: false, error: `图片过大(${sizeInMB.toFixed(2)}MB)` };
      }
      
      const timestamp = now;
      const randomStr = Math.random().toString(36).substring(2, 8);
      const cloudPath = `screenshots/${binding.openid}/${timestamp}_${randomStr}.jpg`;
      
      const uploadResult = await cloud.uploadFile({
        cloudPath: cloudPath,
        fileContent: imageBuffer
      });
      
      uploadedFileID = uploadResult.fileID;
      console.log('上传成功, fileID:', uploadedFileID);
    }
    
    if (!uploadedFileID) {
      return { success: false, error: '缺少图片数据' };
    }
    
    // 更新 session 状态为处理中
    await db.collection('sessions')
      .where({ openid: binding.openid })
      .update({
        data: {
          imageUrl: uploadedFileID,
          status: 'processing',
          errorMsg: '',
          updateTime: now
        }
      });
    
    // 异步触发分析（不等待结果）
    console.log('触发异步分析...');
    
    // 使用 setTimeout 模拟异步调用
    // 在云函数中，即使主函数返回了，这个也会继续执行
    setImmediate(async () => {
      try {
        console.log('开始后台分析任务...');
        await analyzeImage(binding.openid, uploadedFileID);
      } catch (err) {
        console.error('后台分析失败:', err);
      }
    });
    
    console.log('上传流程完成，返回成功');
    
    // 立即返回，不等待分析完成
    return {
      success: true,
      message: '上传成功，正在分析中',
      fileID: uploadedFileID
    };
    
  } catch (err) {
    console.error('上传失败:', err);
    return {
      success: false,
      error: err.message || '未知错误'
    };
  }
};

// 分析图片的异步函数
async function analyzeImage(openid, imageUrl) {
  const axios = require('axios');
  
  console.log('========== 开始分析图片 ==========');
  console.log('openid:', openid);
  console.log('imageUrl:', imageUrl);
  
  try {
    // 获取临时链接
    const downloadResult = await cloud.getTempFileURL({
      fileList: [imageUrl]
    });
    
    const fileInfo = downloadResult.fileList[0];
    if (fileInfo.status !== 0) {
      throw new Error('获取图片链接失败');
    }
    
    const tempUrl = fileInfo.tempFileURL;
    console.log('临时链接:', tempUrl);
    
    // 更新状态
    await db.collection('sessions')
      .where({ openid })
      .update({
        data: {
          status: 'analyzing',
          updateTime: Date.now()
        }
      });
    
    // 调用豆包API
    const apiKey = config.doubao.api_key || process.env.ARK_API_KEY;
    if (!apiKey) {
      throw new Error('API Key 未配置');
    }
    
    console.log('调用豆包API...');
    const startTime = Date.now();
    
    const response = await axios.post(
      config.doubao.api_url,
      {
        model: config.doubao.model_name,
        max_completion_tokens: config.doubao.max_completion_tokens,
        messages: [
          {
            content: [
              {
                type: 'image_url',
                image_url: { url: tempUrl }
              },
              {
                type: 'text',
                text: config.doubao.prompt_text
              }
            ],
            role: 'user'
          }
        ]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: 120000
      }
    );
    
    const endTime = Date.now();
    console.log(`API响应成功，耗时: ${(endTime - startTime) / 1000} 秒`);
    
    const answer = response.data.choices[0].message.content;
    console.log('回答长度:', answer.length);
    
    // 保存结果
    await db.collection('sessions')
      .where({ openid })
      .update({
        data: {
          answer,
          status: 'completed',
          errorMsg: '',
          updateTime: Date.now()
        }
      });
    
    console.log('分析完成并保存');
    
  } catch (err) {
    console.error('分析失败:', err.message);
    
    let errorMsg = '分析失败: ';
    if (err.response) {
      errorMsg += `API错误 ${err.response.status}`;
    } else if (err.code === 'ECONNABORTED') {
      errorMsg += 'API请求超时';
    } else {
      errorMsg += err.message;
    }
    
    await db.collection('sessions')
      .where({ openid })
      .update({
        data: {
          status: 'error',
          errorMsg,
          updateTime: Date.now()
        }
      });
  }
}