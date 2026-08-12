/**
 * 多裝置同步（Firebase Firestore）
 *
 * 設計原則：localStorage 永遠是畫面的來源，同步只是背景的事。
 * 所以就算 Firebase 掛掉、網路不通、SDK 載不下來，App 一樣能正常打卡，
 * 只是那些改動會留在這台裝置上，等連上線再補傳。
 *
 * 資料位置：
 *   families/{familyId}/meta/profile      設定與作息項目
 *   families/{familyId}/records/{日期}    每天的打卡紀錄
 *
 * familyId 就是配對碼。第一台裝置自動產生，其他裝置輸入同一組碼即可共用資料。
 * 沒有帳號密碼，安全性來自這串亂碼夠長猜不到 —— 所以配對碼等同鑰匙，別外流。
 */
import { firebaseConfig, SDK_VERSION, SYNC_ENABLED } from './firebase-config.js';

const CDN = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;
const FAMILY_KEY = 'oakley.familyId';

// 配對碼字母表：拿掉容易看錯的 0/O/1/I，方便在另一台裝置上手動輸入
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

let status = 'off';                 // off | connecting | online | offline | error
let statusDetail = '';
const statusListeners = [];

let db = null;
let unsubscribes = [];
let pushing = false;                // 首次上傳期間先不要被自己觸發
let reconciled = false;             // 每次 attach 只跟伺服器對帳一次

// ── 配對碼 ────────────────────────────────────────────────

function newFamilyId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < 16; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function getFamilyId() {
  let id = localStorage.getItem(FAMILY_KEY);
  if (!id) {
    id = newFamilyId();
    localStorage.setItem(FAMILY_KEY, id);
  }
  return id;
}

/** 顯示用：ABCD-EFGH-JKMN-PQRS */
function formatCode(id) {
  return (id.match(/.{1,4}/g) || []).join('-');
}

function normalizeCode(input) {
  return String(input || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

// ── 狀態回報 ──────────────────────────────────────────────

function setStatus(next, detail) {
  status = next;
  statusDetail = detail || '';
  statusListeners.forEach((fn) => fn(status, statusDetail));
}

// ── 啟動 ──────────────────────────────────────────────────

let fb = null;                      // 動態載入的 Firestore API

async function loadSDK() {
  const [app, auth, firestore] = await Promise.all([
    import(`${CDN}/firebase-app.js`),
    import(`${CDN}/firebase-auth.js`),
    import(`${CDN}/firebase-firestore.js`)
  ]);
  return { ...app, ...auth, ...firestore };
}

async function start() {
  if (!SYNC_ENABLED) {
    setStatus('off', '同步已關閉');
    return;
  }

  setStatus('connecting', '連線中…');

  try {
    fb = await loadSDK();
  } catch (e) {
    // 通常是完全離線、或公司網路擋掉 gstatic。App 照常運作，只是不同步。
    setStatus('error', '載不到 Firebase（離線或被網路擋住）');
    console.warn('Firebase SDK 載入失敗：', e);
    return;
  }

  try {
    const app = fb.initializeApp(firebaseConfig);

    // 開離線快取：斷網時照樣讀寫，恢復連線自動補傳
    db = fb.initializeFirestore(app, {
      localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() })
    });

    await fb.signInAnonymously(fb.getAuth(app));
  } catch (e) {
    setStatus('error', describeError(e));
    console.warn('Firebase 初始化失敗：', e);
    return;
  }

  attach(getFamilyId());
}

function describeError(e) {
  const code = (e && e.code) || '';
  // 這幾個是設定沒做完，訊息要直接講出該去哪裡按什麼
  if (code.includes('configuration-not-found') || code.includes('operation-not-allowed')) {
    return '請到 Firebase 主控台 → Authentication → 啟用「匿名」登入';
  }
  if (code.includes('permission-denied')) return '請到 Firestore → 規則，貼上 firestore.rules 並發布';
  if (code.includes('not-found')) return '請先在 Firebase 主控台建立 Firestore 資料庫';
  if (code.includes('unavailable')) return '連不上 Firestore，資料先存在本機，之後會自動補傳';
  return (e && e.message) || '未知錯誤';
}

