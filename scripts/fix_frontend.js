const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', '..', 'Beacon-Pages.github.io', 'register', 'index.html');
let html = fs.readFileSync(filePath, 'utf8');

// === Change 1: Update showTGVerifyStep function ===

// Replace the tgDeepLink line
html = html.replace(
  "var tgDeepLink = 'https://t.me/' + botUsername + '?start=' + code;",
  "var tgDeepLink = ''; // 不再使用个人对话链接，改为引导到群组"
);

// Replace the title/subtitle
html = html.replace(
  "请通过 Telegram 完成身份验证",
  "请通过 Telegram 官方群组完成验证"
);
html = html.replace(
  "向 Bot 发送验证码即可自动验证群组成员身份",
  "在官方群组内发送验证码，Bot 将自动验证您的身份"
);

// Add copy button after verify-code display
html = html.replace(
  "html += '<div class=\"verify-expires\">",
  "html += '<div style=\"margin-top:6px\"><button class=\"copy-btn\" data-copy=\"' + escAttr('/start ' + code) + '\" style=\"background:#334155;color:#e2e8f0;border:1px solid #475569;padding:6px 14px;border-radius:8px;cursor:pointer;font-size:13px\">📋 复制 /start ' + escHtml(code) + '</button></div>';\n    html += '<div class=\"verify-expires\">"
);

// Replace instructions
const oldInstructions = [
  "    html += '<li>点击下方按钮打开 Telegram Bot</li>';",
  "    html += '<li>向 Bot 发送 <code>/start ' + escHtml(code) + '</code>（点击链接自动填充）</li>';",
  "    html += '<li>Bot 将自动验证您的群组成员身份</li>';",
  "    html += '<li>验证通过后本页面将自动完成注册</li>';"
].join('\n');

const newInstructions = [
  "    if (groupInviteLink) {",
  "      html += '<li>点击下方按钮<b>加入官方群组</b></li>';",
  "      html += '<li>在<b>群组内</b>发送 <code>/start ' + escHtml(code) + '</code></li>';",
  "    } else {",
  "      html += '<li>打开 Telegram 并<b>进入官方群组</b></li>';",
  "      html += '<li>在<b>群组内</b>发送 <code>/start ' + escHtml(code) + '</code></li>';",
  "    }",
  "    html += '<li>Bot 将在群组内<b>公开回复</b>验证结果</li>';",
  "    html += '<li>验证通过后本页面将<b>自动完成注册</b></li>';"
].join('\n');

html = html.replace(oldInstructions, newInstructions);

// Replace action buttons section
const oldButtons = [
  "    // action buttons",
  "    html += '<a class=\"verify-tg-link\" href=\"' + escHtml(tgDeepLink) + '\" target=\"_blank\" rel=\"noopener\">';",
  "    html += '<span>🤖</span> 打开 Telegram Bot</a>';",
  "    if (groupInviteLink) {",
  "      html += '<br><a class=\"verify-group-btn\" href=\"' + escHtml(groupInviteLink) + '\" target=\"_blank\" rel=\"noopener\">📋 加入官方群组（如未加入）</a>';",
  "    }"
].join('\n');

const newButtons = [
  "    // action buttons: primary is group invite, secondary is copy command",
  "    if (groupInviteLink) {",
  "      html += '<a class=\"verify-tg-link\" href=\"' + escHtml(groupInviteLink) + '\" target=\"_blank\" rel=\"noopener\" style=\"background:linear-gradient(135deg,#25a55a,#2ecc71)\">';",
  "      html += '<span>📋</span> 加入官方群组</a>';",
  "    } else {",
  "      html += '<div class=\"verify-tg-link\" style=\"background:#334155;cursor:not-allowed;opacity:0.7\">';",
  "      html += '<span>⚠️</span> 群组邀请链接不可用，请联系管理员</div>';",
  "    }",
  "    // secondary copy button",
  "    html += '<br><button class=\"verify-copy-cmd-btn\" data-copy=\"' + escAttr('/start ' + code) + '\" style=\"display:inline-flex;align-items:center;gap:6px;background:#1e293b;color:#94a3b8;border:1px solid #334155;padding:10px 18px;border-radius:10px;cursor:pointer;font-size:13px;margin-top:8px;transition:all .2s\" onmouseover=\"this.style.borderColor='#475569';this.style.color='#e2e8f0'\" onmouseout=\"this.style.borderColor='#334155';this.style.color='#94a3b8'\">📋 复制命令 /start ' + escHtml(code) + '</button>';"
].join('\n');

html = html.replace(oldButtons, newButtons);

// Add polling indicator comment
html = html.replace(
  "    // polling indicator",
  "    // polling indicator with status display"
);

// Add failure display area before back button
html = html.replace(
  "    html += '</div>';\n\n    // back button",
  "    html += '</div>';\n\n    // failure display area\n    html += '<div id=\"verifyFailMsg\" style=\"display:none;margin-top:12px\"></div>';\n\n    // back button"
);

// Add copy handler attachment after innerHTML
html = html.replace(
  "    resultItems.innerHTML = html;\n\n    // start polling",
  "    resultItems.innerHTML = html;\n\n    // attach copy handlers\n    resultItems.querySelectorAll('.copy-btn, .verify-copy-cmd-btn').forEach(function(btn) {\n      btn.addEventListener('click', function() { copyText(btn.dataset.copy, btn); });\n    });\n\n    // start polling"
);

// === Change 2: Add showVerifyFail function ===
html = html.replace(
  "  function stopTGVerifyPolling() {",
  "  function showVerifyFail(message) {\n    var failEl = document.getElementById('verifyFailMsg');\n    if (failEl) {\n      failEl.style.display = 'block';\n      failEl.innerHTML = '<div style=\"background:#450a0a;border:1px solid #dc2626;border-radius:10px;padding:12px 16px;color:#fca5a5;font-size:13px\">' + escHtml(message) + '</div>';\n    }\n  }\n\n  function stopTGVerifyPolling() {"
);

// === Change 3: Add showVerifyFail call on timeout ===
html = html.replace(
  "        if (pollEl) pollEl.innerHTML = '<span style=\"color:#ef4444\">⏰ 验证超时，请返回重新注册。</span>';\n        return;",
  "        if (pollEl) pollEl.innerHTML = '<span style=\"color:#ef4444\">⏰ 验证超时，请返回重新注册。</span>';\n        showVerifyFail('验证已超时（10分钟），请返回注册页面重新发起注册。');\n        return;"
);

// Write back
fs.writeFileSync(filePath, html, 'utf8');
console.log('Done. File length:', html.length);
console.log('Has corruption (U+FFFD):', html.includes('\uFFFD'));
console.log('Has showVerifyFail:', html.includes('showVerifyFail'));
console.log('Has showTGVerifyStep:', html.includes('showTGVerifyStep'));
console.log('Has verifyFailMsg:', html.includes('verifyFailMsg'));
console.log('Has join group instr:', html.includes('加入官方群组'));
console.log('Has t.me link (should be false):', html.includes("t.me/' + botUsername + '?start="));
