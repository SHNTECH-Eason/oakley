/**
 * 英文闖關（聽）
 *
 * 跟數學闖關共用同一套地圖、同一套「十題全對才過關」、同一套計時與最佳紀錄，
 * 但有兩件事本質不同：
 *
 * 1. 題庫是累積的，不是一階段一技能。
 *    數學的湊十學會了就往下一關，詞彙不是 —— 字會忘。所以第 25 關考的是
 *    「到第 25 關為止出現過的所有字」，不是只考第 25 關的新字。
 *    每關加一到四個新字，舊字持續回來，這是詞彙唯一會留下來的方式。
 *
 * 2. 選項是圖不是英文字。
 *    他不認得英文字母，用字當選項就變成在考拼字。
 *
 * 而且四個選項盡量同一類：聽到 cat，選項放狗貓鳥魚，而不是貓／蘋果／紅色／鞋子。
 * 後者用類別就猜到了，前者才逼他真的聽那個字 —— 跟數學的干擾項同一個道理。
 *
 * 只做「聽」。「說」不讓程式評分：語音辨識判五歲的非母語發音會判錯，
 * 而被誤判的訊息是「我不會」，那正是整個 App 一路在避免的東西。
 */
(function (global) {
  'use strict';

  var TOTAL = 10;              // 每關題數
  var PER_TIER = 10;
  var COINS_PER_TIER_BONUS = 5;

  // 場景沿用數學那邊畫好的，只是換順序，免得兩張地圖看起來一樣
  var TIERS = [
    { name: '身邊的東西', desc: 'dog　ball　cup', color: 'rose',   scene: 'rainbow', place: '彩虹' },
    { name: '顏色與食物', desc: 'red　apple',     color: 'cyan',   scene: 'sea',     place: '海底' },
    { name: '身體',       desc: 'eye　hand',      color: 'amber',  scene: 'meadow',  place: '草原' },
    { name: '數字與動作', desc: 'three　jump',    color: 'orange', scene: 'castle',  place: '城堡' }
  ];

  var STAGES = TIERS.length * PER_TIER;

  /**
   * 詞彙表。at = 第幾關開始出現，之後就一直留在題庫裡。
   *
   * 選字的三個原則：
   *   只收他生活裡真的有的東西 —— 不要 elephant、giraffe，動物園單字他平常看不到
   *   只收畫得清楚的 —— 名詞最安全，go / have / like 這種一律不收
   *   每一類至少四個 —— 同類才湊得出四個選項，湊不到就退回跨類（那一題會比較好猜）
   *
   * kind 決定選項怎麼畫：icon 用 SVG 圖、color 畫色塊、digit 直接寫數字。
   * 顏色和數字因此不必畫圖，這也是為什麼四個場景只需要 28 張新圖。
   */
  var WORDS = [
    // ── 第 1–10 關：身邊的東西 ──
    { w: 'dog',    zh: '狗',   kind: 'icon', val: 'e-dog',    cat: 'animal', at: 1 },
    { w: 'cat',    zh: '貓',   kind: 'icon', val: 'e-cat',    cat: 'animal', at: 1 },
    { w: 'bird',   zh: '鳥',   kind: 'icon', val: 'e-bird',   cat: 'animal', at: 1 },
    { w: 'fish',   zh: '魚',   kind: 'icon', val: 'i-fish',   cat: 'animal', at: 1 },
    { w: 'ball',   zh: '球',   kind: 'icon', val: 'e-ball',   cat: 'toy',    at: 2 },
    { w: 'car',    zh: '車',   kind: 'icon', val: 'e-car',    cat: 'toy',    at: 3 },
    { w: 'book',   zh: '書',   kind: 'icon', val: 'i-book',   cat: 'thing',  at: 4 },
    { w: 'shoe',   zh: '鞋子', kind: 'icon', val: 'e-shoe',   cat: 'wear',   at: 5 },
    { w: 'hat',    zh: '帽子', kind: 'icon', val: 'e-hat',    cat: 'wear',   at: 6 },
    { w: 'cup',    zh: '杯子', kind: 'icon', val: 'e-cup',    cat: 'thing',  at: 7 },
    { w: 'bag',    zh: '書包', kind: 'icon', val: 'e-bag',    cat: 'thing',  at: 8 },
    { w: 'bed',    zh: '床',   kind: 'icon', val: 'e-bed',    cat: 'thing',  at: 9 },

    // ── 第 11–20 關：顏色與食物 ──
    // 顏色四個一起放：色塊本來就好認，而且要四個才湊得出同類的選項
    { w: 'red',    zh: '紅色', kind: 'color', val: '#ef4444', cat: 'color', at: 11 },
    { w: 'blue',   zh: '藍色', kind: 'color', val: '#3b82f6', cat: 'color', at: 11 },
    { w: 'yellow', zh: '黃色', kind: 'color', val: '#facc15', cat: 'color', at: 11 },
    { w: 'green',  zh: '綠色', kind: 'color', val: '#22c55e', cat: 'color', at: 11 },
    { w: 'black',  zh: '黑色', kind: 'color', val: '#1e293b', cat: 'color', at: 12 },
    { w: 'white',  zh: '白色', kind: 'color', val: '#f8fafc', cat: 'color', at: 13 },
    { w: 'apple',  zh: '蘋果', kind: 'icon', val: 'e-apple',  cat: 'food',  at: 14 },
    { w: 'banana', zh: '香蕉', kind: 'icon', val: 'e-banana', cat: 'food',  at: 14 },
    { w: 'milk',   zh: '牛奶', kind: 'icon', val: 'e-milk',   cat: 'food',  at: 15 },
    { w: 'egg',    zh: '蛋',   kind: 'icon', val: 'e-egg',    cat: 'food',  at: 15 },
    { w: 'bread',  zh: '麵包', kind: 'icon', val: 'e-bread',  cat: 'food',  at: 16 },
    { w: 'water',  zh: '水',   kind: 'icon', val: 'e-water',  cat: 'food',  at: 17 },

    // ── 第 21–30 關：身體 ──
    { w: 'eye',    zh: '眼睛', kind: 'icon', val: 'e-eye',    cat: 'body', at: 21 },
    { w: 'ear',    zh: '耳朵', kind: 'icon', val: 'e-ear',    cat: 'body', at: 21 },
    { w: 'nose',   zh: '鼻子', kind: 'icon', val: 'e-nose',   cat: 'body', at: 21 },
    { w: 'mouth',  zh: '嘴巴', kind: 'icon', val: 'e-mouth',  cat: 'body', at: 21 },
    { w: 'hand',   zh: '手',   kind: 'icon', val: 'e-hand',   cat: 'body', at: 22 },
    { w: 'foot',   zh: '腳',   kind: 'icon', val: 'e-foot',   cat: 'body', at: 23 },
    { w: 'hair',   zh: '頭髮', kind: 'icon', val: 'e-hair',   cat: 'body', at: 24 },
    { w: 'teeth',  zh: '牙齒', kind: 'icon', val: 'e-teeth',  cat: 'body', at: 25 },

    // ── 第 31–40 關：數字與動作 ──
    { w: 'one',    zh: '一', kind: 'digit', val: '1',  cat: 'num', at: 31 },
    { w: 'two',    zh: '二', kind: 'digit', val: '2',  cat: 'num', at: 31 },
    { w: 'three',  zh: '三', kind: 'digit', val: '3',  cat: 'num', at: 31 },
    { w: 'four',   zh: '四', kind: 'digit', val: '4',  cat: 'num', at: 31 },
    { w: 'five',   zh: '五', kind: 'digit', val: '5',  cat: 'num', at: 32 },
    { w: 'six',    zh: '六', kind: 'digit', val: '6',  cat: 'num', at: 32 },
    { w: 'seven',  zh: '七', kind: 'digit', val: '7',  cat: 'num', at: 33 },
    { w: 'eight',  zh: '八', kind: 'digit', val: '8',  cat: 'num', at: 33 },
    { w: 'nine',   zh: '九', kind: 'digit', val: '9',  cat: 'num', at: 34 },
    { w: 'ten',    zh: '十', kind: 'digit', val: '10', cat: 'num', at: 34 },
    { w: 'run',    zh: '跑',   kind: 'icon', val: 'e-run',   cat: 'action', at: 35 },
    { w: 'jump',   zh: '跳',   kind: 'icon', val: 'e-jump',  cat: 'action', at: 35 },
    { w: 'sleep',  zh: '睡覺', kind: 'icon', val: 'e-sleep', cat: 'action', at: 35 },
    { w: 'eat',    zh: '吃',   kind: 'icon', val: 'e-eat',   cat: 'action', at: 35 }
  ];

  function rnd(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function tierOf(stage) {
    return Math.min(TIERS.length, Math.floor((stage - 1) / PER_TIER) + 1);
  }

  function tierInfo(stage) {
    var t = tierOf(stage);
    return Object.assign({ n: t, from: (t - 1) * PER_TIER + 1, to: t * PER_TIER }, TIERS[t - 1]);
  }

  /** 到這一關為止學過的所有字 */
  function poolFor(stage) {
    return WORDS.filter(function (x) { return x.at <= stage; });
  }

  /** 這一關第一次出現的字 */
  function freshAt(stage) {
    return WORDS.filter(function (x) { return x.at === stage; });
  }

  // 剛學的字權重高，但學過的會一直回來。不讓舊字消失是這整套的重點。
  function weightOf(word, stage) {
    return 1 + 3 / (1 + stage - word.at);
  }

  function pickTarget(pool, stage) {
    var total = 0, i;
    for (i = 0; i < pool.length; i++) total += weightOf(pool[i], stage);
    var r = Math.random() * total;
    for (i = 0; i < pool.length; i++) {
      r -= weightOf(pool[i], stage);
      if (r <= 0) return pool[i];
    }
    return pool[pool.length - 1];
  }

  /**
   * 三個干擾項，優先同一類。
   * 同類才逼他聽那個字；跨類的話用類別就猜到了，等於沒在聽。
   * 那一類不夠四個時才退回跨類 —— 新字剛出現時會這樣，也剛好比較好過。
   */
  function makeOptions(item, pool) {
    var opts = [item];
    var same = shuffle(pool.filter(function (x) { return x.cat === item.cat && x.w !== item.w; }));
    var other = shuffle(pool.filter(function (x) { return x.cat !== item.cat; }));

    same.concat(other).forEach(function (x) {
      if (opts.length < 4 && opts.indexOf(x) === -1) opts.push(x);
    });
    return shuffle(opts);
  }

  function makeSet(stage) {
    var pool = poolFor(stage);
    var list = [];

    // 這一關的新字一定要出現
    freshAt(stage).forEach(function (x) { if (list.length < TOTAL) list.push(x); });

    var guard = 0;
    while (list.length < TOTAL && guard++ < 400) {
      var pick = pickTarget(pool, stage);
      // 題庫夠大才避免同一關出到重複的字；前幾關只有四個字，重複是必然也是刻意的
      if (pool.length >= TOTAL && list.indexOf(pick) >= 0) continue;
      list.push(pick);
    }
    while (list.length < TOTAL) list.push(pool[rnd(0, pool.length - 1)]);

    return shuffle(list).map(function (item) {
      return { item: item, options: makeOptions(item, pool) };
    });
  }

  global.Eng = {
    TOTAL: TOTAL,
    STAGES: STAGES,
    PER_TIER: PER_TIER,
    COINS_PER_TIER_BONUS: COINS_PER_TIER_BONUS,
    TIERS: TIERS,
    WORDS: WORDS,

    coinsOf: function (stage) { return tierOf(stage); },

    coinsFor: function (cleared) {
      var n = Math.max(0, Math.min(STAGES, cleared));
      var total = 0;
      for (var s = 1; s <= n; s++) total += tierOf(s);
      return total + Math.floor(n / PER_TIER) * COINS_PER_TIER_BONUS;
    },

    tierOf: tierOf,
    tierInfo: tierInfo,
    poolFor: poolFor,
    freshAt: freshAt,
    makeSet: makeSet
  };
})(window);
