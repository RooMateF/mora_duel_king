// 猜☆拳☆王 — 網頁版主程式(大廳、房間、渲染、房主端遊戲迴圈)

let myUid = null;
let roomCode = null;
let isHost = false;
let myRole = null; // "p1" | "p2"
let game = null; // 只有房主會建立
let hostStarted = false;
let gameLog = [];
// 累計寫入過的 log 行數。gameLog 本身會被裁切、發布到 Firebase 的版本更只送最後幾行,
// 長度都不再單調遞增,所以動畫不能再靠「陣列長度變化」判斷哪些是新事件,改看這個序號。
let logTotal = 0;
let lastPublicSeen = null;
let lastPrivateSeen = null;
let pendingAsk = null; // { title, prompt, options, kind, resolve } — 待處理的「打牌」決策
let lastDifficulty = "normal"; // 結算畫面「再戰一次」要沿用同一個難度

// 各模式啟動時會覆寫這個函式,讓它去抓「當下最新的」狀態來重畫,而不是重播 lastPublicSeen 這個舊快照。
// 這點很重要:引擎剛把某個狀態(例如 starsRevealed)寫回去、還沒來得及讓 log()/publishState 補一次
// render 之前,如果馬上要跳出下一個提示(showCardPickUI),不能只是重播上一次看到的舊畫面。
let refreshBoard = () => { if (lastPublicSeen) renderPublic(lastPublicSeen); };

// 發布到 Firebase 的對戰紀錄只送最後這幾行。原本每次狀態更新都把整份紀錄(上限 300 行)
// 重新 set 一次,而雙方都在監聽整個 public 節點 —— 等於每更新一次就把完整紀錄重新下載一遍,
// 一局累積下來的流量遠大於實際資料量。畫面上的紀錄面板本來也只看得到最近幾十行。
const PUBLISHED_LOG_LINES = 60;

function pushLog(text) {
  gameLog.push(text);
  logTotal++;
  if (gameLog.length > 300) gameLog = gameLog.slice(-300);
}

function resetLog() {
  gameLog = [];
  logTotal = 0;
}

function publishedLog() {
  return gameLog.slice(-PUBLISHED_LOG_LINES);
}

// 對局結束後由房主刪掉房間。不能立刻刪:對手要先收到「最終狀態」才看得到勝負結果,
// 房間一沒了對方畫面就停在上一刻。留一段緩衝再刪。
const ROOM_CLEANUP_DELAY_MS = 20000;

function scheduleRoomCleanup(code) {
  if (!code) return;
  setTimeout(() => {
    Net.deleteRoom(code).catch((e) => {
      console.warn("刪除房間失敗(檢查 database.rules.json 是否已部署):", e.message);
    });
  }, ROOM_CLEANUP_DELAY_MS);
}

function $(id) { return document.getElementById(id); }

function showScreen(id) {
  ["lobby", "waiting", "gameScreen"].forEach((s) => $(s).classList.toggle("hidden", s !== id));
}

async function init() {
  Net.init();
  try {
    myUid = await Net.signIn();
  } catch (e) {
    $("lobbyMsg").textContent = "Firebase 尚未設定好,請先完成 README 的設定步驟。(" + e.message + ")";
    return;
  }
  // 順手清掉超過一天的房間(打到一半被放生、沒能走到正常刪除流程的那些)。
  // 不 await:清理失敗或很慢都不該卡住玩家進大廳。
  Net.sweepStaleRooms()
    .then((r) => { if (r.removed) console.info(`已清理 ${r.removed} 個超過一天的房間`); })
    .catch((e) => console.warn("清理舊房間失敗(檢查 database.rules.json 是否已部署):", e.message));

  $("createBtn").onclick = onCreate;
  $("joinBtn").onclick = onJoin;
  document.querySelectorAll(".diffBtn").forEach((btn) => {
    btn.onclick = () => startSinglePlayer(btn.dataset.diff);
  });
  $("rulesBtn").onclick = showRules;
  $("rulesCloseBtn").onclick = () => $("rulesOverlay").classList.add("hidden");
  $("logToggleBtn").onclick = () => {
    $("logOverlay").classList.remove("hidden");
    const t = $("logText");
    t.scrollTop = t.scrollHeight;
  };
  $("logCloseBtn").onclick = () => $("logOverlay").classList.add("hidden");
  $("discardCloseBtn").onclick = () => $("discardOverlay").classList.add("hidden");
  $("copyCodeBtn").onclick = () => {
    navigator.clipboard.writeText(roomCode);
    $("copyCodeBtn").textContent = "已複製!";
    setTimeout(() => { $("copyCodeBtn").textContent = "複製代碼"; }, 1500);
  };
}

async function onCreate() {
  const name = ($("nameInput").value || "").trim() || "玩家";
  $("lobbyMsg").textContent = "";
  try {
    roomCode = await Net.createRoom(name);
  } catch (e) {
    $("lobbyMsg").textContent = e.message;
    return;
  }
  isHost = true;
  myRole = "p1";
  $("roomCodeDisplay").textContent = roomCode;
  showScreen("waiting");
  // 還在等對手的階段就掛好自動刪除:房主這時候關掉分頁,房間不該留在資料庫裡。
  // 失敗(例如規則還沒部署)只警告,不影響開房。
  Net.armRoomAutoDelete(roomCode).catch((e) => {
    console.warn("無法掛上房間自動刪除(檢查 database.rules.json 是否已部署):", e.message);
  });
  Net.watchMeta(roomCode, onRoomUpdateAsHost);
}

async function onJoin() {
  const name = ($("nameInput").value || "").trim() || "玩家";
  const code = ($("codeInput").value || "").trim().toUpperCase();
  $("lobbyMsg").textContent = "";
  if (!code) {
    $("lobbyMsg").textContent = "請輸入房間代碼";
    return;
  }
  try {
    await Net.joinRoom(code, name);
  } catch (e) {
    $("lobbyMsg").textContent = e.message;
    return;
  }
  roomCode = code;
  isHost = false;
  myRole = "p2";
  startGuest();
}

function onRoomUpdateAsHost(room) {
  if (!room) return;
  if (room.guestUid && !hostStarted) {
    hostStarted = true;
    startHostGame(room.hostName, room.guestName, room.guestUid);
  }
}

function startGuest() {
  showScreen("gameScreen");
  Net.watchPublic(roomCode, (pub) => {
    if (pub) renderPublic(pub);
  });
  Net.watchPrivate(roomCode, myUid, (priv) => {
    lastPrivateSeen = priv;
    if (lastPublicSeen) renderPublic(lastPublicSeen);
  });
  Net.listenRpcRequest(roomCode, myUid, async (req) => {
    const value = await showLocalModal(req.title, req.prompt, req.options, req.kind);
    await Net.sendRpcResponse(roomCode, myUid, req.id, value);
  });
}

function startHostGame(hostName, guestName, guestUid) {
  showScreen("gameScreen");
  // 對局開始後就取消自動刪除:對戰中短暫斷線很常見,不能因為一次網路抖動
  // 就把進行中的對局整個刪掉。改由結束時主動刪。
  Net.cancelRoomAutoDelete(roomCode).catch(() => { /* 沒掛成功過就不用取消 */ });
  // 同時登記到索引,萬一這局打到一半就被雙方放生,隔天會被清掉
  Net.indexRoom(roomCode).catch((e) => {
    console.warn("無法登記房間索引(檢查 database.rules.json 是否已部署):", e.message);
  });
  const ui = makeUi(guestUid);
  game = new Game(ui, hostName, guestName);
  // 房主自己畫面用的即時重畫:直接從 game 現況組快照,不用等 Firebase 一來一回,
  // 避免剛寫回的狀態(例如 starsRevealed)還沒進 lastPublicSeen 就要跳出下一個提示。
  refreshBoard = () => {
    lastPrivateSeen = {
      handSun: game.p1.handSun, handMoon: game.p1.handMoon, committedStar: game.p1.committedStar,
      pendingMoonCard: game.p1.pendingMoonCard,
    };
    renderPublic(buildHostPub());
  };

  Net.watchPublic(roomCode, (pub) => {
    if (pub) renderPublic(pub);
  });
  Net.watchPrivate(roomCode, myUid, (priv) => {
    lastPrivateSeen = priv;
    if (lastPublicSeen) renderPublic(lastPublicSeen);
  });
  Net.listenRpcRequest(roomCode, myUid, async (req) => {
    const value = await showLocalModal(req.title, req.prompt, req.options, req.kind);
    await Net.sendRpcResponse(roomCode, myUid, req.id, value);
  });

  runGameLoop(guestUid);
}

function makeUi(guestUid) {
  async function ask(role, title, prompt, options, kind, onResolved) {
    let value;
    if (role === "p1") {
      value = await showLocalModal(title, prompt, options, kind);
    } else {
      const id = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : String(Math.random());
      await Net.sendRpcRequest(roomCode, guestUid, {
        id, title, prompt, kind,
        options: options.map((o) => ({ label: o.label, value: (o.value === undefined ? null : o.value) })),
      });
      value = await Net.waitRpcResponse(roomCode, guestUid, id);
    }
    // 引擎要先把這次選擇的結果寫回 player 物件,畫面才不會照舊狀態畫一次
    if (onResolved) onResolved(value);
    await publishState(guestUid);
    return value;
  }
  async function log(text) {
    pushLog(text);
    await publishState(guestUid);
    await sleep(delayForLogLine(text));
  }
  async function confirm(role, title, prompt) {
    const v = await ask(role, title, prompt, [
      { label: "是", value: true },
      { label: "否", value: false },
    ]);
    return !!v;
  }
  async function info(role, title, msg) {
    await ask(role, title, msg, [{ label: "知道了", value: true }]);
  }
  return { log, ask, confirm, info };
}

function boardSnapshotFor(p, revealStar) {
  return {
    name: p.name,
    stars: { ...p.stars },
    sunPileCount: p.sunPile.length,
    moonPileCount: p.moonPile.length,
    handSunCount: p.handSun.length,
    handMoonCount: p.handMoon.length,
    discardCount: p.discard.length,
    discard: p.discard.slice(), // 棄牌區內容本來就是雙方都看得到的公開資訊,直接整份公開
    playedSun: p.playedSunCards.slice(),
    star: revealStar ? p.committedStar : null,
    // 只公開「這回合已經蓋牌了嗎」的是非值,不洩漏蓋了什麼,讓對手畫面能正確演出
    // 先攻方先把星星卡蓋到檯面上、後攻方才輪到蓋牌的順序
    starCommitted: p.committedStar !== null,
    playedMoon: p.moonDecided ? p.playedMoonCard : null,
    moonPending: !p.moonDecided && p.pendingMoonCard !== null,
  };
}

function buildHostPub() {
  return {
    round: game.roundNum,
    starsRevealed: game.starsRevealed,
    firstIsP1: game.firstIsP1,
    p1: boardSnapshotFor(game.p1, game.starsRevealed),
    p2: boardSnapshotFor(game.p2, game.starsRevealed),
    log: publishedLog(),
    logSeq: logTotal,
    winnerRole: null,
    updatedAt: Date.now(),
  };
}

async function publishState(guestUid) {
  const pub = buildHostPub();
  await Net.publishPublic(roomCode, pub);
  await Net.publishPrivate(roomCode, myUid, {
    handSun: game.p1.handSun, handMoon: game.p1.handMoon, committedStar: game.p1.committedStar,
    pendingMoonCard: game.p1.pendingMoonCard,
  });
  await Net.publishPrivate(roomCode, guestUid, {
    handSun: game.p2.handSun, handMoon: game.p2.handMoon, committedStar: game.p2.committedStar,
    pendingMoonCard: game.p2.pendingMoonCard,
  });
}