// ── 監聽遠端 ──────────────────────────────────────────────

function detach() {
  unsubscribes.forEach((fn) => { try { fn(); } catch (e) {} });
  unsubscribes = [];
}

function attach(familyId) {
  detach();
  reconciled = false;

  const profileRef = fb.doc(db, 'families', familyId, 'meta', 'profile');
  const recordsRef = fb.collection(db, 'families', familyId, 'records');

  unsubscribes.push(fb.onSnapshot(profileRef, (snap) => {
    if (snap.exists()) {
      Store.applyRemoteProfile(snap.data());
    } else if (!pushing) {
      pushProfile(familyId);            // 這個家庭還沒資料，把本機的當成初始值
    }
  }, (e) => setStatus('error', describeError(e))));

  unsubscribes.push(fb.onSnapshot(recordsRef, { includeMetadataChanges: true }, (snap) => {
    // 對帳一定要在套用遠端資料「之前」跑，它讀的是還沒被覆蓋的本機紀錄
    const firstServerSync = !reconciled && !snap.metadata.fromCache;
    if (firstServerSync) {
      reconciled = true;
      reconcile(familyId, snap);
    }

    snap.docChanges().forEach((change) => {
      if (change.type === 'removed') {
        Store.applyRemoteRecord(change.doc.id, null);
      } else if (reconciled && !firstServerSync) {
        // 對過帳之後，遠端才是那一天的權威，別台的取消才傳得過來
        Store.applyRemoteRecord(change.doc.id, change.doc.data());
      } else {
        // 對帳前（含離線快取）一律合併，寧可多一個章也不要弄丟
        Store.mergeRemoteDay(change.doc.id, change.doc.data());
      }
    });

    setStatus(snap.metadata.fromCache ? 'offline' : 'online',
              snap.metadata.fromCache ? '離線中，改動會先存在這台' : '已同步');
  }, (e) => setStatus('error', describeError(e))));
}

/**
 * 把本機有、雲端沒有的紀錄補上去。
 *
 * 這台裝置可能離線好幾天才連上來，也可能是第一次同步，
 * 不能只在雲端全空時才上傳，不然那些紀錄會永遠卡在本機。
 *
 * 取聯集，偏向「絕不弄丟任何一個爪印」。代價是：如果家長在 A 裝置取消了某一項，
 * 而 B 裝置離線時還記著舊的完成狀態，B 上線後那一項會被補回來。
 * 對貼紙表來說，寧可多一個章也不要少一個。
 */
function reconcile(familyId, snap) {
  const remote = {};
  snap.forEach((d) => { remote[d.id] = d.data(); });

  const local = Store.state.records;
  const writes = [];

  Object.keys(local).forEach((dateKey) => {
    const missing = {};
    Object.keys(local[dateKey]).forEach((taskId) => {
      if (!remote[dateKey] || !remote[dateKey][taskId]) missing[taskId] = local[dateKey][taskId];
    });
    if (Object.keys(missing).length) {
      writes.push(fb.setDoc(fb.doc(db, 'families', familyId, 'records', dateKey), missing, { merge: true }));
    }
  });

  if (!writes.length) return;

  pushing = true;
  Promise.all(writes)
    .catch((e) => setStatus('error', describeError(e)))
    .finally(() => { pushing = false; });
}

// ── 推送本機改動 ──────────────────────────────────────────

function pushProfile(familyId) {
  if (!db) return;
  const ref = fb.doc(db, 'families', familyId, 'meta', 'profile');
  fb.setDoc(ref, Store.profileForSync(), { merge: true })
    .catch((e) => setStatus('error', describeError(e)));
}

/** 單一欄位寫入，兩台裝置同時改同一天的不同項目才不會互相蓋掉 */
function pushToggle(familyId, dateKey, taskId, done, expected) {
  if (!db) return;
  const ref = fb.doc(db, 'families', familyId, 'records', dateKey);
  const value = done ? (Store.dayRecord(dateKey)[taskId] || new Date().toISOString()) : fb.deleteField();

  const payload = { [taskId]: value };
  if (typeof expected === 'number') payload._expected = expected;

  fb.setDoc(ref, payload, { merge: true })
    .catch((e) => setStatus('error', describeError(e)));
}

