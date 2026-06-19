// 自动循环调用 purge-ghosts 端点清理 KV 残留用户
// 用法：node scripts/purge-ghosts.mjs <管理员密码> [间隔秒数] [每批数]
//
// 示例：
//   node scripts/purge-ghosts.mjs myAdminPassword 30 5
//   node scripts/purge-ghosts.mjs myAdminPassword 15 10   # 每15秒清10个
//
// 鉴权用 ?key=管理员密码（端点支持），无需浏览器 cookie，绕过 UA 绑定。

const BASE = 'https://beacon.ssdxz.cc.cd';
const DEFAULT_INTERVAL = 30;
const DEFAULT_LIMIT = 5;

const adminKey = process.argv[2];
const intervalSec = Math.max(5, Number(process.argv[3]) || DEFAULT_INTERVAL);
const limit = Math.min(Math.max(Number(process.argv[4]) || DEFAULT_LIMIT, 1), 20);

if (!adminKey) {
	console.error('用法: node scripts/purge-ghosts.mjs <管理员密码> [间隔秒数] [每批数]');
	console.error('示例: node scripts/purge-ghosts.mjs myPassword 30 5');
	process.exit(1);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });

async function fetchJSON(path) {
	const url = `${BASE}${path}&_t=${Date.now()}`;
	const resp = await fetch(url, { headers: { Accept: 'application/json' } });
	if (resp.status === 302 || resp.status === 301) {
		console.error(`[${ts()}] ❌ 重定向到登录页 —— 密码错误`);
		return null;
	}
	const text = await resp.text();
	if (text.startsWith('<')) {
		console.error(`[${ts()}] ❌ 返回 HTML（HTTP ${resp.status}）—— 密码错误或被拦截`);
		return null;
	}
	try { return JSON.parse(text); }
	catch { console.error(`[${ts()}] ❌ JSON 解析失败: ${text.slice(0, 120)}`); return null; }
}

async function main() {
	console.log(`=== KV 残留用户自动清理 ===`);
	console.log(`目标: ${BASE}/admin/system/purge-ghosts`);
	console.log(`配置: 每批 ${limit} 个 / 间隔 ${intervalSec} 秒`);
	console.log(`按 Ctrl+C 中止\n`);

	// 先 dryRun 预览总量
	console.log(`[${ts()}] 预览中（dryRun）...`);
	const preview = await fetchJSON(`/admin/system/purge-ghosts?dryRun=true&key=${encodeURIComponent(adminKey)}`);
	if (!preview) { console.error('预览失败，请检查管理员密码'); process.exit(1); }
	console.log(`[${ts()}] 残留总量: ${preview.kvStalePurged}（真实 ${preview.kvStaleReal} / 扫描 ${preview.kvStaleScanned}）\n`);

	if (!preview.kvStalePurged) { console.log('✅ 没有残留，无需清理。'); return; }

	let round = 0, totalPurged = 0;
	const startTime = Date.now();
	while (true) {
		round++;
		const data = await fetchJSON(`/admin/system/purge-ghosts?limit=${limit}&key=${encodeURIComponent(adminKey)}`);
		if (!data) {
			console.log(`[${ts()}] 请求失败，${intervalSec}秒后重试...`);
			await sleep(intervalSec * 1000);
			continue;
		}
		totalPurged += data.kvStalePurged || 0;
		const pct = ((totalPurged / preview.kvStalePurged) * 100).toFixed(1);
		console.log(
			`[${ts()}] #${round} 清理:${data.kvStalePurged} 失败:${data.failed} | ` +
			`剩余:${data.remaining} | 累计:${totalPurged}/${preview.kvStalePurged} (${pct}%)` +
			(data.hasMore ? '' : ' | ✅完成')
		);
		if (!data.hasMore) {
			const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
			console.log(`\n=== 清理完成 ===`);
			console.log(`累计清理 ${totalPurged} 个残留用户，耗时 ${elapsed} 秒，${round} 轮`);
			console.log(`注意：KV list 索引最终一致，后台数字可能需数小时才完全恢复`);
			break;
		}
		await sleep(intervalSec * 1000);
	}
}

main().catch(e => { console.error('致命错误:', e.message); process.exit(1); });
