const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  console.log('========== 获取上传凭证请求 ==========');
  console.log('收到的原始 event:', JSON.stringify(event));
  
  let requestData = {};
  
  try {
    // HTTP 触发器的请求体在 event.body 中
    if (event.body) {
      if (typeof event.body === 'string') {
        requestData = JSON.parse(event.body);
      } else {
        requestData = event.body;
      }
    } else {
      requestData = event;
    }
    
    const { code } = requestData;
    console.log('绑定码:', code);
    
    if (!code) {
      return {
        success: false,
        error: '缺少绑定码参数'
      };
    }
    
    // 验证绑定码
    console.log('验证绑定码...');
    const bindResult = await db.collection('bindings')
      .where({ code, status: 'active' })
      .get();
    
    if (bindResult.data.length === 0) {
      return {
        success: false,
        error: '绑定码无效或已过期'
      };
    }
    
    const binding = bindResult.data[0];
    const now = Date.now();
    
    // 检查过期
    if (binding.expireTime < now) {
      await db.collection('bindings').doc(binding._id).update({
        data: { status: 'expired' }
      });
      return {
        success: false,
        error: '绑定码已过期'
      };
    }
    
    console.log('绑定码验证通过, openid:', binding.openid);
    
    // 生成云存储路径
    const timestamp = now;
    const randomStr = Math.random().toString(36).substring(2, 8);
    const cloudPath = `screenshots/${binding.openid}/${timestamp}_${randomStr}.jpg`;
    
    console.log('生成云存储路径:', cloudPath);
    
    // 获取云存储临时上传链接
    console.log('获取临时上传链接...');
    const uploadUrlResult = await cloud.getUploadUrl({
      cloudPath: cloudPath,
      maxAge: 300 // 链接5分钟内有效
    });
    
    console.log('获取临时上传链接成功');
    console.log('uploadUrl:', uploadUrlResult.url);
    console.log('fileID:', uploadUrlResult.fileID);
    
    return {
      success: true,
      uploadUrl: uploadUrlResult.url,
      fileID: uploadUrlResult.fileID,
      cloudPath: cloudPath,
      openid: binding.openid,
      // 添加上传所需的其他信息
      token: uploadUrlResult.token,
      authorization: uploadUrlResult.authorization,
      cosFileId: uploadUrlResult.cosFileId
    };
    
  } catch (err) {
    console.error('========== 获取上传凭证失败 ==========');
    console.error('错误:', err);
    
    return {
      success: false,
      error: err.message || '未知错误'
    };
  }
};