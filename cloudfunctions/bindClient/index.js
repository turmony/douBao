const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  let code;
  
  // 处理HTTP触发器请求
  if (event.body) {
    try {
      const body = typeof event.body === 'string' 
        ? JSON.parse(event.body) 
        : event.body;
      code = body.code;
    } catch (e) {
      return {
        success: false,
        error: '请求格式错误'
      };
    }
  } else {
    // 直接调用的情况
    code = event.code;
  }
  
  if (!code || code.length !== 6) {
    return {
      success: false,
      error: '无效的绑定码'
    };
  }
  
  try {
    const now = Date.now();
    
    const result = await db.collection('bindings')
      .where({
        code,
        status: 'active'
      })
      .get();
    
    if (result.data.length === 0) {
      return {
        success: false,
        error: '绑定码不存在或已过期'
      };
    }
    
    const binding = result.data[0];
    
    if (binding.expireTime < now) {
      await db.collection('bindings').doc(binding._id).update({
        data: { status: 'expired' }
      });
      return {
        success: false,
        error: '绑定码已过期，请重新生成'
      };
    }
    
    return {
      success: true,
      openid: binding.openid,
      code: binding.code
    };
  } catch (err) {
    console.error('绑定验证失败:', err);
    return {
      success: false,
      error: err.message
    };
  }
};