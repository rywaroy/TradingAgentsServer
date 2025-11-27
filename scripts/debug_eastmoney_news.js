#!/usr/bin/env node
/**
 * 东财新闻接口快速调试脚本
 * 用法：node scripts/debug_eastmoney_news.js 600519 [条数]
 */
const axios = require('axios');
const dayjs = require('dayjs');

const symbol = process.argv[2];
const maxNews = Number(process.argv[3] || 5);

if (!symbol) {
  console.error('用法：node scripts/debug_eastmoney_news.js <6位代码> [条数]');
  process.exit(1);
}

const secid = symbol.startsWith('6') ? `1.${symbol}` : `0.${symbol}`;

async function main() {
  console.log(`测试东财 push2 接口，secid=${secid}`);
  await probePush2();

  console.log('\n测试东财 newsapi 兜底接口');
  await probeNewsApi();

  console.log('\n测试新浪新闻接口');
  await probeSina();
}

async function probePush2() {
  const url = 'https://push2.eastmoney.com/api/qt/stock/getnewslist';
  try {
    const { data } = await axios.get(url, {
      params: {
        secid,
        pn: 1,
        ps: maxNews,
        fields: 'art_code,art_title,title,digest,media_name,publish_time,showtime'
      },
      headers: { Referer: 'https://quote.eastmoney.com' },
      timeout: 5000
    });

    const rawList = data?.data?.list || data?.data?.news || [];
    console.log(`push2 状态: ${data?.rc ?? '未知'}，条数: ${Array.isArray(rawList) ? rawList.length : 0}`);
    printPreview(rawList);
    if (!Array.isArray(rawList) || !rawList.length) {
      console.log('push2 返回 data 结构预览：', JSON.stringify(data?.data || data, null, 2).slice(0, 1000));
    }
  } catch (err) {
    console.error(`push2 请求失败: ${(err.response && err.response.status) || err.message}`);
  }
}

async function probeNewsApi() {
  const url = 'http://newsapi.eastmoney.com/kuaixun/v1/getlist';
  try {
    const { data } = await axios.get(url, {
      params: {
        client: 'app',
        code: symbol,
        page_index: 1,
        page_size: maxNews,
        need_content: 0,
        last_time: 0,
        show_field: 'title;summary;show_time;source'
      },
      headers: { Referer: 'https://finance.eastmoney.com' },
      timeout: 5000
    });

    const list = data?.data?.data || data?.data?.list || [];
    console.log(`newsapi 状态: ${data?.status ?? '未知'}，条数: ${Array.isArray(list) ? list.length : 0}`);
    printPreview(list);
    if (!Array.isArray(list) || !list.length) {
      console.log('newsapi 返回数据预览：', JSON.stringify(data, null, 2).slice(0, 1000));
    }
  } catch (err) {
    console.error(`newsapi 请求失败: ${(err.response && err.response.status) || err.message}`);
  }
}

function printPreview(list) {
  if (!Array.isArray(list) || !list.length) {
    console.log('无数据');
    return;
  }

  const preview = list.slice(0, 3).map((item) => {
    const title = item.art_title || item.title || item.digest || item.summary || '';
    const time = item.publish_time || item.showtime || item.show_time || '';
    return {
      title,
      source: item.media_name || item.source || '',
      time: time ? dayjs(time).format('YYYY-MM-DD HH:mm') : ''
    };
  });
  console.log('示例：', JSON.stringify(preview, null, 2));
}

async function probeSina() {
  const url = 'https://feed.mix.sina.com.cn/api/roll/get';
  try {
    const { data } = await axios.get(url, {
      params: {
        pageid: 153,
        lid: 2509,
        k: symbol,
        num: maxNews,
        page: 1
      },
      headers: { Referer: 'https://finance.sina.com.cn' },
      timeout: 5000
    });
    const list = data?.result?.data || [];
    console.log(`sina 条数: ${Array.isArray(list) ? list.length : 0}`);
    printPreview(list);
    if (!Array.isArray(list) || !list.length) {
      console.log('sina 返回数据预览：', JSON.stringify(data, null, 2).slice(0, 1000));
    }
  } catch (err) {
    console.error(`sina 请求失败: ${(err.response && err.response.status) || err.message}`);
  }
}

main();