async function runGameLoop(guestUid) {
  try {
    while (true) {
      await game.playRound();
    }
  } catch (e) {
    if (e instanceof GameOverError) {
      pushLog(`\n★★★ 遊戲結束!獲勝者:${e.winnerRole === "p1" ? game.p1.name : game.p2.name} ★★★`);
      const pub = {
        round: game.roundNum,
        starsRevealed: true,
        firstIsP1: game.firstIsP1,
        p1: boardSnapshotFor(game.p1, true),
        p2: boardSnapshotFor(game.p2, true),
        log: publishedLog(),
        logSeq: logTotal,
        winnerRole: e.winnerRole,
        updatedAt: Date.now(),
      };
      await Net.publishPublic(roomCode, pub);
      scheduleRoomCleanup(roomCode);
    } else {
      console.error(e);
      pushLog(`發生錯誤:${e.message}`);
      await publishState(guestUid);
    }
  }
}

// -- 單人對戰 AI(完全本機執行,不用 Firebase)-----------------------

function startSinglePlayer(difficulty) {
  isHost = true;
  myRole = "p1";
  roomCode = null;
  lastDifficulty = difficulty;
  resetLog();
  window.__gameOverShown = false;
  showScreen("gameScreen");

  const ui = makeLocalUi();
  game = new Game(ui, "你", "電腦", { vsAi: true, difficulty });
  refreshBoard = renderLocalState;
  renderLocalState();
  runLocalGameLoop();
}

function makeLocalUi() {
  async function ask(_role, title, prompt, options, kind, onResolved) {
    const value = await showLocalModal(title, prompt, options, kind);
    // 引擎要先把這次選擇的結果寫回 player 物件,畫面才不會照舊狀態畫一次
    if (onResolved) onResolved(value);
    renderLocalState();
    return value;
  }
  async function log(text) {
    pushLog(text);
    renderLocalState();
    await sleep(delayForLogLine(text));
  }
  async function confirm(role, title, prompt) {
    const v = await ask(role, title, prompt, [
      { label: "是", value: true },
      { label: "否", value: false },
    ]);
    return !!v;
  }
  async function info(role, title, msg) {
    await ask(role, title, msg, [{ label: "知道了", value: true }]);
  }
  return { log, ask, confirm, info };
}

function renderLocalState(winnerRole) {
  const pub = {
    round: game.roundNum,
    starsRevealed: game.starsRevealed,
    firstIsP1: game.firstIsP1,
    p1: boardSnapshotFor(game.p1, game.starsRevealed || !!winnerRole),
    p2: boardSnapshotFor(game.p2, game.starsRevealed || !!winnerRole),
    log: publishedLog(),
    logSeq: logTotal,
    winnerRole: winnerRole || null,
  };
  lastPrivateSeen = {
    handSun: game.p1.handSun, handMoon: game.p1.handMoon, committedStar: game.p1.committedStar,
    pendingMoonCard: game.p1.pendingMoonCard,
  };
  renderPublic(pub);
}

async function runLocalGameLoop() {
  try {
    while (true) {
      await game.playRound();
    }
  } catch (e) {
    if (e instanceof GameOverError) {
      pushLog(`\n★★★ 遊戲結束!獲勝者:${e.winnerRole === "p1" ? game.p1.name : game.p2.name} ★★★`);
      renderLocalState(e.winnerRole);
    } else {
      console.error(e);
      pushLog(`發生錯誤:${e.message}`);
      renderLocalState();
    }
  }
}

// -- 畫面渲染 ---------------------------------------------------

function renderPublic(pub) {
  const prevPub = lastPublicSeen;
  lastPublicSeen = pub;
  const mineKey = myRole === "p1" ? "p1" : "p2";
  const oppKey = myRole === "p1" ? "p2" : "p1";
  $("statusText").textContent = `⟳ ${pub.round}`;
  renderBand($("oppBand"), pub[oppKey], true, null);
  renderBand($("myBand"), pub[mineKey], false, lastPrivateSeen);
  renderBattlefield(pub, oppKey, mineKey);
  syncDrawPickOverlay();
  renderLog(pub.log || []);
  if (!prevPub && pub.round === 1) showCoinFlip(pub);
  triggerBattleEffects(prevPub, pub, oppKey, mineKey);
  if (pub.winnerRole) showGameOver(pub.winnerRole, pub);
}

// -- 開場硬幣:決定先攻/後攻 -----------------------------------------

function showCoinFlip(pub) {
  if (typeof pub.firstIsP1 !== "boolean") return;
  const firstName = pub.firstIsP1 ? pub.p1.name : pub.p2.name;
  const overlay = $("coinFlipOverlay");
  $("coinFrontFace").textContent = pub.p1.name;
  $("coinBackFace").textContent = pub.p2.name;
  const coin = $("coinEl");
  coin.className = "coin " + (pub.firstIsP1 ? "spin-front" : "spin-back");
  $("coinResultText").textContent = "";
  overlay.classList.remove("hidden");
  setTimeout(() => {
    $("coinResultText").textContent = `${firstName} 先攻!`;
    fx($("coinResultText"), "pop");
  }, 1150);
  setTimeout(() => { overlay.classList.add("hidden"); }, 2700);
}

const DIFF_LABEL = { easy: "簡單", normal: "普通", hard: "困難" };

// 電腦先攻蓋星星卡時:先秀「OOO(難度)的回合」橫幅,橫幅收起後再演示一張牌背從對手那側
// 飛到戰場星星欄位的蓋牌動畫,玩家才能實際看到電腦先出牌這件事,而不是畫面毫無變化
function showOpponentStarSetTurn(pub, oppKey, oppCol) {
  const name = pub[oppKey].name;
  const diffLabel = (typeof game !== "undefined" && game && game.vsAi) ? (DIFF_LABEL[game.difficulty] || "") : "";
  const banner = document.createElement("div");
  banner.className = "turn-order-banner";
  banner.textContent = diffLabel ? `${name}(${diffLabel})的回合` : `${name}的回合`;
  document.body.appendChild(banner);
  nextPaint(() => banner.classList.add("show"));
  setTimeout(() => banner.classList.remove("show"), 500);
  setTimeout(() => {
    banner.remove();
    const oppBand = $("oppBand");
    const fromEl = (oppBand && oppBand.querySelector(".band-name")) || oppBand;
    const starWrap = oppCol.querySelector('[data-slot-kind="star"]');
    flyGhost(fromEl, starWrap, cardImgSrc("back_star"), "?");
  }, 650);
}

// -- 戰鬥畫面特效:翻牌、太陽強化、月亮發動、勝負對撞 -----------------
// 純粹靠比對「上一次 render 的 snapshot」跟「這次的 snapshot」觸發,不需要引擎額外通知,
// 這樣本機/房主/加入者三種模式都能用同一套邏輯(加入者從來不會直接執行 engine.js)。

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 揭示的節奏:翻牌前先停一拍(讓玩家意識到要開牌了),兩張牌之間再錯開一點,
// 一張一張翻比兩張同時翻更有戲。翻牌動畫本身的長度在 style.css 的 starFlipTurn。
const REVEAL_BEAT_MS = 420;
const REVEAL_GAP_MS = 380;
const MOON_FLIP_MS = 1050; // 要跟 style.css 的 starFlipTurn 動畫長度一致

// 揭示期間「還不可以畫成正面」的截止時間(各側分開,因為是一前一後翻)。
// 做在 render 層而不是事後改 DOM:揭示中隨時可能因為 log 更新而重繪,
// 只靠事後把 img 換成背面的話,下一次重繪就會直接把牌面畫出來、破壞揭示。
const revealHoldUntil = { opp: 0, mine: 0 };

function holdRevealFor(side, ms) {
  revealHoldUntil[side] = Date.now() + ms;
}

function isRevealHeld(side) {
  return Date.now() < revealHoldUntil[side];
}

// 每行 log 之後都停一下讓畫面有時間播動畫,關鍵劇情點(開場硬幣、翻牌、出招、發動、抽牌、分出勝負)停久一點
function delayForLogLine(text) {
  if (/^\n===== 第 1 回合 =====/.test(text)) return 1900; // 等開場硬幣動畫播完
  let extra = 0;
  if (/^★ .+ 贏得本回合!$/.test(text) || /^平手!/.test(text)) extra = 1400; // 碰撞特效(閃光+型別衝擊圖)要多留時間播完
  else if (/取走 .+ 的一張『.+』星星卡。/.test(text)) extra = 600; // 星星被吸走的動畫要多留一點時間
  else if (/ 蓋下星星卡。$/.test(text)) extra = 950; // 電腦先攻蓋星星卡:橫幅 + 蓋牌動畫要多留時間播完
  // 揭示改成「停一拍 → 先攻翻 → 後攻翻」,加上翻牌動畫本身放慢到 1.05s,
  // 這裡要留夠時間讓整段演完,不然會被下一行 log 切斷
  else if (/揭示星星:/.test(text)) extra = 950;
  // 升級卡(殞石頭/雷射剪刀/鈦合金布)有機會觸發變身特效(全螢幕暈染+閃光+放大卡圖,約 1.9s),
  // 不確定這次有沒有真的升級成功(型別不符會直接丟棄、沒有特效),但抓最長的情況預留時間,
  // 避免特效播到一半就被下一行 log 切斷、或被下一個提示畫面蓋住。
  else if (/打出太陽卡:(殞石頭|雷射剪刀|鈦合金布)/.test(text)) extra = 2650;
  else if (/打出太陽卡:/.test(text) || /打出【烈陽】!$/.test(text)) extra = 700; // 對手出牌有飛入動畫 + 放慢後的發光
  else if (/發動【.+】/.test(text)) extra = 1500; // 月亮卡改成原地翻開再亮特效,要更久
  else if (/(抽牌|抽了一張牌)。$/.test(text)) extra = 1050; // 抽牌儀式(放大置中→飛進手牌)要多留時間播完
  return 150 + extra;
}

// 勝負對撞的衝擊波:在星星卡格子中心炸開一圈光環,強化「撞上去」的力道感
function spawnShockwave(targetEl, variant) {
  if (!targetEl) return;
  const rect = targetEl.getBoundingClientRect();
  const size = rect.width * 2.6;
  const ring = document.createElement("div");
  ring.className = `clash-shock clash-shock-${variant}`;
  ring.style.left = `${rect.left + rect.width / 2 - size / 2}px`;
  ring.style.top = `${rect.top + rect.height / 2 - size / 2}px`;
  ring.style.width = `${size}px`;
  ring.style.height = `${size}px`;
  document.body.appendChild(ring);
  setTimeout(() => ring.remove(), 650);
}

// 型別對應的碰撞美術:石頭碎裂/剪刀劈砍火花/布纖維噴散,疊在既有的 clash-shock 光環之上,
// 讓「這是石頭 vs 剪刀」有具體的打擊畫面,不再每次都只是同一圈光。
const IMPACT_TYPE_SRC = { "石頭": "img/impact_rock.png", "剪刀": "img/impact_scissor.png", "布": "img/impact_cloth.png" };
const IMPACT_FLASH_SRC = "img/impact_flash.png";

