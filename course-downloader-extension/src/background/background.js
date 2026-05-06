const COURSE_BASE = 'http://123.121.147.7:88/ve';
const MIS_HOME    = 'https://mis.bjtu.edu.cn/home/';
const MIS_PING    = 'https://mis.bjtu.edu.cn/';
const COURSEWARE_PAGE = '10450';

let pageTabId = null;
let apiSessionId = ''; // 每次扫描后缓存，用于下载

// ── 点击图标：打开/聚焦完整页面 ──
chrome.action.onClicked.addListener(async () => {
  if (pageTabId !== null) {
    try {
      const tab = await chrome.tabs.get(pageTabId);
      await chrome.tabs.update(pageTabId, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      return;
    } catch { pageTabId = null; }
  }
  const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('src/page/page.html') });
  pageTabId = tab.id;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === pageTabId) pageTabId = null;
});

// ── Keep-alive alarm ──
chrome.alarms.get('misKeepAlive', (alarm) => {
  if (!alarm) chrome.alarms.create('misKeepAlive', { periodInMinutes: 5 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'misKeepAlive') return;
  const { keepAliveEnabled } = await chrome.storage.local.get('keepAliveEnabled');
  if (!keepAliveEnabled) return;
  await pingMisNow();
});

// ── 消息路由 ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.action) {
    case 'checkConnectivity':
      checkConnectivity().then(sendResponse);
      return true;
    case 'getPageData':
      getPageDataFromTab().then(sendResponse);
      return true;
    case 'scanCourseFiles':
      scanCourseFiles(msg.course).then(sendResponse);
      return true;
    case 'startDownload':
      startDownload(msg.files, msg.sessionId, msg.rootFolder);
      sendResponse({ ok: true });
      break;
    case 'stopDownload':
      stopFlag = true;
      sendResponse({ ok: true });
      break;
    case 'setKeepAlive':
      chrome.storage.local.set({ keepAliveEnabled: msg.enabled });
      if (msg.enabled) pingMisNow();
      sendResponse({ ok: true });
      break;
    case 'pingNow':
      pingMisNow().then(sendResponse);
      return true;
  }
});

// ── 联通性检测 ──
async function checkConnectivity() {
  const result = { mis: false, course: false, misReason: '', courseReason: '' };
  const to = () => AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined;

  try {
    const r = await fetch(MIS_HOME, { credentials: 'include', redirect: 'follow', cache: 'no-store', signal: to() });
    result.mis = r.status < 500;
  } catch { result.misReason = '无法连接 MIS'; }

  try {
    const r = await fetch(`${COURSE_BASE}/`, { credentials: 'include', redirect: 'follow', cache: 'no-store', signal: to() });
    result.course = r.status < 500;
    if (!result.course) result.courseReason = `HTTP ${r.status}`;
  } catch { result.courseReason = '无法连接，请确认在校园网/VPN环境下'; }

  return result;
}

// ── Keep-alive ping ──
async function pingMisNow() {
  try {
    await fetch(MIS_PING, { credentials: 'include', cache: 'no-store' });
    const ts = new Date().toLocaleTimeString('zh-CN');
    await chrome.storage.local.set({ lastKeepAlive: ts, keepAliveStatus: 'ok' });
    broadcastToPage({ action: 'keepAliveStatus', status: 'ok', time: ts });
    return { ok: true, time: ts };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── 从课程列表标签页提取课程数据 ──
async function getPageDataFromTab() {
  const tabs = await chrome.tabs.query({});
  const target =
    tabs.find(t => t.url?.includes('123.121.147.7') && t.url?.includes('toCoursePlatformIndex')) ||
    tabs.find(t => t.url?.includes('123.121.147.7')) || null;

  if (!target) return { sessionId: '', courses: [], tabFound: false };

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: target.id },
      func: () => {
        const sessionId = document.getElementById('sessionId')?.value
          || new URLSearchParams(location.search).get('sessionId')
          || (typeof window.sessionId !== 'undefined' ? String(window.sessionId) : '')
          || '';

        const courses = [];
        document.querySelectorAll('.courseItem').forEach(item => {
          const oc = item.getAttribute('onclick') || '';
          const m = oc.match(/goPage\(\s*['"](\d+)['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/);
          if (!m) return;
          const nameEl = item.querySelector('.course-text[title]') || item.querySelector('.course-text');
          const name = (nameEl?.getAttribute('title') || nameEl?.textContent || '').trim();
          if (name) courses.push({ cId: m[1], courseNum: m[2], xkhId: m[3], xqCode: m[4], name });
        });

        return { sessionId, courses, url: location.href, tabFound: true };
      }
    });
    return result || { sessionId: '', courses: [], tabFound: true };
  } catch (e) {
    return { sessionId: '', courses: [], tabFound: true, error: e.message };
  }
}

