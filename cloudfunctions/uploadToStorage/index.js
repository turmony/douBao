const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  console.log('========== 上传文件到云存储 ==========');
  console.log('收到的原始 event:', JSON.stringify(event).substring(0, 500)); // 只显示前500字符
  
  // HTTP 触发器的请求体在 event.body 中，需要解析
  let requestData = {};
  
  try {
    // 如果是 HTTP 触发器，数据在 event.body 中
    if (event.body) {
      console.log('检测到 HTTP 触发器请求');
      
      // body 可能是字符串，需要解析
      if (typeof event.body === 'string') {
        try {
          requestData = JSON.parse(event.body);
        } catch (parseErr) {
          console.error('JSON 解析失败:', parseErr);
          return {
            success: false,
            error: 'JSON 解析失败: ' + parseErr.message
          };
        }
      } else {
        requestData = event.body;
      }
    } else {
      // 直接调用的情况，数据直接在 event 中
      requestData = event;
    }
    
    const { code, cloudPath, fileContent } = requestData;
    
    console.log('解析后的参数:', {
      code: code || '未提供',
      cloudPath: cloudPath || '未提供',
      hasFileContent: !!fileContent,
      fileContentLength: fileContent ? fileContent.length : 0
    });
    
    // 验证参数
    if (!code) {
      console.error('错误: 缺少绑定码');
      return {
        success: false,
        error: '缺少绑定码参数'
      };
    }
    
    if (!cloudPath) {
      console.error('错误: 缺少云存储路径');
      return {
        success: false,
        error: '缺少云存储路径'
      };
    }
    
    if (!fileContent) {
      console.error('错误: 缺少文件内容');
      return {
        success: false,
        error: '缺少文件内容'
      };
    }
    
    // 验证绑定码
    console.log('验证绑定码:', code);
    const bindResult = await db.collection('bindings')
      .where({ code, status: 'active' })
      .get();
    
    if (bindResult.data.length === 0) {
      console.log('绑定码验证失败');
      return {
        success: false,
        error: '绑定码无效或已过期'
      };
    }
    
    console.log('绑定码验证通过');
    
    // 解码base64
    console.log('开始解码 base64...');
    let buffer;
    try {
      buffer = Buffer.from(fileContent, 'base64');
      console.log('base64 解码成功, buffer 大小:', buffer.length, 'bytes');
    } catch (decodeErr) {
      console.error('base64 解码失败:', decodeErr);
      return {
        success: false,
        error: 'base64 解码失败: ' + decodeErr.message
      };
    }
    
    // 检查文件大小
    const sizeInMB = buffer.length / (1024 * 1024);
    console.log(`文件大小: ${sizeInMB.toFixed(2)} MB`);
    
    if (sizeInMB > 10) {
      console.error('文件过大');
      return {
        success: false,
        error: `文件过大(${sizeInMB.toFixed(2)}MB)，最大支持10MB`
      };
    }
    
    // 上传到云存储
    console.log('开始上传到云存储...');
    console.log('云存储路径:', cloudPath);
    
    let uploadResult;
    try {
      uploadResult = await cloud.uploadFile({
        cloudPath: cloudPath,
        fileContent: buffer
      });
      console.log('上传成功, fileID:', uploadResult.fileID);
    } catch (uploadErr) {
      console.error('上传到云存储失败:', {
        message: uploadErr.message,
        code: uploadErr.code,
        stack: uploadErr.stack
      });
      return {
        success: false,
        error: '上传到云存储失败: ' + uploadErr.message
      };
    }
    
    console.log('========== 上传完成 ==========');
    
    return {
      success: true,
      fileID: uploadResult.fileID
    };
    
  } catch (err) {
    console.error('========== 上传失败 ==========');
    console.error('错误信息:', err.message);
    console.error('错误堆栈:', err.stack);
    
    return {
      success: false,
      error: err.message || '未知错误'
    };
  }
};