// ── 全局状态 ──
let sessionId = '';
let courses = [];
let courseFiles = {};
let selectedFiles = new Set();
let isDownloading = false;
let completedDl = 0, totalDl = 0;
let isScanningAll = false;
let scanStopRequested = false;

// ── 启动 ──
document.addEventListener('DOMContentLoaded', async () => {
  bindEvents();
  await loadStoredSettings();
  await init();
});

async function init() {
  setConnStatus('mis', 'checking');
  setConnStatus('course', 'checking');

  // 连接检测后台运行，不阻塞主界面
  chrome.runtime.sendMessage({ action: 'checkConnectivity' })
    .then(conn => { if (conn) updateConnUI(conn); })
    .catch(() => {});

  const info = await getPageInfo().catch(() => null);

  if (info?.sessionId) sessionId = info.sessionId;
  window._pageTabFound = info?.tabFound ?? false;

  showMainContent();
  renderCourses(info?.courses || []);
}

function updateConnUI(conn) {
  setConnStatus('mis', conn.mis ? 'ok' : 'err');
  document.getElementById('misLabel').textContent = conn.mis ? 'MIS ✓' : 'MIS 不可达';

  setConnStatus('course', conn.course ? 'ok' : 'err');
  document.getElementById('courseLabel').textContent = conn.course ? '课程平台 ✓' : '课程平台 不可达';
}

function setConnStatus(which, state) {
  const dot = document.getElementById(which + 'Dot');
  dot.className = 'conn-dot ' + state;
}

// ── 从课程平台标签页提取信息 ──
async function getPageInfo() {
  return await chrome.runtime.sendMessage({ action: 'getPageData' });
}

// ── 登录提示 / 主体切换 ──
function showLoginWarning(title, detail) {
  document.getElementById('warningTitle').textContent = title;
  document.getElementById('warningDetail').textContent = detail;
  document.getElementById('loginWarning').classList.remove('hidden');
  document.getElementById('mainContent').classList.add('hidden');
}

function showMainContent() {
  document.getElementById('loginWarning').classList.add('hidden');
  document.getElementById('mainContent').classList.remove('hidden');
}

// ── 课程列表渲染 ──
function renderCourses(list) {
  courses = list || [];
  document.getElementById('courseCount').textContent = courses.length;
  const el = document.getElementById('courseList');

  if (!courses.length) {
    const hint = window._pageTabFound
      ? '已找到课程平台标签页，但未识别到课程。<br>请确认当前页面是「我的课程」列表页，等待页面完全加载后点击 ↻ 重新检测'
      : '未找到课程平台标签页。<br>请先在浏览器中打开下方链接，等页面加载完成后点击 ↻ 重新检测';
    el.innerHTML = `
      <div class="empty-tip">
        ${hint}<br><br>
        <a href="http://123.121.147.7:88/ve/back/coursePlatform/coursePlatform.shtml?method=toCoursePlatformIndex"
           target="_blank" style="color:#4a7fd4;font-size:12px">打开 MIS 课程中心</a>
      </div>`;
    return;
  }

  el.innerHTML = courses.map((c, i) => `
    <div class="course-item" data-num="${esc(c.courseNum)}">
      <input type="checkbox" class="course-chk" data-num="${esc(c.courseNum)}">
      <div class="course-item-body">
        <div class="course-name" title="${esc(c.name)}">${esc(c.name)}</div>
        <div class="course-meta">
          <code style="font-size:10px">${esc(c.courseNum)}</code>
          <span id="cs-${esc(c.courseNum)}"></span>
        </div>
      </div>
      <button class="btn btn-xs course-scan-btn" data-num="${esc(c.courseNum)}">扫描</button>
    </div>
  `).join('');

  el.querySelectorAll('.course-item').forEach(item => {
    item.querySelector('.course-name').addEventListener('click', () => {
      highlightCourse(item.dataset.num);
      scrollToGroup(item.dataset.num);
    });
  });

  el.querySelectorAll('.course-scan-btn').forEach(btn => {
    btn.addEventListener('click', () => scanOneCourse(btn.dataset.num));
  });
}

function highlightCourse(num) {
  document.querySelectorAll('.course-item').forEach(el => el.classList.remove('active'));
  document.querySelector(`.course-item[data-num="${num}"]`)?.classList.add('active');
}

