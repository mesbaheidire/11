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
    const params = new URLSearchParams();
    if (message) params.append('message', message);
    if (link) params.append('link', link);
    params.append('access_token', token);
    const postData = params.toString();

    const options = {
      hostname: FB_GRAPH_URL,
      path: `/${FB_API_VERSION}/${pageId}/feed`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
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
    const params = new URLSearchParams();
    if (message) params.append('message', message);
    params.append('url', imageUrl);
    params.append('access_token', token);
    const postData = params.toString();

    const options = {
      hostname: FB_GRAPH_URL,
      path: `/${FB_API_VERSION}/${pageId}/photos`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
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

async function verifyPageToken(pageAccessToken, pageId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: FB_GRAPH_URL,
      path: `/${FB_API_VERSION}/${pageId}?fields=name,id&access_token=${encodeURIComponent(pageAccessToken)}`,
      method: 'GET'
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            resolve({ valid: false, error: parsed.error.message });
          } else {
            resolve({ valid: true, pageName: parsed.name, pageId: parsed.id });
          }
        } catch (e) {
          resolve({ valid: false, error: 'Invalid response' });
        }
      });
    });

    req.on('error', (e) => resolve({ valid: false, error: e.message }));
    req.end();
  });
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
