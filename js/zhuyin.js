/**
 * 注音渲染模組
 *
 * 提供中文字 → 直式注音（符號直排、聲調置右）的 DOM 產生器，
 * 版面規則沿用實體海報：聲調用紅色、輕聲「˙」標在符號正上方。
 *
 * 用 DOM 節點而非 innerHTML 組字，因為家長模式可以自訂作息項目名稱，
 * 那些字串不該被當成 HTML 解讀。
 */
(function (global) {
  'use strict';

  var TONES = ['ˊ', 'ˇ', 'ˋ', '˙'];

  // 字典只收本 App 會出現的字。查不到的字會原樣顯示（不加注音），
  // 所以家長自訂項目時就算用到冷僻字也不會壞掉。
  var DICT = {
    // ── 作息項目 ──
    起: 'ㄑㄧˇ', 床: 'ㄔㄨㄤˊ', 刷: 'ㄕㄨㄚ', 牙: 'ㄧㄚˊ', 洗: 'ㄒㄧˇ', 臉: 'ㄌㄧㄢˇ',
    換: 'ㄏㄨㄢˋ', 衣: 'ㄧ', 服: 'ㄈㄨˊ', 吃: 'ㄔ', 早: 'ㄗㄠˇ', 餐: 'ㄘㄢ',
    出: 'ㄔㄨ', 門: 'ㄇㄣˊ', 上: 'ㄕㄤˋ', 學: 'ㄒㄩㄝˊ', 晚: 'ㄨㄢˇ',
    時: 'ㄕˊ', 間: 'ㄐㄧㄢ', 遊: 'ㄧㄡˊ', 戲: 'ㄒㄧˋ', 閱: 'ㄩㄝˋ', 讀: 'ㄉㄨˊ',
    收: 'ㄕㄡ', 拾: 'ㄕˊ', 澡: 'ㄗㄠˇ', 整: 'ㄓㄥˇ', 理: 'ㄌㄧˇ', 書: 'ㄕㄨ', 包: 'ㄅㄠ',
    滴: 'ㄉㄧ', 眼: 'ㄧㄢˇ', 藥: 'ㄧㄠˋ', 水: 'ㄕㄨㄟˇ', 噴: 'ㄆㄣ', 鼻: 'ㄅㄧˊ', 子: '˙ㄗ',
    睡: 'ㄕㄨㄟˋ', 覺: 'ㄐㄧㄠˋ', 午: 'ㄨˇ', 中: 'ㄓㄨㄥ', 功: 'ㄍㄨㄥ', 課: 'ㄎㄜˋ',
    運: 'ㄩㄣˋ', 動: 'ㄉㄨㄥˋ', 幫: 'ㄅㄤ', 忙: 'ㄇㄤˊ', 練: 'ㄌㄧㄢˋ', 琴: 'ㄑㄧㄣˊ',

    // ── 介面 ──
    今: 'ㄐㄧㄣ', 天: 'ㄊㄧㄢ', 本: 'ㄅㄣˇ', 週: 'ㄓㄡ', 紀: 'ㄐㄧˋ', 錄: 'ㄌㄨˋ',
    家: 'ㄐㄧㄚ', 長: 'ㄓㄤˇ', 完: 'ㄨㄢˊ', 成: 'ㄔㄥˊ', 爪: 'ㄓㄨㄚˇ', 印: 'ㄧㄣˋ',
    連: 'ㄌㄧㄢˊ', 續: 'ㄒㄩˋ', 月: 'ㄩㄝˋ', 年: 'ㄋㄧㄢˊ', 日: 'ㄖˋ',
    星: 'ㄒㄧㄥ', 期: 'ㄑㄧˊ', 目: 'ㄇㄨˋ', 標: 'ㄅㄧㄠ', 表: 'ㄅㄧㄠˇ',
    作: 'ㄗㄨㄛˋ', 息: 'ㄒㄧˊ', 任: 'ㄖㄣˋ', 務: 'ㄨˋ', 蓋: 'ㄍㄞˋ', 章: 'ㄓㄤ',
    獎: 'ㄐㄧㄤˇ', 勵: 'ㄌㄧˋ', 點: 'ㄉㄧㄢˇ', 數: 'ㄕㄨˋ', 總: 'ㄗㄨㄥˇ', 共: 'ㄍㄨㄥˋ',
    集: 'ㄐㄧˊ', 滿: 'ㄇㄢˇ', 全: 'ㄑㄩㄢˊ', 部: 'ㄅㄨˋ', 個: 'ㄍㄜˋ', 項: 'ㄒㄧㄤˋ',

    // ── 稱讚語 ──
    好: 'ㄏㄠˇ', 棒: 'ㄅㄤˋ', 太: 'ㄊㄞˋ', 加: 'ㄐㄧㄚ', 油: 'ㄧㄡˊ',
    厲: 'ㄌㄧˋ', 害: 'ㄏㄞˋ', 努: 'ㄋㄨˇ', 力: 'ㄌㄧˋ', 繼: 'ㄐㄧˋ',
    習: 'ㄒㄧˊ', 慣: 'ㄍㄨㄢˋ', 救: 'ㄐㄧㄡˋ', 援: 'ㄩㄢˊ', 隊: 'ㄉㄨㄟˋ', 汪: 'ㄨㄤ',
    我: 'ㄨㄛˇ', 的: '˙ㄉㄜ', 了: '˙ㄌㄜ', 小: 'ㄒㄧㄠˇ', 朋: 'ㄆㄥˊ', 友: 'ㄧㄡˇ',
    還: 'ㄏㄞˊ', 差: 'ㄔㄚ', 沒: 'ㄇㄟˊ', 有: 'ㄧㄡˇ', 已: 'ㄧˇ', 經: 'ㄐㄧㄥ',
    明: 'ㄇㄧㄥˊ', 昨: 'ㄗㄨㄛˊ', 到: 'ㄉㄠˋ', 分: 'ㄈㄣ', 零: 'ㄌㄧㄥˊ',

    // ── 特別獎勵 ──
    幫: 'ㄅㄤ', 做: 'ㄗㄨㄛˋ', 事: 'ㄕˋ', 自: 'ㄗˋ', 己: 'ㄐㄧˇ',
    玩: 'ㄨㄢˊ', 具: 'ㄐㄩˋ', 禮: 'ㄌㄧˇ', 貌: 'ㄇㄠˋ',
    勇: 'ㄩㄥˇ', 敢: 'ㄍㄢˇ', 嘗: 'ㄔㄤˊ', 試: 'ㄕˋ',
    主: 'ㄓㄨˇ', 看: 'ㄎㄢˋ', 願: 'ㄩㄢˋ', 意: 'ㄧˋ', 享: 'ㄒㄧㄤˇ',
    飯: 'ㄈㄢˋ', 特: 'ㄊㄜˋ', 別: 'ㄅㄧㄝˊ', 現: 'ㄒㄧㄢˋ',
    領: 'ㄌㄧㄥˇ', 給: 'ㄍㄟˇ', 得: 'ㄉㄜˊ', 到: 'ㄉㄠˋ',

    // ── 數字與名字 ──
    一: 'ㄧ', 二: 'ㄦˋ', 三: 'ㄙㄢ', 四: 'ㄙˋ', 五: 'ㄨˇ',
    六: 'ㄌㄧㄡˋ', 七: 'ㄑㄧ', 八: 'ㄅㄚ', 九: 'ㄐㄧㄡˇ', 十: 'ㄕˊ',
    林: 'ㄌㄧㄣˊ', 禹: 'ㄩˇ', 欣: 'ㄒㄧㄣ'
  };

  /** 把注音字串拆成 { symbols: [..], tone: 'ˇ', toneTop: false } */
  function parse(zy) {
    var toneTop = false;
    var tone = '';
    var body = zy;

    if (body.charAt(0) === '˙') {          // 輕聲標在上方
      toneTop = true;
      tone = '˙';
      body = body.slice(1);
    } else {
      var last = body.charAt(body.length - 1);
      if (TONES.indexOf(last) !== -1) {
        tone = last;
        body = body.slice(0, -1);
      }
    }
    return { symbols: body.split(''), tone: tone, toneTop: toneTop };
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /**
   * 把一段文字轉成帶注音的 DocumentFragment。
   * 查不到注音的字元（英數、標點、空白）原樣輸出。
   */
  function render(text) {
    var frag = document.createDocumentFragment();

    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      var zy = DICT[ch];

      if (!zy) {
        frag.appendChild(el('span', 'zy-plain', ch));
        continue;
      }

      var parsed = parse(zy);
      var box = el('span', 'zy');
      box.appendChild(el('span', 'zy-char', ch));

      var phonetic = el('span', 'zy-ph');
      var symbols = el('span', 'zy-sym');
      if (parsed.toneTop) symbols.appendChild(el('span', 'zy-tone-top', parsed.tone));
      parsed.symbols.forEach(function (s) { symbols.appendChild(el('span', null, s)); });
      phonetic.appendChild(symbols);
      if (parsed.tone && !parsed.toneTop) {
        phonetic.appendChild(el('span', 'zy-tone', parsed.tone));
      }

      box.appendChild(phonetic);
      frag.appendChild(box);
    }
    return frag;
  }

  /** 清空容器後填入帶注音的文字 */
  function fill(container, text) {
    container.textContent = '';
    container.appendChild(render(text));
    return container;
  }

  global.Zhuyin = { render: render, fill: fill, dict: DICT };
})(window);