/** 一整天都被取消時，遠端那份也要刪掉，不然會留下只剩中繼欄位的空文件 */
function deleteRemoteDay(familyId, dateKey) {
  if (!db) return;
  fb.deleteDoc(fb.doc(db, 'families', familyId, 'records', dateKey))
    .catch((e) => setStatus('error', describeError(e)));
}

function pushAllRecords(familyId) {
  if (!db) return;
  const records = Store.state.records;
  const keys = Object.keys(records);
  if (!keys.length) return;

  pushing = true;
  Promise.all(keys.map((key) =>
    fb.setDoc(fb.doc(db, 'families', familyId, 'records', key), records[key], { merge: true })
  ))
    .catch((e) => setStatus('error', describeError(e)))
    .finally(() => { pushing = false; });
}

// 本機一有改動就往上推。origin 是 'remote' 的不能推，不然會無限迴圈。
Store.subscribe((state, meta) => {
  if (!db || !meta || meta.origin !== 'local') return;
  const familyId = getFamilyId();

  if (meta.kind === 'record') {
    if (Store.state.records[meta.dateKey]) {
      pushToggle(familyId, meta.dateKey, meta.taskId, meta.done, meta.expected);
    } else {
      deleteRemoteDay(familyId, meta.dateKey);
    }
  } else if (meta.kind === 'profile') {
    pushProfile(familyId);
  } else if (meta.kind === 'all') {
    if (meta.wipe) {
      wipeRemoteRecords(familyId).then(() => pushProfile(familyId));
    } else {
      pushProfile(familyId);
      pushAllRecords(familyId);
    }
  }
});

/** 家長按下「清除所有紀錄」時，雲端那份也要刪掉，不然下次同步又會全部長回來 */
async function wipeRemoteRecords(familyId) {
  if (!db) return;
  pushing = true;
  try {
    const snap = await fb.getDocs(fb.collection(db, 'families', familyId, 'records'));
    await Promise.all(snap.docs.map((d) => fb.deleteDoc(d.ref)));
  } catch (e) {
    setStatus('error', describeError(e));
  } finally {
    pushing = false;
  }
}

// ── 對外 API ──────────────────────────────────────────────

/**
 * 用配對碼加入另一台裝置的家庭。
 * 兩邊紀錄取聯集後再推回去，所以不會有人的努力被蓋掉。
 */
async function join(rawCode) {
  const code = normalizeCode(rawCode);
  if (code.length < 8) throw new Error('配對碼看起來不完整');
  if (!db) throw new Error('目前連不上雲端，請稍後再試');

  setStatus('connecting', '配對中…');
  detach();

  const profileSnap = await fb.getDoc(fb.doc(db, 'families', code, 'meta', 'profile'));
  const recordsSnap = await fb.getDocs(fb.collection(db, 'families', code, 'records'));

  const remote = {};
  recordsSnap.forEach((d) => { remote[d.id] = d.data(); });

  localStorage.setItem(FAMILY_KEY, code);
  Store.mergeRemoteRecords(remote);
  if (profileSnap.exists()) Store.applyRemoteProfile(profileSnap.data());

  pushAllRecords(code);
  attach(code);
  return code;
}

/** 脫離目前的家庭，自己重新開一組（本機資料保留） */
function unpair() {
  const id = newFamilyId();
  localStorage.setItem(FAMILY_KEY, id);
  if (db) {
    pushProfile(id);
    pushAllRecords(id);
    attach(id);
  }
  return id;
}

window.Sync = {
  get enabled() { return SYNC_ENABLED; },
  get status() { return status; },
  get statusDetail() { return statusDetail; },
  get code() { return formatCode(getFamilyId()); },
  onStatus(fn) { statusListeners.push(fn); fn(status, statusDetail); },
  join,
  unpair,
  formatCode
};

start();