// starType 給了才疊型別專屬圖(平手時兩邊型別一定相同,勝負時用贏家的型別);
// 都跟 spawnShockwave 一樣算好座標貼在 body 上,不受戰場重繪打斷。
function spawnImpactBurst(targetEl, starType) {
  if (!targetEl) return;
  const rect = targetEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;

  const place = (img, size, lifespanMs) => {
    img.style.left = `${cx - size / 2}px`;
    img.style.top = `${cy - size / 2}px`;
    img.style.width = `${size}px`;
    img.style.height = `${size}px`;
    document.body.appendChild(img);
    setTimeout(() => img.remove(), lifespanMs);
  };

  const flash = document.createElement("img");
  flash.src = IMPACT_FLASH_SRC;
  flash.alt = "";
  flash.className = "impact-burst impact-burst-flash";
  place(flash, rect.width * 2.4, 750);

  const typeSrc = starType && IMPACT_TYPE_SRC[starType];
  if (typeSrc) {
    const chip = document.createElement("img");
    chip.src = typeSrc;
    chip.alt = "";
    chip.className = "impact-burst impact-burst-type";
    place(chip, rect.width * 3.2, 1350);
  }
}

// 太陽卡升級成功時的「變身」特效:星星欄位本身的美術不會真的換掉(下一次
// renderBattlefield 一樣畫回原本的石頭/布/剪刀),這裡用一張蓋在最上層、跟畫面
// 重繪脫鉤的浮動 img 做「原圖 → 進化圖」的短暫閃現,搭配從太陽欄位射向星星欄位的
// 光束、以及既有的衝擊波 —— 手法跟 spawnShockwave 一樣,直接算好座標貼在 body 上,
// 才不會被下一次戰場重繪(bf.innerHTML = "")中途打斷。
function playEvolveEffect(starTargetEl, sunTargetEl, evolvedCardName) {
  if (!starTargetEl) return;
  const rect = starTargetEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;

  // 全螢幕金色暈染一閃,把玩家視線先拉過來,再讓底下的星星欄位變身——
  // 之前只在星星格子本身做效果,範圍太小、太容易被忽略,加這層當「事件發生了」的明確訊號。
  const vignette = document.createElement("div");
  vignette.className = "evolve-vignette";
  document.body.appendChild(vignette);
  setTimeout(() => vignette.remove(), 1300);

  // 用戰鬥碰撞同一套白熱閃光素材,疊在星星格中心當「能量灌注」的爆發底圖
  const flash = document.createElement("img");
  flash.src = IMPACT_FLASH_SRC;
  flash.alt = "";
  flash.className = "evolve-flash";
  const flashSize = rect.width * 2.8;
  flash.style.left = `${cx - flashSize / 2}px`;
  flash.style.top = `${cy - flashSize / 2}px`;
  flash.style.width = `${flashSize}px`;
  flash.style.height = `${flashSize}px`;
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 1100);

  // 進化後卡圖本體:比原本卡格明顯放大,強調「這張牌質變了」,不再只是同尺寸換圖
  const overlaySize = rect.width * 1.55;
  const overlay = document.createElement("img");
  overlay.src = cardImgSrc(evolvedCardName);
  overlay.alt = "";
  overlay.className = "evolve-overlay";
  overlay.style.left = `${cx - overlaySize / 2}px`;
  overlay.style.top = `${cy - overlaySize / 2}px`;
  overlay.style.width = `${overlaySize}px`;
  overlay.style.height = `${overlaySize * (rect.height / rect.width)}px`;
  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), 2350);

  if (sunTargetEl) {
    const sunRect = sunTargetEl.getBoundingClientRect();
    const x1 = sunRect.left + sunRect.width / 2, y1 = sunRect.top + sunRect.height / 2;
    const len = Math.hypot(cx - x1, cy - y1);
    const angle = Math.atan2(cy - y1, cx - x1) * 180 / Math.PI;
    const beam = document.createElement("div");
    beam.className = "evolve-beam";
    beam.style.left = `${x1}px`;
    beam.style.top = `${y1}px`;
    beam.style.width = `${len}px`;
    beam.style.transform = `rotate(${angle}deg)`;
    document.body.appendChild(beam);
    setTimeout(() => beam.remove(), 700);
  }

  spawnShockwave(starTargetEl, "sun");
  fx(starTargetEl, "fx-evolve-pulse");
  fx($("battlefield"), "fx-shake");
}

function fx(el, cls) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth; // 強制 reflow,確保動畫在 class 重新加上時真的會重播
  el.classList.add(cls);
}

// 從 bandEl(oppBand/myBand)裡找出標籤符合的牌庫/手牌堆疊縮圖(太陽庫、月亮庫、太陽手牌、月亮手牌)
function bandPileTileImg(bandEl, label) {
  if (!bandEl) return null;
  const tiles = bandEl.querySelectorAll(".pile-tile-wrap");
  for (const t of tiles) {
    const cap = t.querySelector(".pile-tile-label");
    if (cap && cap.textContent === label) return t.querySelector(".pile-back");
  }
  return null;
}

// 保險用的「下一幀」:一般瀏覽器用 requestAnimationFrame 最順,但分頁不在前景/沒在合成畫面時
// rAF 可能整個不會觸發,額外排一個 setTimeout 當備援,兩個哪個先到就跑,確保動畫一定會開始播放。
function nextPaint(fn) {
  let done = false;
  const run = () => { if (done) return; done = true; fn(); };
  requestAnimationFrame(run);
  setTimeout(run, 50);
}

// 讓一張卡從 fromEl 的位置飛到 toEl 的位置再消失,onArrive 在飛抵時觸發(通常接著播欄位本身的特效)。
// 用 CSS 自訂屬性描述起點/中繼點/終點,搭配單一 keyframes 動畫走出一道拱起的弧線,
// 比單純直線內插更有「丟一張牌出去」的力道感,中繼點還會帶一點傾斜再擺正。
function flyGhost(fromEl, toEl, src, altText, onArrive) {
  if (!fromEl || !toEl) { if (onArrive) onArrive(); return; }
  const fromRect = fromEl.getBoundingClientRect();
  const toRect = toEl.getBoundingClientRect();
  const dx = toRect.left - fromRect.left;
  const dy = toRect.top - fromRect.top;
  const arcLift = Math.max(36, Math.abs(dx) * 0.22);
  const ghost = document.createElement("img");
  ghost.src = src;
  ghost.alt = altText || "";
  ghost.className = "fly-card-ghost";
  ghost.style.width = `${toRect.width}px`;
  ghost.style.left = "0px";
  ghost.style.top = "0px";
  ghost.style.setProperty("--fly-start-x", `${fromRect.left}px`);
  ghost.style.setProperty("--fly-start-y", `${fromRect.top}px`);
  ghost.style.setProperty("--fly-mid-x", `${fromRect.left + dx * 0.5}px`);
  ghost.style.setProperty("--fly-mid-y", `${fromRect.top + dy * 0.5 - arcLift}px`);
  ghost.style.setProperty("--fly-end-x", `${toRect.left}px`);
  ghost.style.setProperty("--fly-end-y", `${toRect.top}px`);
  ghost.style.transform = `translate(${fromRect.left}px, ${fromRect.top}px) scale(0.6) rotate(-8deg)`;
  ghost.style.opacity = "0.4";
  document.body.appendChild(ghost);
  nextPaint(() => ghost.classList.add("fly-arc"));
  setTimeout(() => {
    ghost.remove();
    if (onArrive) onArrive();
  }, 440);
}

function flyCardIn(fromEl, toEl, cardName, onArrive) {
  flyGhost(fromEl, toEl, cardImgSrc(cardName), cardName, onArrive);
}

// 抽牌儀式:牌堆放大移到畫面正中央停留一下(像現實世界把牌從牌堆抽出來看一眼),
// 再縮小飛進手牌區消失。destEl 可以是元素、也可以是回傳元素的函式(在飛到手牌前才重新查一次,
// 避免動畫途中畫面重繪導致目的地位置抓到舊的/已被移除的節點)。回傳 Promise,動畫播完才 resolve。
function flyDrawCeremony(fromEl, destEl, backSrc) {
  return new Promise((resolve) => {
    if (!fromEl) { resolve(); return; }
    const startRect = fromEl.getBoundingClientRect();
    const ghost = document.createElement("img");
    ghost.src = backSrc;
    ghost.className = "draw-ceremony-ghost";
    ghost.style.width = `${startRect.width}px`;
    ghost.style.left = "0px";
    ghost.style.top = "0px";
    ghost.style.transform = `translate(${startRect.left}px, ${startRect.top}px) scale(1)`;
    document.body.appendChild(ghost);

    const vw = window.innerWidth, vh = window.innerHeight;
    const bigWidth = Math.min(140, vw * 0.34);
    const scaleUp = bigWidth / startRect.width;
    const centerX = vw / 2 - bigWidth / 2;
    const centerY = vh * 0.4 - (bigWidth * 1.4) / 2;

    // 卡片放大置中的當下,身後炸一圈光暈,加強「揭示」的儀式感
    const glowSize = bigWidth * 2.6;
    const glow = document.createElement("div");
    glow.className = "draw-ceremony-glow";
    glow.style.left = `${vw / 2 - glowSize / 2}px`;
    glow.style.top = `${vh * 0.4 - glowSize / 2}px`;
    glow.style.width = `${glowSize}px`;
    glow.style.height = `${glowSize}px`;
    document.body.appendChild(glow);

    nextPaint(() => {
      ghost.style.transition = "transform 0.38s cubic-bezier(.2,.8,.3,1)";
      ghost.style.transform = `translate(${centerX}px, ${centerY}px) scale(${scaleUp})`;
      glow.classList.add("show");
    });

    setTimeout(() => {
      glow.classList.remove("show");
      glow.classList.add("hide");
    }, 560);
    setTimeout(() => glow.remove(), 900);

    setTimeout(() => {
      const dest = typeof destEl === "function" ? destEl() : destEl;
      const destRect = dest ? dest.getBoundingClientRect() : startRect;
      // 目的地(尤其是自己的整排手牌區)可能比原本的牌堆寬很多,縮小的目標尺寸只抓「差不多原本那麼小」,
      // 不要真的撐大去貼合整個容器的寬度
      const targetWidth = Math.min(destRect.width || startRect.width, startRect.width * 1.4, bigWidth);
      const scaleDown = targetWidth / startRect.width;
      ghost.style.transition = "transform 0.38s ease-in, opacity 0.28s ease-in";
      ghost.style.transform = `translate(${destRect.left}px, ${destRect.top}px) scale(${scaleDown})`;
      ghost.style.opacity = "0.25";
    }, 620);

    setTimeout(() => {
      ghost.remove();
      resolve();
    }, 1000);
  });
}

// 牌堆脈動一下,接著播抽牌儀式(放大置中→飛進手牌區),表示「剛剛抽了一張牌」(自己、對手都適用)
function animateDraw(bandEl, isOpp, pileLabel, handLabel, backKind) {
  const pileImg = bandPileTileImg(bandEl, pileLabel);
  fx(pileImg, "fx-draw-pulse");
  const destGetter = () => (isOpp ? bandPileTileImg(bandEl, handLabel) : (bandEl && bandEl.querySelector(".hand")));
  flyDrawCeremony(pileImg, destGetter, cardImgSrc(backKind));
}

