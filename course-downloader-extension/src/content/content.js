// 注入到 MIS 课程平台页面，提取会话和课程数据
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'extractPageInfo') {
    sendResponse(extractPageInfo());
  }
  return true;
});

function extractPageInfo() {
  const sessionId = document.getElementById('sessionId')?.value
    || getUrlParam('sessionId')
    || '';

  const basePath = (typeof BasePath !== 'undefined' ? BasePath : '')
    || 'http://123.121.147.7:88/ve';

  const courses = extractCourses();
  const pageType = detectPageType();

  return { sessionId, basePath, courses, pageType, url: location.href };
}

function extractCourses() {
  const items = document.querySelectorAll('.courseItem');
  const courses = [];

  items.forEach(item => {
    const onclick = item.getAttribute('onclick') || '';
    // goPage('126241','M319008B','2025-2026-2-2M319008B01','2025202602')
    const m = onclick.match(/goPage\(['"](\d+)['"],['"]([^'"]+)['"],['"]([^'"]+)['"],['"]([^'"]+)['"]\)/);
    if (!m) return;

    // 课程名：第一个 .course-text[title]
    const nameEl = item.querySelector('.course-text[title]');
    const name = nameEl?.getAttribute('title') || nameEl?.textContent?.trim() || '未知课程';

    courses.push({
      cId: m[1],
      courseNum: m[2],
      xkhId: m[3],
      xqCode: m[4],
      name: name.trim()
    });
  });

  return courses;
}

function detectPageType() {
  const url = location.href;
  if (url.includes('toCoursePlatformIndex')) return 'courseList';
  if (url.includes('toCoursePlatform')) return 'coursePage';
  return 'other';
}

function getUrlParam(key) {
  return new URLSearchParams(location.search).get(key) || '';
}
