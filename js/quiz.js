/**
 * 數學闖關
 *
 * 80 關的路徑地圖，十題全對才能解鎖下一關。設計上幾個刻意的決定：
 *
 * 1. 難度沿路爬升，從 10 以內的加法開始。五歲直接算兩位數進位會挫折，
 *    而挫折會把整個 App「我好棒」的情緒基調弄壞。難度的定義見下面
 *    「出題」那一段 —— 看的是要數幾下，不是數字多大。
 * 2. 全對才過關 —— 要證明真的會了，不是矇對。但沒過可以立刻重來，
 *    題目會重新出，不會被卡一整天。
 * 3. 每天最多前進三關。有節制才有得期待，也避免一個下午把 50 關刷完。
 * 4. 選擇題不是輸入框。五歲打字慢，而且輸入框會讓答錯變成
 *    「我連怎麼回答都不會」。錯誤選項刻意貼近正確答案。
 * 5. 每天第一次挑戰不管結果都給掌印。獎勵的是「他願意來挑戰」，
 *    跟作息表獎勵「他願意做」是同一套邏輯。
 */
(function (global) {
  'use strict';

  var TOTAL = 10;              // 每關題數
  var STAGES = 80;
  var PER_TIER = 10;

  // 闖關給的是「金幣」，不是掌印。兩種貨幣刻意分開：
  //   掌印 = 習慣的貨幣，靠每天做該做的事和家長給獎累積
  //   金幣 = 本事的貨幣，靠實力闖關累積
  // 分開之後就不用擔心闖關賺太快把作息表稀釋掉，關卡也不必限制一天幾關。
  //
  // 每關的金幣＝所在場景的編號（草原 1、森林 2⋯⋯太空 5）。
  // 一開始就給固定 10 顆的話，後面越難的關反而沒有變得更值錢，
  // 少了「往前闖比較划算」的理由。
  var COINS_PER_TIER_BONUS = 5;   // 打完一整個場景（10 關）的額外獎勵

  // 每個階段一個場景，關卡往前推進就像走過一趟旅程：
  // 草地 → 森林 → 海邊 → 天空 → 太空 → 雪地 → 彩虹 → 城堡
  //
  // 第 51 關之後刻意不再加深難度。這個年紀要養的是「喜歡」和「對數字有感覺」，
  // 不是算得更大 —— 所以後面三個場景的數字大小跟第 41–50 關同一個範圍，
  // 換的是看事情的角度：不見的數字可以在任何位置、三個數要先找出好算的那對、
  // 雙數是可以直接記住的錨。難度平的時候，變化要來自別的地方。
  var TIERS = [
    { name: '10 以內加法',    desc: '3 + 4',   color: 'amber',   scene: 'meadow', place: '草原' },
    { name: '10 以內加減',    desc: '8 − 3',   color: 'emerald', scene: 'forest', place: '森林' },
    { name: '20 以內加減',    desc: '15 − 7',  color: 'blue',    scene: 'beach',  place: '海邊' },
    { name: '湊十',           desc: '2 + 8 = 10', color: 'purple', scene: 'sky',  place: '天空' },
    { name: '跨十與兩位數',   desc: '9 + 3',   color: 'night',   scene: 'space',  place: '太空' },
    { name: '找出不見的數字', desc: '9 + ? = 15', color: 'teal',  scene: 'snow',   place: '雪地' },
    { name: '三個數',         desc: '7 + 3 + 5', color: 'rose',   scene: 'rainbow', place: '彩虹' },
    { name: '雙數與湊二十',   desc: '7 + 7',   color: 'orange',  scene: 'castle', place: '城堡' }
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
  //
  // 難度不是看數字多大，是看「要數幾下」。
  //
  // 五歲的策略是加法取大數往上數、減法取被減數往下數，十根手指就是上限：
  //   15 + 3   往上數 3 下     做得到
  //   8 + 5    往上數 5 下     做得到，跨過十也不影響，只是慢
  //   15 − 13  往下數 13 下    做不到
  //   27 + 45  往上數 45 下    做不到
  // 所以 27 + 45 對他不是「難」，是他手上的方法根本執行不到 —— 那種失敗
  // 跟「想很久算錯」不一樣，它會直接讓他覺得我不會。
  //
  // 第 31 關開始因此改成鋪湊十：先把十的夥伴變成反射，再拿它處理跨十，
  // 最後才碰兩位數。兩位數加兩位數（27 + 45）需要直式計算，那是小二的
  // 方法不是難度，留到他真的走完再開第二張地圖。
  //
  // 每個階段裡面也會爬（用關卡在該階段的序位 k），不再是十關同一種。

  function mk(text, answer, mode, trap) {
    return { text: text, answer: answer, options: makeOptions(answer, mode, trap) };
  }

  function plain(a, op, b, mode) {
    return mk(a + ' ' + op + ' ' + b + ' = ?', op === '+' ? a + b : a - b, mode || 'near');
  }

  /**
   * 31–35：十的夥伴，用缺項的形式問。
   *
   * 用湊十法算 8 + 5 的時候，腦子裡問的是「8 還差幾個才滿十」，
   * 那句話的形狀是 8 + ? = 10，不是 8 + 2 = ?。同一個事實反過來問
   * 就要重新學一次，所以這裡練的必須是缺項那個方向。
   *
   * 整個題庫只有九個事實，重複是刻意的 —— 這種東西就是要背到反射。
   * 也因為只有九個，這一段只給五關，十關同樣的九題會膩。
   */
  function tenPartner(k) {
    // 先用他最熟的寫法把「哪些配對會滿十」認出來（2 + 8、3 + 7），
    // 再翻成缺項（8 + ? = 10）—— 那才是湊十法實際用到的方向。
    // 問法是疊上去的不是換掉的：舊的還會出現，題庫也才夠大。
    var showSum = k < 3 || (k < 6 && Math.random() < 0.4);

    if (showSum) {
      // 全部都是十的話，他不用算就知道一律選 10，那變成在練按按鈕。
      // 所以固定摻進湊不到十的題目 —— 都是第一階就會的加法，
      // 難的不是算，是要分辨這一題到底滿不滿十。
      if (Math.random() < 0.65) {
        var p = rnd(1, 9);
        return plain(p, '+', 10 - p);
      }
      var s = rnd(5, 9);
      var x = rnd(1, s - 1);
      return plain(x, '+', s - x);
    }

    var a = rnd(1, 9);
    var miss = 10 - a;
    // 九個事實遲早都要會，沒有藏起來的道理；有難易之分的是未知數擺在哪：
    //   a + ? = 10   目標形式。舉起 8 根手指，沒舉的兩根一眼就看到
    //   ? + a = 10   一樣的算法，但未知數在最前面，要多讀一次才知道在問什麼
    //   10 − a = ?   看起來最眼熟，其實對他最貴：用倒數的話 10 − 8 要退八下。
    //                等他真的記住夥伴了才划算，所以留到最後兩關
    var form = k < 6 ? 0 : (k < 8 ? rnd(0, 1) : rnd(0, 2));
    if (form === 0) return mk(a + ' + ? = 10', miss, 'near');
    if (form === 1) return mk('? + ' + a + ' = 10', miss, 'near');
    return mk('10 − ' + a + ' = ?', miss, 'near');
  }

  /** 41–43：跨十加法，湊十法的第一個實戰。9 + 3 是 9 湊到 10 再加 2 */
  function addOverTen(k) {
    var lo = k < 1 ? 6 : (k < 2 ? 5 : 4);
    var top = k < 1 ? 14 : (k < 2 ? 16 : 18);
    var a = rnd(lo, 9);
    var b = rnd(11 - a, Math.min(9, top - a));    // 一定進位，且和不超過 top
    return plain(a, '+', b);
  }

  /** 44–46：跨十減法（破十法）。13 − 5 是 13 拆成 10 和 3，10 − 5 = 5，再加 3 */
  function subOverTen(k) {
    var top = k < 1 ? 14 : (k < 2 ? 16 : 18);
    var a = rnd(11, top);
    var u = a % 10;                                // top ≤ 18，所以 u 不會是 9
    var b = rnd(u + 1, 9);                         // 個位不夠減，一定要退位
    // 「小的減大的、反過來算」是這裡最常見的錯：13 − 5 答成 2
    return mk(a + ' − ' + b + ' = ?', a - b, 'near', Math.abs(u - b));
  }

  /**
   * 47–50：兩位數 ± 一位數，湊十的直接應用。26 + 4 就是 6 湊到 10 再進位。
   *
   * 難度刻意壓在跟第 40–45 關同一個水準。第一版十位開到 8（畫面上會出現 98），
   * 量「要數幾下」跟前面差不多，但那個指標漏掉兩件事：
   *   1. 大班會唱數到 100，但看到 75 知道那是七十五是位值概念，那是小一的東西
   *   2. 倒數要跨整十。16 − 8 一路走在十幾裡，75 − 7 得過 70 → 69 那個彎
   * 同樣是七下，走的路不一樣。所以十位壓到 3，數字停在三十幾。
   *
   * 另外刻意讓四成的題目剛好落在整十上（27 + 3 = 30、30 − 4）—— 那正是前面
   * 十關在練的東西，湊到整十就結束，沒有餘數要處理。
   * 這最後四關要像獎勵，不是又一道新的牆。
   */
  function twoDigit(k) {
    // 十位固定壓在 2，四關的數字都停在三十幾，不靠數字變大來製造難度。
    // 這四關的爬升改用「剛好落在整十」的比例遞減：整十的題目沒有餘數要處理，
    // 比例降下來就是逐漸把輔助輪拿掉，數字大小完全不動。
    var round = 0.5 - k * 0.05;                        // 50% → 35%
    if (Math.random() < 0.5) {
      var u = rnd(2, 9);
      var a = rnd(1, 2) * 10 + u;
      var b = Math.random() < round ? 10 - u : rnd(10 - u, 9);
      return plain(a, '+', b, 'carry');                // 個位一定進位
    }
    // 從整十退，30 − 4 就是把十拆開來減，破十法的原樣
    var u2 = Math.random() < round ? 0 : rnd(0, 7);
    var a2 = rnd(2, 3) * 10 + u2;
    var b2 = rnd(u2 + 1, 9);                           // 個位一定退位
    // 個位反過來減、十位原封不動：32 − 6 答成 34
    return mk(a2 + ' − ' + b2 + ' = ?', a2 - b2, 'carry',
              Math.floor(a2 / 10) * 10 + Math.abs(u2 - b2));
  }

  /**
   * 51–60：缺項到處跑。數字大小完全不變，變的是「不見的那個數在哪裡」。
   *
   * 不是要他算得更難，是要他知道 9 + 6 = 15 這件事可以從任何一角問起。
   * 那是數感，不是計算 —— 他在湊十那十關已經做過一次（8 + ? = 10），
   * 這裡把同一個動作攤到所有數字上。
   *
   * 和固定在 11–18，跟第 41–46 關同一個範圍；答案永遠是個位數或那個和，
   * 不管問哪一角，要數的次數都跟前面差不多。
   */
  function missingSpot(k) {
    // 先決定「不見的那個數」，因為要數幾下就是它 —— 四種問法都一樣。
    // 反過來先抽兩個加數的話，和要夠大就會把答案一起推大，成本失控。
    var h = rnd(2, 8);
    var o = rnd(Math.max(2, 8 - h), 9);
    var c = h + o;
    // 未知數先待在最熟的位置，再慢慢挪到別處
    var form = k < 4 ? 0 : (k < 7 ? rnd(0, 1) : rnd(0, 3));
    if (form === 0) return mk(o + ' + ? = ' + c, h, 'near');
    if (form === 1) return mk('? + ' + o + ' = ' + c, h, 'near');
    if (form === 2) return mk(c + ' − ? = ' + o, h, 'near');
    return mk('? − ' + h + ' = ' + o, c, 'near');
  }

  /**
   * 61–70：三個數相加。每一步都很小，難的不是算，是要看出「先做哪兩個」。
   *
   * 7 + 3 + 5 從左往右一路數要數八下，先湊十再加五只要五下。
   * 一半的題目刻意藏一組湊成十的配對，而且位置會換 —— 他得先掃過三個數
   * 找出好算的那對，這正是數感的正題。
   */
  function threeTerms(k) {
    var top = k < 4 ? 12 : (k < 7 ? 16 : 20);

    if (Math.random() < 0.5) {
      var p = rnd(1, 9);
      var third = rnd(1, Math.min(9, top - 10));
      var t = [p, 10 - p, third];
      var order = rnd(0, 2);
      if (order === 1) t = [p, third, 10 - p];
      if (order === 2) t = [third, p, 10 - p];
      return mk(t.join(' + ') + ' = ?', 10 + third, 'near');
    }

    var a = rnd(1, 6), b = rnd(1, 6);
    // 上限要跟 9 取小 —— 少了這個，top 放寬到 20 時第三項會冒出兩位數
    var c = rnd(1, Math.min(9, Math.max(1, top - a - b)));
    return mk(a + ' + ' + b + ' + ' + c + ' = ?', a + b + c, 'near');
  }

  /**
   * 71–80：雙數與湊二十。數字大小還是沒變，換的是可以抓住的錨。
   *
   * 雙數（6+6、7+7）小朋友記得特別快 —— 兩邊一樣多，用手指一比就對稱。
   * 記住之後 7 + 8 就變成「雙數再加一」，不用重新算。
   * 最後三關把湊十的想法搬到下一個整十（14 + ? = 20），收在一個他認得的形狀上。
   */
  function doublesAndTwenty(k) {
    var pick = k < 2 ? 0 : (k < 6 ? rnd(0, 1) : rnd(0, 2));

    if (pick === 0) {
      var d = rnd(2, 10);
      return plain(d, '+', d);
    }
    if (pick === 1) {
      var e = rnd(3, 9);
      return Math.random() < 0.5 ? plain(e, '+', e + 1) : plain(e + 1, '+', e);
    }
    var a = rnd(11, 18);
    return Math.random() < 0.5
      ? mk(a + ' + ? = 20', 20 - a, 'near')
      : plain(20, '−', rnd(2, 9));
  }

  /** 減法一律保證結果不是負數 —— 五歲還沒有負數的概念 */
  function makeQuestion(stage) {
    var tier = tierOf(stage);
    var k = (stage - 1) % PER_TIER;      // 這一關在所屬階段裡的序位 0–9
    var a, b;

    if (tier === 1) {
      a = rnd(1, 8); return plain(a, '+', rnd(1, 9 - a));
    }
    if (tier === 2) {
      if (Math.random() < 0.5) { a = rnd(1, 8); return plain(a, '+', rnd(1, 9 - a)); }
      a = rnd(3, 10); return plain(a, '−', rnd(1, a - 1));
    }
    if (tier === 3) {
      // 被減數從 11 起跳，不然常常出到「6 − 1」這種上一階就會的題目
      if (Math.random() < 0.5) { a = rnd(5, 15); return plain(a, '+', rnd(2, 20 - a)); }
      a = rnd(11, 20); return plain(a, '−', rnd(2, a - 1));
    }
    // 一個場景一個主題，十關跑完才換 —— 場景換了就是換一件事
    if (tier === 4) return tenPartner(k);                       // 天空：湊十
    if (tier === 6) return missingSpot(k);                      // 雪地：缺項到處跑
    if (tier === 7) return threeTerms(k);                       // 彩虹：三個數
    if (tier === 8) return doublesAndTwenty(k);                 // 城堡：雙數與湊二十

    if (k < 3) return addOverTen(k);                            // 太空：湊十拿來用
    return k < 6 ? subOverTen(k - 3) : twoDigit(k - 6);
  }

  /**
   * 錯誤選項要貼近正確答案，不能是亂數。
   * 亂數選項一眼就能排除，等於沒在算；貼近的才逼他真的算一次。
   *
   * carry 那組的 ±9、±10 是給兩位數用的陷阱：忘記進位剛好差 10，
   * 而那個答案就在選項裡等他。trap 是該題型特有的典型錯誤。
   */
  function makeOptions(ans, mode, trap) {
    var offsets = mode === 'carry' ? [-10, -2, -1, 1, 2, 10, 9, -9] : [-3, -2, -1, 1, 2, 3];
    var opts = [ans];
    var guard = 0;

    if (trap != null && trap >= 0 && trap !== ans) opts.push(trap);

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
      if (seen[q.text]) continue;       // 同一關不要出重複的題目
      seen[q.text] = true;
      list.push(q);
    }
    while (list.length < TOTAL) list.push(makeQuestion(stage));
    return list;
  }

  global.Quiz = {
    TOTAL: TOTAL,
    STAGES: STAGES,
    PER_TIER: PER_TIER,
    COINS_PER_TIER_BONUS: COINS_PER_TIER_BONUS,

    /** 這一關過了給幾個金幣＝所在場景的編號 */
    coinsOf: function (stage) { return tierOf(stage); },

    /** 通過 n 關總共值多少金幣（每打完一個場景有額外獎勵） */
    coinsFor: function (cleared) {
      var n = Math.max(0, Math.min(STAGES, cleared));
      var total = 0;
      for (var s = 1; s <= n; s++) total += tierOf(s);
      return total + Math.floor(n / PER_TIER) * COINS_PER_TIER_BONUS;
    },

    /** 把毫秒念成「1 分 20 秒」 */
    fmtTime: function (ms) {
      var s = Math.round(ms / 1000);
      return s < 60 ? (s + ' 秒') : (Math.floor(s / 60) + ' 分 ' + (s % 60) + ' 秒');
    },

    /** 按鈕上的短版：38" / 1'20" —— 圓形節點裡塞不下中文 */
    shortTime: function (ms) {
      var s = Math.round(ms / 1000);
      if (s < 60) return s + '"';
      return Math.floor(s / 60) + "'" + (s % 60 < 10 ? '0' : '') + (s % 60) + '"';
    },
    TIERS: TIERS,
    tierOf: tierOf,
    tierInfo: tierInfo,
    makeSet: makeSet,
    makeQuestion: makeQuestion
  };
})(window);