// 玩家自己選要抽太陽/月亮牌堆時,可以直接向下滑動那疊牌來抽,像現實世界抽牌一樣把一張牌拉走;
// 沒有滑動、只是單純點一下的話則走跟其他卡片一樣的「點一下標記、按確認鈕」流程。
function attachSwipeDraw(el, opts) {
  const { onArm, onConfirm, cardBackSrc, ariaLabel, destEl } = opts;
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  if (ariaLabel) el.setAttribute("aria-label", ariaLabel);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onConfirm(); }
  });

  const SWIPE_THRESHOLD = 34;
  let startX = 0, startY = 0, pointerId = null, ghost = null, moved = false, pulled = false;

  el.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    startX = e.clientX;
    startY = e.clientY;
    pointerId = e.pointerId;
    moved = false;
    pulled = false;
    try { el.setPointerCapture(pointerId); } catch (_) { /* 不支援時忽略 */ }
  });

  el.addEventListener("pointermove", (e) => {
    if (pointerId === null || e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (dy > 6 && dy > Math.abs(dx) * 1.2) {
      moved = true;
      if (!ghost) {
        const rect = el.getBoundingClientRect();
        ghost = document.createElement("img");
        ghost.src = cardBackSrc;
        ghost.className = "draw-pull-ghost";
        ghost.style.width = `${rect.width}px`;
        ghost.style.left = `${rect.left}px`;
        ghost.style.top = `${rect.top}px`;
        document.body.appendChild(ghost);
      }
      const pull = Math.min(dy, 140);
      ghost.style.transform = `translateY(${pull}px)`;
      ghost.style.opacity = String(Math.max(0.35, 1 - pull / 220));
      pulled = dy >= SWIPE_THRESHOLD;
      el.classList.toggle("swipe-ready", pulled);
    }
  });

  function end(e, canceled) {
    if (pointerId === null) return;
    if (e && e.pointerId !== undefined && e.pointerId !== pointerId) return;
    try { el.releasePointerCapture(pointerId); } catch (_) { /* 不支援時忽略 */ }
    pointerId = null;
    el.classList.remove("swipe-ready");
    if (ghost) {
      const g = ghost;
      ghost = null;
      if (pulled && !canceled) {
        g.style.transition = "opacity 0.15s ease-out";
        g.style.opacity = "0";
        setTimeout(() => g.remove(), 160);
        flyDrawCeremony(el, destEl, cardBackSrc).then(() => onConfirm());
      } else {
        g.style.transition = "transform 0.18s ease-out, opacity 0.18s ease-out";
        g.style.transform = "translateY(0px)";
        g.style.opacity = "1";
        setTimeout(() => g.remove(), 190);
      }
      return;
    }
    if (!canceled && !moved && onArm) onArm();
  }

  el.addEventListener("pointerup", (e) => end(e, false));
  el.addEventListener("pointercancel", (e) => end(e, true));
  // pointerup 後瀏覽器仍會補發一個 click,一律攔下,避免和上面的邏輯重複觸發
  el.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  });
}

// 找出某個面板(oppBand/myBand)裡星星型別符合的格子圖片,星星被拿走時要飛過去那裡
function findStarCellImg(bandEl, starType) {
  if (!bandEl) return null;
  const imgs = bandEl.querySelectorAll(".hand-card.card-star");
  for (const img of imgs) {
    if (img.alt === starType) return img;
  }
  // 對手區的星星剩量是壓縮過的小數字列(沒有卡圖),吸收動畫改飛到對應型別那一格
  return bandEl.querySelector(`.opp-star[data-star-type="${starType}"]`);
}

// 星星揭示:把已經畫好正面的 img 換成一個雙面翻牌結構(牌背/牌面各佔一面),
// 翻牌瞬間才把正面轉過來給玩家看,比單純的縮放進場更接近真的把蓋著的牌翻開
function playStarFlip(col) {
  playRevealFlip(col, "star");
}

// 把某格「已經畫成正面」的牌先蓋回背面,真正的牌面記在 data-face-src 上,
// 等 playRevealFlip 翻牌時再拿出來當正面。這樣揭示前玩家絕對看不到牌面。
function holdFaceDown(col, kind) {
  const img = col && col.querySelector(`[data-slot-kind="${kind}"] .slot-card-img`);
  if (!img) return;
  if (img.alt === "?") return; // 本來就是背面(例如對手還沒揭示),不用動
  img.dataset.faceSrc = img.src;
  img.src = cardImgSrc(`back_${kind}`);
}

// 把已經畫好正面的 img 換成雙面翻牌結構,原地翻開。star/moon 共用同一套演出。
function playRevealFlip(col, kind) {
  const wrap = col.querySelector(`[data-slot-kind="${kind}"]`);
  const img = wrap && wrap.querySelector(".slot-card-img");
  if (!wrap || !img) return;
  const stage = document.createElement("div");
  stage.className = "flip-stage";
  const inner = document.createElement("div");
  inner.className = "flip-inner";
  const back = document.createElement("img");
  back.className = "flip-face flip-back";
  back.src = cardImgSrc(`back_${kind}`);
  back.draggable = false;
  const front = document.createElement("img");
  front.className = "flip-face flip-front";
  // holdFaceDown 可能已經把牌面暫時換成背面了,真正的牌面存在 data-face-src
  front.src = img.dataset.faceSrc || img.src;
  front.alt = img.alt;
  front.draggable = false;
  inner.appendChild(back);
  inner.appendChild(front);
  stage.appendChild(inner);
  img.replaceWith(stage);
  nextPaint(() => inner.classList.add("flip-run"));
}

// 星星卡被贏家拿走時,像被吸走一樣飛進贏家的星星格、縮小消失
function flyAbsorb(fromEl, toEl, cardName, onArrive) {
  if (!fromEl || !toEl) { if (onArrive) onArrive(); return; }
  const fromRect = fromEl.getBoundingClientRect();
  const toRect = toEl.getBoundingClientRect();
  const ghost = document.createElement("img");
  ghost.src = cardImgSrc(cardName);
  ghost.alt = cardName;
  ghost.className = "fly-card-ghost";
  ghost.style.width = `${fromRect.width}px`;
  ghost.style.left = "0px";
  ghost.style.top = "0px";
  ghost.style.transform = `translate(${fromRect.left}px, ${fromRect.top}px) scale(1)`;
  document.body.appendChild(ghost);
  nextPaint(() => {
    ghost.style.transition = "transform 0.55s ease-in, opacity 0.55s ease-in";
    const toX = toRect.left + toRect.width / 2 - fromRect.width * 0.1;
    const toY = toRect.top + toRect.height / 2 - fromRect.width * 0.14;
    ghost.style.transform = `translate(${toX}px, ${toY}px) scale(0.15) rotate(20deg)`;
    ghost.style.opacity = "0.2";
  });
  setTimeout(() => {
    ghost.remove();
    if (onArrive) onArrive();
  }, 560);
}

// pub.log 其實是共用同一個可變陣列的參照,不能靠比較 prevPub.log/pub.log 本身抓差異,要自己記掃到哪。
// 而且發布出去的 log 只有最後 PUBLISHED_LOG_LINES 行(是個固定長度的滑動視窗),
// 一旦滿了長度就不再增加 —— 所以不能用陣列長度當進度,要用累計序號 logSeq。
let scannedLogSeq = 0;

