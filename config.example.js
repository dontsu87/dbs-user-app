// 配信先の設定。config.js としてコピーし、デプロイ時に書き換える。
// ここに鍵や個人識別子を書かないこと。Worker のURLは秘密ではない。
window.__DBSCP_CONFIG__ = {
  apiUrl: "https://dbs-billing-view.example.workers.dev",
};
