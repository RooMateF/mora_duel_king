// 猜☆拳☆王 — Firebase 連線層
// 需要先載入 firebase-app-compat.js / firebase-auth-compat.js / firebase-database-compat.js
// 以及填好設定值的 firebase-config.js(見 README.md)。

const Net = (() => {
  let app, auth, db;
  let myUid = null;

  function init() {
    app = firebase.initializeApp(window.FIREBASE_CONFIG);
    auth = firebase.auth();
    db = firebase.database();
  }

  function signIn() {
    return new Promise((resolve, reject) => {
      auth.signInAnonymously().catch(reject);
      auth.onAuthStateChanged((user) => {
        if (user) {
          myUid = user.uid;
          resolve(user.uid);
        }
      });
    });
  }

  function genRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去掉容易混淆的 0/O/1/I
    let code = "";
    for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  async function createRoom(hostName) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = genRoomCode();
      const ref = db.ref(`rooms/${code}/meta`);
      const snap = await ref.get();
      if (snap.exists()) continue;
      await ref.set({
        createdAt: Date.now(),
        hostUid: myUid,
        hostName: hostName,
        guestUid: null,
        guestName: null,
        status: "waiting",
      });
      return code;
    }
    throw new Error("無法建立房間,請再試一次");
  }

  async function joinRoom(code, guestName) {
    const ref = db.ref(`rooms/${code}/meta`);
    const snap = await ref.get();
    if (!snap.exists()) throw new Error("找不到這個房間代碼");
    const meta = snap.val();
    if (meta.guestUid && meta.guestUid !== myUid) throw new Error("這個房間已經有兩個人了");
    if (meta.hostUid === myUid) throw new Error("不能加入自己建立的房間");
    await ref.update({ guestUid: myUid, guestName: guestName, status: "playing" });
    return code;
  }

  function watchMeta(code, callback) {
    const ref = db.ref(`rooms/${code}/meta`);
    ref.on("value", (snap) => callback(snap.val()));
    return () => ref.off("value");
  }

  function watchPublic(code, callback) {
    const ref = db.ref(`rooms/${code}/public`);
    ref.on("value", (snap) => callback(snap.val()));
    return () => ref.off("value");
  }

  function publishPublic(code, publicState) {
    return db.ref(`rooms/${code}/public`).set(publicState);
  }

  function publishPrivate(code, uid, privateState) {
    return db.ref(`rooms/${code}/private/${uid}`).set(privateState);
  }

  function watchPrivate(code, uid, callback) {
    const ref = db.ref(`rooms/${code}/private/${uid}`);
    ref.on("value", (snap) => callback(snap.val()));
    return () => ref.off("value");
  }

  async function sendRpcRequest(code, targetUid, request) {
    await db.ref(`rooms/${code}/rpc/${targetUid}/request`).set(request);
  }

  function listenRpcRequest(code, uid, callback) {
    const ref = db.ref(`rooms/${code}/rpc/${uid}/request`);
    ref.on("value", (snap) => {
      const req = snap.val();
      if (req) callback(req);
    });
    return () => ref.off("value");
  }

  async function sendRpcResponse(code, uid, id, value) {
    await db.ref(`rooms/${code}/rpc/${uid}/response`).set({ id, value });
    await db.ref(`rooms/${code}/rpc/${uid}/request`).remove();
  }

  function waitRpcResponse(code, targetUid, id) {
    return new Promise((resolve) => {
      const ref = db.ref(`rooms/${code}/rpc/${targetUid}/response`);
      const handler = (snap) => {
        const resp = snap.val();
        if (resp && resp.id === id) {
          ref.off("value", handler);
          resolve(resp.value);
        }
      };
      ref.on("value", handler);
    });
  }

  function myUidValue() {
    return myUid;
  }

  // ── 房間清理 ──────────────────────────────────────────────
  // Realtime Database 沒有 TTL,沒清就會永遠留著。三道防線:
  //  1) 等待對手期間掛 onDisconnect:房主關掉分頁/斷線,伺服器端自動把房間刪掉。
  //  2) 對手一進來就取消上面那個 onDisconnect —— 對局中短暫斷線很常見,
  //     不能因為一次網路抖動就把進行中的對局整個刪掉。
  //  3) 對局結束後由房主主動刪除。
  // 註:刪整個 rooms/$roomCode 需要 database.rules.json 給房主該層的寫入權限,
  //     規則沒部署的話這裡會被拒絕(所以呼叫端都要容錯,不能讓遊戲流程掛掉)。
  function armRoomAutoDelete(code) {
    return db.ref(`rooms/${code}`).onDisconnect().remove();
  }

  function cancelRoomAutoDelete(code) {
    return db.ref(`rooms/${code}`).onDisconnect().cancel();
  }

  function deleteRoom(code) {
    return db.ref(`rooms/${code}`).remove();
  }

  return {
    init, signIn, createRoom, joinRoom, watchMeta, watchPublic,
    publishPublic, publishPrivate, watchPrivate,
    sendRpcRequest, listenRpcRequest, sendRpcResponse, waitRpcResponse,
    armRoomAutoDelete, cancelRoomAutoDelete, deleteRoom,
    myUid: myUidValue,
  };
})();
