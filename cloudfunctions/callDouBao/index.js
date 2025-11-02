const cloud = require('wx-server-sdk');
const axios = require('axios');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { openid, imageUrl } = event;
  
  console.log('========== 开始调用豆包API ==========');
  console.log('时间:', new Date().toISOString());
  console.log('参数:', { openid, imageUrl });
  
  try {
    // ===== 1. 获取图片临时下载链接 =====
    console.log('步骤1: 获取图片临时下载链接...');
    
    const downloadResult = await cloud.getTempFileURL({
      fileList: [imageUrl]
    });
    
    console.log('获取临时链接完成');
    
    const fileInfo = downloadResult.fileList[0];
    
    if (fileInfo.status !== 0) {
      throw new Error('获取图片下载链接失败：' + fileInfo.errMsg);
    }
    
    const tempUrl = fileInfo.tempFileURL;
    console.log('临时下载链接:', tempUrl);
    
    // ===== 2. 更新状态 =====
    console.log('步骤2: 更新状态为分析中...');
    await db.collection('sessions')
      .where({ openid })
      .update({
        data: {
          status: 'analyzing',
          updateTime: Date.now()
        }
      });
    console.log('状态更新完成');
    
    // ===== 3. 调用豆包API =====
    console.log('步骤3: 准备调用豆包API...');
    
    const apiKey = process.env.ARK_API_KEY;
    if (!apiKey) {
      throw new Error('ARK_API_KEY 未配置');
    }
    console.log('API Key 已配置');
    
    const requestData = {
      model: 'doubao-seed-1-6-251015',
      max_completion_tokens: 65535,
      messages: [
        {
          content: [
            {
              type: 'image_url',
              image_url: { url: tempUrl }
            },
            {
              type: 'text',
              text: '请详细分析这张图片的内容。'
            }
          ],
          role: 'user'
        }
      ],
      reasoning_effort: 'medium'
    };
    
    console.log('请求数据已准备完成');
    console.log('开始发送 HTTP 请求到豆包API...');
    
    const startTime = Date.now();
    
    let response;
    try {
      response = await axios.post(
        'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
        requestData,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          timeout: 180000 // 180秒超时
        }
      );
      
      const endTime = Date.now();
      console.log(`豆包API响应成功，耗时: ${(endTime - startTime) / 1000} 秒`);
      console.log('响应状态:', response.status);
      
    } catch (apiErr) {
      const endTime = Date.now();
      console.error(`豆包API请求失败，耗时: ${(endTime - startTime) / 1000} 秒`);
      console.error('错误类型:', apiErr.constructor.name);
      console.error('错误消息:', apiErr.message);
      
      if (apiErr.response) {
        console.error('HTTP状态码:', apiErr.response.status);
        console.error('响应数据:', JSON.stringify(apiErr.response.data));
        throw new Error(`API错误 ${apiErr.response.status}: ${JSON.stringify(apiErr.response.data)}`);
      } else if (apiErr.code === 'ECONNABORTED') {
        console.error('请求超时');
        throw new Error('API请求超时，图片可能太大或网络不稳定');
      } else if (apiErr.request) {
        console.error('网络请求失败，无响应');
        throw new Error('网络请求失败，无法连接到豆包API');
      } else {
        throw new Error('请求配置错误: ' + apiErr.message);
      }
    }
    
    // ===== 4. 提取回答 =====
    console.log('步骤4: 提取AI回答...');
    
    if (!response.data || !response.data.choices || response.data.choices.length === 0) {
      console.error('响应数据异常:', JSON.stringify(response.data));
      throw new Error('API响应格式错误');
    }
    
    const answer = response.data.choices[0].message.content;
    console.log('AI回答长度:', answer.length);
    console.log('AI回答前100字符:', answer.substring(0, 100));
    
    // ===== 5. 更新结果 =====
    console.log('步骤5: 保存分析结果...');
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
    console.log('结果保存成功');
    
    console.log('========== 豆包API调用完成 ==========');
    
    return {
      success: true,
      answer: answer.substring(0, 200)
    };
    
  } catch (err) {
    console.error('========== 调用失败 ==========');
    console.error('错误:', err.message);
    console.error('堆栈:', err.stack);
    
    const errorMsg = '分析失败: ' + (err.message || '未知错误');
    
    try {
      await db.collection('sessions')
        .where({ openid })
        .update({
          data: {
            status: 'error',
            errorMsg,
            updateTime: Date.now()
          }
        });
      console.log('错误状态已保存');
    } catch (updateErr) {
      console.error('保存错误状态失败:', updateErr);
    }
    
    return {
      success: false,
      error: errorMsg
    };
  }
};