function triggerBattleEffects(prevPub, pub, oppKey, mineKey) {
  const allLines = pub.log || [];
  // 舊版狀態沒有 logSeq 時退回用長度,至少不會整個壞掉
  const seq = typeof pub.logSeq === "number" ? pub.logSeq : allLines.length;
  if (seq < scannedLogSeq) scannedLogSeq = 0; // 開新的一局,序號從頭算
  // 只取這次真正新增的行。若因為斷線漏掉太多,最多也只能拿到視窗裡還留著的那些
  const newCount = Math.min(seq - scannedLogSeq, allLines.length);
  const newLines = newCount > 0 ? allLines.slice(allLines.length - newCount) : [];
  scannedLogSeq = seq;

  if (!prevPub) return;
  const bf = $("battlefield");
  const cols = bf.querySelectorAll(":scope > .bf-col");
  const oppCol = cols[0], mineCol = cols[1];
  if (!oppCol || !mineCol) return;

  const starImg = (col) => col.querySelector('[data-slot-kind="star"] .slot-card-img');
  const sunImg = (col) => col.querySelector('[data-slot-kind="sun"] .slot-card-img');
  const moonImg = (col) => col.querySelector('[data-slot-kind="moon"] .slot-card-img');

  // 0) 對手(電腦)先攻蓋星星卡時,engine.js 會多印一行「OOO 蓋下星星卡。」,
  // 藉此撥放「OOO(難度)的回合」橫幅 + 蓋牌動畫,玩家才能實際看到電腦先出牌,
  // 而不是畫面上什麼都沒發生、直接跳到自己的出牌提示。自己出牌是靠互動提示本身就看得出來,不需要橫幅。
  // 電腦(vsAi 模式的 p2)每回合的星星都是走 AI 分支、都會印這行 log,不管這回合是不是真的先攻,
  // 所以一定要另外檢查 firstIsP1 確認「這次真的是對手先出手」,不然會不分先後攻每回合都誤觸發。
  const oppIsFirst = (oppKey === "p1") === pub.firstIsP1;
  if (oppIsFirst) {
    for (const line of newLines) {
      const setMatch = line.match(/^(.+) 蓋下星星卡。$/);
      if (setMatch && setMatch[1] === pub[oppKey].name) {
        showOpponentStarSetTurn(pub, oppKey, oppCol);
      }
    }
  }

  // 1) 星星揭示:這是整局最重要的一刻,所以不是「瞬間兩張一起翻完」,而是
  //    先停一拍讓玩家意識到要開牌了,再依先攻→後攻的順序一張一張慢慢翻開。
  if (!prevPub.starsRevealed && pub.starsRevealed) {
    const oppIsFirstReveal = (oppKey === "p1") === pub.firstIsP1;
    const firstCol = oppIsFirstReveal ? oppCol : mineCol;
    const secondCol = oppIsFirstReveal ? mineCol : oppCol;
    // 翻牌要等一拍才開始,這段時間內畫面必須維持背面,否則會先讓玩家看光牌面。
    // 交給 render 層的 revealHoldUntil 控制,中途重繪也不會提前爆牌面。
    const firstSide = oppIsFirstReveal ? "opp" : "mine";
    const secondSide = oppIsFirstReveal ? "mine" : "opp";
    holdRevealFor(firstSide, REVEAL_BEAT_MS);
    holdRevealFor(secondSide, REVEAL_BEAT_MS + REVEAL_GAP_MS);
    holdFaceDown(firstCol, "star");
    holdFaceDown(secondCol, "star");
    // 翻牌時重新抓一次欄位:中途可能已經重繪過,先前抓到的節點會變成孤兒
    const flipSide = (side) => {
      const cols = $("battlefield").querySelectorAll(":scope > .bf-col");
      const col = side === "opp" ? cols[0] : cols[1];
      if (col) playStarFlip(col);
    };
    setTimeout(() => flipSide(firstSide), REVEAL_BEAT_MS);
    setTimeout(() => flipSide(secondSide), REVEAL_BEAT_MS + REVEAL_GAP_MS);
  }

  // 2) 太陽卡出牌/強化(牌一出現在太陽欄位就播,型別不符後續結算時會直接丟棄)
  // 對手看不到手牌內容,額外從對手的太陽手牌堆疊「飛」一張進場,讓對手的動作更有實感
  [[oppKey, oppCol, true], [mineKey, mineCol, false]].forEach(([key, col, isOpp]) => {
    const prevArr = (prevPub[key] || {}).playedSun || [];
    const nowArr = (pub[key] || {}).playedSun || [];
    if (prevArr.length === 0 && nowArr.length > 0) {
      const card = nowArr[nowArr.length - 1];
      const target = sunImg(col);
      // 【烈陽】是太陽卡裡的強化特效卡,額外炸一圈橘色衝擊波,跟普通太陽卡出牌區隔開來
      const burst = card === "烈陽" ? () => spawnShockwave(target, "sun") : null;
      // 型別相符的升級卡(殞石頭/雷射剪刀/鈦合金布):星星卡真的被升級了,
      // 額外在星星欄位播一段「變身」特效(見下方 playEvolveEffect),跟單純亮個光的
      // 太陽出牌區隔開來 —— 這是本回合戰力真的改變的時刻,值得更重的演出。
      const evo = SUN_EVOLVE[card];
      const didEvolve = evo && evo[0] === (pub[key] || {}).star;
      const evolveFx = didEvolve ? () => {
        setTimeout(() => playEvolveEffect(starImg(col), target, evo[1]), 250);
      } : null;
      if (isOpp) flyCardIn(bandPileTileImg($("oppBand"), "太陽手牌"), target, card, () => { fx(target, "fx-sun"); if (burst) burst(); if (evolveFx) evolveFx(); });
      else { fx(target, "fx-sun"); if (burst) burst(); if (evolveFx) evolveFx(); }
    }
  });

  // 3) 月亮卡發動:牌本來就蓋在場上,所以是「原地翻開」再亮特效,不是憑空出現。
  //    跟星星一樣先停一拍再翻,翻完才炸特效。
  [[oppKey, oppCol], [mineKey, mineCol]].forEach(([key, col]) => {
    const prevMoon = (prevPub[key] || {}).playedMoon;
    const nowMoon = (pub[key] || {}).playedMoon;
    if (!prevMoon && nowMoon) {
      // 同星星:先把已經畫出來的牌面壓回背面,牌面留給翻牌動畫揭曉
      holdFaceDown(col, "moon");
      setTimeout(() => {
        playRevealFlip(col, "moon");
        setTimeout(() => {
          const target = moonImg(col) || col.querySelector('[data-slot-kind="moon"] .flip-front');
          fx(target, "fx-moon");
          // 【日蝕】是月亮卡裡的反制特效卡,額外炸一圈衝擊波,跟普通月亮發動區隔開來
          if (nowMoon === "日蝕") spawnShockwave(target, "moon");
        }, MOON_FLIP_MS);
      }, REVEAL_BEAT_MS);
    }
  });

  // 4) 抽牌動畫:牌庫變少代表有人剛抽了牌,自己、對手都適用
  [[oppKey, $("oppBand"), true], [mineKey, $("myBand"), false]].forEach(([key, bandEl, isOpp]) => {
    const prevSnap = prevPub[key] || {};
    const nowSnap = pub[key] || {};
    if ((prevSnap.sunPileCount || 0) > (nowSnap.sunPileCount || 0)) animateDraw(bandEl, isOpp, "太陽庫", "太陽手牌", "back_sun");
    if ((prevSnap.moonPileCount || 0) > (nowSnap.moonPileCount || 0)) animateDraw(bandEl, isOpp, "月亮庫", "月亮手牌", "back_moon");
  });

  // 5) 回合勝負對撞:掃描這次新增的 log 行,找「★ XXX 贏得本回合!」或「平手!」
  for (const line of newLines) {
    const winMatch = line.match(/^★ (.+) 贏得本回合!$/);
    if (winMatch) {
      const winnerName = winMatch[1];
      const winnerIsOpp = pub[oppKey] && pub[oppKey].name === winnerName;
      const winCol = winnerIsOpp ? oppCol : mineCol;
      const loseCol = winnerIsOpp ? mineCol : oppCol;
      const winImg = starImg(winCol), loseImg = starImg(loseCol);
      const winnerStarType = (winnerIsOpp ? pub[oppKey] : pub[mineKey]) && (winnerIsOpp ? pub[oppKey] : pub[mineKey]).star;
      if (winImg) {
        winImg.style.setProperty("--bump-dir", winnerIsOpp ? "10px" : "-10px");
        fx(winImg, "fx-win");
        spawnShockwave(winImg, "win");
      }
      if (loseImg) {
        loseImg.style.setProperty("--bump-dir", winnerIsOpp ? "-10px" : "10px");
        fx(loseImg, "fx-lose");
        // 石頭碎裂/剪刀斬擊這種型別專屬的碰撞美術是「贏家的招式打在輸家身上」,
        // 所以疊圖位置要放輸家那張星星卡上,不是贏家自己這邊(贏家維持既有的金色勝利光環)。
        spawnImpactBurst(loseImg, winnerStarType);
      }
      fx($("battlefield"), "fx-shake");
    } else if (/^平手!/.test(line)) {
      fx(starImg(oppCol), "fx-tie");
      fx(starImg(mineCol), "fx-tie");
      spawnShockwave(starImg(oppCol), "tie");
      spawnImpactBurst(starImg(oppCol), (pub[oppKey] || {}).star);
      fx($("battlefield"), "fx-shake");
    }

    // 6) 星星被吸收:輸家蓋出的那張星星卡飛進贏家的星星格,像被吸走一樣
    const stealMatch = line.match(/^(.+) 取走 (.+) 的一張『(.+)』星星卡。/);
    if (stealMatch) {
      const [, winnerName2, , starType] = stealMatch;
      const winnerIsOpp2 = pub[oppKey] && pub[oppKey].name === winnerName2;
      const loserCol2 = winnerIsOpp2 ? mineCol : oppCol;
      const winnerBand = winnerIsOpp2 ? $("oppBand") : $("myBand");
      const srcImg = starImg(loserCol2);
      const destImg = findStarCellImg(winnerBand, starType);
      if (srcImg && destImg) {
        flyAbsorb(srcImg, destImg, starType, () => fx(destImg, "fx-absorb-receive"));
      }
    }
  }
}

// 單人模式我方玩家名字本來就叫「你」,再加後綴會變成「你(你)」
function myDisplayName(name) {
  return name === "你" ? name : `${name}(你)`;
}

function renderBand(container, snapshot, isOpp, privateData) {
  container.innerHTML = "";
  // 依設計圖分區上色:對手側(上)深色、我方側(下)藍色
  container.dataset.side = isOpp ? "opp" : "mine";
  if (!snapshot) return;

  if (isOpp) renderOppBand(container, snapshot);
  else renderMyBand(container, snapshot, privateData);
}

// 對手區(設計圖上方深色帶):資訊量壓到最低,只保留「看得到才公平」的公開情報。
// 版面:最左上角一排極小的手牌張數圖示 → 名條 → 月亮庫 / 星星剩量 / 太陽庫 / 棄牌。
function renderOppBand(container, snapshot) {
  // 對手區全部塞進同一列:左上角手牌圖示 + 名字,接著星星剩量、牌庫、棄牌。
  // 不分兩行,避免左上角的手牌圖示和左側牌庫上下疊成一團,也把高度讓給戰場。
  const row = document.createElement("div");
  row.className = "opp-row";

  // 對手的太陽/月亮手牌張數:設計圖沒有這一區,依需求用極小圖示放最左邊。
  // 保留 pileCardTile 的結構(含 .pile-tile-label),抽牌動畫才找得到飛行起點。
  const handIcons = document.createElement("div");
  handIcons.className = "opp-hand-icons";
  handIcons.appendChild(pileCardTile("太陽手牌", snapshot.handSunCount, "back_sun"));
  handIcons.appendChild(pileCardTile("月亮手牌", snapshot.handMoonCount, "back_moon"));
  row.appendChild(handIcons);

  const nameEl = document.createElement("div");
  nameEl.className = "band-name opp-name";
  nameEl.textContent = snapshot.name;
  row.appendChild(nameEl);

  // 對手的星星剩量壓成一排極小數字(✊3 ✋2 ✌0)。星星會因為吸收而超過 3 張,
  // 所以直接顯示數字而不是畫格子,既省空間又不會失真。打空的型別壓暗。
  const stars = document.createElement("div");
  stars.className = "opp-stars";
  STAR_TYPES.forEach((t) => {
    const n = snapshot.stars[t];
    const cell = document.createElement("span");
    cell.className = "opp-star" + (n === 0 ? " depleted" : "");
    // 星星被搶走的吸收動畫要飛到對應型別,標上型別供 findStarCellImg 定位
    cell.dataset.starType = t;
    const ico = document.createElement("span");
    ico.className = "opp-star-ico";
    ico.style.backgroundImage = `url("${STAR_GLYPH_SRC[t]}")`;
    const num = document.createElement("span");
    num.className = "opp-star-n";
    num.textContent = n;
    cell.appendChild(ico);
    cell.appendChild(num);
    stars.appendChild(cell);
  });
  row.appendChild(stars);

  row.appendChild(pileCardTile("太陽庫", snapshot.sunPileCount, "back_sun", null, true));
  row.appendChild(pileCardTile("月亮庫", snapshot.moonPileCount, "back_moon", null, true));
  row.appendChild(pileChip("棄牌", snapshot.discardCount, "discard", () => showDiscardPile(`${snapshot.name}的棄牌`, snapshot.discard || [])));
  container.appendChild(row);
}

// 我方區(設計圖下方藍色帶):
// 上排 = 太陽庫 / 三格星星庫存 / 月亮庫,下排 = 星星庫 / 手牌 / 棄牌
function renderMyBand(container, snapshot, privateData) {
  const nameEl = document.createElement("div");
  nameEl.className = "band-name";
  nameEl.textContent = myDisplayName(snapshot.name);
  container.appendChild(nameEl);

  const askKind = pendingAsk ? pendingAsk.kind : null;
  if (askKind === "star" || askKind === "sun" || askKind === "moonCommit" || askKind === "drawPile") {
    container.appendChild(actionPromptEl(pendingAsk.prompt));
    if (armedValue !== null) container.appendChild(confirmBarEl());
  }

  const drawPickable = askKind === "drawPile";
  const drawValueFor = (t) => (drawPickable && pendingAsk.options.some((o) => o.value === t) ? t : null);

  // 上排:牌庫夾住中間的星星庫存槽,對應設計圖下方帶的左右牌堆 + 中央三格
  const topRow = document.createElement("div");
  topRow.className = "my-row";
  topRow.appendChild(pileCardTile("太陽庫", snapshot.sunPileCount, "back_sun", drawValueFor("太陽"), true));

  const slotStrip = document.createElement("div");
  slotStrip.className = "star-strip";
  STAR_TYPES.forEach((t) => {
    const selectable = askKind === "star" && pendingAsk.options.some((o) => o.value === t);
    const cell = document.createElement("div");
    cell.className = "panel-cell";
    cell.appendChild(handCardTile(t, "star", snapshot.stars[t], selectable ? () => resolvePendingAsk(t) : null, t, "mine"));
    slotStrip.appendChild(cell);
  });
  topRow.appendChild(slotStrip);
  topRow.appendChild(pileCardTile("月亮庫", snapshot.moonPileCount, "back_moon", drawValueFor("月亮"), true));
  container.appendChild(topRow);

  // 下排:手牌 + 棄牌。設計圖左下角那張小星星卡在本作沒有對應資料
  // (星星不是一疊牌庫,而是三個型別各自的持有數),所以不畫,避免顯示假資訊。
  const btmRow = document.createElement("div");
  btmRow.className = "my-row my-row-hand";

  const handEl = document.createElement("div");
  handEl.className = "hand";
  const priv = privateData || { handSun: [], handMoon: [] };
  const sunPickable = askKind === "sun";
  const moonPickable = askKind === "moonCommit";
  (priv.handSun || []).forEach((c) => {
    const selectable = sunPickable && pendingAsk.options.some((o) => o.value === c);
    handEl.appendChild(handCardTile(c, "sun", null, selectable ? () => resolvePendingAsk(c) : null, c));
  });
  (priv.handMoon || []).forEach((c) => {
    const selectable = moonPickable && pendingAsk.options.some((o) => o.value === c);
    handEl.appendChild(handCardTile(c, "moon", null, selectable ? () => resolvePendingAsk(c) : null, c));
  });
  if (!(priv.handSun || []).length && !(priv.handMoon || []).length) {
    const span = document.createElement("span");
    span.className = "dim hand-empty";
    span.textContent = "(沒有太陽/月亮卡)";
    handEl.appendChild(span);
  }
  if (sunPickable || moonPickable) {
    const skipOpt = pendingAsk.options.find((o) => o.value === null || o.value === undefined);
    if (skipOpt) handEl.appendChild(skipTile(skipOpt.label, () => resolvePendingAsk(null)));
  }
  btmRow.appendChild(handEl);
  btmRow.appendChild(pileChip("棄牌", snapshot.discardCount, "discard", () => showDiscardPile(`${myDisplayName(snapshot.name)}的棄牌`, snapshot.discard || [])));
  container.appendChild(btmRow);
}

