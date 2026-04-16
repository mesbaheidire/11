const crypto = require('crypto');
const got = require('got');

const API_URL = 'https://api-sg.aliexpress.com/sync';

function signRequest(params, appSecret) {
    const sortedParams = Object.keys(params)
        .sort()
        .reduce((acc, key) => {
            acc[key] = params[key];
            return acc;
        }, {});

    const sortedString = Object.keys(sortedParams).reduce((acc, key) => {
        return `${acc}${key}${sortedParams[key]}`;
    }, '');

    const signString = `${appSecret}${sortedString}${appSecret}`;

    return crypto
        .createHash('md5')
        .update(signString, 'utf8')
        .digest('hex')
        .toUpperCase();
}

async function getProductDetails(productId, options = {}) {
    if (!productId) return null;
    
    // Retry logic
    const maxRetries = 2;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Add small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 1100 * attempt));

            const appKey = process.env.ALIEXPRESS_APP_KEY;
            const appSecret = process.env.ALIEXPRESS_APP_SECRET;

            if (!appKey || !appSecret) {
                console.error('Missing AliExpress API credentials');
                return null;
            }

            const params = {
                method: 'aliexpress.affiliate.productdetail.get',
                app_key: appKey,
                sign_method: 'md5',
                timestamp: Date.now().toString(),
                format: 'json',
                v: '2.0',
                product_ids: String(productId),
                target_currency: options.currency || 'USD',
                target_language: options.language || 'EN',
                tracking_id: process.env.ALIEXPRESS_TRACK_ID || 'default'
            };

            params.sign = signRequest(params, appSecret);

            const response = await got(API_URL, {
                searchParams: params,
                timeout: { request: 15000 },
                responseType: 'json'
            });

            const data = response.body;
            
            if (data.aliexpress_affiliate_productdetail_get_response) {
                const result = data.aliexpress_affiliate_productdetail_get_response.resp_result;
                if (result && result.result && result.result.products && result.result.products.product) {
                    const products = result.result.products.product;
                    const product = Array.isArray(products) ? products[0] : products;
                    
                    return {
                        title: product.product_title || '',
                        image_url: product.product_main_image_url || product.product_small_image_urls?.string?.[0] || null,
                        price: product.target_sale_price || product.target_original_price || null,
                        original_price: product.target_original_price || null,
                        sale_price: product.target_sale_price || null,
                        discount: product.discount || null,
                        currency: product.target_sale_price_currency || 'USD',
                        product_url: product.product_detail_url || null,
                        promotion_link: product.promotion_link || null,
                        shop_name: product.shop_title || null,
                        rating: product.evaluate_rate || null,
                        orders: product.lastest_volume || null
                    };
                }
            }

            if (data.error_response) {
                lastError = data.error_response.msg || JSON.stringify(data.error_response);
                console.error(`AliExpress API Attempt ${attempt} Error:`, lastError);
            }

        } catch (err) {
            lastError = err.message;
            console.error(`AliExpress API request attempt ${attempt} error:`, lastError);
        }
        
        if (attempt < maxRetries) {
            console.log(`Retrying AliExpress API... (${attempt}/${maxRetries})`);
        }
    }

    return null;
}

