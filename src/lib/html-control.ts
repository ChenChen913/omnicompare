/**
 * HTML 演示播放控制：运行时 + 注入器
 *
 * 背景与决策见 docs/HTML-ANIMATION-CONTROL.md。
 *
 * 为什么是"注入"而不是放开 sandbox：
 * - iframe 是 `sandbox="allow-scripts"`（opaque origin），父页面拿不到内部 DOM/变量；
 * - 唯一可行通道是 postMessage，所以控制器必须作为页面里的第一个 <script> 注入。
 *
 * 为什么按字节注入：
 * - 上传的 HTML 可能是 GBK/GB18030，先解码再编码会毁掉原文；
 * - 只在字节层面找到 `<head ...>` 的 `>` 后插入 ASCII 运行时，不碰其余字节。
 *
 * 运行时协议（父页面 <-> iframe）：
 *   父 -> 子：{ __oc: 1, token, action: 'pause' | 'play', at?: number }
 *   子 -> 父：{ __oc: 1, token, type: 'ready' | 'paused' | 'resumed' | 'capabilities', data }
 * token 由父页面每次挂载随机生成，子页面只接受携带同 token 且 source===parent 的消息；
 * 父页面只接受 source===iframe.contentWindow 且 token 匹配的消息。
 */

/** 运行时脚本（保持纯 ASCII，避免注入到 GBK 页面时产生编码混排） */
const HTML_CONTROL_SCRIPT = `(function () {
  if (window.__OC_CTRL__) return;
  window.__OC_CTRL__ = true;
  var q = new URLSearchParams(location.search);
  var token = q.get('oc_token') || '';
  var hold = q.get('oc_hold') === '1';
  var warm = Number(q.get('oc_warm'));
  if (!isFinite(warm) || warm < 0) warm = 1200;
  var realNow = performance.now.bind(performance);
  var realDateNow = Date.now.bind(Date);
  var realSetInterval = window.setInterval.bind(window);
  var raf = window.requestAnimationFrame.bind(window);
  var caf = window.cancelAnimationFrame.bind(window);
  var offset = 0;
  var paused = false;
  var pausedAt = realNow();
  var queued = new Map();
  var seq = 1000000;
  var sentReady = false;
  var awaitingFirstFrame = false;
  var lastVirtual = null;
  var mediaWasPlaying = [];
  var pausedAnims = [];
  var rescanTimer = null;
  var lottieFrozen = false;
  var gsapFrozen = false;

  performance.now = function () { return realNow() - offset; };
  Date.now = function () { return realDateNow() - offset - (paused ? realNow() - pausedAt : 0); };
  window.setInterval = function (fn, delay) {
    var extra = Array.prototype.slice.call(arguments, 2);
    return realSetInterval(function () { if (paused) return; fn.apply(window, extra); }, delay);
  };

  function post(type, data) {
    try { parent.postMessage({ __oc: 1, token: token, type: type, data: data || {} }, '*'); } catch (e) {}
  }

  function walkAnimations(root, out) {
    try {
      var list = root.getAnimations ? root.getAnimations() : [];
      for (var i = 0; i < list.length; i++) out.push(list[i]);
    } catch (e) {}
    var nodes = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (var j = 0; j < nodes.length; j++) {
      if (nodes[j].shadowRoot) walkAnimations(nodes[j].shadowRoot, out);
    }
  }

  function collectAnimations() {
    var out = [];
    walkAnimations(document, out);
    return out;
  }

  function countShadowRoots() {
    var n = 0;
    var nodes = document.querySelectorAll('*');
    for (var i = 0; i < nodes.length; i++) if (nodes[i].shadowRoot) n++;
    return n;
  }

  function isScrollDriven(a) {
    try { return typeof ScrollTimeline !== 'undefined' && a.timeline instanceof ScrollTimeline; } catch (e) { return false; }
  }

  function track(cb) {
    return function (ts) {
      var v = ts - offset;
      if (awaitingFirstFrame && lastVirtual !== null) {
        post('frame', { gap: Math.round((v - lastVirtual) * 100) / 100 });
        awaitingFirstFrame = false;
      }
      lastVirtual = v;
      cb(v);
    };
  }

  window.requestAnimationFrame = function (cb) {
    if (paused) {
      var id = seq++;
      queued.set(id, cb);
      return id;
    }
    return raf(track(cb));
  };
  window.cancelAnimationFrame = function (id) {
    if (queued.delete(id)) return;
    caf(id);
  };

  function pauseAnimations() {
    pausedAnims = [];
    var list = collectAnimations();
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      try {
        if (isScrollDriven(a)) continue;
        if (a.playState === 'running') { a.pause(); pausedAnims.push(a); }
      } catch (e) {}
    }
  }
  function playAnimations() {
    for (var i = 0; i < pausedAnims.length; i++) { try { pausedAnims[i].play(); } catch (e) {} }
    pausedAnims = [];
  }
  function pauseSmil() {
    var svgs = document.querySelectorAll('svg');
    for (var i = 0; i < svgs.length; i++) { try { svgs[i].pauseAnimations(); } catch (e) {} }
  }
  function playSmil() {
    var svgs = document.querySelectorAll('svg');
    for (var i = 0; i < svgs.length; i++) { try { svgs[i].unpauseAnimations(); } catch (e) {} }
  }
  function pauseMedia(append) {
    if (!append) mediaWasPlaying = [];
    var media = document.querySelectorAll('video,audio');
    for (var i = 0; i < media.length; i++) {
      var m = media[i];
      if (!m.paused && mediaWasPlaying.indexOf(m) === -1) {
        mediaWasPlaying.push(m);
        try { m.pause(); } catch (e) {}
      }
    }
  }
  function playMedia() {
    for (var i = 0; i < mediaWasPlaying.length; i++) {
      try { mediaWasPlaying[i].play().catch(function () {}); } catch (e) {}
    }
    mediaWasPlaying = [];
  }
  function pauseLottie() {
    try {
      if (window.lottie && typeof window.lottie.freeze === 'function') { window.lottie.freeze(); lottieFrozen = true; }
    } catch (e) {}
  }
  function playLottie() {
    try {
      if (lottieFrozen && window.lottie && typeof window.lottie.unfreeze === 'function') window.lottie.unfreeze();
    } catch (e) {}
    lottieFrozen = false;
  }
  function pauseGsap() {
    try {
      if (window.gsap && window.gsap.globalTimeline) { window.gsap.globalTimeline.pause(); gsapFrozen = true; }
    } catch (e) {}
  }
  function playGsap() {
    try {
      if (gsapFrozen && window.gsap && window.gsap.globalTimeline) window.gsap.globalTimeline.play();
    } catch (e) {}
    gsapFrozen = false;
  }

  function rescan() {
    if (!paused) return;
    var list = collectAnimations();
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      try {
        if (isScrollDriven(a)) continue;
        if (a.playState === 'running') { a.pause(); pausedAnims.push(a); }
      } catch (e) {}
    }
    pauseSmil();
    pauseMedia(true);
  }

  function pause(reason) {
    if (paused) return;
    paused = true;
    pausedAt = realNow();
    pauseAnimations();
    pauseSmil();
    pauseMedia(false);
    pauseLottie();
    pauseGsap();
    if (rescanTimer === null) rescanTimer = realSetInterval(rescan, 250);
    post('paused', { at: realDateNow(), reason: reason || 'cmd' });
  }

  function finishResume(ts) {
    offset += realNow() - pausedAt;
    paused = false;
    if (rescanTimer !== null) { clearInterval(rescanTimer); rescanTimer = null; }
    awaitingFirstFrame = true;
    playAnimations();
    playSmil();
    playMedia();
    playLottie();
    playGsap();
    var pending = queued;
    queued = new Map();
    pending.forEach(function (cb) { track(cb)(ts); });
    post('resumed', { at: realDateNow() });
  }

  function resumeAt(atWall) {
    function tick(ts) {
      if (!paused) return;
      if (realDateNow() < atWall) { raf(tick); return; }
      finishResume(ts);
    }
    raf(tick);
  }

  function capabilities() {
    return {
      canvas: !!document.querySelector('canvas'),
      media: document.querySelectorAll('video,audio').length,
      smil: document.querySelectorAll('animate,animateTransform,animateMotion,set').length,
      animations: collectAnimations().length,
      shadow: countShadowRoots(),
      gif: document.querySelectorAll('img[src$=".gif" i]').length,
      svgImage: document.querySelectorAll('img[src$=".svg" i]').length,
    };
  }

  function markReady() {
    if (sentReady) return;
    sentReady = true;
    post('ready', { hold: hold, warm: warm });
    post('capabilities', capabilities());
    if (hold) pause('ready');
  }

  if (document.readyState === 'complete') setTimeout(function () { markReady(); }, warm);
  else window.addEventListener('load', function () { setTimeout(function () { markReady(); }, warm); });
  setTimeout(function () { markReady(); }, Math.max(25000, warm + 15000));

  window.addEventListener('message', function (e) {
    if (e.source !== parent) return;
    var d = e.data;
    if (!d || d.__oc !== 1 || d.token !== token) return;
    if (d.action === 'pause') pause('cmd');
    else if (d.action === 'play') {
      if (typeof d.at === 'number') resumeAt(d.at);
      else { if (paused) finishResume(realNow()); }
    }
  });

  window.addEventListener('error', function (e) {
    post('error', { message: String((e && e.message) || 'error') });
  });

  post('loaded', {});
})();`;

