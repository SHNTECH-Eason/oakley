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
        pointsPerTask: 1,    // 每完成一項的爪印數
        perfectBonus: 5,     // 當日全部完成的額外爪印
        quizStage: 1,        // 數學闖關目前在第幾關（全對才會前進）
        sound: true,         // 打卡音效（睡前那一項會響，可以關掉）
        speech: false        // 念出項目名稱與稱讚。五歲還不識字，聽比看有用，
                             // 但合成語音有機械感，所以預設關閉讓家長自己決定
      },
      tasks: DEFAULT_TASKS.map(function (t) { return Object.assign({}, t); }),
      records: {},           // { 'YYYY-MM-DD': { taskId: ISO 時間字串 } }
      bonuses: [],           // 作息表之外的特別獎勵 [{ id, date, reason, points, at }]
      quizzes: {},           // 每日闖關 { 'YYYY-MM-DD': { cleared: [關卡], attempts, points, at } }
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

    // 判斷要不要轉換舊資料，一定要在套用預設值「之前」看原始內容 ——
    // 預設值會把 quizStage 填成 1，之後就分不出是舊資料還是新使用者了
    var incoming = data.settings || {};
    var hadStage = typeof incoming.quizStage === 'number';
    var oldLevel = Number(incoming.quizLevel) || 0;

    data.settings = Object.assign(base.settings, incoming);
    data.records = data.records || {};
    data.bonuses = Array.isArray(data.bonuses) ? data.bonuses : [];
    data.quizzes = (data.quizzes && typeof data.quizzes === 'object') ? data.quizzes : {};

    // 舊版是「五個難度 × 連續全對升級」，換成 50 關的地圖。
    // 把當時的難度對應到該階段的第一關，進度不會憑空消失。
    if (!hadStage && oldLevel > 1) {
      data.settings.quizStage = (oldLevel - 1) * 10 + 1;
    }
    delete data.settings.quizLevel;
    delete data.settings.quizStreak;
    delete data.settings.pin;          // 家長密碼已移除，不再保留
    Object.keys(data.quizzes).forEach(function (k) {
      if (!Array.isArray(data.quizzes[k].cleared)) data.quizzes[k].cleared = [];
    });
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

  /** 一天的紀錄裡以底線開頭的是中繼欄位（_expected），不是完成的項目 */
  function completedIds(rec) {
    return Object.keys(rec || {}).filter(function (id) {
      return id.charAt(0) !== '_' && !!rec[id];
    });
  }

  /**
   * 那一天「當時應該完成幾項」。
   *
   * 打卡時會把當下的項目數寫進該日紀錄，之後家長改作息表就不會回頭改寫歷史。
   * 沒有這個的話，新增一個項目會讓過去每一個全破日都失去獎勵 ——
   * 小朋友什麼都沒做，累積的爪印數卻自己變少，這是不能接受的。
   *
   * 舊資料沒存過這個欄位，就退回用現行設定推算。
   */
  function expectedCount(d) {
    var rec = state.records[dateKey(d)];
    if (rec && typeof rec._expected === 'number' && rec._expected > 0) return rec._expected;
    return tasksForDate(d).length;
  }

  /** 某天的完成進度 */
  function dayStats(d) {
    var key = dateKey(d);
    var applicable = tasksForDate(d);
    var rec = dayRecord(key);

    var done = applicable.filter(function (t) { return !!rec[t.id]; }).length;  // 畫面顯示用
    var earned = completedIds(rec).length;   // 計分用，包含後來被刪掉的項目
    var expected = expectedCount(d);

    return {
      key: key,
      done: done,
      total: applicable.length,
      perfect: expected > 0 && earned >= expected,
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
      var done = completedIds(state.records[key]).length;
      sum += done * per;

      var expected = expectedCount(parseKey(key));
      if (expected > 0 && done >= expected) sum += bonus;
    });

    var bonus = bonusPoints();
    var quiz = quizPoints();
    var used = state.redeemed.reduce(function (a, r) { return a + (r.cost || 0); }, 0);
    var earned = sum + bonus + quiz;
    return { earned: earned, routine: sum, bonus: bonus, quiz: quiz, used: used, balance: earned - used };
  }

  /** 作息表之外的特別獎勵總點數 */
  function bonusPoints() {
    return state.bonuses.reduce(function (a, b) { return a + (Number(b.points) || 0); }, 0);
  }

  /** 數學挑戰累積的點數 */
  function quizPoints() {
    return Object.keys(state.quizzes).reduce(function (a, k) {
      return a + (Number(state.quizzes[k].points) || 0);
    }, 0);
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
      return completedIds(state.records[k]).length > 0;
    }).length;
  }

  // ── 本機修改（會往上同步） ──────────────────────────────────

  /** 切換完成狀態，回傳切換後是否為完成 */
  function toggle(d, taskId) {
    var key = dateKey(d);
    if (!state.records[key]) state.records[key] = {};

    var rec = state.records[key];
    var nowDone = !rec[taskId];
    var expected = tasksForDate(d).length;

    if (nowDone) rec[taskId] = new Date().toISOString();
    else delete rec[taskId];

    if (completedIds(rec).length) {
      rec._expected = expected;       // 記下當下的標準，日後改作息表不影響這天
    } else {
      delete state.records[key];      // 整天都取消了就把這天清掉
    }

    persist();
    notify({
      origin: 'local', kind: 'record',
      dateKey: key, taskId: taskId, done: nowDone, expected: expected
    });
    return nowDone;
  }

  // ── 特別獎勵 ────────────────────────────────────────────────
  // 作息表以外的好表現。不綁在任何一天的項目上，所以獨立存成一份清單，
  // 對應 Firestore 的 families/{id}/bonuses/{id}，一筆一份文件才不會互相蓋掉。

  function addBonus(reason, points) {
    var b = {
      id: 'b' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
      date: dateKey(today()),
      reason: String(reason || '特別棒').slice(0, 20),
      points: Math.max(1, Math.min(99, Number(points) || 1)),
      at: new Date().toISOString()
    };
    state.bonuses.push(b);
    persist();
    notify({ origin: 'local', kind: 'bonus', bonus: b });
    return b;
  }

  function removeBonus(id) {
    state.bonuses = state.bonuses.filter(function (b) { return b.id !== id; });
    persist();
    notify({ origin: 'local', kind: 'bonus-remove', id: id });
  }

  /** 最近的獎勵，新的在前面 */
  function recentBonuses(limit) {
    return state.bonuses.slice().sort(function (a, b) {
      return (b.at || '').localeCompare(a.at || '');
    }).slice(0, limit || 20);
  }

  // ── 數學闖關 ────────────────────────────────────────────────

  function quizToday() {
    return state.quizzes[dateKey(today())] || null;
  }

  /** 今天已經前進幾關 */
  function clearedToday() {
    var t = quizToday();
    return t && Array.isArray(t.cleared) ? t.cleared.length : 0;
  }

  function quizStage() {
    return Math.min(Quiz.STAGES, Math.max(1, state.settings.quizStage || 1));
  }

  /** 今天還能不能往前推進（全部通關之後就只剩重玩） */
  function canAdvance() {
    return clearedToday() < Quiz.DAILY_ADVANCE && quizStage() <= Quiz.STAGES;
  }

  /**
   * 記錄一次挑戰。
   *
   * 全對才過關。沒過可以立刻重來，所以不會被卡一整天；
   * 但每天最多前進三關，有節制才有得期待。
   * 爪印只在當天第一次挑戰給，重試不再給 —— 獎勵的是「有來挑戰」。
   */
  function recordQuizAttempt(stage, correct, total) {
    var key = dateKey(today());
    var s = state.settings;
    var rec = state.quizzes[key] || { date: key, cleared: [], attempts: 0, points: 0, at: null };
    if (!Array.isArray(rec.cleared)) rec.cleared = [];

    var passed = correct >= total;
    var gained = 0;

    rec.attempts = (rec.attempts || 0) + 1;
    if (rec.attempts === 1) gained += Quiz.SHOW_UP_POINTS;

    var advanced = false;
    if (passed && stage === quizStage() && canAdvance()) {
      rec.cleared.push(stage);
      s.quizStage = stage + 1;
      gained += Quiz.CLEAR_POINTS;
      advanced = true;
    }

    rec.points = (rec.points || 0) + gained;
    rec.at = new Date().toISOString();
    state.quizzes[key] = rec;

    persist();
    notify({ origin: 'local', kind: 'quiz', dateKey: key, result: rec });
    if (advanced) notify({ origin: 'local', kind: 'profile' });   // 進度存在 settings 裡

    return {
      passed: passed, advanced: advanced, gained: gained,
      stage: quizStage(), clearedToday: rec.cleared.length,
      allDone: quizStage() > Quiz.STAGES
    };
  }

  function applyRemoteQuiz(key, data) {
    if (data) state.quizzes[key] = data;
    else delete state.quizzes[key];
    persist();
    notify({ origin: 'remote', kind: 'quiz' });
  }

  function mergeRemoteQuizzes(map, replace) {
    if (replace) state.quizzes = {};
    Object.keys(map || {}).forEach(function (k) { state.quizzes[k] = map[k]; });
    persist();
    notify({ origin: 'remote', kind: 'all' });
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

  /** 作息項目與設定以遠端為準 */
  function applyRemoteProfile(profile) {
    if (!profile) return;

    if (profile.child) Object.assign(state.child, profile.child);
    if (profile.settings) Object.assign(state.settings, profile.settings);
    if (Array.isArray(profile.tasks) && profile.tasks.length) state.tasks = profile.tasks;
    if (Array.isArray(profile.redeemed)) state.redeemed = profile.redeemed;

    persist();
    notify({ origin: 'remote', kind: 'profile' });
  }

  /** 遠端來的獎勵：同 id 就覆蓋，沒有就新增 */
  function applyRemoteBonus(b) {
    if (!b || !b.id) return;
    var i = state.bonuses.findIndex(function (x) { return x.id === b.id; });
    if (i >= 0) state.bonuses[i] = b;
    else state.bonuses.push(b);
    persist();
    notify({ origin: 'remote', kind: 'bonus' });
  }

  function removeRemoteBonus(id) {
    state.bonuses = state.bonuses.filter(function (b) { return b.id !== id; });
    persist();
    notify({ origin: 'remote', kind: 'bonus' });
  }

  /** 配對時把遠端的獎勵清單併進來（依 id 去重） */
  function mergeRemoteBonuses(list, replace) {
    if (replace) state.bonuses = [];
    (list || []).forEach(function (b) {
      if (!b || !b.id) return;
      var i = state.bonuses.findIndex(function (x) { return x.id === b.id; });
      if (i >= 0) state.bonuses[i] = b;
      else state.bonuses.push(b);
    });
    persist();
    notify({ origin: 'remote', kind: 'all' });
  }

  /**
   * 整份紀錄換成遠端那份。
   * 接受別人的邀請連結時用 —— 這台原本的紀錄不該被推到對方的家庭裡去。
   */
  function replaceRecords(remote) {
    state.records = {};
    Object.keys(remote || {}).forEach(function (key) {
      state.records[key] = remote[key];
    });
    persist();
    notify({ origin: 'remote', kind: 'all' });
  }

  /**
   * 兩邊的紀錄取聯集，衝突時以遠端為準。
   * 配對自己的另一台裝置時用，確保兩邊原有的努力都不會不見。
   */
  function mergeRemoteRecords(remote) {
    Object.keys(remote || {}).forEach(function (key) {
      state.records[key] = Object.assign({}, state.records[key] || {}, remote[key]);
    });
    persist();
    notify({ origin: 'remote', kind: 'all' });
  }

  /** 給 sync 用：目前要上傳的設定 */
  function profileForSync() {
    return {
      child: state.child,
      settings: Object.assign({}, state.settings),
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
    bonusPoints: bonusPoints,
    quizPoints: quizPoints,
    recentBonuses: recentBonuses,
    quizToday: quizToday,
    quizStage: quizStage,
    clearedToday: clearedToday,
    canAdvance: canAdvance,
    recordQuizAttempt: recordQuizAttempt,
    applyRemoteQuiz: applyRemoteQuiz,
    mergeRemoteQuizzes: mergeRemoteQuizzes,
    streak: streak,
    activeDays: activeDays,

    toggle: toggle,
    addBonus: addBonus,
    removeBonus: removeBonus,
    updateSettings: updateSettings,
    updateChild: updateChild,
    saveTasks: saveTasks,

    applyRemoteRecord: applyRemoteRecord,
    applyRemoteBonus: applyRemoteBonus,
    removeRemoteBonus: removeRemoteBonus,
    mergeRemoteBonuses: mergeRemoteBonuses,
    mergeRemoteDay: mergeRemoteDay,
    applyRemoteProfile: applyRemoteProfile,
    mergeRemoteRecords: mergeRemoteRecords,
    replaceRecords: replaceRecords,
    completedIds: completedIds,
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
