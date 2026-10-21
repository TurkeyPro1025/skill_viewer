/* Skills 译站官网交互:复制 / 滚动高亮 / FAQ 单开(零依赖) */
(function () {
  "use strict";

  /* 复制按钮:navigator.clipboard,file:// 下回退 execCommand;成功态 1.6s */
  var btn = document.getElementById("copy-btn");
  var cmd = document.getElementById("install-cmd");
  if (btn && cmd) {
    btn.addEventListener("click", function () {
      var text = cmd.innerText;
      var done = function () {
        btn.textContent = "已复制 ✓";
        btn.classList.add("copied");
        setTimeout(function () {
          btn.textContent = "复制";
          btn.classList.remove("copied");
        }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallback(); });
      } else {
        fallback();
      }
      function fallback() {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); done(); } catch (e) { /* 忽略 */ }
        ta.remove();
      }
    });
  }

  /* FAQ 同组单开:展开一条时收起其余 */
  var items = document.querySelectorAll(".faq details");
  items.forEach(function (d) {
    d.addEventListener("toggle", function () {
      if (d.open) items.forEach(function (o) { if (o !== d) o.open = false; });
    });
  });


  /* 图标格式降级:SVG 优先,缺图回退同名 PNG,两者皆缺隐藏留空砖(便于后续补图)。
     error 事件不冒泡,用捕获监听统一处理带 data-fallback 的图标。 */
  document.addEventListener("error", function (e) {
    var img = e.target;
    if (!img || img.tagName !== "IMG" || !img.dataset.fallback) return;
    if (img.dataset.fallbackDone) { img.style.display = "none"; return; }
    img.dataset.fallbackDone = "1";
    img.src = img.dataset.fallback;
  }, true);
  /* Agent 清单默认收起:只显示前 12 个,左下角展开/收起 */
  var rootsList = document.getElementById("roots-list");
  var rootsToggle = document.getElementById("roots-toggle");
  if (rootsList && rootsToggle) {
    rootsList.classList.add("collapsed");
    rootsToggle.addEventListener("click", function () {
      var collapsed = rootsList.classList.toggle("collapsed");
      rootsToggle.setAttribute("aria-expanded", String(!collapsed));
      rootsToggle.textContent = collapsed ? "展开全部" : "收起";
    });
  }

  /* 滚动高亮:视口 35% 高度处探测线所在区块,对应导航链接点亮。
     不用 IntersectionObserver:部分 WebView/后台标签页不派发其回调。 */
  var links = Array.prototype.slice.call(document.querySelectorAll(".nav-links a"));
  var pairs = links.map(function (a) {
    var sec = document.querySelector(a.hash);
    return sec ? { a: a, sec: sec } : null;
  }).filter(function (p) { return p; });

  function update() {
    var line = scrollY + innerHeight * 0.35;
    var hit = null;
    pairs.forEach(function (p) {
      if (p.sec.getBoundingClientRect().top + scrollY <= line) hit = p;
    });
    pairs.forEach(function (p) { p.a.classList.toggle("on", p === hit); });
  }

  window.addEventListener("scroll", update, { passive: true });
  update();


})();
