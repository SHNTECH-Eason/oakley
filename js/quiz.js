/**
 * 數學闖關
 *
 * 100 關的路徑地圖，十題全對才能解鎖下一關。設計上幾個刻意的決定：
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
  var PER_TIER = 10;           // 預設一個場景幾關；第 101 關之後的場景是 20 關

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
  // 草地 → 森林 → 海邊 → 天空 → 太空 → 雪地 → 彩虹 → 城堡 → 海底 → 煙火
  //
  // 第 51 關之後刻意不再加深難度。這個年紀要養的是「喜歡」和「對數字有感覺」，
  // 不是算得更大 —— 所以後面三個場景的數字大小跟第 41–50 關同一個範圍，
  // 而且全部只有加法。換的是看事情的角度：不見的數字可以在後面也可以在前面、
  // 三個數要先找出好算的那對。難度平的時候，變化要來自別的地方。
  var TIERS = [
    { name: '10 以內加法',    desc: '3 + 4',   color: 'amber',   scene: 'meadow', place: '草原' },
    { name: '10 以內加減',    desc: '8 − 3',   color: 'emerald', scene: 'forest', place: '森林' },
    { name: '20 以內加減',    desc: '15 − 7',  color: 'blue',    scene: 'beach',  place: '海邊' },
    { name: '湊十',           desc: '2 + 8 = 10', color: 'purple', scene: 'sky',  place: '天空' },
    { name: '跨十與兩位數',   desc: '9 + 3',   color: 'night',   scene: 'space',  place: '太空' },
    { name: '找出不見的數字', desc: '9 + ? = 15', color: 'teal',  scene: 'snow',   place: '雪地' },
    { name: '不見的數字在前面', desc: '? + 6 = 15', color: 'rose', scene: 'rainbow', place: '彩虹' },
    { name: '三個數',         desc: '7 + 3 + 5', color: 'orange', scene: 'castle', place: '城堡' },
    { name: '三個數',         desc: '7 + 3 + 5', color: 'cyan',   scene: 'sea',    place: '海底' },
    { name: '三個數',         desc: '7 + 3 + 5', color: 'fuchsia', scene: 'fireworks', place: '煙火' },

    // 第 101 關開始走湊十法。場景還是十關一個，但題型每 20 關才換 ——
    // 換風景是給眼睛的獎勵，換題型是學習的節奏，兩件事的合理間隔本來就不一樣。
    // 所以每個題型配兩個場景。
    //
    // 這三段刻意把「拆數字」和「為什麼這樣拆」分開 —— 那是兩件事：
    //   5 可以拆成 2 和 3        只看 5
    //   為什麼是 2 和 3          前面那個 8 決定的
    // 混在一起教，他會以為拆法是背出來的。
    { name: '拆數字',     desc: '5 → 2 和 3',     color: 'lime',    scene: 'jungle',    place: '叢林' },
    { name: '拆數字',     desc: '5 → 2 和 3',     color: 'sand',    scene: 'desert',    place: '沙漠' },
    { name: '為什麼這樣拆', desc: '8 + 5 → 2 和 3', color: 'crimson', scene: 'volcano',   place: '火山' },
    { name: '為什麼這樣拆', desc: '8 + 5 → 2 和 3', color: 'aqua',    scene: 'waterfall', place: '瀑布' },
    { name: '跨十加法',   desc: '8 + 5 = 13',     color: 'violet',  scene: 'aurora',    place: '極光' },
    { name: '跨十加法',   desc: '8 + 5 = 13',     color: 'stone',   scene: 'summit',    place: '山頂' }
  ];

  // 每個場景幾關可以不一樣，from/to 由 span 累加算出來，不要在別處重算
  (function () {
    var s = 1;
    TIERS.forEach(function (t) {
      t.span = t.span || PER_TIER;
      t.from = s;
      t.to = s + t.span - 1;
      s = t.to + 1;
    });
  })();

  var STAGES = TIERS[TIERS.length - 1].to;

  function rnd(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }

  /** 第幾關屬於第幾個場景。場景不等寬，所以要查不能算 */
  function tierOf(stage) {
    for (var i = 0; i < TIERS.length; i++) if (stage <= TIERS[i].to) return i + 1;
    return TIERS.length;
  }

  function tierInfo(stage) {
    var t = tierOf(stage);
    return Object.assign({ n: t }, TIERS[t - 1]);
  }

  /** 是不是某個場景的第一關／最後一關。地圖分段和關主節點靠這兩個判斷 */
  function isTierStart(stage) {
    return TIERS.some(function (t) { return t.from === stage; });
  }
  function isTierEnd(stage) {
    return TIERS.some(function (t) { return t.to === stage; });
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

  function mk(text, answer, mode, trap, min) {
    return { text: text, answer: answer, options: makeOptions(answer, mode, trap, min) };
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
   * 51–70：缺項加法。數字大小完全不變，變的是「不見的那個數在哪裡」。
   *
   * 不是要他算得更難，是要他知道 9 + 6 = 15 這件事可以從別的角度問起。
   * 那是數感，不是計算 —— 他在湊十那十關已經做過一次（8 + ? = 10），
   * 這裡把同一個動作攤到所有數字上。
   *
   * 整整二十關都只有加法，不摻減法：這一段的目的是熟練和自信，
   * 一個穩定的形狀重複夠多次，他才會從「用數的」變成「直接知道」。
   *
   * 和固定在 8–17，跟第 41–50 關同一個範圍；答案就是那個不見的數，
   * 所以不管未知數擺哪裡，要數的次數都一樣。
   */
  function missingSpot(k, front) {
    // 先決定「不見的那個數」，因為要數幾下就是它。
    // 反過來先抽兩個加數的話，和要夠大就會把答案一起推大，成本失控。
    var h = rnd(2, 8);
    var o = rnd(Math.max(2, 8 - h), 9);
    var c = h + o;
    // 雪地整整十關只出「? 在後面」，到了彩虹才把未知數挪到最前面。
    // 算法一模一樣，差別只在要多讀一次才知道在問什麼。
    var ahead = front && Math.random() < (k < 3 ? 0.35 : 0.55);
    return ahead
      ? mk('? + ' + o + ' = ' + c, h, 'near')
      : mk(o + ' + ? = ' + c, h, 'near');
  }

  /**
   * 71–100：三個數相加。每一步都很小，難的不是算，是要看出「先做哪兩個」。
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
   * 分解樹。畫法跟課本一樣：要拆的數字下面長兩隻腳。
   * left / right 其中一個是 null，那個就是要答的。
   */
  function tree(lead, top, left, right, mode, trap) {
    // 答案是空的那一隻，值等於上面的數減掉另一隻 —— 不是把已知的那隻抄過來
    var answer = left === null ? top - right : top - left;
    // text 不會顯示（有 split 時畫面走分解樹那條路），但 makeSet 拿它當去重的鍵。
    // 留空的話一關十題會被當成同一題，實際只出得到七種。
    var key = (lead || '') + top + ':' + left + ':' + right;
    var q = mk(key, answer, mode || 'near', trap, 1);
    q.split = { lead: lead, top: top, left: left, right: right };
    return q;
  }

  /**
   * 101–120：拆數字。只看一個數，跟十無關。
   *
   * 算術上這跟他第 51–70 關做的「2 + ? = 5」一模一樣，價值在三件事：
   * 寫法跟明年課本一致、系統性把 2–10 的所有拆法掃過一遍、而且它是
   * 下一段的前置。他會覺得簡單，這一段本來就是暖身。
   */
  function splitNumber(k) {
    var lo = k < 5 ? 3 : (k < 12 ? 4 : 5);
    var hi = k < 5 ? 6 : (k < 12 ? 8 : 10);

    // 把範圍內所有的拆法列出來等機率抽。
    // 先抽 top 再抽 left 的話小數字會被抽到比較多次 —— 實測「拆出 1」佔 22%、
    // 「拆出 7」只有 3%，那他會一直練同幾個，而這一段的目的正是把所有拆法掃過。
    var pairs = [];
    for (var t = lo; t <= hi; t++)
      for (var l = 1; l < t; l++) pairs.push([t, l]);

    var p = pairs[rnd(0, pairs.length - 1)];
    // 把整個數抄下來是這裡最常見的錯
    return tree(null, p[0], p[1], null, 'near', p[0]);
  }

  /**
   * 121–140：為什麼這樣拆。
   *
   * 121–130 問左腳：答案是 10 − 前面那個數，**刻意跟後面那個數無關**。
   * 那不是缺陷，那就是這一段要教的事 —— 你要拆出多少，是前面那個數說了算。
   *
   * 131–140 問右腳：這時候才要兩個概念一起用 —— 先由前面決定拆多少，
   * 再從後面那個數裡拿掉。
   *
   * 左右腳分開問，兩個概念才不會糊在一起。
   */
  function splitForTen(k) {
    var lo = k < 3 ? 7 : (k < 7 ? 6 : 5);
    var a = rnd(lo, 9);
    var b = rnd(11 - a, 9);        // 和一定超過十，才需要湊
    var left = 10 - a;
    var right = b - left;

    if (k < 10) {
      // 問左腳。干擾項放右腳 —— 這兩個搞混是這一段最典型的錯
      return tree(a + ' +', b, null, right, 'near', right);
    }
    // 問右腳。干擾項放左腳，同一個混淆反過來
    return tree(a + ' +', b, left, null, 'near', left);
  }

  /** 141–160：腳不畫了，在腦子裡拆。對應課本的心算階段 */
  function addAcrossTen(k) {
    var lo = k < 6 ? 6 : (k < 13 ? 5 : 4);
    var top = k < 6 ? 15 : (k < 13 ? 17 : 18);
    var a = rnd(lo, 9);
    var b = rnd(11 - a, Math.min(9, top - a));
    return plain(a, '+', b);
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
    if (tier === 6) return missingSpot(k, false);               // 雪地：? 在後面
    if (tier === 7) return missingSpot(k, true);                // 彩虹：? 也會跑到前面
    // 城堡、海底、煙火都是三個數。換的只有場景 —— 同一件事再練三十關，
    // 到後面是要他不用數就知道，那需要的是重複，不是新花樣。
    if (tier <= 10) return threeTerms(k);

    // 題型的邊界是 20 關，跟場景（10 關）對不齊，所以 k 要從題型那一段的
    // 第一關算起，不能用 tierInfo(stage).from
    if (stage <= 120) return splitNumber(stage - 101);
    if (stage <= 140) return splitForTen(stage - 121);
    return addAcrossTen(stage - 141);

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
  function makeOptions(ans, mode, trap, min) {
    var offsets = mode === 'carry' ? [-10, -2, -1, 1, 2, 10, 9, -9] : [-3, -2, -1, 1, 2, 3];
    var lo = min || 0;                 // 分解樹的腳不能是 0，那在概念上講不通
    var opts = [ans];
    var guard = 0;

    if (trap != null && trap >= lo && trap !== ans) opts.push(trap);

    while (opts.length < 4 && guard++ < 60) {
      var o = ans + offsets[Math.floor(Math.random() * offsets.length)];
      if (o >= lo && opts.indexOf(o) === -1) opts.push(o);
    }
    while (opts.length < 4) {
      var f = Math.max(lo, ans + opts.length);
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
      // 場景不等寬，不能用 n / PER_TIER 算，要逐個看有沒有打完
      TIERS.forEach(function (t) { if (n >= t.to) total += COINS_PER_TIER_BONUS; });
      return total;
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
    isTierStart: isTierStart,
    isTierEnd: isTierEnd,
    makeSet: makeSet,
    makeQuestion: makeQuestion
  };
})(window);