async function searchHotProducts(options = {}) {
    const maxRetries = 2;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await new Promise(resolve => setTimeout(resolve, 1100 * attempt));

            const appKey = process.env.ALIEXPRESS_APP_KEY;
            const appSecret = process.env.ALIEXPRESS_APP_SECRET;

            if (!appKey || !appSecret) {
                console.error('Missing AliExpress API credentials');
                return { success: false, error: 'Missing API credentials' };
            }

            const params = {
                method: 'aliexpress.affiliate.hotproduct.query',
                app_key: appKey,
                sign_method: 'md5',
                timestamp: Date.now().toString(),
                format: 'json',
                v: '2.0',
                target_currency: options.currency || 'USD',
                target_language: options.language || 'EN',
                tracking_id: process.env.ALIEXPRESS_TRACK_ID || 'default',
                page_no: options.page || '1',
                page_size: options.limit || '10'
            };

            if (options.category) params.category_ids = options.category;
            if (options.keywords) params.keywords = options.keywords;
            if (options.minPrice) params.min_sale_price = options.minPrice;
            if (options.maxPrice) params.max_sale_price = options.maxPrice;

            params.sign = signRequest(params, appSecret);

            const response = await got(API_URL, {
                searchParams: params,
                timeout: { request: 20000 },
                responseType: 'json'
            });

            const data = response.body;
            
            if (data.aliexpress_affiliate_hotproduct_query_response) {
                const result = data.aliexpress_affiliate_hotproduct_query_response.resp_result;
                if (result && result.result && result.result.products && result.result.products.product) {
                    const products = result.result.products.product;
                    const productList = Array.isArray(products) ? products : [products];
                    
                    return {
                        success: true,
                        total: result.result.total_record_count || productList.length,
                        products: productList.map(p => ({
                            id: p.product_id,
                            title: p.product_title || '',
                            image_url: p.product_main_image_url || null,
                            price: p.target_sale_price || p.target_original_price || null,
                            original_price: p.target_original_price || null,
                            sale_price: p.target_sale_price || null,
                            discount: p.discount || null,
                            currency: p.target_sale_price_currency || 'USD',
                            product_url: p.product_detail_url || null,
                            promotion_link: p.promotion_link || null,
                            shop_name: p.shop_title || null,
                            rating: p.evaluate_rate || null,
                            orders: p.lastest_volume || null,
                            commission_rate: p.commission_rate || null
                        }))
                    };
                }
            }

            if (data.error_response) {
                lastError = data.error_response.msg || JSON.stringify(data.error_response);
                console.error(`Hot Products API Attempt ${attempt} Error:`, lastError);
            }

        } catch (err) {
            lastError = err.message;
            console.error(`Hot Products API attempt ${attempt} error:`, lastError);
        }
        
        if (attempt < maxRetries) {
            console.log(`Retrying Hot Products API... (${attempt}/${maxRetries})`);
        }
    }

    return { success: false, error: lastError || 'Failed to fetch hot products' };
}

async function searchProducts(options = {}) {
    const maxRetries = 2;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await new Promise(resolve => setTimeout(resolve, 1100 * attempt));

            const appKey = process.env.ALIEXPRESS_APP_KEY;
            const appSecret = process.env.ALIEXPRESS_APP_SECRET;

            if (!appKey || !appSecret) {
                console.error('Missing AliExpress API credentials');
                return { success: false, error: 'Missing API credentials' };
            }

            const params = {
                method: 'aliexpress.affiliate.product.query',
                app_key: appKey,
                sign_method: 'md5',
                timestamp: Date.now().toString(),
                format: 'json',
                v: '2.0',
                target_currency: options.currency || 'USD',
                target_language: options.language || 'EN',
                tracking_id: process.env.ALIEXPRESS_TRACK_ID || 'default',
                page_no: options.page || '1',
                page_size: options.limit || '10',
                sort: options.sort || 'SALE_PRICE_ASC'
            };

            if (options.keywords) params.keywords = options.keywords;
            if (options.category) params.category_ids = options.category;
            if (options.minPrice) params.min_sale_price = options.minPrice;
            if (options.maxPrice) params.max_sale_price = options.maxPrice;

            params.sign = signRequest(params, appSecret);

            const response = await got(API_URL, {
                searchParams: params,
                timeout: { request: 20000 },
                responseType: 'json'
            });

            const data = response.body;
            
            if (data.aliexpress_affiliate_product_query_response) {
                const result = data.aliexpress_affiliate_product_query_response.resp_result;
                if (result && result.result && result.result.products && result.result.products.product) {
                    const products = result.result.products.product;
                    const productList = Array.isArray(products) ? products : [products];
                    
                    return {
                        success: true,
                        total: result.result.total_record_count || productList.length,
                        products: productList.map(p => ({
                            id: p.product_id,
                            title: p.product_title || '',
                            image_url: p.product_main_image_url || null,
                            price: p.target_sale_price || p.target_original_price || null,
                            original_price: p.target_original_price || null,
                            sale_price: p.target_sale_price || null,
                            discount: p.discount || null,
                            currency: p.target_sale_price_currency || 'USD',
                            product_url: p.product_detail_url || null,
                            promotion_link: p.promotion_link || null,
                            shop_name: p.shop_title || null,
                            rating: p.evaluate_rate || null,
                            orders: p.lastest_volume || null,
                            commission_rate: p.commission_rate || null
                        }))
                    };
                }
            }

            if (data.error_response) {
                lastError = data.error_response.msg || JSON.stringify(data.error_response);
                console.error(`Product Query API Attempt ${attempt} Error:`, lastError);
            }

        } catch (err) {
            lastError = err.message;
            console.error(`Product Query API attempt ${attempt} error:`, lastError);
        }
        
        if (attempt < maxRetries) {
            console.log(`Retrying Product Query API... (${attempt}/${maxRetries})`);
        }
    }

    return { success: false, error: lastError || 'Failed to search products' };
}

module.exports = { getProductDetails, searchHotProducts, searchProducts };