// onOpen 給了才能點:棄牌區這種「唯讀查看」用途才需要,其他 chip(目前沒有別的用途)維持原樣不能點。
function pileChip(label, count, kind, onOpen) {
  const el = document.createElement("div");
  el.className = `chip chip-${kind}` + (onOpen ? " chip-tappable" : "");
  el.innerHTML = `<span class="chip-label">${label}</span><span class="chip-count">x${count}</span>`;
  if (onOpen) {
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.setAttribute("aria-label", `查看${label}`);
    el.onclick = onOpen;
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); }
    });
  }
  return el;
}

// 棄牌區查看:雙方的棄牌本來就是公開資訊,點開來看已經打出過哪些太陽/月亮卡。
// 每張縮圖沿用手牌的長按看效果機制(handCardTile 不給 onTap 時就是「純展示可查」模式)。
function showDiscardPile(title, cards) {
  $("discardOverlayTitle").textContent = title;
  const grid = $("discardOverlayGrid");
  grid.innerHTML = "";
  if (!cards.length) {
    const empty = document.createElement("p");
    empty.className = "dim discard-empty";
    empty.textContent = "(還沒有棄牌)";
    grid.appendChild(empty);
  } else {
    cards.forEach((name) => {
      grid.appendChild(handCardTile(name, cardKind(name), null, null));
    });
  }
  $("discardOverlay").classList.remove("hidden");
}

// drawValue: 非空字串("太陽"/"月亮")時,這個牌堆可以用向下滑動的手勢抽牌
// 牌庫(太陽庫/月亮庫)在設計圖裡是專屬的深色卡背:炭黑/深藍底 + 金色或藍色的天體徽記,
// 跟手牌那種亮色華麗卡背刻意區隔 —— 牌庫是背景元件要壓得住,手上的牌才該搶眼。
const DECK_ART_SRC = { back_sun: "img/deck_sun.png", back_moon: "img/deck_moon.png" };

// isDeck: true 代表這是牌庫(用設計圖的深色牌庫美術),false/省略代表是手牌張數指示(用一般卡背)
function pileCardTile(label, count, backName, drawValue, isDeck) {
  const wrap = document.createElement("div");
  const isArmed = drawValue && armedValue === drawValue;
  wrap.className = "hand-card-wrap pile-tile-wrap" + (isArmed ? " armed" : "");
  const img = document.createElement("img");
  img.className = "hand-card pile-back" + (drawValue ? " selectable" : "") + (isDeck ? " pile-deck" : "");
  img.src = (isDeck && DECK_ART_SRC[backName]) ? DECK_ART_SRC[backName] : cardImgSrc(backName);
  img.alt = label;
  img.draggable = false;
  if (drawValue) {
    attachSwipeDraw(img, {
      onArm: () => armValue(drawValue),
      onConfirm: () => resolvePendingAsk(drawValue),
      cardBackSrc: cardImgSrc(backName),
      ariaLabel: `向下滑動抽${label}`,
      destEl: () => { const myBand = $("myBand"); return myBand ? myBand.querySelector(".hand") : null; },
    });
  }
  wrap.appendChild(img);
  const cap = document.createElement("div");
  cap.className = "pile-tile-label";
  cap.textContent = label;
  wrap.appendChild(cap);
  const badge = document.createElement("span");
  badge.className = "hand-card-count";
  badge.textContent = `x${count}`;
  wrap.appendChild(badge);
  return wrap;
}

// 卡圖檔名不會變,但圖片「內容」可能整批換掉(例如美術重做),瀏覽器會用檔名快取,
// 換圖後玩家可能還是吃到舊圖。跟 index.html 的 ?v= 同一套邏輯,換卡圖時記得手動遞增。
const CARD_ASSET_VERSION = 2;

function cardImgSrc(name) {
  return `cards/${encodeURIComponent(name)}.png?v=${CARD_ASSET_VERSION}`;
}

// 星星型別的「底座」卡框(拳頭/手掌/剪刀),對應 battlefield_layout_slots_v2.png 的星星庫存列。
// 依設計圖分區:對手側(上方)用深色底座、我方側(下方)用藍色底座。
const STAR_SOCKET_SRC = {
  opp:  { "石頭": "img/socket_石頭.png",      "布": "img/socket_布.png",      "剪刀": "img/socket_剪刀.png" },
  mine: { "石頭": "img/socket_石頭_blue.png", "布": "img/socket_布_blue.png", "剪刀": "img/socket_剪刀_blue.png" },
};

// 對手區星星剩量用的小手勢圖示,直接從上面那些底座卡框裁出中央圖案(白色圖案 + 透明背景),
// 用 CSS 上色縮小。沿用設計圖自己的手勢造型,比彩色 emoji 更貼合深藍金的典雅風格。
const STAR_GLYPH_SRC = { "石頭": "img/glyph_石頭.png", "布": "img/glyph_布.png", "剪刀": "img/glyph_剪刀.png" };

// ─── 天體卡框:對照 battlefield_layout_slots_v2.png 的空欄位,用向量 SVG 重現 ───
// 太陽/星星/月亮各自的置中 symbol(浮水印),外圈同心橢圓、四邊菱形標記、邊角刻痕則統一由 frameDeco 疊上。
// 用 SVG 而非點陣圖:解析度無關、可隨欄位大小縮放都保持銳利,且色彩集中在這裡好維護。
const SYM_COLOR = { moon: "#7ea6dd", star: "#d3dcec", sun: "#e8b23a" };

function _svgUri(inner, viewBox) {
  return "data:image/svg+xml;utf8," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + (viewBox || "0 0 100 100") + '">' + inner + "</svg>");
}

// 星形多邊形頂點(spikes 個尖角,rO/rI 為外/內半徑,rot 額外旋轉)
function _starPts(cx, cy, spikes, rO, rI, rot) {
  const pts = [];
  const step = Math.PI / spikes;
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 ? rI : rO;
    const a = i * step - Math.PI / 2 + (rot || 0);
    pts.push((cx + r * Math.cos(a)).toFixed(1) + "," + (cy + r * Math.sin(a)).toFixed(1));
  }
  return pts.join(" ");
}

function _symInner(kind) {
  const c = SYM_COLOR[kind];
  if (kind === "moon") {
    // 兩個圓做出彎月缺口(缺口朝右上,呼應設計圖的月牙)
    return '<defs><mask id="mo"><rect width="100" height="100" fill="#fff"/>' +
      '<circle cx="63" cy="40" r="33" fill="#000"/></mask></defs>' +
      '<circle cx="50" cy="52" r="37" fill="' + c + '" mask="url(#mo)"/>';
  }
  if (kind === "star") {
    // 羅盤玫瑰:主四芒(南北東西較長)+ 斜四芒(較短)交疊
    return '<polygon points="' + _starPts(50, 50, 4, 46, 11, 0) + '" fill="' + c + '"/>' +
      '<polygon points="' + _starPts(50, 50, 4, 30, 10, Math.PI / 4) + '" fill="' + c + '" opacity="0.85"/>';
  }
  // sun:放射光芒 + 實心圓心
  return '<polygon points="' + _starPts(50, 50, 12, 45, 27, 0) + '" fill="' + c + '"/>' +
    '<circle cx="50" cy="50" r="14" fill="' + c + '"/>';
}

const SLOT_SYM = { moon: _svgUri(_symInner("moon")), star: _svgUri(_symInner("star")), sun: _svgUri(_symInner("sun")) };

// 卡框裝飾(同心橢圓導引線 + 四邊菱形 + 邊角刻痕),中性半透明色,深/藍兩種分區底色上都清楚。
const FRAME_DECO = (() => {
  const stroke = "rgba(206,218,240,0.34)";
  const dia = (x, y) => '<rect x="' + (x - 3) + '" y="' + (y - 3) + '" width="6" height="6" fill="rgba(214,224,244,0.5)" transform="rotate(45 ' + x + ' ' + y + ')"/>';
  const tick = (d) => '<path d="' + d + '" fill="none" stroke="rgba(214,224,244,0.45)" stroke-width="1.4"/>';
  // 卡片比例 400/560,所以框裝飾用 100x140 的 viewBox,菱形/刻痕才不會被拉扁
  return _svgUri(
    '<ellipse cx="50" cy="70" rx="34" ry="48" fill="none" stroke="' + stroke + '" stroke-width="1"/>' +
    '<ellipse cx="50" cy="70" rx="26" ry="37" fill="none" stroke="' + stroke + '" stroke-width="0.8"/>' +
    dia(50, 16) + dia(50, 124) + dia(12, 70) + dia(88, 70) +
    tick("M8 12 L8 20 M8 12 L16 12") + tick("M92 12 L92 20 M92 12 L84 12") +
    tick("M8 128 L8 120 M8 128 L16 128") + tick("M92 128 L92 120 M92 128 L84 128"),
    "0 0 100 140"
  );
})();

function handCardTile(name, kind, count, onTap, value, side) {
  const wrap = document.createElement("div");
  const isArmed = onTap && armedValue !== null && value !== undefined && armedValue === value;
  wrap.className = "hand-card-wrap" + (isArmed ? " armed" : "");
  // 星星庫存格:還有牌時顯示該張星星卡的正面卡圖(型別一眼就分得出來),
  // 這個型別打完(x0)時才換成桌墊上印的底座(拳頭/手掌/剪刀),代表這一格空了。
  const depleted = kind === "star" && count === 0;
  const socketSrc = depleted ? (STAR_SOCKET_SRC[side === "opp" ? "opp" : "mine"] || {})[name] : null;
  const img = document.createElement("img");
  img.className = `hand-card card-${kind}` + (onTap ? " selectable" : "") + (socketSrc ? " hand-card-socket" : "");
  img.src = socketSrc || cardImgSrc(name);
  img.alt = name;
  img.draggable = false;
  attachInteractiveCard(img, {
    cardName: name,
    onConfirm: onTap || null,
    onArm: onTap ? () => armValue(value) : null,
    draggable: !!onTap,
    dropSelector: onTap ? dropSelectorForKind(kind) : null,
    ariaLabel: onTap ? `打出 ${name}` : null,
  });
  wrap.appendChild(img);
  if (count !== null && count !== undefined) {
    // 不自己畫 ◇ pips:底座圖本身已經印了三顆菱形,張數一律用數字 badge 表示
    // (星星會因為對戰吸收而超過 3 張,pips 只畫 3 顆會失真)。
    const badge = document.createElement("span");
    badge.className = "hand-card-count";
    badge.textContent = `x${count}`;
    wrap.appendChild(badge);
  }
  return wrap;
}

