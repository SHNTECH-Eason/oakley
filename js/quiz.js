/**
 * 數學闖關
 *
 * 50 關的路徑地圖，十題全對才能解鎖下一關。設計上幾個刻意的決定：
 *
 * 1. 難度沿路爬升，從 10 以內的加法開始。五歲直接算兩位數進位會挫折，
 *    而挫折會把整個 App「我好棒」的情緒基調弄壞。
 * 2. 全對才過關 —— 要證明真的會了，不是矇對。但沒過可以立刻重來，
 *    題目會重新出，不會被卡一整天。
 * 3. 每天最多前進三關。有節制才有得期待，也避免一個下午把 50 關刷完。
 * 4. 選擇題不是輸入框。五歲打字慢，而且輸入框會讓答錯變成
 *    「我連怎麼回答都不會」。錯誤選項刻意貼近正確答案。
 * 5. 每天第一次挑戰不管結果都給爪印。獎勵的是「他願意來挑戰」，
 *    跟作息表獎勵「他願意做」是同一套邏輯。
 */
(function (global) {
  'use strict';

  var TOTAL = 10;              // 每關題數
  var STAGES = 50;
  var PER_TIER = 10;
  var DAILY_ADVANCE = 3;       // 一天最多前進幾關

  // 分數壓在「一天作息全破」（8 + 5 = 13）附近。
  // 作息表才是主線，闖關是加分的娛樂，不該反過來蓋過它。
  var SHOW_UP_POINTS = 2;      // 當天第一次挑戰就給，答錯也算
  var CLEAR_POINTS = 4;        // 每過一關
  // 一天上限 = 2 + 4 × 3 = 14

  var TIERS = [
    { name: '10 以內加法',    desc: '3 + 4',   color: 'amber'   },
    { name: '10 以內加減',    desc: '8 − 3',   color: 'emerald' },
    { name: '20 以內加減',    desc: '15 − 7',  color: 'blue'    },
    { name: '兩位數不進位',   desc: '23 + 15', color: 'purple'  },
    { name: '兩位數進位借位', desc: '27 + 18', color: 'night'   }
  ];

  function rnd(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }

  /** 第幾關屬於第幾個難度階段（1–5） */
  function tierOf(stage) {
    return Math.min(TIERS.length, Math.floor((stage - 1) / PER_TIER) + 1);
  }

  function tierInfo(stage) {
    var t = tierOf(stage);
    return Object.assign({ n: t, from: (t - 1) * PER_TIER + 1, to: t * PER_TIER }, TIERS[t - 1]);
  }

  // ── 出題 ──────────────────────────────────────────────────

  /** 減法一律保證結果不是負數 —— 五歲還沒有負數的概念 */
  function makeQuestion(stage) {
    var tier = tierOf(stage);
    var a, b, op;

    if (tier === 1) {
      a = rnd(1, 8); b = rnd(1, 9 - a); op = '+';
    } else if (tier === 2) {
      if (Math.random() < 0.5) { a = rnd(1, 8); b = rnd(1, 9 - a); op = '+'; }
      else { a = rnd(3, 10); b = rnd(1, a - 1); op = '−'; }
    } else if (tier === 3) {
      // 被減數從 11 起跳，不然常常出到「6 − 1」這種上一階就會的題目
      if (Math.random() < 0.5) { a = rnd(5, 15); b = rnd(2, 20 - a); op = '+'; }
      else { a = rnd(11, 20); b = rnd(2, a - 1); op = '−'; }
    } else if (tier === 4) {
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

    var ans = op === '+' ? a + b : a - b;
    return { a: a, b: b, op: op, answer: ans, options: makeOptions(ans, tier) };
  }

  /**
   * 錯誤選項要貼近正確答案，不能是亂數。
   * 亂數選項一眼就能排除，等於沒在算；貼近的才逼他真的算一次。
   */
  function makeOptions(ans, tier) {
    var offsets = tier >= 4 ? [-10, -2, -1, 1, 2, 10, 9, -9] : [-3, -2, -1, 1, 2, 3];
    var opts = [ans];
    var guard = 0;

    while (opts.length < 4 && guard++ < 60) {
      var o = ans + offsets[Math.floor(Math.random() * offsets.length)];
      if (o >= 0 && opts.indexOf(o) === -1) opts.push(o);
    }
    while (opts.length < 4) {
      var f = Math.max(0, ans + opts.length);
      if (opts.indexOf(f) === -1) opts.push(f); else opts.push(f + 4);
    }

    for (var i = opts.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = opts[i]; opts[i] = opts[j]; opts[j] = t;
    }
    return opts;
  }

  function makeSet(stage) {
    var list = [], seen = {}, guard = 0;
    while (list.length < TOTAL && guard++ < 400) {
      var q = makeQuestion(stage);
      var sig = q.a + q.op + q.b;
      if (seen[sig]) continue;          // 同一關不要出重複的題目
      seen[sig] = true;
      list.push(q);
    }
    while (list.length < TOTAL) list.push(makeQuestion(stage));
    return list;
  }

  global.Quiz = {
    TOTAL: TOTAL,
    STAGES: STAGES,
    PER_TIER: PER_TIER,
    DAILY_ADVANCE: DAILY_ADVANCE,
    SHOW_UP_POINTS: SHOW_UP_POINTS,
    CLEAR_POINTS: CLEAR_POINTS,
    TIERS: TIERS,
    tierOf: tierOf,
    tierInfo: tierInfo,
    makeSet: makeSet,
    makeQuestion: makeQuestion
  };
})(window);
