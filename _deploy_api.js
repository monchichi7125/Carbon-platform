const fs = require('fs');
const https = require('https');

const TOKEN = process.env.GH_TOKEN;
const REPO = 'monchichi7125/Carbon-platform';
const WS = 'C:/Users/15319/WorkBuddy/2026-09-14-15-45-06';

if (!TOKEN) { console.log('ERROR: GH_TOKEN 未设置'); process.exit(1); }

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com',
      path: '/repos/' + REPO + path,
      method,
      headers: {
        'Authorization': 'token ' + TOKEN,
        'User-Agent': 'WorkBuddy-Deploy',
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      }
    }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        let json; try { json = JSON.parse(buf); } catch (e) { json = null; }
        resolve({ status: res.statusCode, json, raw: buf });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function b64EqualsLocal(b64, localBuf) {
  try {
    const remote = Buffer.from(b64, 'base64');
    return remote.equals(localBuf);
  } catch (e) { return false; }
}

async function upsertFile(localPath, repoPath, message) {
  if (!fs.existsSync(localPath)) {
    console.log('SKIP (本地不存在):', repoPath);
    return;
  }
  const localBuf = fs.readFileSync(localPath);
  let sha = null;
  let same = false;
  const cur = await api('GET', '/contents/' + repoPath);
  if (cur.status === 200 && cur.json) {
    sha = cur.json.sha || null;
    if (cur.json.content) same = b64EqualsLocal(cur.json.content, localBuf);
  }
  if (same) {
    console.log('SKIP (内容相同):', repoPath, '(' + localBuf.length + ' bytes)');
    return;
  }
  const body = { message, content: localBuf.toString('base64'), branch: 'main' };
  if (sha) body.sha = sha;
  const res = await api('PUT', '/contents/' + repoPath, body);
  if (res.status === 200 || res.status === 201) {
    console.log('OK  ', repoPath, '-> commit', res.json.commit && res.json.commit.sha,
      '(' + localBuf.length + ' bytes)');
  } else {
    console.log('FAIL', repoPath, 'HTTP', res.status, (res.raw || '').slice(0, 400));
    process.exitCode = 1;
  }
}

(async () => {
  const M = 'feat: 双碳学习平台（模块04 交易市场·三子页独立编号 · CCER 年度/月度/每日由明细真实计算 · 在线更新数据）';
  // 主页必须来自最新 carbon-learning-platform.html（含所有修复）
  await upsertFile(WS + '/carbon-learning-platform.html', 'index.html', M);
  // 依赖资产：仅当与线上不同才更新
  await upsertFile(WS + '/carbon-platform/emission-factors.json', 'emission-factors.json', M);
  await upsertFile(WS + '/carbon-mindmap.html', 'carbon-mindmap.html', M);
  // 在线更新数据源：页面「从 xxx.json 更新数据」按钮依赖这两个文件与 index.html 同目录
  await upsertFile(WS + '/ccer-market-data.json', 'ccer-market-data.json', M);
  await upsertFile(WS + '/carbon-price-data.json', 'carbon-price-data.json', M);
  console.log('DEPLOY_DONE');
})();