function skipTile(label, onTap) {
  const btn = document.createElement("button");
  btn.className = "skip-tile";
  btn.textContent = label;
  btn.onclick = onTap;
  return btn;
}

function actionPromptEl(text) {
  const el = document.createElement("div");
  el.className = "action-prompt";
  el.textContent = text;
  return el;
}

function confirmBarEl() {
  const bar = document.createElement("div");
  bar.className = "confirm-bar";
  const opt = pendingAsk && pendingAsk.options.find((o) => o.value === armedValue);
  const label = opt ? opt.label : "此選擇";

  const verb = pendingAsk && pendingAsk.kind === "drawPile" ? "確認抽牌" : "確認出牌";
  const confirmBtn = document.createElement("button");
  confirmBtn.className = "confirm-btn";
  confirmBtn.textContent = `${verb}:${label}`;
  confirmBtn.onclick = () => resolvePendingAsk(armedValue);
  bar.appendChild(confirmBtn);

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "confirm-cancel-btn";
  cancelBtn.textContent = "取消選擇";
  cancelBtn.onclick = () => resetArmed();
  bar.appendChild(cancelBtn);

  return bar;
}

function resolvePendingAsk(value) {
  if (!pendingAsk) return;
  resetArmed();
  const resolve = pendingAsk.resolve;
  pendingAsk = null;
  // 抽牌彈窗要立刻收起,不能等下一次 render:引擎接手後可能還要跑一段 await,
  // 這段時間內滿版遮罩會一直蓋著畫面,玩家會覺得點了沒反應。
  $("drawPickOverlay").classList.add("hidden");
  stopTurnTimer(); // 已經做出選擇,倒數立刻停掉,不要繼續在畫面上跳
  resolve(value);
}

// 抽牌二選一:牌庫縮圖擠在左右下角很小、很難精準點到,改成蓋滿畫面的兩張大牌。
// 抽牌是強制的(引擎只在兩堆都還有牌時才問),所以這個彈窗沒有取消,一定要選一邊。
function syncDrawPickOverlay() {
  const ov = $("drawPickOverlay");
  const ask = pendingAsk && pendingAsk.kind === "drawPile" ? pendingAsk : null;
  if (!ask) {
    ov.classList.add("hidden");
    return;
  }
  $("drawPickTitle").textContent = ask.prompt || ask.title || "選擇要抽的牌堆";
  const box = $("drawPickCards");
  box.innerHTML = "";
  ask.options.forEach((opt) => {
    const kind = opt.value === "太陽" ? "sun" : "moon";
    const back = cardImgSrc(`back_${kind}`);
    const wrap = document.createElement("div");
    wrap.className = `draw-pick-card draw-pick-${kind}`;
    const img = document.createElement("img");
    img.className = "draw-pick-img";
    img.src = back;
    img.alt = opt.label;
    img.draggable = false;
    // 往下滑 = 抽牌(跟牌庫縮圖同一套手勢);單純點一下也直接抽,
    // 因為這裡是強制的二選一、沒有其他可按的東西,不需要再多一步確認鈕。
    attachSwipeDraw(img, {
      onArm: () => resolvePendingAsk(opt.value),
      onConfirm: () => resolvePendingAsk(opt.value),
      cardBackSrc: back,
      ariaLabel: `抽${opt.value}牌`,
      destEl: () => { const my = $("myBand"); return my ? my.querySelector(".hand") : null; },
    });
    wrap.appendChild(img);
    const cap = document.createElement("div");
    cap.className = "draw-pick-label";
    cap.textContent = opt.label;
    wrap.appendChild(cap);
    box.appendChild(wrap);
  });
  ov.classList.remove("hidden");
}

function showCardPickUI(title, prompt, options, kind) {
  return new Promise((resolve) => {
    resetArmed();
    pendingAsk = { title, prompt, options, kind, resolve };
    refreshBoard();
  });
}

// -- 卡片互動:長按看效果 / 點卡標記+按鈕確認出牌 / 拖曳到欄位出牌 -----

const DRAG_THRESHOLD = 8;
const LONG_PRESS_MS = 450;

let armedValue = null; // 目前被「點過一次、等待按確認鈕」標記的選項值

function armValue(value) {
  armedValue = value;
  if (lastPublicSeen) renderPublic(lastPublicSeen);
}

function resetArmed() {
  if (armedValue === null) return;
  armedValue = null;
  if (lastPublicSeen) renderPublic(lastPublicSeen);
}

function dropSelectorForKind(kind) {
  if (kind === "star" || kind === "sun" || kind === "moon") {
    return `.slot-wrap[data-drop-kind="${kind}"]`;
  }
  return null;
}

// el: 顯示卡圖的 <img>。cardName: 用於長按看效果(沒有效果文字就不啟用長按)。
// onConfirm: 拖曳放到合法欄位、或鍵盤 Enter/Space 時立即執行的動作。
// onArm: 單純點一下(沒有拖曳、沒有觸發長按)時執行,用來標記選取,實際出牌要靠畫面上的確認鈕。
// draggable: 是否允許拖到 dropSelector 指定的欄位放開直接出牌。
function attachInteractiveCard(el, opts) {
  const { cardName, onConfirm, onArm, draggable, dropSelector, ariaLabel } = opts;

  if (onConfirm || onArm) {
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    if (ariaLabel) el.setAttribute("aria-label", ariaLabel);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (onConfirm) onConfirm();
        else if (onArm) onArm();
      }
    });
  }
  if (cardName && CARD_EFFECTS[cardName]) {
    el.classList.add("has-card-info");
  }

  let infoTimer = null;
  let infoFired = false;
  let dragging = false;
  let moved = false;
  let startX = 0, startY = 0;
  let grabOffsetX = 0, grabOffsetY = 0;
  let ghost = null;
  let overTarget = null;
  let activePointerId = null;

  function clearInfoTimer() {
    if (infoTimer) clearTimeout(infoTimer);
    infoTimer = null;
  }

  function clearDragVisuals() {
    if (ghost) { ghost.remove(); ghost = null; }
    if (overTarget) { overTarget.classList.remove("drop-target-hover"); overTarget = null; }
    document.querySelectorAll(".drop-target-active").forEach((n) => n.classList.remove("drop-target-active"));
    el.classList.remove("dragging-source");
    dragging = false;
  }

  function findDropTarget(x, y) {
    if (!dropSelector) return null;
    const under = document.elementFromPoint(x, y);
    if (!under) return null;
    return under.closest(dropSelector);
  }

  el.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    infoFired = false;
    moved = false;
    startX = e.clientX;
    startY = e.clientY;
    const rect = el.getBoundingClientRect();
    // 記住手指/滑鼠抓住卡片的相對位置,拖曳時 ghost 才會跟著這個抓點走,而不是瞬間跳到置中
    grabOffsetX = startX - rect.left;
    grabOffsetY = startY - rect.top;
    activePointerId = e.pointerId;
    try { el.setPointerCapture(activePointerId); } catch (_) { /* 不支援時忽略 */ }
    if (cardName && CARD_EFFECTS[cardName]) {
      infoTimer = setTimeout(() => {
        infoFired = true;
        showCardInfo(cardName);
      }, LONG_PRESS_MS);
    }
    if (draggable && dropSelector) {
      document.querySelectorAll(dropSelector).forEach((n) => n.classList.add("drop-target-active"));
    }
  });

  el.addEventListener("pointermove", (e) => {
    if (activePointerId === null || e.pointerId !== activePointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      moved = true;
      clearInfoTimer();
      if (draggable) {
        dragging = true;
        el.classList.add("dragging-source");
        const rect = el.getBoundingClientRect();
        ghost = el.cloneNode(true);
        ghost.classList.add("drag-ghost");
        ghost.style.width = `${rect.width}px`;
        ghost.style.height = `${rect.height}px`;
        document.body.appendChild(ghost);
      }
    }
    if (dragging && ghost) {
      ghost.style.transform = `translate(${e.clientX - grabOffsetX}px, ${e.clientY - grabOffsetY}px)`;
      const target = findDropTarget(e.clientX, e.clientY);
      if (target !== overTarget) {
        if (overTarget) overTarget.classList.remove("drop-target-hover");
        overTarget = target;
        if (overTarget) overTarget.classList.add("drop-target-hover");
      }
    }
  });

  function endPointer(e, canceled) {
    if (activePointerId === null) return;
    if (e && e.pointerId !== undefined && e.pointerId !== activePointerId) return;
    clearInfoTimer();
    try { el.releasePointerCapture(activePointerId); } catch (_) { /* 不支援時忽略 */ }
    activePointerId = null;

    if (dragging) {
      const dropped = !canceled && overTarget;
      clearDragVisuals();
      if (dropped && onConfirm) onConfirm();
      return;
    }
    clearDragVisuals();
    if (canceled || infoFired || moved) return;
    if (onArm) onArm();
    else if (onConfirm) onConfirm();
  }

  el.addEventListener("pointerup", (e) => endPointer(e, false));
  el.addEventListener("pointercancel", (e) => endPointer(e, true));

  // pointerup 後瀏覽器仍會補發一個 click,一律攔下,避免和上面的邏輯重複觸發
  el.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  });
}

function showCardInfo(cardName) {
  const kind = cardKind(cardName);
  $("cardInfoImg").src = cardImgSrc(cardName);
  $("cardInfoImg").alt = cardName;
  $("cardInfoName").textContent = cardName;
  $("cardInfoKind").textContent = CARD_KIND_LABEL[kind];
  $("cardInfoKind").className = `card-info-kind kind-${kind}`;
  $("cardInfoText").textContent = CARD_EFFECTS[cardName];
  $("cardInfoOverlay").classList.remove("hidden");
}

function renderBattlefield(pub, oppKey, mineKey) {
  const bf = $("battlefield");
  bf.innerHTML = "";
  bf.appendChild(battlefieldColumn(pub[oppKey], true, pub.starsRevealed, null));
  bf.appendChild(battlefieldColumn(pub[mineKey], false, pub.starsRevealed, lastPrivateSeen));
}

