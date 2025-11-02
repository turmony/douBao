const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  
  try {
    // 使旧的绑定码失效
    await db.collection('bindings')
      .where({ openid, status: 'active' })
      .update({
        data: { status: 'expired' }
      });
    
    // 生成新的6位随机码
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const now = Date.now();
    const expireTime = now + 30 * 60 * 1000; // 30分钟后过期
    
    // 创建新绑定
    await db.collection('bindings').add({
      data: {
        code,
        openid,
        createTime: now,
        expireTime,
        status: 'active'
      }
    });
    
    // 初始化session
    const sessionQuery = await db.collection('sessions').where({ openid }).get();
    if (sessionQuery.data.length > 0) {
      await db.collection('sessions').where({ openid }).update({
        data: {
          code,
          imageUrl: '',
          answer: '',
          status: 'waiting',
          errorMsg: '',
          updateTime: now
        }
      });
    } else {
      await db.collection('sessions').add({
        data: {
          openid,
          code,
          imageUrl: '',
          answer: '',
          status: 'waiting',
          errorMsg: '',
          updateTime: now
        }
      });
    }
    
    return {
      success: true,
      code,
      expireTime
    };
  } catch (err) {
    console.error('生成随机码失败:', err);
    return {
      success: false,
      error: err.message
    };
  }
};