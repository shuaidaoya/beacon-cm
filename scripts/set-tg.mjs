// 管理员补填用户 TG 绑定（修复注册时 tgUserId 回填失败的残缺用户）
// 用法：node scripts/set-tg.mjs <管理员密码> <uuid> <tgUserId> [tgUsername]
//
// 示例：
//   node scripts/set-tg.mjs 809341047Yang eec31a49-... 123456789 @wumianye
//
// 用户提供 TG ID 后，你只需执行这一条命令即可帮他绑定。
// 成功后该用户在 TG 端签到/查询就恢复正常了。

const BASE = 'https://beacon.ssdxz.cc.cd';
const adminKey = process.argv[2];
const uuid = process.argv[3];
const tgUserId = process.argv[4];
const tgUsername = process.argv[5] || '';

if (!adminKey || !uuid || !tgUserId) {
	console.error('用法: node scripts/set-tg.mjs <管理员密码> <uuid> <tgUserId> [tgUsername]');
	console.error('示例: node scripts/set-tg.mjs 809341047Yang eec31a49-... 123456789 @wumianye');
	process.exit(1);
}

const body = { uuid, tgUserId };
if (tgUsername) body.tgUsername = tgUsername;

const url = `${BASE}/admin/system/users/set-tg?key=${encodeURIComponent(adminKey)}&_t=${Date.now()}`;

fetch(url, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
	body: JSON.stringify(body),
})
.then(r => r.json())
.then(d => {
	if (d.success) {
		console.log('✅ 绑定成功');
		console.log('  UUID:', d.uuid);
		console.log('  TG ID:', d.tgUserId);
		console.log('  状态:', d.status === 'already_bound' ? '已绑定（幂等）' : '已绑定（新建）');
		console.log('  用户现在可以在 TG 端正常签到/查询了。');
	} else {
		console.error('❌ 绑定失败:', d.error);
		if (d.conflictUuid) console.error('  该 TG 账号已绑定其他用户:', d.conflictUuid);
	}
})
.catch(e => console.error('请求失败:', e.message));