// ── 扫描课程电子课件 ──
async function scanCourseFiles(course) {
  const url =
    `${COURSE_BASE}/back/coursePlatform/coursePlatform.shtml` +
    `?method=toCoursePlatform&courseToPage=${COURSEWARE_PAGE}` +
    `&courseId=${encodeURIComponent(course.courseNum)}` +
    `&dataSource=1` +
    `&cId=${encodeURIComponent(course.cId)}` +
    `&xkhId=${encodeURIComponent(course.xkhId)}` +
    `&xqCode=${encodeURIComponent(course.xqCode)}`;

  let tab;
  try {
    tab = await chrome.tabs.create({ url, active: false });
    await waitTabComplete(tab.id, 20000);

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [{
        courseNum: course.courseNum,
        cId: course.cId,
        xkhId: course.xkhId,
        xqCode: course.xqCode
      }],
      func: async (c) => {
        const BASE = 'http://123.121.147.7:88/ve';
        const sid = document.getElementById('sessionId')?.value || '';

        async function fetchList(upId) {
          const qs = new URLSearchParams({
            courseId: c.courseNum, cId: c.cId,
            xkhId: c.xkhId, xqCode: c.xqCode,
            docType: '1', up_id: String(upId), searchName: ''
          });
          const res = await fetch(
            `${BASE}/back/coursePlatform/courseResource.shtml?method=stuQueryUploadResourceForCourseList&${qs}`,
            { headers: sid ? { sessionId: sid } : {} }
          );
          return res.json().catch(() => ({}));
        }

        const files = [];
        const root = await fetchList(0);

        function toFile(item, folderPath) {
          const t = item.RP_PRIX;
          return {
            rpId: item.rpId,
            name: item.rpName,
            fileType: (t && t !== 'undefined' && t !== 'null') ? t.toLowerCase() : '',
            canDownload: item.stu_download == '2',
            folderPath
          };
        }

        (root.resList || []).forEach(item => files.push(toFile(item, '')));

        for (const bag of (root.bagList || [])) {
          const sub = await fetchList(bag.id);
          (sub.resList || []).forEach(item => files.push(toFile(item, bag.bag_name)));
        }

        return { files, sid };
      }
    });

    if (result?.sid) apiSessionId = result.sid;
    return { success: true, files: result?.files || [], course };
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    if (tab) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

// 等待标签页加载完成
function waitTabComplete(tabId, timeout = 20000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, timeout);

    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 500);
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// ── 获取文件真实下载 URL 及真实文件名 ──
async function resolveRpUrl(rpId) {
  const tabs = await chrome.tabs.query({});
  const tab = tabs.find(t => t.url?.includes('123.121.147.7'));
  if (!tab) return { url: '', dlFilename: '' };

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [rpId, apiSessionId],
      func: async (rpId, sid) => {
        const BASE = 'http://123.121.147.7:88/ve';
        const headers = {};
        if (sid) headers.sessionId = sid;
        const res = await fetch(
          `${BASE}/back/resourceSpace.shtml?method=rpinfoDownloadUrl&rpId=${rpId}`,
          { method: 'POST', headers }
        );
        const d = await res.json().catch(() => ({}));
        let url = d.rpUrl || '';
        if (!url) return { url: '', dlFilename: '' };
        if (!url.startsWith('http')) url = BASE + (url.startsWith('/') ? '' : '/') + url;

        let dlFilename = '';
        try {
          const head = await fetch(url, { method: 'HEAD' });
          const cd = head.headers.get('content-disposition') || '';
          const m = cd.match(/filename\*=UTF-8''([^;\r\n]+)/i)
            || cd.match(/filename="([^"]+)"/i)
            || cd.match(/filename=([^;\r\n]+)/i);
          if (m) dlFilename = decodeURIComponent(m[1].trim().replace(/^["']|["']$/g, ''));
        } catch {}

        return { url, dlFilename };
      }
    });
    return result || { url: '', dlFilename: '' };
  } catch { return { url: '', dlFilename: '' }; }
}

// ── 下载队列 ──
let isDownloading = false;
let stopFlag = false;
let completedCount = 0;
let totalCount = 0;

async function startDownload(files, sessionId, rootFolder) {
  if (isDownloading) return;
  isDownloading = true;
  stopFlag = false;
  completedCount = 0;
  totalCount = files.length;

  broadcastToPage({ action: 'downloadProgress', type: 'start', total: totalCount });

  for (const file of files) {
    if (stopFlag) break;
    await downloadSingleFile(file, rootFolder);
  }

  isDownloading = false;
  broadcastToPage({ action: 'downloadProgress', type: 'done', completed: completedCount, total: totalCount });
}

async function downloadSingleFile(file, rootFolder) {
  broadcastToPage({ action: 'downloadProgress', type: 'progress', file: file.name, status: 'downloading', completed: completedCount, total: totalCount });
  try {
    const { url, dlFilename } = await resolveRpUrl(file.rpId);
    if (!url) throw new Error('未获取到下载链接');

    let dlName = file.fileName || file.name;
    if (dlFilename) {
      const dotIdx = dlFilename.lastIndexOf('.');
      if (dotIdx > 0 && !dlName.includes('.')) {
        dlName = dlName + dlFilename.substring(dotIdx);
      }
    }

    const parts = [rootFolder, file.courseName];
    if (file.folderPath) parts.push(file.folderPath);
    parts.push(dlName);
    const filename = parts.filter(Boolean).map(s => s.replace(/[\\/:*?"<>|]/g, '_').trim()).join('/');

    await new Promise((resolve) => {
      chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false }, (dlId) => {
        if (chrome.runtime.lastError || !dlId) {
          broadcastToPage({ action: 'downloadProgress', type: 'progress', file: file.name, status: 'error', completed: ++completedCount, total: totalCount });
          resolve(); return;
        }
        const onChange = (delta) => {
          if (delta.id !== dlId) return;
          const s = delta.state?.current;
          if (s === 'complete' || s === 'interrupted') {
            chrome.downloads.onChanged.removeListener(onChange);
            broadcastToPage({ action: 'downloadProgress', type: 'progress', file: file.name, status: s === 'complete' ? 'success' : 'error', completed: ++completedCount, total: totalCount });
            resolve();
          }
        };
        chrome.downloads.onChanged.addListener(onChange);
      });
    });
  } catch {
    broadcastToPage({ action: 'downloadProgress', type: 'progress', file: file.name, status: 'error', completed: ++completedCount, total: totalCount });
  }
}

// ── 广播到插件页面 ──
function broadcastToPage(data) {
  if (pageTabId === null) return;
  chrome.tabs.sendMessage(pageTabId, data).catch(() => {});
}
