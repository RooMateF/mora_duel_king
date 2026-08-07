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

  // timedOut:這次回應是不是「時間到,系統自動選的」而不是玩家真的選的 —— 呼叫端
  // (makeUi.ask())要知道這件事才能觸發逾時懲罰(強制抽一張牌),並正確記錄紀錄。
  async function sendRpcResponse(code, uid, id, value, timedOut) {
    await db.ref(`rooms/${code}/rpc/${uid}/response`).set({ id, value, timedOut: !!timedOut });
    await db.ref(`rooms/${code}/rpc/${uid}/request`).remove();
  }

  // 回傳整包 {id, value, timedOut},不再只回傳 value —— 呼叫端要看 timedOut 才能判斷
  // 要不要觸發逾時懲罰。
  function waitRpcResponse(code, targetUid, id) {
    return new Promise((resolve) => {
      const ref = db.ref(`rooms/${code}/rpc/${targetUid}/response`);
      const handler = (snap) => {
        const resp = snap.val();
        if (resp && resp.id === id) {
          ref.off("value", handler);
          resolve(resp);
        }
      };
      ref.on("value", handler);
    });
  }

  // 出牌限時的共用倒數:輕量的 partial update,不用像 publishPublic 整份重傳
  // (那份還包在完整戰場快照裡,一次寫入成本高很多)。deadline/role 為 null 代表清掉倒數。
  function publishTurnDeadline(code, deadline, role) {
    return db.ref(`rooms/${code}/public`).update({ turnDeadline: deadline || null, turnRole: role || null });
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

  async function deleteRoom(code) {
    await db.ref(`rooms/${code}`).remove();
    await db.ref(`roomIndex/${code}`).remove().catch(() => { /* 沒建索引就算了 */ });
  }

  // ── 超過一天的房間定期清掉 ────────────────────────────────
  // 要清就得先知道有哪些房間,但「開放讀取 rooms 根節點」不可行:Firebase 規則是
  // 往下放寬的,那樣會連 rooms/$code/private 一起開放,對手就能讀到你蓋的星星卡。
  // 所以另外開一個只存「房間代碼 → 開始時間」的索引節點,不含任何牌面資訊。
  // 索引只在對局真正開始後才寫入 —— 等待中的房間本來就由 onDisconnect 負責,
  // 也就不會被列進索引,避免有人掃索引去搶進別人還在等人的房間。
  const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

  function indexRoom(code) {
    return db.ref(`roomIndex/${code}`).set(firebase.database.ServerValue.TIMESTAMP);
  }

  async function sweepStaleRooms(maxDeletes = 20) {
    const snap = await db.ref("roomIndex").get();
    const all = snap.val() || {};
    const cutoff = Date.now() - ROOM_TTL_MS;
    const stale = Object.keys(all)
      .filter((code) => typeof all[code] === "number" && all[code] <= cutoff)
      .slice(0, maxDeletes); // 一次不要清太多,避免單次開啟頁面打太多請求
    let removed = 0;
    for (const code of stale) {
      try {
        await deleteRoom(code);
        removed++;
      } catch (_) { /* 沒權限或已被別人清掉,跳過就好 */ }
    }
    return { indexed: Object.keys(all).length, stale: stale.length, removed };
  }

  return {
    init, signIn, createRoom, joinRoom, watchMeta, watchPublic,
    publishPublic, publishPrivate, watchPrivate,
    sendRpcRequest, listenRpcRequest, sendRpcResponse, waitRpcResponse, publishTurnDeadline,
    armRoomAutoDelete, cancelRoomAutoDelete, deleteRoom,
    indexRoom, sweepStaleRooms,
    myUid: myUidValue,
  };
})();
