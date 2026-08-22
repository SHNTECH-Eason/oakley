/**
 * 每日數學挑戰
 *
 * 十題加減，答對有爪印。設計上有幾個刻意的決定：
 *
 * 1. 難度分五級，從 10 以內的加法開始。五歲直接算兩位數進位會挫折，
 *    而挫折會把整個 App「我好棒」的情緒基調弄壞。
 * 2. 同一等級連續全對五次才自動升級 —— 要證明真的會了，不是矇對。
 * 3. 選擇題不是輸入框。五歲打字慢，而且輸入框會讓答錯變成
 *    「我連怎麼回答都不會」。錯誤選項刻意貼近正確答案。
 * 4. 完成就有基本獎勵，答錯也拿得到。我們獎勵的是「他願意挑戰」，
 *    跟作息表獎勵「他願意做」是同一套邏輯。
 * 5. 每天只有一次算成績，但練習模式無限次。今天手滑答壞了不用等明天。
 */
(function (global) {
  'use strict';

  // 分數刻意壓在「一天作息全破」之下（那是 8 + 5 = 13）。
  // 作息表才是主線，數學挑戰是加分的娛樂，不該反過來蓋過它。
  // 最低 2（完成就有，答錯也算），最高 15。
  var TOTAL = 10;
  var BASE_POINTS = 2;
  var PER_CORRECT = 1;
  var PERFECT_BONUS = 3;

  var LEVELS = [
    { n: 1, name: '10 以內加法',   desc: '3 + 4' },
    { n: 2, name: '10 以內加減',   desc: '8 − 3' },
    { n: 3, name: '20 以內加減',   desc: '15 − 7' },
    { n: 4, name: '兩位數不進位',  desc: '23 + 15' },
    { n: 5, name: '兩位數進位借位', desc: '27 + 18' }
  ];

  function rnd(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }

  // ── 出題 ──────────────────────────────────────────────────

  /** 減法一律保證結果不是負數 —— 五歲還沒有負數的概念 */
  function makeQuestion(level) {
    var a, b, op, ans;

    if (level === 1) {
      a = rnd(1, 8); b = rnd(1, 9 - a); op = '+';
    } else if (level === 2) {
      if (Math.random() < 0.5) { a = rnd(1, 8); b = rnd(1, 9 - a); op = '+'; }
      else { a = rnd(2, 10); b = rnd(1, a); op = '−'; }
    } else if (level === 3) {
      // 被減數從 10 起跳，不然常常出到「6 − 1」這種第二關就會的題目
      if (Math.random() < 0.5) { a = rnd(5, 15); b = rnd(2, 20 - a); op = '+'; }
      else { a = rnd(11, 20); b = rnd(2, a - 1); op = '−'; }
    } else if (level === 4) {
      // 個位不進位、十位不超過 9
      var A = rnd(1, 4), B = rnd(1, 9 - A);
      var a1 = rnd(0, 8), b1 = rnd(0, 9 - a1);
      if (Math.random() < 0.5) { a = A * 10 + a1; b = B * 10 + b1; op = '+'; }
      else { a = (A + B) * 10 + (a1 + b1); b = B * 10 + b1; op = '−'; }
    } else {
      // 個位一定進位／借位
      if (Math.random() < 0.5) {
        var c1 = rnd(2, 9), d1 = rnd(10 - c1, 9);
        a = rnd(1, 4) * 10 + c1; b = rnd(1, 4) * 10 + d1; op = '+';
      } else {
        var e1 = rnd(0, 7), f1 = rnd(e1 + 1, 9);
        var eT = rnd(2, 9), fT = rnd(1, eT - 1);
        a = eT * 10 + e1; b = fT * 10 + f1; op = '−';
      }
    }

    ans = op === '+' ? a + b : a - b;
    return { a: a, b: b, op: op, answer: ans, options: makeOptions(ans, level) };
  }

  /**
   * 錯誤選項要貼近正確答案，不能是亂數。
   * 亂數選項一眼就能排除，等於沒在算；貼近的才逼他真的算一次。
   */
  function makeOptions(ans, level) {
    var offsets = level >= 4 ? [-10, -2, -1, 1, 2, 10, 9, -9] : [-3, -2, -1, 1, 2, 3];
    var opts = [ans];
    var guard = 0;

    while (opts.length < 4 && guard++ < 60) {
      var o = ans + offsets[Math.floor(Math.random() * offsets.length)];
      if (o >= 0 && opts.indexOf(o) === -1) opts.push(o);
    }
    while (opts.length < 4) {                       // 保險，理論上用不到
      var f = Math.max(0, ans + opts.length);
      if (opts.indexOf(f) === -1) opts.push(f); else opts.push(f + 4);
    }

    for (var i = opts.length - 1; i > 0; i--) {     // 洗牌
      var j = Math.floor(Math.random() * (i + 1));
      var t = opts[i]; opts[i] = opts[j]; opts[j] = t;
    }
    return opts;
  }

  function makeSet(level) {
    var list = [], seen = {};
    var guard = 0;
    while (list.length < TOTAL && guard++ < 400) {
      var q = makeQuestion(level);
      var sig = q.a + q.op + q.b;
      if (seen[sig]) continue;                      // 同一份考卷不要出重複的題目
      seen[sig] = true;
      list.push(q);
    }
    while (list.length < TOTAL) list.push(makeQuestion(level));
    return list;
  }

  global.Quiz = {
    TOTAL: TOTAL,
    BASE_POINTS: BASE_POINTS,
    PER_CORRECT: PER_CORRECT,
    PERFECT_BONUS: PERFECT_BONUS,
    LEVELS: LEVELS,
    levelInfo: function (n) { return LEVELS[Math.max(0, Math.min(LEVELS.length - 1, n - 1))]; },
    makeSet: makeSet,
    makeQuestion: makeQuestion,
    score: function (correct) {
      return BASE_POINTS + correct * PER_CORRECT + (correct >= TOTAL ? PERFECT_BONUS : 0);
    }
  };
})(window);
