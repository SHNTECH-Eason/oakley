/**
 * 介面邏輯
 *
 * 四個分頁：今天（打卡）、本週（格子表）、紀錄（統計＋月曆）、家長（PIN 保護）。
 * 小朋友只能打卡「當天」，過去的日子要補登得走家長模式 —— 不然他會一次把整週點完。
 */
(function () {
  'use strict';

  var DOW = ['日', '一', '二', '三', '四', '五', '六'];
  var COLORS = ['amber', 'orange', 'blue', 'emerald', 'purple', 'teal', 'indigo', 'night'];
  var ICONS = ['chase', 'marshall', 'skye', 'rubble', 'house', 'meal', 'bath', 'moon'];

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var view = 'today';
  var weekAnchor = Store.today();     // 本週檢視的基準日
  var calAnchor = Store.today();      // 月曆檢視的基準月
  var parentUnlocked = false;
  var pinBuffer = '';
  var pinStage = 'verify';            // verify | create | confirm
  var pinFirstEntry = '';
  var lastRenderedDay = null;

  // ── 小工具 ──────────────────────────────────────────────

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  function svgIcon(name, className) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    if (className) svg.setAttribute('class', className);
    svg.setAttribute('viewBox', '0 0 64 64');
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  }

  /** 項目名稱用「/」分段，各段獨立加注音，避免斜線被當成字 */
  function labelNode(text) {
    var wrap = el('span');
    text.split('/').forEach(function (part, i) {
      if (i) wrap.appendChild(el('span', 'task__sep', '/'));
      wrap.appendChild(Zhuyin.render(part.trim()));
    });
    return wrap;
  }

  function fmtDate(d) {
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日　星期' + DOW[d.getDay()];
  }

  function sameDay(a, b) {
    return Store.dateKey(a) === Store.dateKey(b);
  }

  var toastTimer;
  function toast(msg) {
    var box = $('#toast');
    box.textContent = msg;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.hidden = true; }, 2200);
  }

  // ── 音效 ────────────────────────────────────────────────
  // 用 Web Audio 合成，不放音檔，離線也有聲音

  var audioCtx = null;
  var master = null;

  function ensureAudio() {
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        master = audioCtx.createGain();
        master.gain.value = 0.9;                // 手機喇叭要夠大聲才聽得到
        master.connect(audioCtx.destination);
      }
      if (audioCtx.state === 'suspended') audioCtx.resume();
      return audioCtx;
    } catch (e) {
      return null;                              // 不支援就安靜跳過
    }
  }

  /**
   * iOS 規定音訊必須在使用者手勢裡啟動，而且 resume() 是非同步的。
   * 第一次碰到畫面就先用一個無聲的 buffer 把它解鎖，
   * 否則第一次打卡的聲音會被系統吞掉。
   */
  function unlockAudio() {
    var ctx = ensureAudio();
    if (!ctx) return;
    var src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, 22050);
    src.connect(ctx.destination);
    src.start(0);
  }

  function tone(freq, startAt, dur, gainPeak, type) {
    var osc = audioCtx.createOscillator();
    var gain = audioCtx.createGain();
    osc.type = type || 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(gainPeak, startAt + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);
    osc.connect(gain).connect(master);
    osc.start(startAt);
    osc.stop(startAt + dur + 0.02);
  }

  /** 半音位移，用來讓音高隨進度爬升 */
  function semis(base, n) { return base * Math.pow(2, n / 12); }

  /**
   * level 是今天的完成比例 0–1。
   * 每次都一模一樣的聲音，一個禮拜就變壁紙了；讓音高隨著進度往上爬，
   * 小朋友會直覺感覺到「越來越接近了」。
   */
  function play(kind, level) {
    if (!Store.state.settings.sound) return;
    if (!ensureAudio()) return;

    // 排在稍微之後，讓 resume() 有時間完成，不然第一聲會缺角
    var t = audioCtx.currentTime + 0.02;
    var lv = typeof level === 'number' ? level : 0;

    if (kind === 'done') {
      var root = semis(784, Math.round(lv * 5));      // 越接近全破，音越高
      tone(root, t, 0.10, 0.5);
      tone(root * 4 / 3, t + 0.06, 0.14, 0.45);
      tone(root * 2, t + 0.12, 0.26, 0.34);
      if (lv >= 0.6) tone(root * 3, t + 0.19, 0.30, 0.22, 'sine');
    } else if (kind === 'rare') {
      // 少見的驚喜音，閃亮亮的上行琶音
      [1046, 1318, 1568, 2093, 2637].forEach(function (f, i) {
        tone(f, t + i * 0.055, 0.34, 0.34, 'sine');
      });
    } else if (kind === 'almost') {
      // 只剩一個：兩個往上吊的音，製造「快到了」的期待
      tone(880, t, 0.14, 0.4);
      tone(1174, t + 0.11, 0.34, 0.4);
    } else if (kind === 'perfect') {
      [523, 659, 784, 1046, 1318].forEach(function (f, i) {
        tone(f, t + i * 0.10, 0.42, 0.45);
      });
      tone(2093, t + 0.52, 0.7, 0.3, 'sine');
      tone(1568, t + 0.60, 0.8, 0.24, 'sine');
    } else if (kind === 'replay') {
      // 再看一次：溫和的兩音，不搶戲
      tone(1046, t, 0.09, 0.32);
      tone(1568, t + 0.07, 0.20, 0.24);
    }
  }

  // ── 語音 ────────────────────────────────────────────────
  // 五歲還不太識字，聽得懂比看得懂重要。預設關閉，家長模式可開。

  var zhVoice = null;

  function pickVoice() {
    if (zhVoice) return zhVoice;
    if (!('speechSynthesis' in window)) return null;
    var voices = speechSynthesis.getVoices() || [];
    // 優先台灣中文，退而求其次任何中文
    zhVoice = voices.filter(function (v) { return /zh[-_]TW/i.test(v.lang); })[0] ||
              voices.filter(function (v) { return /^zh/i.test(v.lang); })[0] || null;
    return zhVoice;
  }

  function speak(text, delay) {
    if (!Store.state.settings.speech) return;
    if (!('speechSynthesis' in window)) return;
    setTimeout(function () {
      try {
        speechSynthesis.cancel();               // 連點時不要疊在一起
        var u = new SpeechSynthesisUtterance(text);
        u.lang = 'zh-TW';
        u.rate = 0.95;
        u.pitch = 1.2;                          // 高一點比較像在跟小孩說話
        var v = pickVoice();
        if (v) u.voice = v;
        speechSynthesis.speak(u);
      } catch (e) {}
    }, delay || 0);
  }

  if ('speechSynthesis' in window) {
    // 有些瀏覽器要等這個事件才拿得到語音清單
    speechSynthesis.addEventListener('voiceschanged', function () { zhVoice = null; pickVoice(); });
  }

  function buzz(ms) {
    if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} }
  }

  // ── 蓋章特效 ────────────────────────────────────────────

  var CONFETTI = ['#f59e0b', '#f97316', '#2563eb', '#059669', '#7c3aed', '#0d9488', '#ec4899', '#fde047'];
  var fxLayer = null;

  function fx() {
    if (!fxLayer) {
      fxLayer = el('div', 'fx-layer');
      document.body.appendChild(fxLayer);
    }
    return fxLayer;
  }

  function reduceMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function autoRemove(node, ms) {
    setTimeout(function () { node.remove(); }, ms);
  }

  /** 蓋章瞬間：擴散圓環 + 爪印與紙屑往上噴再落下。count 隨進度加大 */
  function stampBurst(anchor, color, count) {
    if (reduceMotion()) return;
    var n = count || 16;
    var box = anchor.getBoundingClientRect();
    var cx = box.left + box.width / 2;
    var cy = box.top + box.height / 2;
    var layer = fx();

    var ring = el('div', 'fx-ripple');
    ring.style.left = box.left + 'px';
    ring.style.top = box.top + 'px';
    ring.style.width = box.width + 'px';
    ring.style.height = box.height + 'px';
    ring.style.setProperty('--c', color);
    layer.appendChild(ring);
    autoRemove(ring, 700);

    for (var i = 0; i < n; i++) {
      var piece;
      if (i % 3 === 0) {
        piece = svgIcon('paw', 'fx-piece');
        piece.style.width = '19px';
        piece.style.height = '19px';
        piece.style.fill = (i % 2) ? '#fde047' : color;
      } else {
        piece = el('div', 'fx-piece');
        var w = 6 + Math.random() * 5;
        piece.style.width = w + 'px';
        piece.style.height = (w * (Math.random() > 0.5 ? 1 : 1.9)) + 'px';
        piece.style.background = pick(CONFETTI);
        piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
      }

      // 往上為主的扇形，再加重力把它們拉下來
      var angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.15;
      var dist = 55 + Math.random() * 60;
      piece.style.left = cx + 'px';
      piece.style.top = cy + 'px';
      piece.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
      piece.style.setProperty('--dy', Math.sin(angle) * dist + 'px');
      piece.style.setProperty('--fall', (75 + Math.random() * 75) + 'px');
      piece.style.setProperty('--rot', Math.round(Math.random() * 720 - 360) + 'deg');
      piece.style.setProperty('--dur', (0.8 + Math.random() * 0.45) + 's');
      layer.appendChild(piece);
      autoRemove(piece, 1350);
    }
  }

  /** 從蓋章處往上飄的「+1 🐾」 */
  function floatPoints(anchor, text, rare) {
    if (reduceMotion()) return;
    var box = anchor.getBoundingClientRect();
    var node = el('div', 'fx-float' + (rare ? ' fx-float--rare' : ''), text);
    node.style.left = (box.left + box.width / 2) + 'px';
    node.style.top = box.top + 'px';
    fx().appendChild(node);
    autoRemove(node, 1050);
  }

  // ── 汪汪隊夥伴 ──────────────────────────────────────────

  var buddyTimers = [];

  /**
   * 天天從右下角彈出來揮手、眨眼，說一句話再退場。
   * 動畫是 18 格的精靈圖，用 CSS steps() 播放，不需要影片解碼。
   * pointer-events 是 none，不會擋到任何按鈕。
   */
  function showBuddy(text, big) {
    if (reduceMotion()) return;

    var box = $('#buddy');
    var bubble = $('#buddy-bubble');

    buddyTimers.forEach(clearTimeout);
    buddyTimers = [];

    Zhuyin.fill(bubble, text);

    // 重設動畫，連續點擊時才會重新播一次而不是卡住
    box.hidden = true;
    box.classList.remove('is-leaving');
    box.classList.toggle('buddy--big', !!big);
    void box.offsetWidth;
    box.hidden = false;

    var stay = big ? 2600 : 1800;
    buddyTimers.push(setTimeout(function () { box.classList.add('is-leaving'); }, stay));
    buddyTimers.push(setTimeout(function () {
      box.hidden = true;
      box.classList.remove('is-leaving');
    }, stay + 380));
  }

  /** 全部完成時的紙屑雨 */
  function confettiRain(count) {
    if (reduceMotion()) return;
    var layer = fx();
    for (var i = 0; i < count; i++) {
      var p = el('div', 'fx-rain');
      var w = 7 + Math.random() * 7;
      p.style.width = w + 'px';
      p.style.height = (w * (Math.random() > 0.5 ? 1 : 2)) + 'px';
      p.style.background = pick(CONFETTI);
      p.style.borderRadius = Math.random() > 0.6 ? '50%' : '2px';
      p.style.left = (Math.random() * 100) + 'vw';
      p.style.setProperty('--rot', Math.round(Math.random() * 1080 - 540) + 'deg');
      p.style.setProperty('--dur', (1.9 + Math.random() * 1.6) + 's');
      p.style.animationDelay = (Math.random() * 0.9) + 's';
      layer.appendChild(p);
      autoRemove(p, 4500);
    }
  }

  // ── 頂部 ────────────────────────────────────────────────

  var lastPawCount = null;

  function renderTop() {
    var s = Store.state;
    $('#child-name').textContent = s.child.nickname || s.child.name;
    $('#today-date').textContent = fmtDate(Store.today());

    var balance = Store.totalPoints().balance;
    var numEl = $('#paw-count');
    numEl.textContent = balance;

    if (lastPawCount !== null && balance !== lastPawCount) {
      var badge = $('#paw-total');
      badge.classList.remove('is-bumped');
      void badge.offsetWidth;                   // 重新觸發動畫
      badge.classList.add('is-bumped');
    }
    lastPawCount = balance;
  }

  // ── 今天 ────────────────────────────────────────────────

  function renderToday() {
    var day = Store.today();
    var tasks = Store.tasksForDate(day);
    var key = Store.dateKey(day);
    var list = $('#task-list');

    // 我們自己寫上雲端的資料會回彈成 remote 事件觸發重繪。
    // 如果項目本身沒變，就只更新狀態不重建 DOM —— 重建會把正在播的
    // 蓋章動畫連同節點一起砍掉，小朋友只會看到閃一下。
    var existing = $$('#task-list .task');
    var sameShape = existing.length === tasks.length && tasks.every(function (t, i) {
      return existing[i].dataset.task === t.id;
    });

    if (sameShape) {
      tasks.forEach(function (t, i) {
        var done = Store.isDone(key, t.id);
        existing[i].classList.toggle('is-done', done);
        existing[i].setAttribute('aria-pressed', done ? 'true' : 'false');
      });
      renderProgress();
      markNextTask();
      renderChallengeCard();
      return;
    }

    list.textContent = '';

    tasks.forEach(function (task, idx) {
      var done = Store.isDone(key, task.id);

      var li = el('li');
      var btn = el('button', 'task' + (done ? ' is-done' : ''));
      btn.setAttribute('data-color', task.color);
      btn.setAttribute('data-task', task.id);
      btn.setAttribute('aria-pressed', done ? 'true' : 'false');
      btn.setAttribute('aria-label', (idx + 1) + '. ' + task.label + (done ? '，已完成' : '，未完成'));

      var icon = svgIcon(task.icon, 'task__icon');
      btn.appendChild(icon);

      var body = el('div', 'task__body');
      var time = el('div', 'task__time', '⏰ ' + task.from + (task.to ? ' - ' + task.to : ''));
      body.appendChild(time);
      var label = el('div', 'task__label');
      label.appendChild(labelNode(task.label));
      body.appendChild(label);
      btn.appendChild(body);

      var stamp = el('div', 'task__stamp');
      stamp.appendChild(svgIcon('paw'));
      btn.appendChild(stamp);

      btn.addEventListener('click', function () { onTaskTap(task, btn); });
      li.appendChild(btn);
      list.appendChild(li);
    });

    renderProgress();
    markNextTask();
    renderChallengeCard();
  }

  function renderProgress() {
    var stats = Store.dayStats(Store.today());

    $('#progress-done').textContent = stats.done;
    $('#progress-total').textContent = '/' + stats.total;

    var bar = $('#progress-bar');
    bar.style.strokeDashoffset = String(264 * (1 - stats.ratio));
    bar.classList.toggle('is-perfect', stats.perfect);

    Zhuyin.fill($('#progress-title'), stats.perfect ? '太棒了' : '今天的任務');

    // 稱讚語正在顯示時不要蓋掉它，等它自己退場
    var subEl = $('#progress-sub');
    if (subEl.classList.contains('is-praise')) return;

    var left = stats.total - stats.done;
    var sub;
    if (stats.perfect) sub = '今天全部完成，好厲害！';
    else if (stats.done === 0) sub = '一起出發吧，共 ' + stats.total + ' 個任務';
    else sub = '已完成 ' + stats.done + ' 個，還差 ' + left + ' 個';
    subEl.textContent = sub;
  }

  var PRAISE = ['好棒！', '太厲害了！', '做得好！', '你好棒！', '厲害喔！', '超棒的！', '很棒喔！', '完成了！'];
  var PRAISE_RARE = ['哇！超級棒！', '太強了！', '完美！'];

  // 叫名字的版本。偶爾出現就好 —— 每次都叫反而變成口頭禪，
  // 偶爾出現才會有「這是在跟我說話」的感覺。
  var PRAISE_NAMED = ['{n}好棒！', '{n}好厲害！', '{n}做得真好！', '{n}太棒了！', '{n}超厲害！'];

  /** 中文名字直接接，英文名字要留空格才不會黏在一起 */
  function withName(template, name) {
    var glue = /^[一-鿿]+$/.test(name) ? name : name + ' ';
    return template.replace('{n}', glue);
  }

  function pickPraise(rare) {
    var name = (Store.state.child.nickname || '').trim();

    if (rare) {
      if (name && Math.random() < 0.5) return withName('哇！{n}超級棒！', name);
      return pick(PRAISE_RARE);
    }
    if (name && Math.random() < 0.35) return withName(pick(PRAISE_NAMED), name);
    return pick(PRAISE);
  }

  function taskColor(btn) {
    return getComputedStyle(btn).getPropertyValue('--c').trim() || '#f59e0b';
  }

  /**
   * 點一下作息項目。
   *
   * 已完成再點「不會取消」，只會再放一次慶祝。
   * 五歲小孩會因為好玩再戳一次自己剛蓋的章，不能讓他親手把爪印刪掉。
   * 真的要取消請走家長模式的補登。
   */
  function onTaskTap(task, btn) {
    var day = Store.today();

    if (Store.isDone(Store.dateKey(day), task.id)) {
      replayCelebration(task, btn);
      return;
    }

    var wasPerfect = Store.dayStats(day).perfect;
    Store.toggle(day, task.id);

    btn.classList.add('is-done');
    btn.setAttribute('aria-pressed', 'true');

    var stats = Store.dayStats(day);
    var level = stats.total ? stats.done / stats.total : 0;
    var rare = Math.random() < 0.33;             // 約每三次一次的驚喜，避免變成壁紙

    btn.classList.add('is-stamping');
    setTimeout(function () { btn.classList.remove('is-stamping'); }, 700);

    var stamp = $('.task__stamp', btn);
    var color = taskColor(btn);

    // 越接近全破，粒子越多、噴得越開
    stampBurst(stamp, color, Math.round(12 + level * 14) * (rare ? 2 : 1));
    floatPoints(stamp, (rare ? '✨ ' : '') + '+' + Store.state.settings.pointsPerTask + ' 🐾' + (rare ? ' ✨' : ''), rare);

    play(rare ? 'rare' : 'done', level);
    buzz(rare ? [20, 40, 20] : 18);

    renderProgress();
    renderTop();
    markNextTask();

    var nowPerfect = Store.dayStats(day).perfect;
    var oneLeft = !nowPerfect && stats.total - stats.done === 1;

    // 只念稱讚，不念項目名稱 —— 大人本來就在旁邊，他知道自己剛做完什麼，
    // 念一長串名稱反而拖慢那一刻的節奏
    if (nowPerfect) {
      // 一天只有一次，這句一定叫名字
      var name = (Store.state.child.nickname || '').trim();
      var done = name ? withName('全部完成！{n}今天好棒！', name) : '全部完成！今天好棒！';
      flashPraise(done);
      speak(done, 400);
      // 全破的狗狗留給慶祝畫面演，這裡不搶戲
    } else if (oneLeft) {
      flashPraise('只剩最後一個囉！');
      setTimeout(function () { play('almost', 1); }, 520);
      speak('只剩最後一個囉！', 440);
      showBuddy('只剩最後一個囉！');
    } else {
      var praise = pickPraise(rare);
      flashPraise(praise);
      speak(praise, 400);
      showBuddy(praise, rare);
    }

    if (!wasPerfect && nowPerfect) setTimeout(showCelebrate, 380);
  }

  /** 已完成的項目再點：重播慶祝，不動資料 */
  function replayCelebration(task, btn) {
    btn.classList.add('is-stamping');
    setTimeout(function () { btn.classList.remove('is-stamping'); }, 700);
    stampBurst($('.task__stamp', btn), taskColor(btn), 10);
    play('replay');
    buzz(12);
    speak('已經完成', 260);
  }

  var praiseTimer;

  /** 稱讚語短暫蓋在進度說明上，1.8 秒後恢復 */
  function flashPraise(text) {
    var sub = $('#progress-sub');
    sub.textContent = text;
    sub.classList.add('is-praise');
    clearTimeout(praiseTimer);
    praiseTimer = setTimeout(function () {
      sub.classList.remove('is-praise');
      renderProgress();
    }, 1800);
  }

  /** 只剩一項時讓那張卡輕輕發光，告訴他下一個要做什麼 */
  function markNextTask() {
    var pending = $$('#task-list .task:not(.is-done)');
    $$('#task-list .task').forEach(function (b) { b.classList.remove('task--last'); });
    if (pending.length === 1) pending[0].classList.add('task--last');
  }

  function showCelebrate() {
    $('#celebrate-bonus').textContent = Store.state.settings.perfectBonus;
    $('#celebrate').hidden = false;
    confettiRain(70);
    play('perfect');
    buzz([30, 60, 30, 60, 120]);
  }

  // ── 特別獎勵 ────────────────────────────────────────────
  // 這份清單目前寫死。之後若要讓家長自訂，搬進 Store 讓它跟著同步即可。

  var REWARDS = [
    { icon: 'rubble',   label: '自己收玩具', points: 3, color: 'amber'   },
    { icon: 'chase',    label: '幫忙做家事', points: 3, color: 'orange'  },
    { icon: 'skye',     label: '有禮貌',     points: 2, color: 'purple'  },
    { icon: 'marshall', label: '勇敢嘗試',   points: 3, color: 'emerald' },
    { icon: 'moon',     label: '主動看書',   points: 3, color: 'blue'    },
    { icon: 'meal',     label: '自己吃飯',   points: 2, color: 'teal'    },
    { icon: 'house',    label: '願意分享',   points: 2, color: 'indigo'  },
    { icon: 'paw',      label: '特別棒',     points: 5, color: 'night'   }
  ];

  var pendingReward = null;

  function renderReward() {
    var list = $('#reward-list');
    list.textContent = '';

    REWARDS.forEach(function (r) {
      var li = el('li');
      var btn = el('button', 'reward');
      btn.setAttribute('data-color', r.color);
      btn.setAttribute('aria-label', r.label + '，' + r.points + ' 個爪印');

      btn.appendChild(svgIcon(r.icon, 'reward__icon'));

      var label = el('div', 'reward__label');
      label.appendChild(Zhuyin.render(r.label));
      btn.appendChild(label);

      var pts = el('span', 'reward__points');
      pts.appendChild(svgIcon('paw'));
      pts.appendChild(el('span', null, '+' + r.points));
      btn.appendChild(pts);

      btn.addEventListener('click', function () { askGive(r); });
      li.appendChild(btn);
      list.appendChild(li);
    });

    renderRewardLog();
  }

  function renderRewardLog() {
    var box = $('#reward-log');
    box.textContent = '';
    var items = Store.recentBonuses(12);

    if (!items.length) {
      box.appendChild(el('li', 'reward-log__empty', '還沒有給過特別獎勵'));
      return;
    }

    items.forEach(function (b) {
      var li = el('li', 'reward-log__item');
      li.appendChild(el('span', 'reward-log__when', b.date.slice(5).replace('-', '/')));
      li.appendChild(el('span', 'reward-log__why', b.reason));
      li.appendChild(el('span', 'reward-log__pts', '+' + b.points + ' 🐾'));

      var del = el('button', 'reward-log__del', '✕');
      del.title = '收回這個獎勵';
      del.addEventListener('click', function () {
        if (!confirm('收回「' + b.reason + '」的 ' + b.points + ' 個爪印？')) return;
        Store.removeBonus(b.id);
        renderRewardLog();
        renderTop();
        toast('已收回');
      });
      li.appendChild(del);
      box.appendChild(li);
    });
  }

  /** 選了理由之後先確認，避免小朋友自己一直按 */
  function askGive(reward) {
    pendingReward = reward;
    $('#give-icon').textContent = '🎁';
    $('#give-reason').value = reward.label;
    $('#give-points').value = reward.points;
    $('#give').hidden = false;
  }

  function confirmGive() {
    var reason = $('#give-reason').value.trim() || (pendingReward && pendingReward.label) || '特別棒';
    var points = Number($('#give-points').value) || 1;

    Store.addBonus(reason, points);
    $('#give').hidden = true;
    pendingReward = null;

    renderRewardLog();
    renderTop();

    // 給獎的動靜要比一般打卡大，這是「特別」的
    confettiRain(45);
    play('perfect');
    buzz([30, 60, 30, 60, 120]);

    var name = (Store.state.child.nickname || '').trim();
    var praise = name ? withName('{n}好棒！' + reason + '，加 ' + points + ' 個爪印！', name)
                      : (reason + '，加 ' + points + ' 個爪印！');
    toast('🎁 ' + reason + '　+' + points + ' 🐾');
    speak(praise, 300);
    showBuddy(reason.length > 6 ? '好棒！' : reason + '，好棒！', true);
  }

  // ── 數學挑戰 ────────────────────────────────────────────

  var quizState = null;      // { set, i, correct, practice, level }

  function renderChallengeCard() {
    var today = Store.quizToday();
    var lv = Quiz.levelInfo(Store.state.settings.quizLevel || 1);
    var card = $('#challenge-card');
    card.classList.toggle('is-done', !!today);
    $('#challenge-sub').textContent = today
      ? ('今天答對 ' + today.correct + '/' + today.total + '　可以再練習')
      : ('第 ' + lv.n + ' 關・' + lv.name + '　十題');
  }

  function openQuiz() {
    var lv = Quiz.levelInfo(Store.state.settings.quizLevel || 1);
    var today = Store.quizToday();
    var streak = Store.state.settings.quizStreak || 0;

    $('#quiz-level').textContent = '第 ' + lv.n + ' 關';
    $('#quiz-start-meta').textContent = lv.name + '（例：' + lv.desc + '）　共 ' + Quiz.TOTAL + ' 題';
    $('#quiz-streak').textContent = today
      ? '今天已經挑戰過了，答對 ' + today.correct + '/' + today.total
      : '連續全對 ' + streak + ' / ' + Store.LEVEL_UP_STREAK + '　全對五次就升關';
    $('#quiz-play').textContent = today ? '再玩一次（沒有獎勵）' : '開始挑戰';

    showQuizPanel('start');
    renderQuizDots(-1);
    $('#quiz').hidden = false;
  }

  function closeQuiz() {
    $('#quiz').hidden = true;
    quizState = null;
    renderChallengeCard();
    renderTop();
  }

  function showQuizPanel(which) {
    $('#quiz-start').hidden = which !== 'start';
    $('#quiz-play-panel').hidden = which !== 'play';
    $('#quiz-done').hidden = which !== 'done';
  }

  // 名字不能叫 renderDots：家長 PIN 鍵盤已經有一個同名函式，
  // 而它在檔案裡的位置比較後面，會把這個蓋掉。
  function renderQuizDots(current) {
    var box = $('#quiz-dots');
    box.textContent = '';
    for (var i = 0; i < Quiz.TOTAL; i++) {
      var d = el('i');
      if (quizState && quizState.marks && quizState.marks[i] === true) d.className = 'is-right';
      else if (quizState && quizState.marks && quizState.marks[i] === false) d.className = 'is-wrong';
      else if (i === current) d.className = 'is-now';
      box.appendChild(d);
    }
  }

  function startQuiz(practice) {
    var level = Store.state.settings.quizLevel || 1;
    quizState = {
      set: Quiz.makeSet(level),
      i: 0, correct: 0, level: level,
      practice: practice || !!Store.quizToday(),   // 今天挑戰過了就只能練習
      marks: []
    };
    showQuizPanel('play');
    showQuestion();
  }

  function showQuestion() {
    var q = quizState.set[quizState.i];
    $('#quiz-question').textContent = q.a + ' ' + q.op + ' ' + q.b + ' = ?';
    $('#quiz-mark').textContent = '';
    $('#quiz-mark').className = 'quiz__mark';
    renderQuizDots(quizState.i);

    // 第一關給爪印圖示當數數的鷹架，五歲還沒辦法純抽象心算
    var aid = $('#quiz-aid');
    aid.textContent = '';
    if (quizState.level === 1) {
      [q.a, q.b].forEach(function (n, idx) {
        if (idx) aid.appendChild(el('span', null, q.op));
        var g = el('span', 'quiz__aid-group');
        for (var k = 0; k < n; k++) g.appendChild(svgIcon('paw'));
        aid.appendChild(g);
      });
    }

    var box = $('#quiz-options');
    box.textContent = '';
    q.options.forEach(function (opt) {
      var b = el('button', 'quiz__opt', String(opt));
      b.addEventListener('click', function () { answer(opt, b); });
      box.appendChild(b);
    });
  }

  function answer(choice, btn) {
    var q = quizState.set[quizState.i];
    var right = choice === q.answer;

    $$('#quiz-options .quiz__opt').forEach(function (b) { b.disabled = true; });
    btn.classList.add(right ? 'is-right' : 'is-wrong');

    var mark = $('#quiz-mark');
    if (right) {
      quizState.correct++;
      quizState.marks[quizState.i] = true;
      mark.textContent = '答對了！';
      mark.className = 'quiz__mark is-right';
      play('done', quizState.correct / Quiz.TOTAL);
      buzz(15);
    } else {
      quizState.marks[quizState.i] = false;
      // 不用紅叉叉，直接把正確答案講出來，語氣保持往前
      mark.textContent = '答案是 ' + q.answer + '，下次一定可以！';
      mark.className = 'quiz__mark is-wrong';
      $$('#quiz-options .quiz__opt').forEach(function (b) {
        if (b.textContent === String(q.answer)) b.classList.add('is-right');
      });
      play('undo');
    }
    renderQuizDots(-1);

    setTimeout(function () {
      quizState.i++;
      if (quizState.i >= Quiz.TOTAL) finishQuiz();
      else showQuestion();
    }, right ? 850 : 1900);
  }

  function finishQuiz() {
    var correct = quizState.correct;
    var perfect = correct >= Quiz.TOTAL;
    var practice = quizState.practice;
    var points = practice ? 0 : Quiz.score(correct);
    var outcome = null;

    if (!practice) outcome = Store.addQuizResult(quizState.level, correct, Quiz.TOTAL, points);

    $('#quiz-done-title').textContent = '';
    Zhuyin.fill($('#quiz-done-title'), perfect ? '全部答對' : (correct >= 6 ? '很棒喔' : '有挑戰就很棒'));
    $('#quiz-score').textContent = correct + ' / ' + Quiz.TOTAL;
    $('#quiz-reward').textContent = practice ? '練習模式，不計獎勵' : '+' + points + ' 🐾';

    var up = $('#quiz-levelup');
    if (outcome && outcome.levelledUp) {
      up.textContent = '🎉 升到第 ' + outcome.level + ' 關：' + Quiz.levelInfo(outcome.level).name;
      up.hidden = false;
    } else if (!practice && perfect) {
      up.textContent = '連續全對 ' + outcome.streak + ' / ' + Store.LEVEL_UP_STREAK;
      up.hidden = false;
    } else {
      up.hidden = true;
    }

    showQuizPanel('done');
    renderQuizDots(-1);
    renderTop();

    if (perfect && !practice) { confettiRain(50); play('perfect'); buzz([30,60,30,60,120]); }
    else if (!practice) { play('done', 1); }
  }

  // ── 本週 ────────────────────────────────────────────────

  function renderWeek() {
    var start = Store.startOfWeek(weekAnchor);
    var days = [];
    for (var i = 0; i < 7; i++) days.push(Store.addDays(start, i));
    var last = days[6];
    var today = Store.today();

    $('#week-label').textContent =
      (start.getMonth() + 1) + '/' + start.getDate() + ' – ' + (last.getMonth() + 1) + '/' + last.getDate();
    $('#week-next').disabled = Store.startOfWeek(today).getTime() <= start.getTime();

    var table = $('#week-grid');
    table.textContent = '';

    var head = el('tr');
    head.appendChild(el('th', 'week__row-head'));
    days.forEach(function (d) {
      var th = el('th', sameDay(d, today) ? 'is-today' : null, DOW[d.getDay()]);
      head.appendChild(th);
    });
    table.appendChild(head);

    Store.state.tasks.forEach(function (task) {
      var tr = el('tr');
      tr.setAttribute('data-color', task.color);

      var th = el('th', 'week__row-head');
      var wrap = el('div', 'week__task');
      wrap.appendChild(svgIcon(task.icon));
      wrap.appendChild(el('span', 'week__task-name', task.label.replace(/\//g, '・')));
      th.appendChild(wrap);
      tr.appendChild(th);

      days.forEach(function (d) {
        var td = el('td', 'week__cell' + (sameDay(d, today) ? ' is-today' : ''));
        if (task.days.indexOf(d.getDay()) === -1) {
          td.setAttribute('data-state', 'na');
          td.title = '這天沒有這個任務';
        } else if (Store.isDone(Store.dateKey(d), task.id)) {
          td.setAttribute('data-state', 'done');
          td.appendChild(svgIcon('paw'));
        }
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });

    var paws = 0, perfect = 0;
    days.forEach(function (d) {
      var s = Store.dayStats(d);
      paws += s.done;
      if (s.perfect) perfect++;
    });
    $('#week-note').textContent = '本週集到 ' + paws + ' 個爪印 🐾　全部完成 ' + perfect + ' 天';
  }

  // ── 紀錄 ────────────────────────────────────────────────

  function renderStats() {
    var pts = Store.totalPoints();
    $('#stat-paw').textContent = pts.balance;
    $('#stat-streak').textContent = Store.streak();
    $('#stat-days').textContent = Store.activeDays();
    renderCalendar();
  }

  function levelOf(ratio, hasAny) {
    if (!hasAny) return 0;
    if (ratio >= 1) return 4;
    if (ratio >= 0.75) return 3;
    if (ratio >= 0.4) return 2;
    return 1;
  }

  function renderCalendar() {
    var year = calAnchor.getFullYear();
    var month = calAnchor.getMonth();
    var today = Store.today();

    $('#cal-label').textContent = year + '年' + (month + 1) + '月';
    $('#cal-next').disabled =
      year > today.getFullYear() || (year === today.getFullYear() && month >= today.getMonth());

    var grid = $('#calendar');
    grid.textContent = '';

    ['一', '二', '三', '四', '五', '六', '日'].forEach(function (d) {
      grid.appendChild(el('div', 'calendar__dow', d));
    });

    var first = new Date(year, month, 1);
    var lead = (first.getDay() + 6) % 7;              // 週一為第一欄
    for (var i = 0; i < lead; i++) grid.appendChild(el('div', 'calendar__day calendar__day--empty'));

    var daysInMonth = new Date(year, month + 1, 0).getDate();
    for (var d = 1; d <= daysInMonth; d++) {
      var date = new Date(year, month, d);
      var stats = Store.dayStats(date);
      var cell = el('div', 'calendar__day' + (sameDay(date, today) ? ' is-today' : ''), String(d));
      cell.setAttribute('data-level', String(levelOf(stats.ratio, stats.done > 0)));
      cell.title = Store.dateKey(date) + '　完成 ' + stats.done + '/' + stats.total;
      grid.appendChild(cell);
    }
  }

  // ── 家長：PIN ───────────────────────────────────────────

  /**
   * 進入家長分頁。
   *
   * 沒設密碼就直接進去 —— 小孩是被大人遞過手機點一下，不會自己翻分頁，
   * 每次補登都要輸入密碼只是在擋家長自己。需要鎖的人再自己去設。
   */
  function enterParent() {
    if (!Store.state.settings.pin) { unlockParent(); return; }
    if (parentUnlocked) { renderParent(); return; }
    resetGate('verify');
  }

  function resetGate(stage) {
    pinBuffer = '';
    pinFirstEntry = '';
    pinStage = stage || (Store.state.settings.pin ? 'verify' : 'create');
    $('#pin-gate').hidden = false;
    $('#parent-panel').hidden = true;
    $('#gate-cancel').hidden = pinStage === 'verify';   // 設定中途才給取消
    renderGate();
  }

  function renderGate() {
    var titles = { verify: '請輸入家長密碼', create: '設定家長密碼', confirm: '再輸入一次確認' };
    var hints = {
      verify: '四位數字',
      create: '第一次使用，請設定四位數字',
      confirm: '確認剛剛設定的密碼'
    };
    $('#gate-title').textContent = titles[pinStage];
    var hint = $('#gate-hint');
    hint.textContent = hints[pinStage];
    hint.classList.remove('is-error');
    renderDots();
  }

  function renderDots() {
    $$('#gate-dots i').forEach(function (dot, i) {
      dot.classList.toggle('is-filled', i < pinBuffer.length);
    });
  }

  function gateError(msg) {
    var hint = $('#gate-hint');
    hint.textContent = msg;
    hint.classList.add('is-error');
    $('#pin-gate').classList.add('is-shaking');
    setTimeout(function () { $('#pin-gate').classList.remove('is-shaking'); }, 420);
    pinBuffer = '';
    renderDots();
    buzz([40, 40, 40]);
  }

  function pinPress(key) {
    if (key === 'del') {
      pinBuffer = pinBuffer.slice(0, -1);
      renderDots();
      return;
    }
    if (pinBuffer.length >= 4) return;
    pinBuffer += key;
    renderDots();
    if (pinBuffer.length === 4) setTimeout(pinSubmit, 140);
  }

  function pinSubmit() {
    if (pinStage === 'verify') {
      if (pinBuffer === Store.state.settings.pin) unlockParent();
      else gateError('密碼不對，再試一次');
    } else if (pinStage === 'create') {
      pinFirstEntry = pinBuffer;
      pinBuffer = '';
      pinStage = 'confirm';
      renderGate();
    } else {
      if (pinBuffer === pinFirstEntry) {
        Store.updateSettings({ pin: pinFirstEntry });
        toast('密碼設定完成，之後進家長分頁要輸入');
        unlockParent();
      } else {
        pinStage = 'create';
        pinFirstEntry = '';
        gateError('兩次不一樣，請重新設定');
      }
    }
  }

  function unlockParent() {
    parentUnlocked = true;
    pinBuffer = '';
    $('#pin-gate').hidden = true;
    $('#parent-panel').hidden = false;
    renderParent();
  }

  function lockParent() {
    parentUnlocked = false;
    if (!Store.state.settings.pin) return;    // 沒設密碼就沒有鎖這回事
    resetGate('verify');
  }

  function buildKeypad() {
    var pad = $('#keypad');
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].forEach(function (k) {
      var b = el('button', k === '' ? 'is-blank' : null, k);
      if (k === '') { b.disabled = true; }
      else b.addEventListener('click', function () { pinPress(k === '⌫' ? 'del' : k); });
      pad.appendChild(b);
    });
  }

  // ── 家長：面板 ──────────────────────────────────────────

  function renderParent() {
    if (!parentUnlocked) return;
    var s = Store.state;
    $('#cfg-per').value = s.settings.pointsPerTask;
    $('#cfg-bonus').value = s.settings.perfectBonus;
    $('#cfg-nick').value = s.child.nickname || '';
    $('#cfg-sound').checked = s.settings.sound !== false;
    $('#cfg-speech').checked = !!s.settings.speech;

    var sel = $('#cfg-level');
    if (!sel.options.length) {
      Quiz.LEVELS.forEach(function (lv) {
        sel.appendChild(new Option('第 ' + lv.n + ' 關　' + lv.name, lv.n));
      });
    }
    sel.value = String(s.settings.quizLevel || 1);
    $('#cfg-level-hint').textContent =
      '連續全對 ' + Store.LEVEL_UP_STREAK + ' 次會自動升關（目前 ' +
      (s.settings.quizStreak || 0) + ' 次）。手動改難度會把連勝歸零。';
    if (!$('#backfill-date').value) $('#backfill-date').value = Store.dateKey(Store.today());

    var hasPin = !!s.settings.pin;
    $('#pin-set').textContent = hasPin ? '變更密碼' : '設定家長密碼';
    $('#pin-remove').hidden = !hasPin;
    $('#pin-hint').textContent = hasPin
      ? '已設定密碼，進入這個分頁需要輸入。切換到其他分頁會自動上鎖。'
      : '目前沒有設密碼，家長分頁可以直接進入。小朋友是被大人遞手機點一下，通常不需要鎖；擔心他亂按就設一組。';

    readVersion();
    renderBackfill();
    renderTaskEditor();
  }

  function renderBackfill() {
    var val = $('#backfill-date').value;
    var list = $('#backfill-list');
    list.textContent = '';
    if (!val) return;

    var date = Store.parseKey(val);
    var key = Store.dateKey(date);

    Store.state.tasks.forEach(function (task) {
      var applicable = task.days.indexOf(date.getDay()) !== -1;
      var done = Store.isDone(key, task.id);

      var li = el('li', 'backfill__item' + (done ? ' is-done' : ''));
      li.setAttribute('data-color', task.color);

      var cb = el('input');
      cb.type = 'checkbox';
      cb.checked = done;
      cb.addEventListener('change', function () {
        Store.toggle(date, task.id);
        li.classList.toggle('is-done', cb.checked);
        renderTop();
        if (sameDay(date, Store.today())) renderToday();
      });

      li.appendChild(cb);
      li.appendChild(svgIcon(task.icon));
      li.appendChild(el('span', null, task.label.replace(/\//g, '・')));
      if (!applicable) li.appendChild(el('span', 'backfill__na', '這天原本沒有'));
      list.appendChild(li);
    });
  }

  function renderTaskEditor() {
    var list = $('#task-editor');
    list.textContent = '';
    Store.state.tasks.forEach(function (task) {
      list.appendChild(taskEditorRow(task));
    });
  }

  function taskEditorRow(task) {
    var li = el('li', 'editor__item');
    li.setAttribute('data-task', task.id);
    li.setAttribute('data-color', task.color);

    var icon = svgIcon(task.icon);
    icon.style.gridRow = '1 / span 3';
    li.appendChild(icon);

    var times = el('div', 'editor__times');
    var from = el('input', 'field');
    from.type = 'time'; from.value = task.from; from.dataset.field = 'from';
    var to = el('input', 'field');
    to.type = 'time'; to.value = task.to || ''; to.dataset.field = 'to';
    times.appendChild(from);
    times.appendChild(to);
    li.appendChild(times);

    var name = el('input', 'field editor__name');
    name.type = 'text'; name.value = task.label; name.dataset.field = 'label';
    name.maxLength = 24;
    li.appendChild(name);

    var wd = el('div', 'editor__weekday');
    [1, 2, 3, 4, 5, 6, 0].forEach(function (d) {
      var lab = el('label');
      var cb = el('input');
      cb.type = 'checkbox';
      cb.checked = task.days.indexOf(d) !== -1;
      cb.dataset.day = String(d);
      lab.appendChild(cb);
      lab.appendChild(el('span', null, DOW[d]));
      wd.appendChild(lab);
    });
    li.appendChild(wd);

    var del = el('button', 'editor__del', '✕');
    del.title = '刪除這個項目';
    del.addEventListener('click', function () {
      if (confirm('刪除「' + task.label + '」？\n已經蓋過的爪印會保留。')) li.remove();
    });
    li.appendChild(del);

    return li;
  }

  function collectTasks() {
    return $$('#task-editor .editor__item').map(function (li, idx) {
      var days = $$('.editor__weekday input', li)
        .filter(function (cb) { return cb.checked; })
        .map(function (cb) { return Number(cb.dataset.day); });

      var existing = Store.state.tasks.filter(function (t) { return t.id === li.dataset.task; })[0];

      return {
        id: li.dataset.task,
        from: $('[data-field="from"]', li).value || '00:00',
        to: $('[data-field="to"]', li).value || '',
        label: $('[data-field="label"]', li).value.trim() || '任務',
        color: (existing && existing.color) || COLORS[idx % COLORS.length],
        icon: (existing && existing.icon) || ICONS[idx % ICONS.length],
        days: days.length ? days : Store.EVERY_DAY
      };
    });
  }

  // ── 同步 UI ─────────────────────────────────────────────

  var SYNC_TEXT = {
    connecting: '連線中…',
    online: '已同步，其他裝置的改動會即時出現',
    offline: '離線中，改動先存在這台，連上網路會自動補傳',
    off: '同步已關閉，資料只存在這台裝置',
    error: '同步暫停'
  };

  function wireSync() {
    var dot = $('#sync-dot');
    var stateBox = $('#sync-state');
    var codeBox = $('#sync-code');

    if (!window.Sync || !window.Sync.enabled) {
      dot.setAttribute('data-state', 'off');
      stateBox.textContent = SYNC_TEXT.off;
      codeBox.textContent = '—';
      ['#sync-copy', '#sync-join', '#sync-unpair'].forEach(function (s) { $(s).disabled = true; });
      return;
    }

    codeBox.textContent = Sync.code;
    renderPrevCode();

    $('#sync-share').addEventListener('click', function () {
      shareOrCopy(Sync.shareUrl(true), '點開就能看到 Oaklay 的作息表');
    });
    $('#sync-share-blank').addEventListener('click', function () {
      shareOrCopy(Sync.shareUrl(false), '小朋友的作息表 App，點開就有一份全新的');
    });

    Sync.onStatus(function (status, detail) {
      dot.setAttribute('data-state', status);
      stateBox.textContent = status === 'error' ? (SYNC_TEXT.error + '：' + detail) : SYNC_TEXT[status];
      stateBox.classList.toggle('is-error', status === 'error');
      stateBox.classList.toggle('is-online', status === 'online');
      codeBox.textContent = Sync.code;
    });

    $('#sync-copy').addEventListener('click', function () {
      var code = Sync.code;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(
          function () { toast('配對碼已複製'); },
          function () { toast('複製失敗，請長按上面的碼手動複製'); }
        );
      } else {
        toast('請長按上面的碼手動複製');
      }
    });

    // 手動輸入配對碼＝配對「自己的另一台裝置」，所以走合併，兩邊的爪印都留著
    $('#sync-join').addEventListener('click', function () {
      var code = $('#sync-input').value.trim();
      if (!code) { toast('請先輸入配對碼'); return; }
      if (!confirm('要加入這組配對碼嗎？\n\n兩邊的紀錄會合併（不會有人的爪印不見），\n但作息項目與設定會改成對方那一份。')) return;

      $('#sync-join').disabled = true;
      Sync.join(code, { mergeLocal: true }).then(function (joined) {
        $('#sync-input').value = '';
        lastPawCount = null;
        renderAll();
        renderParent();
        toast('已加入 ' + Sync.formatCode(joined));
      }).catch(function (e) {
        alert('加入失敗：' + (e.message || e));
      }).then(function () {
        $('#sync-join').disabled = false;
      });
    });

    $('#sync-unpair').addEventListener('click', function () {
      if (!confirm('脫離目前的同步群組？\n\n這台裝置的紀錄會保留，但之後不再跟其他裝置互通，\n並且會產生一組新的配對碼。')) return;
      Sync.unpair();
      $('#sync-code').textContent = Sync.code;
      toast('已脫離，新的配對碼是 ' + Sync.code);
    });
  }

  function renderPrevCode() {
    var box = $('#sync-prev');
    var prev = window.Sync && Sync.previousCode;
    if (!prev) { box.hidden = true; return; }
    box.hidden = false;
    box.textContent = '上一組配對碼是 ' + prev + '　—— 如果不小心加錯了，把它貼回上面就能回去。';
  }

  /** 手機上優先叫系統分享（可以直接丟 LINE），沒有就退回複製 */
  function shareOrCopy(url, label) {
    if (navigator.share) {
      navigator.share({ title: 'Oaklay 汪汪好習慣救援隊', text: label, url: url })
        .catch(function () {});                 // 使用者按取消不算錯誤
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        function () { toast('連結已複製'); },
        function () { window.prompt('複製這個連結：', url); }
      );
      return;
    }
    window.prompt('複製這個連結：', url);
  }

  // ── 收到邀請連結 ────────────────────────────────────────

  var pendingInvite = null;

  function askInvite(code) {
    pendingInvite = code;

    var days = Store.activeDays();
    var paws = Store.totalPoints().balance;

    $('#invite-code').textContent = Sync.formatCode(code);
    $('#invite-merge').checked = false;

    if (days > 0) {
      // 這台已經在用了，預設不把自己的紀錄推過去，免得污染對方的資料
      $('#invite-text').textContent =
        '加入之後，這台會顯示對方的作息表與紀錄，兩邊即時同步。' +
        '這台目前有 ' + days + ' 天紀錄、' + paws + ' 個爪印，預設不會併過去 —— ' +
        '原本那份還留在雲端，等一下畫面上會顯示舊的配對碼，隨時可以回去。';
      $('#invite-merge-row').hidden = false;
    } else {
      $('#invite-text').textContent = '加入之後，這台就會顯示對方的作息表與紀錄，兩邊即時同步。';
      $('#invite-merge-row').hidden = true;
    }
    $('#invite').hidden = false;
  }

  function acceptInvite() {
    if (!pendingInvite) { $('#invite').hidden = true; return; }
    var btn = $('#invite-ok');
    btn.disabled = true;
    btn.textContent = '加入中…';

    Sync.join(pendingInvite, { mergeLocal: $('#invite-merge').checked }).then(function (code) {
      lastPawCount = null;
      renderAll();
      renderPrevCode();
      toast('已加入 ' + Sync.formatCode(code));
    }).catch(function (e) {
      alert('加入失敗：' + (e.message || e));
    }).then(function () {
      $('#invite').hidden = true;
      btn.disabled = false;
      btn.textContent = '加入';
      pendingInvite = null;
    });
  }

  // 一次快照可能連續塞進好幾天的紀錄，等它停下來再一次重畫
  var remoteRenderTimer;
  function onRemoteChange() {
    clearTimeout(remoteRenderTimer);
    remoteRenderTimer = setTimeout(function () {
      lastPawCount = null;
      renderAll();
      if (parentUnlocked) renderParent();
    }, 60);
  }

  // ── 分頁切換 ────────────────────────────────────────────

  function switchView(next) {
    if (view === 'parent' && next !== 'parent' && parentUnlocked) lockParent();

    view = next;
    $$('.view').forEach(function (v) { v.classList.toggle('view--active', v.id === 'view-' + next); });
    $$('.tab').forEach(function (t) { t.classList.toggle('tab--active', t.dataset.view === next); });
    window.scrollTo(0, 0);

    if (next === 'today') renderToday();
    if (next === 'reward') renderReward();
    if (next === 'week') { weekAnchor = Store.today(); renderWeek(); }
    if (next === 'stats') { calAnchor = Store.today(); renderStats(); }
    if (next === 'parent') enterParent();
  }

  // ── 備份 ────────────────────────────────────────────────

  function exportBackup() {
    var name = 'oakley-作息紀錄-' + Store.dateKey(Store.today()) + '.json';
    var blob = new Blob([Store.exportJSON()], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = el('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('已匯出 ' + name);
  }

  function importBackup(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        Store.importJSON(String(reader.result));
        lastPawCount = null;
        renderAll();
        renderParent();
        toast('備份已還原');
      } catch (e) {
        alert('讀不到這個備份檔：' + e.message);
      }
    };
    reader.readAsText(file);
  }

  // ── 事件綁定 ────────────────────────────────────────────

  function wire() {
    $$('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () { switchView(tab.dataset.view); });
    });

    $('#week-prev').addEventListener('click', function () {
      weekAnchor = Store.addDays(weekAnchor, -7); renderWeek();
    });
    $('#week-next').addEventListener('click', function () {
      weekAnchor = Store.addDays(weekAnchor, 7); renderWeek();
    });

    $('#cal-prev').addEventListener('click', function () {
      calAnchor = new Date(calAnchor.getFullYear(), calAnchor.getMonth() - 1, 1); renderCalendar();
    });
    $('#cal-next').addEventListener('click', function () {
      calAnchor = new Date(calAnchor.getFullYear(), calAnchor.getMonth() + 1, 1); renderCalendar();
    });

    $('#celebrate-close').addEventListener('click', function () { $('#celebrate').hidden = true; });
    $('#celebrate').addEventListener('click', function (e) {
      if (e.target === $('#celebrate')) $('#celebrate').hidden = true;
    });

    $('#backfill-date').addEventListener('change', renderBackfill);

    $('#task-add').addEventListener('click', function () {
      var idx = $$('#task-editor .editor__item').length;
      $('#task-editor').appendChild(taskEditorRow({
        // 加隨機字尾，避免同一毫秒連按兩次新增產生撞號的 id
        id: 'task-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
        from: '12:00', to: '', label: '新任務',
        color: COLORS[idx % COLORS.length],
        icon: ICONS[idx % ICONS.length],
        days: Store.EVERY_DAY
      }));
    });

    $('#task-save').addEventListener('click', function () {
      var tasks = collectTasks();
      if (!tasks.length) { alert('至少要留一個項目'); return; }
      Store.saveTasks(tasks);
      renderAll();
      renderParent();
      toast('作息項目已更新');
    });

    $('#cfg-save').addEventListener('click', function () {
      var lv = Number($('#cfg-level').value) || 1;
      // 手動改難度就把連勝歸零，不然換關之後那個數字沒有意義
      if (lv !== Store.state.settings.quizLevel) {
        Store.updateSettings({ quizLevel: lv, quizStreak: 0 });
      }
      Store.updateSettings({
        pointsPerTask: Math.max(1, Number($('#cfg-per').value) || 1),
        perfectBonus: Math.max(0, Number($('#cfg-bonus').value) || 0),
        sound: $('#cfg-sound').checked,
        speech: $('#cfg-speech').checked
      });
      Store.updateChild({ nickname: $('#cfg-nick').value.trim() || 'Oaklay' });
      renderAll();
      renderParent();
      toast('設定已儲存');
    });

    // 診斷用：直接播一次並回報 AudioContext 狀態。
    // 「running 卻聽不到」= 裝置端問題（iPhone 靜音鍵、媒體音量），
    // 「suspended」= 瀏覽器的自動播放限制沒解開。
    $('#sound-test').addEventListener('click', function () {
      // 看的是已儲存的設定，因為 play() 也是看它。只打勾沒按儲存不算數。
      if (!Store.state.settings.sound) { toast('音效目前關閉中，請打勾並按儲存'); return; }
      unlockAudio();
      play('done', 0.5);
      speak('好棒喔！', 400);
      setTimeout(function () {
        if (!audioCtx) { toast('這個裝置不支援 Web Audio'); return; }
        var voice = pickVoice();
        toast('已播放　狀態：' + audioCtx.state +
              '　語音：' + (!Store.state.settings.speech ? '關閉' : (voice ? voice.name : '找不到中文語音')));
      }, 150);
    });

    $('#backup-export').addEventListener('click', exportBackup);
    $('#backup-import').addEventListener('click', function () { $('#backup-file').click(); });
    $('#backup-file').addEventListener('change', function (e) {
      if (e.target.files[0]) importBackup(e.target.files[0]);
      e.target.value = '';
    });

    $('#pin-set').addEventListener('click', function () { resetGate('create'); });

    $('#pin-remove').addEventListener('click', function () {
      if (!confirm('移除家長密碼？\n\n之後任何人都能直接進入家長分頁。')) return;
      Store.updateSettings({ pin: null });
      renderParent();
      toast('已移除密碼');
    });

    $('#gate-cancel').addEventListener('click', function () {
      // 設定密碼設到一半反悔：有舊密碼就回鎖定，沒有就直接回面板
      if (Store.state.settings.pin) resetGate('verify');
      else unlockParent();
    });

    $('#data-reset').addEventListener('click', function () {
      if (!confirm('這會刪掉所有打卡紀錄和累積的爪印，而且無法復原。\n確定要清除嗎？')) return;
      if (!confirm('真的確定？建議先匯出一份備份。')) return;
      Store.resetAll();
      lastPawCount = null;
      renderAll();
      lockParent();
      toast('已清除所有資料');
    });

    $('#parent-lock').addEventListener('click', function () { lockParent(); });

    wireSync();

    $('#update-apply').addEventListener('click', applyUpdate);
    $('#update-check').addEventListener('click', checkForUpdate);
    $('#update-force').addEventListener('click', forceReload);

    $('#challenge-card').addEventListener('click', openQuiz);
    $('#quiz-close').addEventListener('click', closeQuiz);
    $('#quiz-play').addEventListener('click', function () { startQuiz(false); });
    $('#quiz-practice').addEventListener('click', function () { startQuiz(true); });
    $('#quiz-again').addEventListener('click', closeQuiz);

    $('#give-ok').addEventListener('click', confirmGive);
    $('#give-cancel').addEventListener('click', function () {
      pendingReward = null;
      $('#give').hidden = true;
    });
    $('#give').addEventListener('click', function (e) {
      if (e.target === $('#give')) { pendingReward = null; $('#give').hidden = true; }
    });

    $('#invite-ok').addEventListener('click', acceptInvite);
    $('#invite-cancel').addEventListener('click', function () {
      pendingInvite = null;
      $('#invite').hidden = true;
    });

    // iOS 要在使用者手勢裡才能啟動音訊，第一次碰畫面就先解鎖
    document.addEventListener('pointerdown', unlockAudio, { once: true });

    // 跨過午夜時自動換到新的一天，順便看看有沒有新版
    document.addEventListener('visibilitychange', function () {
      checkDayRollover();
      if (!document.hidden && swRegistration) swRegistration.update();
    });
    setInterval(checkDayRollover, 60000);
  }

  function checkDayRollover() {
    var now = Store.dateKey(Store.today());
    if (lastRenderedDay && lastRenderedDay !== now) {
      lastRenderedDay = now;
      renderAll();
      toast('新的一天開始了！');
    }
    lastRenderedDay = now;
  }

  // ── 啟動 ────────────────────────────────────────────────

  function renderAll() {
    renderTop();
    renderToday();
    if (view === 'reward') renderRewardLog();
    if (view === 'week') renderWeek();
    if (view === 'stats') renderStats();
  }

  function initStaticZhuyin() {
    $$('[data-zy]').forEach(function (node) { Zhuyin.fill(node, node.dataset.zy); });
  }

  // ── 版本更新 ────────────────────────────────────────────

  var swRegistration = null;
  var reloadingForUpdate = false;

  function showUpdateBar() {
    $('#update-bar').hidden = false;
  }

  function applyUpdate() {
    var waiting = swRegistration && swRegistration.waiting;
    if (!waiting) { location.reload(); return; }
    $('#update-apply').disabled = true;
    $('#update-apply').textContent = '更新中…';
    // 新的 Service Worker 接手後會觸發 controllerchange，那時才重新載入
    waiting.postMessage({ type: 'SKIP_WAITING' });
  }

  function initServiceWorker() {
    // file:// 開啟時不能註冊 Service Worker，直接跳過
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;

    navigator.serviceWorker.register('sw.js').then(function (reg) {
      swRegistration = reg;
      navigator.serviceWorker.ready.then(readVersion);   // 首次安裝時 controller 稍後才出現

      // 上次跳出提示但沒更新就關掉了，這次進來要再提醒一次
      if (reg.waiting && navigator.serviceWorker.controller) showUpdateBar();

      reg.addEventListener('updatefound', function () {
        var incoming = reg.installing;
        if (!incoming) return;
        incoming.addEventListener('statechange', function () {
          // 有 controller 才代表這是「更新」；第一次安裝不用打擾使用者
          if (incoming.state === 'installed' && navigator.serviceWorker.controller) showUpdateBar();
        });
      });
    }).catch(function (e) {
      console.warn('Service Worker 註冊失敗：', e);
    });

    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (reloadingForUpdate) return;
      reloadingForUpdate = true;
      location.reload();
    });
  }

  /**
   * 問正在服務這個頁面的 Service Worker 它自己是哪一版。
   * 直接跟當事人要，看到什麼就真的是什麼 —— 不會有「以為更新了其實沒有」。
   */
  function readVersion() {
    var boxes = [$('#app-version'), $('#version-text')].filter(Boolean);
    var show = function (text) { boxes.forEach(function (b) { b.textContent = text; }); };
    var fallback = '未使用離線快取';

    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
      show(fallback);
      return;
    }

    var ch = new MessageChannel();
    var timer = setTimeout(function () { show(fallback); }, 1500);
    ch.port1.onmessage = function (ev) {
      clearTimeout(timer);
      var v = (ev.data && ev.data.version) || '';
      show(v.replace(/^oakley-routine-/, '') || fallback);
    };
    navigator.serviceWorker.controller.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
  }

  /** 卡在舊版時的逃生門：清掉 SW 與快取，換一個新網址重載，繞過所有快取層 */
  function forceReload() {
    if (!confirm('這會清掉離線快取並重新下載最新版。\n\n打卡紀錄存在別的地方，不會受影響。')) return;

    var done = function () {
      location.replace(location.pathname + '?r=' + Date.now());
    };

    if (!('serviceWorker' in navigator)) { done(); return; }

    navigator.serviceWorker.getRegistrations()
      .then(function (regs) { return Promise.all(regs.map(function (r) { return r.unregister(); })); })
      .then(function () { return caches.keys(); })
      .then(function (keys) { return Promise.all(keys.map(function (k) { return caches.delete(k); })); })
      .catch(function () {})
      .then(done);
  }

  function checkForUpdate() {
    if (!swRegistration) { toast('這個環境不支援離線更新'); return; }
    toast('檢查中…');
    swRegistration.update().then(function () {
      setTimeout(function () {
        if (swRegistration.waiting) { showUpdateBar(); toast('有新版本可以更新'); }
        else toast('已經是最新版本');
      }, 1200);
    }).catch(function () {
      toast('檢查失敗，請確認網路');
    });
  }

  function init() {
    // 資料已經在 store.js 載入時讀好了，這裡不能再 load 一次：
    // 那會蓋掉這段期間同步進來的遠端改動。
    Store.subscribe(function (state, meta) {
      if (meta && meta.origin === 'remote') onRemoteChange();
    });
    initStaticZhuyin();
    buildKeypad();
    wire();
    lastRenderedDay = Store.dateKey(Store.today());
    renderAll();
    initServiceWorker();
    readVersion();

    // 從邀請連結進來的話問一下要不要加入。網址裡的碼在讀取當下就被抹掉了。
    var invite = window.Sync && Sync.enabled ? Sync.takeInviteCode() : null;
    if (invite) askInvite(invite);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
