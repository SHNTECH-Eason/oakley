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

  function play(kind) {
    if (!Store.state.settings.sound) return;
    if (!ensureAudio()) return;

    // 排在稍微之後，讓 resume() 有時間完成，不然第一聲會缺角
    var t = audioCtx.currentTime + 0.02;

    if (kind === 'done') {
      // 清脆上行三音，像蓋章的「叮鈴」
      tone(784, t, 0.10, 0.5);
      tone(1046, t + 0.06, 0.14, 0.45);
      tone(1568, t + 0.12, 0.26, 0.32);
    } else if (kind === 'undo') {
      tone(494, t, 0.10, 0.3);
      tone(370, t + 0.07, 0.16, 0.26);
    } else if (kind === 'perfect') {
      [523, 659, 784, 1046, 1318].forEach(function (f, i) {
        tone(f, t + i * 0.10, 0.42, 0.45);
      });
      tone(2093, t + 0.52, 0.7, 0.3, 'sine');
    }
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

  /** 蓋章瞬間：擴散圓環 + 爪印與紙屑往上噴再落下 */
  function stampBurst(anchor, color) {
    if (reduceMotion()) return;
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

    for (var i = 0; i < 16; i++) {
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
  function floatPoints(anchor, text) {
    if (reduceMotion()) return;
    var box = anchor.getBoundingClientRect();
    var node = el('div', 'fx-float', text);
    node.style.left = (box.left + box.width / 2) + 'px';
    node.style.top = box.top + 'px';
    fx().appendChild(node);
    autoRemove(node, 1050);
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

      btn.addEventListener('click', function () { onToggle(task, btn); });
      li.appendChild(btn);
      list.appendChild(li);
    });

    renderProgress();
  }

  function renderProgress() {
    var stats = Store.dayStats(Store.today());

    $('#progress-done').textContent = stats.done;
    $('#progress-total').textContent = '/' + stats.total;

    var bar = $('#progress-bar');
    bar.style.strokeDashoffset = String(264 * (1 - stats.ratio));
    bar.classList.toggle('is-perfect', stats.perfect);

    Zhuyin.fill($('#progress-title'), stats.perfect ? '太棒了' : '今天的任務');

    var left = stats.total - stats.done;
    var sub;
    if (stats.perfect) sub = '今天全部完成，好厲害！';
    else if (stats.done === 0) sub = '一起出發吧，共 ' + stats.total + ' 個任務';
    else sub = '已完成 ' + stats.done + ' 個，還差 ' + left + ' 個';
    $('#progress-sub').textContent = sub;
  }

  function onToggle(task, btn) {
    var day = Store.today();
    var wasPerfect = Store.dayStats(day).perfect;
    var nowDone = Store.toggle(day, task.id);

    btn.classList.toggle('is-done', nowDone);
    btn.setAttribute('aria-pressed', nowDone ? 'true' : 'false');

    if (nowDone) {
      btn.classList.add('is-stamping');
      setTimeout(function () { btn.classList.remove('is-stamping'); }, 700);

      var stamp = $('.task__stamp', btn);
      var color = getComputedStyle(btn).getPropertyValue('--c').trim() || '#f59e0b';
      stampBurst(stamp, color);
      floatPoints(stamp, '+' + Store.state.settings.pointsPerTask + ' 🐾');

      play('done');
      buzz(18);
    } else {
      play('undo');
    }

    renderProgress();
    renderTop();

    if (!wasPerfect && Store.dayStats(day).perfect) {
      setTimeout(showCelebrate, 380);
    }
  }

  function showCelebrate() {
    $('#celebrate-bonus').textContent = Store.state.settings.perfectBonus;
    $('#celebrate').hidden = false;
    confettiRain(70);
    play('perfect');
    buzz([30, 60, 30, 60, 120]);
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

  function resetGate() {
    pinBuffer = '';
    pinFirstEntry = '';
    pinStage = Store.state.settings.pin ? 'verify' : 'create';
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
        toast('密碼設定完成');
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
    $('#pin-gate').hidden = false;
    $('#parent-panel').hidden = true;
    resetGate();
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
    if (!$('#backfill-date').value) $('#backfill-date').value = Store.dateKey(Store.today());
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

    $('#sync-join').addEventListener('click', function () {
      var code = $('#sync-input').value.trim();
      if (!code) { toast('請先輸入配對碼'); return; }
      if (!confirm('要加入這組配對碼嗎？\n\n兩邊的紀錄會合併（不會有人的爪印不見），\n但作息項目與設定會改成對方那一份。')) return;

      $('#sync-join').disabled = true;
      Sync.join(code).then(function (joined) {
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
    if (next === 'week') { weekAnchor = Store.today(); renderWeek(); }
    if (next === 'stats') { calAnchor = Store.today(); renderStats(); }
    if (next === 'parent') { if (parentUnlocked) renderParent(); else resetGate(); }
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
      Store.updateSettings({
        pointsPerTask: Math.max(1, Number($('#cfg-per').value) || 1),
        perfectBonus: Math.max(0, Number($('#cfg-bonus').value) || 0),
        sound: $('#cfg-sound').checked
      });
      Store.updateChild({ nickname: $('#cfg-nick').value.trim() || 'Oaklay' });
      renderAll();
      toast('設定已儲存');
    });

    // 診斷用：直接播一次並回報 AudioContext 狀態。
    // 「running 卻聽不到」= 裝置端問題（iPhone 靜音鍵、媒體音量），
    // 「suspended」= 瀏覽器的自動播放限制沒解開。
    $('#sound-test').addEventListener('click', function () {
      // 看的是已儲存的設定，因為 play() 也是看它。只打勾沒按儲存不算數。
      if (!Store.state.settings.sound) { toast('音效目前關閉中，請打勾並按儲存'); return; }
      unlockAudio();
      play('done');
      setTimeout(function () {
        if (!audioCtx) { toast('這個裝置不支援 Web Audio'); return; }
        toast('已播放　狀態：' + audioCtx.state + '　音量：' + Math.round(master.gain.value * 100) + '%');
      }, 150);
    });

    $('#backup-export').addEventListener('click', exportBackup);
    $('#backup-import').addEventListener('click', function () { $('#backup-file').click(); });
    $('#backup-file').addEventListener('change', function (e) {
      if (e.target.files[0]) importBackup(e.target.files[0]);
      e.target.value = '';
    });

    $('#pin-change').addEventListener('click', function () {
      Store.updateSettings({ pin: null });
      lockParent();
      toast('請重新設定密碼');
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
    resetGate();
    initServiceWorker();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
