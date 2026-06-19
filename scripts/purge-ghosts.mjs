// 自动循环调用 purge-ghosts 端点清理 KV 残留用户
// 用法：先在浏览器登录后台，F12 → Application → Cookies → 复制 auth 的值
//       然后运行：node scripts/purge-ghosts.mjs <authCookie值>
//       可选第二参数：每轮间隔秒数（默认30）
//
// 示例：node scripts/purge-ghosts.mjs a1b2c3d4e5f6...
//       node scripts/purge-ghosts.mjs a1b2c3d4e5f6... 15

const BASE = 'https://beacon.ssdxz.cc.cd';
const LIMIT = 5;        // 每批清理数（与端点默认一致，串行安全）
const INTERVAL = 30;    // 默认每轮间隔秒数

const authCookie = process.argv[2];
const intervalSec = Math.max(5, Number(process.argv[3]) || INTERVAL);

if (!authCookie) {
	console.error('用法: node scripts/purge-ghosts.mjs <authCookie值> [间隔秒数]');
	console.error('获取 cookie：浏览器登录后台 → F12 → Application → Cookies → 复制 auth 值');
	process.exit(1);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });

async function callPurge() {
	const url = `${BASE}/admin/system/purge-ghosts?limit=${LIMIT}&_t=${Date.now()}`;
	const resp = await fetch(url, {
		headers: { Cookie: `auth=${authCookie}` },
	});
	if (resp.status === 302) {
		console.error(`[${ts()}] ❌ 被重定向到登录页（302）—— cookie 无效或已过期，请重新获取`);
		return null;
	}
	if (!resp.ok) {
		console.error(`[${ts()}] ❌ HTTP ${resp.status}: ${await resp.text().catch(() => '')}`);
		return null;
	}
	return resp.json();
}

async function main() {
	console.log(`=== KV 残留用户自动清理 ===`);
	console.log(`目标: ${BASE}/admin/system/purge-ghosts?limit=${LIMIT}`);
	console.log(`间隔: ${intervalSec} 秒/轮`);
	console.log(`按 Ctrl+C 中止\n`);

	let round = 0;
	let totalPurged = 0;

	// 先 dryRun 看总量
	console.log(`[${ts()}] 预览中（dryRun）...`);
	const preview = await callPurgeDry();
	if (!preview) process.exit(1);
	console.log(`[${ts()}] 残留总量: ${preview.kvStalePurged}（真实用户 ${preview.kvStaleReal} / 扫描 ${preview.kvStaleScanned}）\n`);

	if (preview.kvStalePurged === 0) {
		console.log('没有残留，无需清理。');
		return;
	}

	while (true) {
		round++;
		const data = await callPurge();
		if (!data) {
			console.log(`[${ts()}] 请求失败，${intervalSec}秒后重试...`);
			await sleep(intervalSec * 1000);
			continue;
		}
		totalPurged += data.kvStalePurged || 0;
		console.log(
			`[${ts()}] #${round} 本批清理: ${data.kvStalePurged} 失败: ${data.failed} | ` +
			`剩余: ${data.remaining} | 累计: ${totalPurged}` +
			(data.hasMore ? '' : ' | ✅ 完成')
		);
		if (!data.hasMore) {
			console.log(`\n=== 清理完成 ===`);
			console.log(`累计清理 ${totalPurged} 个残留用户`);
			console.log(`注意：KV list 索引最终一致，后台数字可能需数小时才完全恢复`);
			break;
		}
		await sleep(intervalSec * 1000);
	}
}

async function callPurgeDry() {
	const url = `${BASE}/admin/system/purge-ghosts?dryRun=true&_t=${Date.now()}`;
	try {
		const resp = await fetch(url, { headers: { Cookie: `auth=${authCookie}` } });
		if (resp.status === 302) {
			console.error(`[${ts()}] ❌ cookie 无效或已过期，请重新获取`);
			return null;
		}
		if (!resp.ok) return null;
		return resp.json();
	} catch (e) {
		console.error(`[${ts()}] 预览失败: ${e.message}`);
		return null;
	}
}

main().catch(e => { console.error('致命错误:', e); process.exit(1); });