function battlefieldColumn(snapshot, isOpp, starsRevealed, privateData) {
  const col = document.createElement("div");
  col.className = "bf-col";
  // 依設計圖分區上色:對手側(上)深色、我方側(下)藍色
  col.dataset.side = isOpp ? "opp" : "mine";
  if (!snapshot) return col;

  const label = document.createElement("div");
  label.className = "bf-label";
  label.textContent = isOpp ? snapshot.name : myDisplayName(snapshot.name);
  col.appendChild(label);

  const moonActivateAsk = !isOpp && pendingAsk && pendingAsk.kind === "moonActivate" ? pendingAsk : null;
  if (moonActivateAsk) {
    col.appendChild(actionPromptEl(moonActivateAsk.prompt));
    if (armedValue !== null) col.appendChild(confirmBarEl());
  }

  const row = document.createElement("div");
  row.className = "bf-row";

  // 設計圖的兩排戰場是鏡像對稱的:對手排是 月/星/日,我方排是 日/星/月,
  // 星星永遠在正中間對撞。先照我方順序組好,對手排最後再反轉。
  const slots = [];

  slots.push(slotEl("太陽", snapshot.playedSun && snapshot.playedSun.length ? snapshot.playedSun.join("、") : null, "sun", false, null, !isOpp ? "sun" : null));

  // 揭示是這個遊戲最重要的一刻,所以雙方蓋下的星星卡在揭示前「都」顯示背面
  // (包含自己蓋的),等雙方都準備好才一起翻開,翻牌的戲才做得出來。
  let starContent = null, starBack = false;
  const myCommitted = !isOpp ? (privateData && privateData.committedStar) || null : null;
  const side = isOpp ? "opp" : "mine";
  // 揭示了但這一側的翻牌動畫還沒開始 → 繼續畫背面,牌面留給翻牌動畫揭曉
  if (starsRevealed && isRevealHeld(side)) {
    starContent = "?";
    starBack = true;
  } else if (starsRevealed) {
    starContent = (isOpp ? snapshot.star : snapshot.star || myCommitted) || null;
  } else if (isOpp ? snapshot.starCommitted : !!myCommitted) {
    // starCommitted 只公開是非值、不洩漏蓋了什麼,讓畫面能正確反映先攻/後攻順序
    starContent = "?";
    starBack = true;
  }
  const starSlot = slotEl("星星", starContent, "star", starBack, null, !isOpp ? "star" : null);
  // 自己的牌雖然蓋著,但太陽/月亮階段還要靠它決策,所以在自己這側標一行小字提示蓋了什麼
  if (starBack && !isOpp && myCommitted) {
    const memo = document.createElement("div");
    memo.className = "slot-memo";
    memo.textContent = myCommitted;
    starSlot.appendChild(memo);
  }
  slots.push(starSlot);

  // 月亮卡同理:蓋下去時雙方都只看到背面,等到「發動」才翻開。
  let moonContent = null, moonBack = false, moonTap = null;
  const myPendingMoon = !isOpp && privateData ? privateData.pendingMoonCard || null : null;
  if (snapshot.playedMoon) {
    moonContent = snapshot.playedMoon;
  } else if (isOpp ? snapshot.moonPending : !!myPendingMoon) {
    moonContent = "?";
    moonBack = true;
    if (moonActivateAsk) moonTap = () => resolvePendingAsk(true);
  }
  const moonSlot = slotEl("月亮", moonContent, "moon", moonBack, moonTap, !isOpp ? "moon" : null, true);
  // 自己蓋的月亮卡蓋著,但要決定發不發動,所以同樣標一行小字提示是哪張
  if (moonBack && !isOpp && myPendingMoon) {
    const memo = document.createElement("div");
    memo.className = "slot-memo";
    memo.textContent = myPendingMoon;
    moonSlot.appendChild(memo);
  }
  slots.push(moonSlot);

  if (isOpp) slots.reverse();
  slots.forEach((s) => row.appendChild(s));

  col.appendChild(row);

  if (moonActivateAsk) {
    const skipOpt = moonActivateAsk.options.find((o) => o.value === false);
    if (skipOpt) col.appendChild(skipTile(skipOpt.label, () => resolvePendingAsk(false)));
  }

  return col;
}

function slotEl(header, content, kind, back, onTap, dropKind, value) {
  const wrap = document.createElement("div");
  const isArmed = onTap && armedValue !== null && value !== undefined && armedValue === value;
  wrap.className = "slot-wrap" + (isArmed ? " armed" : "");
  wrap.dataset.slotKind = kind;
  if (dropKind) wrap.dataset.dropKind = dropKind;
  const h = document.createElement("div");
  h.className = "slot-header";
  h.textContent = header;
  wrap.appendChild(h);

  if (back) {
    // 蓋著的牌也可能需要互動(例如自己蓋的月亮卡要能點下去發動),
    // 所以有 onTap 時照樣綁上互動,只是長按不給看內容(牌是蓋著的)
    const img = document.createElement("img");
    img.className = "slot-card-img" + (onTap ? " selectable" : "");
    img.src = cardImgSrc(`back_${kind}`);
    img.alt = "?";
    img.draggable = false;
    if (onTap) {
      attachInteractiveCard(img, {
        cardName: null,
        onConfirm: onTap,
        onArm: () => armValue(value),
        draggable: false,
        ariaLabel: "發動蓋著的卡",
      });
    }
    wrap.appendChild(img);
    return wrap;
  }

  if (content) {
    const img = document.createElement("img");
    img.className = "slot-card-img" + (onTap ? " selectable" : "");
    img.src = cardImgSrc(content);
    img.alt = content;
    img.draggable = false;
    attachInteractiveCard(img, {
      cardName: content,
      onConfirm: onTap || null,
      onArm: onTap ? () => armValue(value) : null,
      draggable: false,
      ariaLabel: onTap ? `發動 ${content}` : null,
    });
    wrap.appendChild(img);
    return wrap;
  }

  // 空欄位畫成設計圖裡的「天體卡框」:卡框底 + 置中的太陽/星星/月亮 symbol 浮水印 +
  // 同心橢圓/菱形/邊角刻痕裝飾。牌打上去後同一格會換成實際卡圖,卡框感一路延續。
  const empty = document.createElement("div");
  empty.className = "slot-empty-card";
  const sym = document.createElement("div");
  sym.className = "slot-sym";
  sym.style.backgroundImage = `url("${SLOT_SYM[kind]}")`;
  empty.appendChild(sym);
  const deco = document.createElement("div");
  deco.className = "slot-deco";
  deco.style.backgroundImage = `url("${FRAME_DECO}")`;
  empty.appendChild(deco);
  wrap.appendChild(empty);
  return wrap;
}

function renderLog(lines) {
  const panel = $("logText");
  const overlayOpen = !$("logOverlay").classList.contains("hidden");
  const wasAtBottom = !overlayOpen || panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 10;
  panel.textContent = lines.join("\n");
  if (overlayOpen && wasAtBottom) panel.scrollTop = panel.scrollHeight;
}

const GO_BG_SRC = { win: "img/endscreen_victory_bg.jpg", lose: "img/endscreen_defeat_bg.jpg" };
const GO_MEDALLION_SRC = { win: "img/endscreen_victory_medallion.png", lose: "img/endscreen_defeat_medallion.png" };
const GO_PARTICLE_SRC = "img/endscreen_star_particle.png";
const GO_PARTICLE_COUNT = 16;

function spawnGoParticles() {
  const box = $("goParticles");
  box.innerHTML = "";
  for (let i = 0; i < GO_PARTICLE_COUNT; i++) {
    const img = document.createElement("img");
    img.src = GO_PARTICLE_SRC;
    img.className = "go-particle";
    img.alt = "";
    const size = 14 + Math.random() * 18;
    img.style.setProperty("--gp-left", `${Math.random() * 100}%`);
    img.style.setProperty("--gp-size", `${size}px`);
    img.style.setProperty("--gp-dur", `${3.5 + Math.random() * 3}s`);
    img.style.setProperty("--gp-delay", `${-Math.random() * 6}s`);
    img.style.setProperty("--gp-drift", `${(Math.random() - 0.5) * 80}px`);
    box.appendChild(img);
  }
}

function showGameOver(winnerRole, pub) {
  if (window.__gameOverShown) return;
  window.__gameOverShown = true;
  const amIWinner = winnerRole === myRole;
  const result = amIWinner ? "win" : "lose";
  const name = winnerRole === "p1" ? pub.p1.name : pub.p2.name;

  const overlay = $("gameOverOverlay");
  overlay.dataset.result = result;
  $("goBg").style.backgroundImage = `url(${GO_BG_SRC[result]})`;
  $("goMedallion").src = GO_MEDALLION_SRC[result];
  $("goResultText").textContent = amIWinner ? "勝利" : "落敗";
  $("goWinnerName").textContent = `獲勝者:${name}`;
  spawnGoParticles();

  const isSinglePlayer = roomCode === null && game && game.vsAi;
  const rematchBtn = $("goRematchBtn");
  rematchBtn.classList.toggle("hidden", !isSinglePlayer);
  if (isSinglePlayer) {
    rematchBtn.onclick = () => {
      overlay.classList.remove("go-show");
      setTimeout(() => {
        overlay.classList.add("hidden");
        startSinglePlayer(lastDifficulty);
      }, 200);
    };
  }
  $("goLobbyBtn").onclick = () => location.reload();

  overlay.classList.remove("hidden");
  requestAnimationFrame(() => overlay.classList.add("go-show"));
}

// -- 彈窗(本地決策 modal,房主/加入者共用)------------------------
// 「打牌」類的決策(星星/太陽/月亮蓋牌/發動月亮)改成直接點畫面上的牌,不跳文字選單;
// 其他決策(指定目標、選牌堆、強制發動或丟棄…)還是用文字按鈕選單。

const CARD_PICK_KINDS = ["star", "sun", "moonCommit", "moonActivate", "drawPile"];

// ── 雙人對戰的 60 秒出牌限時 ──────────────────────────────────────
// 只在連線對戰生效(單人對 AI 不限時,自己慢慢想沒差)。時間到就自動幫你選一個
// 「最不傷」的選項:有「不打/略過」就略過,沒有的話(星星、抽牌是強制的)選第一個。
const TURN_LIMIT_MS = 60000;
let turnTimerId = null;
let turnTickId = null;

function isOnlineMatch() {
  return !!roomCode;
}

function defaultChoiceFor(options) {
  const list = options || [];
  const skip = list.find((o) => o.value === null || o.value === undefined || o.value === false);
  if (skip) return skip.value === undefined ? null : skip.value;
  return list.length ? list[0].value : null;
}

function stopTurnTimer() {
  if (turnTimerId) { clearTimeout(turnTimerId); turnTimerId = null; }
  if (turnTickId) { clearInterval(turnTickId); turnTickId = null; }
  const el = $("turnTimer");
  if (el) el.classList.add("hidden");
}

function startTurnTimer(onTimeout) {
  stopTurnTimer();
  const el = $("turnTimer");
  const deadline = Date.now() + TURN_LIMIT_MS;
  const paint = () => {
    const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    el.textContent = `⏱ ${left}`;
    el.classList.toggle("urgent", left <= 10);
  };
  el.classList.remove("hidden");
  paint();
  turnTickId = setInterval(paint, 250);
  turnTimerId = setTimeout(onTimeout, TURN_LIMIT_MS);
}

// 把一個「等玩家決策」的 promise 包上限時:時間到就收掉畫面上的提示、改用預設值往下走
function withTurnLimit(inner, options) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      stopTurnTimer();
      resolve(v);
    };
    inner.then(finish);
    startTurnTimer(() => {
      const fallback = defaultChoiceFor(options);
      // 收掉還開著的決策 UI,否則遮罩/提示會卡在畫面上
      pendingAsk = null;
      resetArmed();
      $("drawPickOverlay").classList.add("hidden");
      $("modalOverlay").classList.add("hidden");
      pushLog(`(逾時 ${TURN_LIMIT_MS / 1000} 秒,自動選擇)`);
      if (lastPublicSeen) renderPublic(lastPublicSeen);
      finish(fallback);
    });
  });
}

function showLocalModal(title, prompt, options, kind) {
  const inner = CARD_PICK_KINDS.includes(kind)
    ? showCardPickUI(title, prompt, options, kind)
    : showTextModal(title, prompt, options);
  return isOnlineMatch() ? withTurnLimit(inner, options) : inner;
}

function showTextModal(title, prompt, options) {
  return new Promise((resolve) => {
    $("modalTitle").textContent = title;
    $("modalPrompt").textContent = prompt;
    const btnBox = $("modalButtons");
    btnBox.innerHTML = "";
    (options || []).forEach((opt) => {
      const b = document.createElement("button");
      b.textContent = opt.label;
      b.onclick = () => {
        $("modalOverlay").classList.add("hidden");
        resolve(opt.value === undefined ? null : opt.value);
      };
      btnBox.appendChild(b);
    });
    $("modalOverlay").classList.remove("hidden");
  });
}

function showRules() {
  $("rulesText").textContent = RULES_TEXT;
  $("rulesOverlay").classList.remove("hidden");
}

document.addEventListener("DOMContentLoaded", init);
