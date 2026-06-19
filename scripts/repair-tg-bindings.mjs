// 自动循环调用 repair-tg-bindings 端点重建缺失的 tg_bind 索引
// 用法：node scripts/repair-tg-bindings.mjs <管理员密码> [间隔秒数] [每批数]
//
// 示例：
//   node scripts/repair-tg-bindings.mjs 809341047Yang 5 10
//   （每5秒一批，每批10个，约16轮清完159个）

const BASE = 'https://beacon.ssdxz.cc.cd';
const DEFAULT_INTERVAL = 5;
const DEFAULT_LIMIT = 10;

const adminKey = process.argv[2];
const intervalSec = Math.max(2, Number(process.argv[3]) || DEFAULT_INTERVAL);
const limit = Math.min(Math.max(Number(process.argv[4]) || DEFAULT_LIMIT, 1), 20);

if (!adminKey) {
	console.error('用法: node scripts/repair-tg-bindings.mjs <管理员密码> [间隔秒数] [每批数]');
	process.exit(1);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });

async function fetchJSON(path) {
	const url = `${BASE}${path}&_t=${Date.now()}`;
	const resp = await fetch(url, { headers: { Accept: 'application/json' } });
	const text = await resp.text();
	if (text.startsWith('<')) {
		console.error(`[${ts()}] ❌ 返回 HTML（HTTP ${resp.status}）—— 密码错误或被拦截`);
		return null;
	}
	try { return JSON.parse(text); }
	catch { console.error(`[${ts()}] ❌ JSON 解析失败: ${text.slice(0, 120)}`); return null; }
}

async function main() {
	console.log(`=== TG 绑定一致性修复 ===`);
	console.log(`目标: ${BASE}/admin/system/repair-tg-bindings`);
	console.log(`配置: 每批 ${limit} 个 / 间隔 ${intervalSec} 秒`);
	console.log(`按 Ctrl+C 中止\n`);

	// dryRun 预览总量
	console.log(`[${ts()}] 预览中（dryRun）...`);
	const preview = await fetchJSON(`/admin/system/repair-tg-bindings?dryRun=true&limit=999&key=${encodeURIComponent(adminKey)}`);
	if (!preview) { console.error('预览失败，请检查管理员密码'); process.exit(1); }
	console.log(`[${ts()}] 待修复: ${preview.repaired} | 冲突: ${preview.conflicts} | 异常: ${preview.anomalies} | 已一致: ${preview.skipped}\n`);

	if (preview.conflicts > 0) console.log(`⚠️ 有 ${preview.conflicts} 个冲突（tg_bind 指向其他用户），需人工处理：`, preview.conflictList);
	if (preview.anomalies > 0) console.log(`⚠️ 有 ${preview.anomalies} 个异常（tg-verified 但无 tgUserId），需人工处理：`, preview.anomalyList);

	if (!preview.repaired && !preview.hasMore) { console.log('✅ 无需修复。'); return; }

	let round = 0, totalRepaired = 0;
	const startTime = Date.now();
	let offset = 0;
	while (true) {
		round++;
		const data = await fetchJSON(`/admin/system/repair-tg-bindings?limit=${limit}&offset=${offset}&key=${encodeURIComponent(adminKey)}`);
		if (!data) {
			console.log(`[${ts()}] 请求失败，${intervalSec}秒后重试...`);
			await sleep(intervalSec * 1000);
			continue;
		}
		totalRepaired += data.repaired || 0;
		offset = data.nextOffset || (offset + data.scanned);
		console.log(
			`[${ts()}] #${round} 修复:${data.repaired} 冲突:${data.conflicts} 异常:${data.anomalies} 跳过:${data.skipped} | ` +
			`offset:${data.nextOffset} 剩余:${data.remaining}` +
			(data.hasMore ? '' : ' | ✅完成')
		);
		if (!data.hasMore) {
			const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
			console.log(`\n=== 修复完成 ===`);
			console.log(`累计修复 ${totalRepaired} 个 tg_bind，耗时 ${elapsed} 秒，${round} 轮`);
			console.log(`TG 端签到/查询现在应能正常识别绑定（即使 tg_bind 曾缺失，D1 回退也会自动重建）`);
			break;
		}
		await sleep(intervalSec * 1000);
	}
}

main().catch(e => { console.error('致命错误:', e.message); process.exit(1); });
