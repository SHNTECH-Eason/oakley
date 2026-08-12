/**
 * Firebase 專案設定
 *
 * 這裡的 apiKey 不是密碼。Firebase 網頁版的 apiKey 只是專案識別碼，
 * 本來就會出現在網頁原始碼裡，Google 的文件也說明它可以公開。
 * 真正擋住別人存取資料的是 Firestore 安全規則（見 firestore.rules）。
 *
 * 要換成別的 Firebase 專案，改這個檔案就好。
 */
export const firebaseConfig = {
  apiKey: 'AIzaSyA00tyzVCRCvAy2TPSKdEERFpGbdhEK058',
  authDomain: 'oakley-d414f.firebaseapp.com',
  projectId: 'oakley-d414f',
  storageBucket: 'oakley-d414f.firebasestorage.app',
  messagingSenderId: '1062846263205',
  appId: '1:1062846263205:web:4d5d87386b107ffc43424c'
};

/** Firebase JS SDK 版本（CDN 路徑用） */
export const SDK_VERSION = '12.17.1';

/** 設 false 可以完全關掉雲端同步，只用本機 localStorage */
export const SYNC_ENABLED = true;