/** 注入标记：重复注入时跳过 */
export const HTML_CONTROL_MARKER = '__OC_CTRL__';

function indexOfAscii(buf: Buffer, needle: string, from = 0): number {
  // 只用于查找少量 ASCII 标签；latin1 逐字节映射，不会误判多字节字符
  return buf.toString('latin1').toLowerCase().indexOf(needle.toLowerCase(), from);
}

/**
 * 把控制器脚本注入 HTML 字节流：优先 `<head>` 之后，
 * 其次 `<html>` 之后，最后文件开头。已注入过则原样返回。
 */
export function injectHtmlControl(input: Buffer): Buffer {
  if (input.includes(Buffer.from(HTML_CONTROL_MARKER))) return input;

  const script = Buffer.from(`<script>${HTML_CONTROL_SCRIPT}</script>`, 'utf8');

  const head = indexOfAscii(input, '<head');
  if (head >= 0) {
    const close = input.indexOf(0x3e, head); // '>'
    if (close >= 0) return Buffer.concat([input.subarray(0, close + 1), script, input.subarray(close + 1)]);
  }

  const htmlTag = indexOfAscii(input, '<html');
  if (htmlTag >= 0) {
    const close = input.indexOf(0x3e, htmlTag);
    if (close >= 0) return Buffer.concat([input.subarray(0, close + 1), script, input.subarray(close + 1)]);
  }

  return Buffer.concat([script, input]);
}