function scrollToGroup(num) {
  document.getElementById(`group-${num}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── 扫描文件 ──
async function scanOneCourse(courseNum) {
  const course = courses.find(c => c.courseNum === courseNum);
  if (!course) return;
  setCourseStatus(courseNum, 'scanning', '扫描中...');
  switchTab('files');

  const res = await chrome.runtime.sendMessage({ action: 'scanCourseFiles', sessionId, course });

  if (res?.success) {
    courseFiles[courseNum] = res.files;
    const canDl = res.files.filter(f => f.canDownload).length;
    setCourseStatus(courseNum, 'done', `${canDl}/${res.files.length} 可下载`);
    renderFileGroup(course, res.files);
    updateFileStats();
  } else {
    setCourseStatus(courseNum, 'error', '失败');
    addLog(`扫描失败: ${course.name} — ${res?.error || '未知'}`, 'error');
  }
}

async function scanAllCourses() {
  const btn = document.getElementById('btnScanAll');

  if (isScanningAll) {
    scanStopRequested = true;
    btn.textContent = '停止中...';
    btn.disabled = true;
    return;
  }

  isScanningAll = true;
  scanStopRequested = false;
  btn.textContent = '⏹ 停止扫描';
  btn.classList.remove('btn-primary');
  btn.classList.add('btn-danger');

  switchTab('files');
  document.getElementById('filePanel').innerHTML = '';

  for (const c of courses) {
    if (scanStopRequested) break;
    await scanOneCourse(c.courseNum);
  }

  isScanningAll = false;
  scanStopRequested = false;
  btn.disabled = false;
  btn.textContent = '🔍 扫描全部课件';
  btn.classList.remove('btn-danger');
  btn.classList.add('btn-primary');
  updateFileStats();
}

function setCourseStatus(num, type, text) {
  const el = document.getElementById(`cs-${num}`);
  if (!el) return;
  el.className = `course-status status-${type}`;
  el.textContent = text;
}

// ── 文件渲染 ──
function renderFileGroup(course, files) {
  const panel = document.getElementById('filePanel');
  document.getElementById(`group-${course.courseNum}`)?.remove();
  panel.querySelector('.empty-tip')?.remove();

  const canDl = files.filter(f => f.canDownload).length;
  const locked = files.length - canDl;

  const g = document.createElement('div');
  g.className = 'course-group';
  g.id = `group-${course.courseNum}`;
  const num = course.courseNum;

  g.innerHTML = `
    <div class="course-group-header" onclick="toggleGroup('${esc(num)}')">
      <div>
        <div class="course-group-title">${esc(course.name)}</div>
        <div class="course-group-meta">${canDl} 可下载 · ${locked} 受限 · 共 ${files.length} 个</div>
      </div>
      <div class="course-group-right">
        <span class="course-group-toggle" id="tog-${esc(num)}">▾</span>
      </div>
    </div>
    <div id="gbody-${esc(num)}">
      ${files.length === 0
        ? '<div class="empty-tip" style="padding:20px">该课程暂无课件</div>'
        : `<table class="file-table">
            <thead><tr>
              <th style="width:30px">
                <input type="checkbox" id="chk-all-${esc(num)}"
                  onchange="toggleGroupFiles('${esc(num)}',this.checked)">
              </th>
              <th>文件名</th><th style="width:60px">类型</th><th style="width:70px">状态</th>
            </tr></thead>
            <tbody>
              ${files.map(f => `
                <tr>
                  <td>${f.canDownload
                    ? `<input type="checkbox" class="file-chk"
                        data-rpid="${esc(f.rpId)}" data-course="${esc(num)}"
                        data-name="${esc(f.name)}" data-folder="${esc(f.folderPath||'')}"
                        onchange="onFileCheck(this)">`
                    : '<input type="checkbox" disabled>'
                  }</td>
                  <td class="file-name">
                    <span class="file-name-text" title="${esc(f.name)}">${fileIcon(f.name, f.fileType)} ${esc(f.name)}</span>
                    ${f.folderPath ? `<span class="file-path">📁 ${esc(f.folderPath)}</span>` : ''}
                  </td>
                  <td><span class="type-badge">${esc(fileTypeName(f))}</span></td>
                  <td>${f.canDownload ? '<span class="tag-ok">可下载</span>' : '<span class="tag-locked">受限</span>'}</td>
                </tr>`).join('')}
            </tbody>
          </table>`}
    </div>`;

  panel.appendChild(g);
  g.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

window.toggleGroup = (num) => {
  const body = document.getElementById(`gbody-${num}`);
  const tog = document.getElementById(`tog-${num}`);
  if (!body) return;
  const hidden = body.style.display === 'none';
  body.style.display = hidden ? '' : 'none';
  tog.textContent = hidden ? '▾' : '▸';
};

window.toggleGroupFiles = (num, checked) => {
  document.querySelectorAll(`.file-chk[data-course="${num}"]`).forEach(c => {
    c.checked = checked;
    onFileCheck(c);
  });
};

function onFileCheck(el) {
  el.checked ? selectedFiles.add(el.dataset.rpid) : selectedFiles.delete(el.dataset.rpid);
}

function updateFileStats() {
  const total = Object.values(courseFiles).reduce((s, f) => s + f.length, 0);
  const dl = Object.values(courseFiles).reduce((s, f) => s + f.filter(x => x.canDownload).length, 0);
  document.getElementById('fileStats').textContent = `共 ${total} 个文件，${dl} 个可下载`;
}

// ── 下载 ──
function buildFilesFromCourses(nums) {
  return nums.flatMap(num => {
    const c = courses.find(x => x.courseNum === num);
    return (courseFiles[num] || [])
      .filter(f => f.canDownload)
      .map(f => ({ ...f, fileName: f.name, courseName: c?.name || num }));
  });
}

function buildSelectedFilesList() {
  const files = [];
  document.querySelectorAll('.file-chk:checked').forEach(el => {
    const c = courses.find(x => x.courseNum === el.dataset.course);
    files.push({
      rpId: el.dataset.rpid,
      name: el.dataset.name,
      fileName: el.dataset.name,
      folderPath: el.dataset.folder,
      courseName: c?.name || el.dataset.course
    });
  });
  return files;
}

function startDownload(files) {
  if (!files.length) { alert('没有可下载的文件'); return; }
  if (isDownloading) { alert('下载进行中，请等待或先停止'); return; }
  isDownloading = true;
  totalDl = files.length; completedDl = 0;
  updateProgressBar(0, totalDl);
  switchTab('progress');
  document.getElementById('btnStopDownload').classList.remove('hidden');
  const rootFolder = document.getElementById('rootFolder').value.trim() || '课程资料';
  addLog(`准备下载 ${files.length} 个文件`, 'info');
  chrome.runtime.sendMessage({ action: 'startDownload', files, sessionId, rootFolder });
}

// ── Keep-alive ──
async function loadStoredSettings() {
  const { keepAliveEnabled, lastKeepAlive } = await chrome.storage.local.get(['keepAliveEnabled', 'lastKeepAlive']);
  document.getElementById('keepAliveToggle').checked = !!keepAliveEnabled;
  if (lastKeepAlive) document.getElementById('keepAliveInfo').textContent = `上次: ${lastKeepAlive}`;
}

function updateKeepAliveInfo(status, time) {
  const info = document.getElementById('keepAliveInfo');
  info.textContent = status === 'ok' ? `上次: ${time}` : '刷新失败';
  info.style.color = status === 'ok' ? 'rgba(255,255,255,.7)' : '#ff6b6b';
}

// ── 进度监听 ──
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'downloadProgress') {
    if (msg.type === 'start') { totalDl = msg.total; completedDl = 0; }
    else if (msg.type === 'progress') {
      completedDl = msg.completed; totalDl = msg.total;
      updateProgressBar(msg.completed, msg.total);
      const icon = { success: '✓', error: '✗', downloading: '↓' }[msg.status] || '·';
      addLog(`${icon} ${msg.file}`, msg.status === 'error' ? 'error' : 'success');
    } else if (msg.type === 'done') {
      isDownloading = false;
      document.getElementById('btnStopDownload').classList.add('hidden');
      addLog(`下载完成：${msg.completed}/${msg.total}`, 'info');
    }
  }
  if (msg.action === 'keepAliveStatus') {
    updateKeepAliveInfo(msg.status, msg.time);
  }
});

function updateProgressBar(done, total) {
  const pct = total > 0 ? Math.round(done / total * 100) : 0;
  document.getElementById('progressBar').style.width = pct + '%';
  document.getElementById('progressText').textContent = `${done} / ${total} (${pct}%)`;
}

function addLog(msg, type = 'info') {
  const log = document.getElementById('progressLog');
  const d = document.createElement('div');
  d.className = `log-line log-${type}`;
  d.innerHTML = `<span class="log-time">${now()}</span><span class="log-msg">${esc(msg)}</span>`;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
}

// ── Tab 切换 ──
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab${name[0].toUpperCase() + name.slice(1)}`));
}

