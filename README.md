# Oaklay 汪汪好習慣救援隊

把實體的貼紙作息表搬到手機／平板上：完成一項就點一下蓋爪印，網頁記住所有歷史紀錄並累積點數，多台裝置即時同步。

原本的 A4 列印海報留在 `kids_routine_poster (5).html`，這個 App 沿用它的配色、注音與汪汪隊風格，讓小朋友一眼認得出是同一張表。

---

## 目前有什麼

| 分頁 | 內容 |
|---|---|
| **今天** | 8 個作息項目，點一下蓋爪印（有動畫、音效、震動回饋）。全部完成會跳慶祝畫面 |
| **本週** | 海報那張 8×7 的格子表，一眼看到這週集了幾個 |
| **紀錄** | 總爪印、連續全破天數、打卡天數，加上一整個月的完成度月曆 |
| **家長** | PIN 保護。補登、編輯作息項目、點數規則、多裝置同步、備份匯出入 |

規則：

- 小朋友**只能打卡當天**，過去的日子要補登得走家長模式，避免一次把整週點完
- 每完成一項 = 1 個爪印，當天全部完成再加 5 個（可在家長模式調整）
- 「出門上學」預設只在平日出現，週末不會因為沒上學就斷了連續紀錄
- 已經蓋過的爪印永久有效，就算之後把那個項目刪掉也不會被扣回去

---

## 檔案結構

```
index.html              主畫面（含所有圖示的 SVG 定義）
css/styles.css          全部樣式
js/zhuyin.js            注音字典 + 直式注音渲染
js/store.js             資料層（localStorage，畫面的唯一來源）
js/app.js               四個分頁的 UI 邏輯
js/sync.js              Firebase 同步（選配，載不起來也不影響打卡）
js/firebase-config.js   Firebase 專案設定
manifest.json / sw.js   PWA：加到主畫面、離線可用
firestore.rules         Firestore 安全規則
tools/serve.ps1         本機預覽用的靜態伺服器
icons/                  App 圖示
assets/                 汪汪隊角色圖
```

---

## 本機預覽

這台電腦沒有 node 也沒有 python，所以附了一個 PowerShell 寫的靜態伺服器：

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File tools/serve.ps1 -Port 8080
```

然後開 <http://localhost:8080/>。

> 不能直接用檔案總管點開 `index.html`。`file://` 下 Service Worker 不能註冊、ES module 也會被 CORS 擋掉。

想用同網段的手機測試（需要系統管理員權限的 PowerShell）：

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File tools/serve.ps1 -Port 8080 -Lan
```

---

## Firebase 設定（多裝置同步）

程式碼已經寫好了，但 Firebase 主控台那邊還有三個開關要打開。到 <https://console.firebase.google.com/project/oakley-d414f> ：

**1. 啟用匿名登入**

Authentication → 開始使用 → Sign-in method → 選「匿名」→ 啟用。

沒開這個會看到 `auth/configuration-not-found`。

**2. 建立 Firestore 資料庫**

Firestore Database → 建立資料庫 → 位置選 **asia-east1（台灣）** → 先選正式版模式。

**3. 貼上安全規則**

Firestore Database → 規則 → 把 `firestore.rules` 的內容整份貼上 → 發布。

沒做這步會看到 `permission-denied`。

設定好之後重新整理網頁，家長模式的「多裝置同步」會變成綠燈「已同步」。

### 怎麼配對第二台裝置

1. 第一台：家長模式 → 多裝置同步 → 複製配對碼（像 `T9HL-WNCR-5KRW-YDV6`）
2. 第二台：開同一個網址 → 家長模式 → 多裝置同步 → 貼上配對碼 → 加入

兩邊的紀錄會**取聯集**，所以不會有人的爪印不見。之後任何一台的改動都會即時出現在另一台。

家長 PIN 故意不同步，每台裝置各自設定。

---

## 部署

程式全部是靜態檔案，push 上去就能部署。

**建議：Cloudflare Pages**（免費、支援私有 repo）

1. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git
2. 選這個 repo
3. Build command 留空，Build output directory 填 `/`
4. 部署完會拿到一個 `xxx.pages.dev` 的網址

因為專案裡有孩子的真實姓名，**建議 repo 設成私有**。GitHub 免費帳號的 Pages 只能開在公開 repo，Cloudflare Pages 和 Netlify 的免費方案則可以從私有 repo 部署。

### 手機加到主畫面

用手機瀏覽器開部署後的網址：

- **Android Chrome**：選單 → 加到主畫面
- **iPhone Safari**：分享 → 加入主畫面

加完會有自己的圖示、全螢幕開啟、離線也能用。

---

## 資料存在哪

- **打卡紀錄**存在瀏覽器的 localStorage，畫面永遠讀它 → 點下去零延遲，離線照常用
- 同步只是背景的事。Firebase 掛掉、網路不通、SDK 載不下來，App 一樣能打卡，等連上線自動補傳
- Firestore 結構：`families/{配對碼}/records/{YYYY-MM-DD}`，一天一筆、每項獨立欄位，所以兩台裝置改同一天的不同項目不會互相蓋掉
- 點數一律由紀錄即時算出，不另外存總分，資料不會對不上

### 安全性（老實說）

沒有帳號密碼，**配對碼就是鑰匙**。規則保證要「已登入 + 知道完整的 16 位配對碼」才能存取，而且不准列出所有家庭，所以外人猜不到。

但這也表示：**配對碼外流 = 資料外流**。不要貼到公開的地方，也不要拿這裡存任何敏感資訊。

`js/firebase-config.js` 裡的 `apiKey` 不是密碼 —— Firebase 網頁版的 apiKey 只是專案識別碼，本來就會出現在網頁原始碼裡，擋人的是安全規則。

備份：家長模式可以匯出一份 JSON。清除瀏覽器資料會刪掉本機紀錄（雲端那份還在，重新配對就會拉回來）。

---

## 還沒做的

- **點數兌換管理**：資料結構已經留好 `redeemed` 欄位，之後加獎勵清單和扣點介面不用改結構
