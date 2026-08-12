/**
 * 資料層
 *
 * localStorage 是本機的真實來源，畫面一律讀它，所以點下去是零延遲、離線也能用。
 * js/sync.js 負責把改動推上 Firestore、把別台裝置的改動塞回來（origin: 'remote'）。
 *
 * 結構刻意做成「一天一筆、每項獨立欄位」，對應 families/{id}/records/{YYYY-MM-DD}，
 * 兩台裝置改同一天的不同項目時用 merge 寫入就不會互相蓋掉。
 *
 * 點數一律由 records 即時算出，不另外存總分，避免資料對不上。
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'oakley.routine.v1';
  var EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
  var WEEKDAYS = [1, 2, 3, 4, 5];

  var DEFAULT_TASKS = [
    { id: 'wake',    from: '07:20', to: '07:40', label: '起床/刷牙洗臉',      color: 'amber',   icon: 'chase',    days: EVERY_DAY },
    { id: 'morning', from: '07:40', to: '08:00', label: '換衣服/吃早餐',      color: 'orange',  icon: 'marshall', days: EVERY_DAY },
    { id: 'school',  from: '08:00', to: '',      label: '出門上學',            color: 'blue',    icon: 'house',    days: WEEKDAYS },
    { id: 'dinner',  from: '18:30', to: '19:30', label: '晚餐時間',            color: 'emerald', icon: 'meal',     days: EVERY_DAY },
    { id: 'play',    from: '19:30', to: '20:30', label: '遊戲/閱讀時間',      color: 'purple',  icon: 'skye',     days: EVERY_DAY },
    { id: 'bath',    from: '20:30', to: '21:00', label: '收拾/洗澡時間',      color: 'teal',    icon: 'bath',     days: EVERY_DAY },
    { id: 'bag',     from: '21:00', to: '21:30', label: '整理書包/刷牙',      color: 'indigo',  icon: 'rubble',   days: EVERY_DAY },
    { id: 'sleep',   from: '21:30', to: '',      label: '滴眼藥水/噴鼻子/睡覺', color: 'night',   icon: 'moon',     days: EVERY_DAY }
  ];

  function defaults() {
    return {
      version: 1,
      // 真實姓名故意不寫在程式碼裡（這是公開 repo）。
      // 畫面上顯示的一直都是暱稱，要填全名的話存在雲端那份設定就好。
      child: { name: '', nickname: 'Oaklay' },
      settings: {
        pin: null,           // 家長 PIN。故意不上傳，每台裝置各自設定
        pointsPerTask: 1,    // 每完成一項的爪印數
        perfectBonus: 5,     // 當日全部完成的額外爪印
        sound: true          // 打卡音效（睡前那一項會響，可以關掉）
      },
      tasks: DEFAULT_TASKS.map(function (t) { return Object.assign({}, t); }),
      records: {},           // { 'YYYY-MM-DD': { taskId: ISO 時間字串 } }
      redeemed: [],          // 預留給之後的點數兌換
      updatedAt: null
    };
  }

  // ── 日期工具 ────────────────────────────────────────────────
  // 一律用本地時間，不能用 toISOString()（那是 UTC，台灣時區會整天偏掉）

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function dateKey(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function parseKey(key) {
    var p = key.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }

  function addDays(d, n) {
    var c = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    c.setDate(c.getDate() + n);
    return c;
  }

  /** 該週的星期一 */
  function startOfWeek(d) {
    var day = d.getDay();               // 0=日
    return addDays(d, day === 0 ? -6 : 1 - day);
  }

  function today() {
    var n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }

  // ── 狀態 ────────────────────────────────────────────────────

  var state = defaults();
  var listeners = [];

  /**
   * meta.origin: 'local' 表示這台裝置改的（sync 要往上推）
   *              'remote' 表示從別台同步下來的（sync 不能再推，會無限迴圈）
   */
  function notify(meta) {
    listeners.forEach(function (fn) { fn(state, meta || { origin: 'local', kind: 'all' }); });
  }

  function persist() {
    state.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // 無痕模式或空間滿了。畫面上的資料還在，只是這次沒存進去。
      console.warn('儲存失敗：', e);
      return false;
    }
    return true;
  }

  function load() {
    var raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      raw = null;
    }
    if (raw) {
      try {
        state = migrate(JSON.parse(raw));
      } catch (e) {
        console.warn('資料毀損，改用預設值：', e);
        state = defaults();
      }
    }
    return state;
  }

  /** 舊版資料補上新欄位，避免改版後畫面炸掉 */
  function migrate(data) {
    var base = defaults();
    data = data || {};
    data.version = 1;
    data.child = Object.assign(base.child, data.child || {});
    data.settings = Object.assign(base.settings, data.settings || {});
    data.records = data.records || {};
    data.redeemed = data.redeemed || [];
    if (!Array.isArray(data.tasks) || !data.tasks.length) {
      data.tasks = base.tasks;
    } else {
      data.tasks = data.tasks.map(function (t) {
        if (!Array.isArray(t.days) || !t.days.length) t.days = EVERY_DAY;
        return t;
      });
    }
    return data;
  }

  // ── 查詢 ────────────────────────────────────────────────────

  /** 當天適用的項目（例如「出門上學」預設只在平日出現） */
  function tasksForDate(d) {
    var day = d.getDay();
    return state.tasks.filter(function (t) { return t.days.indexOf(day) !== -1; });
  }

  function dayRecord(key) {
    return state.records[key] || {};
  }

  function isDone(key, taskId) {
    return !!dayRecord(key)[taskId];
  }

  /** 某天的完成進度 */
  function dayStats(d) {
    var key = dateKey(d);
    var applicable = tasksForDate(d);
    var rec = dayRecord(key);
    var done = applicable.filter(function (t) { return !!rec[t.id]; }).length;
    return {
      key: key,
      done: done,
      total: applicable.length,
      perfect: applicable.length > 0 && done === applicable.length,
      ratio: applicable.length ? done / applicable.length : 0
    };
  }

  /**
   * 累積總爪印數。
   * 已經蓋過的章就算數 —— 即使那個項目後來被家長刪掉，之前的努力也不會被抹掉。
   */
  function totalPoints() {
    var per = state.settings.pointsPerTask;
    var bonus = state.settings.perfectBonus;
    var sum = 0;

    Object.keys(state.records).forEach(function (key) {
      var rec = state.records[key];
      var done = Object.keys(rec).filter(function (id) { return !!rec[id]; }).length;
      sum += done * per;

      var applicable = tasksForDate(parseKey(key));
      if (applicable.length && done >= applicable.length) sum += bonus;
    });

    var used = state.redeemed.reduce(function (a, r) { return a + (r.cost || 0); }, 0);
    return { earned: sum, used: used, balance: sum - used };
  }

  /**
   * 連續全破天數。
   * 從今天往回數；今天還沒完成不算中斷（不然一早起來看到 0 很沮喪）。
   */
  function streak() {
    var cursor = today();
    if (!dayStats(cursor).perfect) cursor = addDays(cursor, -1);

    var count = 0;
    while (dayStats(cursor).perfect) {
      count++;
      cursor = addDays(cursor, -1);
      if (count > 3650) break;          // 保險，避免資料異常時無限迴圈
    }
    return count;
  }

  /** 有紀錄的總天數（至少完成一項） */
  function activeDays() {
    return Object.keys(state.records).filter(function (k) {
      var rec = state.records[k];
      return Object.keys(rec).some(function (id) { return !!rec[id]; });
    }).length;
  }

  // ── 本機修改（會往上同步） ──────────────────────────────────

  /** 切換完成狀態，回傳切換後是否為完成 */
  function toggle(d, taskId) {
    var key = dateKey(d);
    if (!state.records[key]) state.records[key] = {};

    var rec = state.records[key];
    var nowDone = !rec[taskId];

    if (nowDone) {
      rec[taskId] = new Date().toISOString();
    } else {
      delete rec[taskId];
      if (!Object.keys(rec).length) delete state.records[key];
    }

    persist();
    notify({ origin: 'local', kind: 'record', dateKey: key, taskId: taskId, done: nowDone });
    return nowDone;
  }

  function updateSettings(patch) {
    Object.assign(state.settings, patch);
    persist();
    notify({ origin: 'local', kind: 'profile' });
  }

  function updateChild(patch) {
    Object.assign(state.child, patch);
    persist();
    notify({ origin: 'local', kind: 'profile' });
  }

  function saveTasks(tasks) {
    state.tasks = tasks;
    persist();
    notify({ origin: 'local', kind: 'profile' });
  }

  // ── 遠端同步進來的修改（不能再往上推） ──────────────────────

  /** 整天的紀錄以遠端為準（遠端那份已經含了我們剛推上去的欄位） */
  function applyRemoteRecord(key, data) {
    if (data && Object.keys(data).length) {
      state.records[key] = data;
    } else {
      delete state.records[key];
    }
    persist();
    notify({ origin: 'remote', kind: 'record', dateKey: key });
  }

  /**
   * 遠端那天的紀錄「合併」進本機，不是覆蓋。
   * 第一次跟伺服器對帳完成前用這個，否則這台離線期間累積、還沒上傳的紀錄
   * 會在對帳讀到它們之前就被洗掉。
   */
  function mergeRemoteDay(key, data) {
    var merged = Object.assign({}, state.records[key] || {}, data || {});
    if (Object.keys(merged).length) state.records[key] = merged;
    else delete state.records[key];
    persist();
    notify({ origin: 'remote', kind: 'record', dateKey: key });
  }

  /** 作息項目與設定以遠端為準，但 PIN 保持各裝置獨立 */
  function applyRemoteProfile(profile) {
    if (!profile) return;
    var localPin = state.settings.pin;

    if (profile.child) Object.assign(state.child, profile.child);
    if (profile.settings) Object.assign(state.settings, profile.settings);
    if (Array.isArray(profile.tasks) && profile.tasks.length) state.tasks = profile.tasks;
    if (Array.isArray(profile.redeemed)) state.redeemed = profile.redeemed;

    state.settings.pin = localPin;
    persist();
    notify({ origin: 'remote', kind: 'profile' });
  }

  /**
   * 兩邊的紀錄取聯集，衝突時以遠端為準。
   * 配對新裝置時用，確保兩邊原有的努力都不會不見。
   */
  function mergeRemoteRecords(remote) {
    Object.keys(remote || {}).forEach(function (key) {
      state.records[key] = Object.assign({}, state.records[key] || {}, remote[key]);
    });
    persist();
    notify({ origin: 'remote', kind: 'all' });
  }

  /** 給 sync 用：目前要上傳的設定（不含 PIN） */
  function profileForSync() {
    var settings = Object.assign({}, state.settings);
    delete settings.pin;
    return {
      child: state.child,
      settings: settings,
      tasks: state.tasks,
      redeemed: state.redeemed,
      updatedAt: new Date().toISOString()
    };
  }

  // ── 備份 ────────────────────────────────────────────────────

  function exportJSON() {
    return JSON.stringify(state, null, 2);
  }

  function importJSON(text) {
    var data = JSON.parse(text);          // 格式不對就讓它丟出來，由呼叫端顯示訊息
    if (!data || typeof data !== 'object' || !data.records) {
      throw new Error('這個檔案看起來不是作息表的備份');
    }
    state = migrate(data);
    persist();
    notify({ origin: 'local', kind: 'all' });
    return state;
  }

  function resetAll() {
    state = defaults();
    persist();
    // wipe 告訴 sync 要連雲端的紀錄一起刪，否則下次同步又會整個長回來
    notify({ origin: 'local', kind: 'all', wipe: true });
  }

  global.Store = {
    EVERY_DAY: EVERY_DAY,
    WEEKDAYS: WEEKDAYS,

    load: load,
    subscribe: function (fn) { listeners.push(fn); },
    get state() { return state; },

    dateKey: dateKey,
    parseKey: parseKey,
    addDays: addDays,
    startOfWeek: startOfWeek,
    today: today,

    tasksForDate: tasksForDate,
    dayRecord: dayRecord,
    isDone: isDone,
    dayStats: dayStats,
    totalPoints: totalPoints,
    streak: streak,
    activeDays: activeDays,

    toggle: toggle,
    updateSettings: updateSettings,
    updateChild: updateChild,
    saveTasks: saveTasks,

    applyRemoteRecord: applyRemoteRecord,
    mergeRemoteDay: mergeRemoteDay,
    applyRemoteProfile: applyRemoteProfile,
    mergeRemoteRecords: mergeRemoteRecords,
    profileForSync: profileForSync,

    exportJSON: exportJSON,
    importJSON: importJSON,
    resetAll: resetAll
  };

  // 這裡就把資料讀進來，不能等到 DOMContentLoaded。
  // js/sync.js 是 module，執行時機比 DOMContentLoaded 早，
  // 如果那時 state 還是空的預設值，初次上傳就會把空資料當成真相。
  load();
})(window);
