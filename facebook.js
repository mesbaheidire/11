const https = require('https');
const http = require('http');

const FB_GRAPH_URL = 'graph.facebook.com';
const FB_API_VERSION = 'v19.0';

async function postToFacebookPage(pageAccessToken, pageId, message, imageUrl, link) {
  if (!pageAccessToken || !pageId) {
    throw new Error('Facebook Page Access Token و Page ID مطلوبان');
  }

  if (imageUrl) {
    return postPhotoToPage(pageAccessToken, pageId, message, imageUrl);
  } else {
    return postTextToPage(pageAccessToken, pageId, message, link);
  }
}

function postTextToPage(token, pageId, message, link) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      message: message,
      link: link || undefined,
      access_token: token
    });

    const options = {
      hostname: FB_GRAPH_URL,
      path: `/${FB_API_VERSION}/${pageId}/feed`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(parsed.error.message || 'Facebook API error'));
          } else {
            resolve({ success: true, postId: parsed.id });
          }
        } catch (e) {
          reject(new Error('Invalid Facebook API response'));
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.write(postData);
    req.end();
  });
}

function postPhotoToPage(token, pageId, message, imageUrl) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      message: message,
      url: imageUrl,
      access_token: token
    });

    const options = {
      hostname: FB_GRAPH_URL,
      path: `/${FB_API_VERSION}/${pageId}/photos`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(parsed.error.message || 'Facebook API error'));
          } else {
            resolve({ success: true, postId: parsed.post_id || parsed.id });
          }
        } catch (e) {
          reject(new Error('Invalid Facebook API response'));
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.write(postData);
    req.end();
  });
}

function fbGet(path) {
  return new Promise((resolve) => {
    const options = { hostname: FB_GRAPH_URL, path: `/${FB_API_VERSION}${path}`, method: 'GET' };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve({ error: { message: 'Invalid JSON response from Facebook' } }); }
      });
    });
    req.on('error', (e) => resolve({ error: { message: e.message } }));
    req.end();
  });
}

async function verifyPageToken(pageAccessToken, pageId) {
  // الخطوة 1: اختبر التوكن نفسه (لمن يعود؟)
  const me = await fbGet(`/me?fields=id,name&access_token=${encodeURIComponent(pageAccessToken)}`);
  if (me.error) {
    return { valid: false, error: `توكن غير صالح: ${me.error.message}` };
  }

  // الخطوة 2: تحقّق إن كان توكن User أم Page
  // إذا me.id == pageId → هذا Page Access Token صحيح
  // إذا me.id != pageId → هذا User Token (لن ينشر على الصفحة)
  const isUserToken = String(me.id) !== String(pageId);

  // الخطوة 3: اطلب tasks من الصفحة لمعرفة الصلاحيات
  const pageInfo = await fbGet(`/${pageId}?fields=name,id,access_token,tasks&access_token=${encodeURIComponent(pageAccessToken)}`);
  if (pageInfo.error) {
    return {
      valid: false,
      error: `الصفحة غير قابلة للوصول: ${pageInfo.error.message}`,
      hint: isUserToken ? 'يبدو أنك تستخدم User Access Token. يجب استبداله بـ Page Access Token من /me/accounts' : null,
      isUserToken
    };
  }

  const tasks = pageInfo.tasks || [];
  const canCreate = tasks.includes('CREATE_CONTENT');
  const canManage = tasks.includes('MANAGE');

  if (isUserToken && !canCreate) {
    return {
      valid: false,
      pageName: pageInfo.name,
      error: 'هذا User Access Token لا Page Token. لا يستطيع النشر على الصفحة.',
      hint: `استبدله بـ Page Access Token عبر: GET /${pageId}?fields=access_token (أو من Graph API Explorer → Get Page Access Token)`,
      tasks,
      isUserToken: true
    };
  }

  if (!canCreate && !canManage && tasks.length > 0) {
    return {
      valid: false,
      pageName: pageInfo.name,
      error: `التوكن صالح لكن بدون صلاحية نشر. الصلاحيات الحالية: [${tasks.join(', ')}]`,
      hint: 'أضف pages_manage_posts و pages_read_engagement من Facebook Login for Business → Permissions',
      tasks,
      isUserToken: false
    };
  }

  return {
    valid: true,
    pageName: pageInfo.name,
    pageId: pageInfo.id,
    tasks,
    canCreate,
    canManage,
    isUserToken: false,
    hasPageTokenField: !!pageInfo.access_token,
    suggestedPageToken: pageInfo.access_token || null
  };
}

function formatFacebookMessage(title, price, affiliateLink, coupon, template) {
  const t = template || {};
  let msg = '';

  if (t.prefix) msg += t.prefix + '\n\n';
  if (title) msg += title + '\n\n';
  if (price) msg += (t.priceLabel || '💰 السعر:') + ' ' + price + '\n\n';
  if (affiliateLink) msg += (t.linkLabel || '🛒 رابط الشراء:') + '\n' + affiliateLink + '\n\n';
  if (coupon) msg += (t.couponLabel || '🎟️ كوبون:') + ' ' + coupon + '\n\n';
  if (t.footer) msg += t.footer + '\n';
  if (t.hashtags) msg += '\n' + t.hashtags;

  return msg.trim();
}

module.exports = {
  postToFacebookPage,
  verifyPageToken,
  formatFacebookMessage
};