// ── 事件绑定 ──
function bindEvents() {
  document.getElementById('btnRecheck').addEventListener('click', init);
  document.getElementById('btnRetryCheck').addEventListener('click', init);
  document.getElementById('btnScanAll').addEventListener('click', scanAllCourses);

  document.getElementById('btnSelectAllCourses').addEventListener('click', () => {
    document.querySelectorAll('.course-chk').forEach(c => c.checked = true);
  });
  document.getElementById('btnDeselectCourses').addEventListener('click', () => {
    document.querySelectorAll('.course-chk').forEach(c => c.checked = false);
  });
  document.getElementById('btnDownloadSelected').addEventListener('click', () => {
    const nums = [...document.querySelectorAll('.course-chk:checked')].map(c => c.dataset.num);
    if (!nums.length) { alert('请勾选课程'); return; }
    const unscanned = nums.filter(n => !courseFiles[n]);
    if (unscanned.length) {
      const names = unscanned.map(n => courses.find(c => c.courseNum === n)?.name || n).join('\n');
      alert(`请先扫描以下课程:\n${names}`);
      return;
    }
    startDownload(buildFilesFromCourses(nums));
  });

  document.getElementById('btnSelectAllFiles').addEventListener('click', () => {
    document.querySelectorAll('.file-chk').forEach(c => { c.checked = true; onFileCheck(c); });
    document.querySelectorAll('[id^="chk-all-"]').forEach(c => c.checked = true);
  });
  document.getElementById('btnDeselectFiles').addEventListener('click', () => {
    document.querySelectorAll('.file-chk').forEach(c => { c.checked = false; onFileCheck(c); });
    document.querySelectorAll('[id^="chk-all-"]').forEach(c => c.checked = false);
    selectedFiles.clear();
  });
  document.getElementById('btnDownloadFiles').addEventListener('click', () => {
    startDownload(buildSelectedFilesList());
  });

  document.getElementById('btnStopDownload').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'stopDownload' });
    isDownloading = false;
    document.getElementById('btnStopDownload').classList.add('hidden');
    addLog('已请求停止', 'warn');
  });
  document.getElementById('btnClearLog').addEventListener('click', () => {
    document.getElementById('progressLog').innerHTML = '';
  });

  document.getElementById('keepAliveToggle').addEventListener('change', function() {
    chrome.runtime.sendMessage({ action: 'setKeepAlive', enabled: this.checked });
    addLog(this.checked ? '防过期已开启（每5分钟自动刷新 MIS 会话）' : '防过期已关闭', 'info');
  });

  document.getElementById('btnPingNow').addEventListener('click', async () => {
    const btn = document.getElementById('btnPingNow');
    btn.disabled = true; btn.textContent = '...';
    const res = await chrome.runtime.sendMessage({ action: 'pingNow' });
    btn.disabled = false; btn.textContent = '刷新';
    if (res?.ok) {
      updateKeepAliveInfo('ok', res.time);
      addLog('手动刷新 MIS 会话成功', 'success');
    } else {
      addLog(`手动刷新失败: ${res?.error || '未知'}`, 'error');
    }
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

// ── 工具函数 ──
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fileIcon(name, type) {
  const e = (type || (name||'').split('.').pop()).toLowerCase();
  return {pdf:'📄',ppt:'📊',pptx:'📊',doc:'📝',docx:'📝',zip:'📦',rar:'📦','7z':'📦',
          mp4:'🎬',avi:'🎬',mkv:'🎬',mp3:'🎵',xls:'📈',xlsx:'📈',
          jpg:'🖼',jpeg:'🖼',png:'🖼',gif:'🖼',txt:'📃',py:'💻',java:'💻',c:'💻',cpp:'💻'}[e] || '📎';
}

function fileTypeName(f) {
  const t = (f.fileType || '').trim().toLowerCase();
  if (t) return t.toUpperCase();
  const nameParts = (f.name || '').split('.');
  if (nameParts.length > 1) return nameParts.pop().toUpperCase().substring(0, 6);
  return '—';
}
function now() {
  return new Date().toLocaleTimeString('zh-CN',{hour12:false});
}
