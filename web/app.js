// 猜☆拳☆王 — 網頁版主程式(大廳、房間、渲染、房主端遊戲迴圈)

let myUid = null;
let roomCode = null;
let isHost = false;
let myRole = null; // "p1" | "p2"
let game = null; // 只有房主會建立
let hostStarted = false;
let gameLog = [];
let lastPublicSeen = null;
let lastPrivateSeen = null;
let pendingAsk = null; // { title, prompt, options, kind, resolve } — 待處理的「打牌」決策

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
  const ui = makeUi(guestUid);
  game = new Game(ui, hostName, guestName);

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
  async function ask(role, title, prompt, options, kind) {
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
    await publishState(guestUid);
    return value;
  }
  async function log(text) {
    gameLog.push(text);
    if (gameLog.length > 300) gameLog = gameLog.slice(-300);
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
    playedSun: p.playedSunCards.slice(),
    star: revealStar ? p.committedStar : null,
    playedMoon: p.moonDecided ? p.playedMoonCard : null,
    moonPending: !p.moonDecided && p.pendingMoonCard !== null,
  };
}

async function publishState(guestUid) {
  const pub = {
    round: game.roundNum,
    starsRevealed: game.starsRevealed,
    firstIsP1: game.firstIsP1,
    p1: boardSnapshotFor(game.p1, game.starsRevealed),
    p2: boardSnapshotFor(game.p2, game.starsRevealed),
    log: gameLog,
    winnerRole: null,
    updatedAt: Date.now(),
  };
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
      gameLog.push(`\n★★★ 遊戲結束!獲勝者:${e.winnerRole === "p1" ? game.p1.name : game.p2.name} ★★★`);
      const pub = {
        round: game.roundNum,
        starsRevealed: true,
        firstIsP1: game.firstIsP1,
        p1: boardSnapshotFor(game.p1, true),
        p2: boardSnapshotFor(game.p2, true),
        log: gameLog,
        winnerRole: e.winnerRole,
        updatedAt: Date.now(),
      };
      await Net.publishPublic(roomCode, pub);
    } else {
      console.error(e);
      gameLog.push(`發生錯誤:${e.message}`);
      await publishState(guestUid);
    }
  }
}

// -- 單人對戰 AI(完全本機執行,不用 Firebase)-----------------------

function startSinglePlayer(difficulty) {
  isHost = true;
  myRole = "p1";
  roomCode = null;
  gameLog = [];
  window.__gameOverShown = false;
  showScreen("gameScreen");

  const ui = makeLocalUi();
  game = new Game(ui, "你", "電腦", { vsAi: true, difficulty });
  renderLocalState();
  runLocalGameLoop();
}

function makeLocalUi() {
  async function ask(_role, title, prompt, options, kind) {
    const value = await showLocalModal(title, prompt, options, kind);
    renderLocalState();
    return value;
  }
  async function log(text) {
    gameLog.push(text);
    if (gameLog.length > 300) gameLog = gameLog.slice(-300);
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
    log: gameLog,
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
      gameLog.push(`\n★★★ 遊戲結束!獲勝者:${e.winnerRole === "p1" ? game.p1.name : game.p2.name} ★★★`);
      renderLocalState(e.winnerRole);
    } else {
      console.error(e);
      gameLog.push(`發生錯誤:${e.message}`);
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
  $("statusText").textContent = `第 ${pub.round} 回合`;
  renderBand($("oppBand"), pub[oppKey], true, null);
  renderBand($("myBand"), pub[mineKey], false, lastPrivateSeen);
  renderBattlefield(pub, oppKey, mineKey);
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
  setTimeout(() => { $("coinResultText").textContent = `${firstName} 先攻!`; }, 1150);
  setTimeout(() => { overlay.classList.add("hidden"); }, 1850);
}

// -- 戰鬥畫面特效:翻牌、太陽強化、月亮發動、勝負對撞 -----------------
// 純粹靠比對「上一次 render 的 snapshot」跟「這次的 snapshot」觸發,不需要引擎額外通知,
// 這樣本機/房主/加入者三種模式都能用同一套邏輯(加入者從來不會直接執行 engine.js)。

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 每行 log 之後都停一下讓畫面有時間播動畫,關鍵劇情點(開場硬幣、翻牌、出招、發動、抽牌、分出勝負)停久一點
function delayForLogLine(text) {
  if (/^\n===== 第 1 回合 =====/.test(text)) return 1900; // 等開場硬幣動畫播完
  let extra = 0;
  if (/^★ .+ 贏得本回合!$/.test(text) || /^平手!/.test(text)) extra = 550;
  else if (/揭示星星:/.test(text)) extra = 200;
  else if (/打出太陽卡:/.test(text) || /打出【烈陽】!$/.test(text)) extra = 500; // 對手出牌會有飛入動畫,留多一點時間播完
  else if (/發動【.+】/.test(text)) extra = 500;
  else if (/(抽牌|抽了一張牌)。$/.test(text)) extra = 450; // 抽牌會有牌堆脈動+飛牌動畫
  return 150 + extra;
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

// 讓一張卡從 fromEl 的位置飛到 toEl 的位置再消失,onArrive 在飛抵時觸發(通常接著播欄位本身的特效)
function flyGhost(fromEl, toEl, src, altText, onArrive) {
  if (!fromEl || !toEl) { if (onArrive) onArrive(); return; }
  const fromRect = fromEl.getBoundingClientRect();
  const toRect = toEl.getBoundingClientRect();
  const ghost = document.createElement("img");
  ghost.src = src;
  ghost.alt = altText || "";
  ghost.className = "fly-card-ghost";
  ghost.style.width = `${toRect.width}px`;
  ghost.style.left = "0px";
  ghost.style.top = "0px";
  ghost.style.transform = `translate(${fromRect.left}px, ${fromRect.top}px) scale(0.6)`;
  ghost.style.opacity = "0.4";
  document.body.appendChild(ghost);
  requestAnimationFrame(() => {
    ghost.style.transition = "transform 0.42s cubic-bezier(.2,.8,.3,1), opacity 0.42s ease-out";
    ghost.style.transform = `translate(${toRect.left}px, ${toRect.top}px) scale(1)`;
    ghost.style.opacity = "1";
  });
  setTimeout(() => {
    ghost.remove();
    if (onArrive) onArrive();
  }, 440);
}

function flyCardIn(fromEl, toEl, cardName, onArrive) {
  flyGhost(fromEl, toEl, cardImgSrc(cardName), cardName, onArrive);
}

// 牌堆脈動一下再飛一張牌背到手牌區,表示「剛剛抽了一張牌」(自己、對手都適用)
function animateDraw(bandEl, isOpp, pileLabel, handLabel, backKind) {
  const pileImg = bandPileTileImg(bandEl, pileLabel);
  fx(pileImg, "fx-draw-pulse");
  const dest = isOpp ? bandPileTileImg(bandEl, handLabel) : (bandEl && bandEl.querySelector(".hand"));
  flyGhost(pileImg, dest, cardImgSrc(backKind), backKind);
}

let scannedLogLines = 0; // pub.log 其實是共用同一個可變陣列的參照,不能靠比較 prevPub.log/pub.log 本身抓差異,要自己記掃到哪

function triggerBattleEffects(prevPub, pub, oppKey, mineKey) {
  const allLines = pub.log || [];
  if (allLines.length < scannedLogLines) scannedLogLines = 0; // 開新的一局,log 陣列變短了,計數器歸零
  const newLines = allLines.slice(scannedLogLines);
  scannedLogLines = allLines.length;

  if (!prevPub) return;
  const bf = $("battlefield");
  const cols = bf.querySelectorAll(":scope > .bf-col");
  const oppCol = cols[0], mineCol = cols[1];
  if (!oppCol || !mineCol) return;

  const starImg = (col) => col.querySelector('[data-slot-kind="star"] .slot-card-img');
  const sunImg = (col) => col.querySelector('[data-slot-kind="sun"] .slot-card-img');
  const moonImg = (col) => col.querySelector('[data-slot-kind="moon"] .slot-card-img');

  // 1) 雙方星星同時翻牌
  if (!prevPub.starsRevealed && pub.starsRevealed) {
    fx(starImg(oppCol), "fx-flip");
    fx(starImg(mineCol), "fx-flip");
  }

  // 2) 太陽卡出牌/強化(牌一出現在太陽欄位就播,型別不符後續會自己收回手牌)
  // 對手看不到手牌內容,額外從對手的太陽手牌堆疊「飛」一張進場,讓對手的動作更有實感
  [[oppKey, oppCol, true], [mineKey, mineCol, false]].forEach(([key, col, isOpp]) => {
    const prevArr = (prevPub[key] || {}).playedSun || [];
    const nowArr = (pub[key] || {}).playedSun || [];
    if (prevArr.length === 0 && nowArr.length > 0) {
      const card = nowArr[nowArr.length - 1];
      const target = sunImg(col);
      if (isOpp) flyCardIn(bandPileTileImg($("oppBand"), "太陽手牌"), target, card, () => fx(target, "fx-sun"));
      else fx(target, "fx-sun");
    }
  });

  // 3) 月亮卡發動特效
  [[oppKey, oppCol, true], [mineKey, mineCol, false]].forEach(([key, col, isOpp]) => {
    const prevMoon = (prevPub[key] || {}).playedMoon;
    const nowMoon = (pub[key] || {}).playedMoon;
    if (!prevMoon && nowMoon) {
      const target = moonImg(col);
      if (isOpp) flyCardIn(bandPileTileImg($("oppBand"), "月亮手牌"), target, nowMoon, () => fx(target, "fx-moon"));
      else fx(target, "fx-moon");
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
      if (winImg) { winImg.style.setProperty("--bump-dir", winnerIsOpp ? "10px" : "-10px"); fx(winImg, "fx-win"); }
      if (loseImg) { loseImg.style.setProperty("--bump-dir", winnerIsOpp ? "-10px" : "10px"); fx(loseImg, "fx-lose"); }
    } else if (/^平手!/.test(line)) {
      fx(starImg(oppCol), "fx-tie");
      fx(starImg(mineCol), "fx-tie");
    }
  }
}

function renderBand(container, snapshot, isOpp, privateData) {
  container.innerHTML = "";
  if (!snapshot) return;

  const nameEl = document.createElement("div");
  nameEl.className = "band-name";
  nameEl.textContent = snapshot.name + (isOpp ? "" : "(你)");
  container.appendChild(nameEl);

  const askKind = !isOpp && pendingAsk ? pendingAsk.kind : null;
  if (askKind === "star" || askKind === "sun" || askKind === "moonCommit") {
    container.appendChild(actionPromptEl(pendingAsk.prompt));
    if (armedValue !== null) container.appendChild(confirmBarEl());
  }

  if (isOpp) {
    // 對手看不到手牌內容,面板簡化成一列摘要就好,把省下的空間留給自己的面板放大
    const summaryEl = document.createElement("div");
    summaryEl.className = "opp-summary";
    STAR_TYPES.forEach((t) => {
      summaryEl.appendChild(handCardTile(t, "star", snapshot.stars[t], null, t));
    });
    summaryEl.appendChild(pileCardTile("太陽庫", snapshot.sunPileCount, "back_sun"));
    summaryEl.appendChild(pileCardTile("月亮庫", snapshot.moonPileCount, "back_moon"));
    summaryEl.appendChild(pileChip("棄牌", snapshot.discardCount, "discard"));
    summaryEl.appendChild(pileCardTile("太陽手牌", snapshot.handSunCount, "back_sun"));
    summaryEl.appendChild(pileCardTile("月亮手牌", snapshot.handMoonCount, "back_moon"));
    container.appendChild(summaryEl);
    return;
  }

  const starsRow = document.createElement("div");
  starsRow.className = "star-row";
  STAR_TYPES.forEach((t) => {
    const selectable = askKind === "star" && pendingAsk.options.some((o) => o.value === t);
    starsRow.appendChild(handCardTile(t, "star", snapshot.stars[t], selectable ? () => resolvePendingAsk(t) : null, t));
  });
  container.appendChild(starsRow);

  const pilesEl = document.createElement("div");
  pilesEl.className = "piles";
  pilesEl.appendChild(pileCardTile("太陽庫", snapshot.sunPileCount, "back_sun"));
  pilesEl.appendChild(pileCardTile("月亮庫", snapshot.moonPileCount, "back_moon"));
  pilesEl.appendChild(pileChip("棄牌", snapshot.discardCount, "discard"));
  container.appendChild(pilesEl);

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
    span.className = "dim";
    span.textContent = "(手上沒有太陽/月亮卡)";
    handEl.appendChild(span);
  }
  if (sunPickable || moonPickable) {
    const skipOpt = pendingAsk.options.find((o) => o.value === null || o.value === undefined);
    if (skipOpt) handEl.appendChild(skipTile(skipOpt.label, () => resolvePendingAsk(null)));
  }
  container.appendChild(handEl);
}

function pileChip(label, count, kind) {
  const el = document.createElement("div");
  el.className = `chip chip-${kind}`;
  el.innerHTML = `<span class="chip-label">${label}</span><span class="chip-count">x${count}</span>`;
  return el;
}

function pileCardTile(label, count, backName) {
  const wrap = document.createElement("div");
  wrap.className = "hand-card-wrap pile-tile-wrap";
  const img = document.createElement("img");
  img.className = "hand-card pile-back";
  img.src = cardImgSrc(backName);
  img.alt = label;
  img.draggable = false;
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

function cardImgSrc(name) {
  return `cards/${encodeURIComponent(name)}.svg`;
}

function handCardTile(name, kind, count, onTap, value) {
  const wrap = document.createElement("div");
  const isArmed = onTap && armedValue !== null && value !== undefined && armedValue === value;
  wrap.className = "hand-card-wrap" + (isArmed ? " armed" : "");
  const img = document.createElement("img");
  img.className = `hand-card card-${kind}` + (onTap ? " selectable" : "");
  img.src = cardImgSrc(name);
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

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "confirm-btn";
  confirmBtn.textContent = `確認出牌:${label}`;
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
  resolve(value);
}

function showCardPickUI(title, prompt, options, kind) {
  return new Promise((resolve) => {
    resetArmed();
    pendingAsk = { title, prompt, options, kind, resolve };
    if (lastPublicSeen) renderPublic(lastPublicSeen);
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
  if (!snapshot) return col;

  const label = document.createElement("div");
  label.className = "bf-label";
  label.textContent = snapshot.name + (isOpp ? "" : "(你)") + " 的出牌";
  col.appendChild(label);

  const moonActivateAsk = !isOpp && pendingAsk && pendingAsk.kind === "moonActivate" ? pendingAsk : null;
  if (moonActivateAsk) {
    col.appendChild(actionPromptEl(moonActivateAsk.prompt));
    if (armedValue !== null) col.appendChild(confirmBarEl());
  }

  const row = document.createElement("div");
  row.className = "bf-row";

  row.appendChild(slotEl("太陽", snapshot.playedSun && snapshot.playedSun.length ? snapshot.playedSun.join("、") : null, "sun", false, null, !isOpp ? "sun" : null));

  let starContent = null, starBack = false;
  if (isOpp) {
    if (!starsRevealed) { starContent = "?"; starBack = true; }
    else { starContent = snapshot.star || null; }
  } else {
    // 自己的星星就算還沒公開,也可以透過私密資料立刻看到自己蓋了什麼
    starContent = snapshot.star || (privateData && privateData.committedStar) || null;
  }
  row.appendChild(slotEl("星星", starContent, "star", starBack, null, !isOpp ? "star" : null));

  let moonContent = null, moonBack = false, moonTap = null;
  if (snapshot.playedMoon) {
    moonContent = snapshot.playedMoon;
  } else if (isOpp) {
    if (snapshot.moonPending) { moonContent = "?"; moonBack = true; }
  } else if (privateData && privateData.pendingMoonCard) {
    moonContent = privateData.pendingMoonCard;
    if (moonActivateAsk) moonTap = () => resolvePendingAsk(true);
  }
  row.appendChild(slotEl("月亮", moonContent, "moon", moonBack, moonTap, !isOpp ? "moon" : null, true));

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
    const img = document.createElement("img");
    img.className = "slot-card-img";
    img.src = cardImgSrc(`back_${kind}`);
    img.alt = "?";
    img.draggable = false;
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

  const empty = document.createElement("div");
  empty.className = "slot-empty-card";
  empty.textContent = "—";
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

function showGameOver(winnerRole, pub) {
  if (window.__gameOverShown) return;
  window.__gameOverShown = true;
  const name = winnerRole === "p1" ? pub.p1.name : pub.p2.name;
  setTimeout(() => alert(`遊戲結束!獲勝者:${name}`), 50);
}

// -- 彈窗(本地決策 modal,房主/加入者共用)------------------------
// 「打牌」類的決策(星星/太陽/月亮蓋牌/發動月亮)改成直接點畫面上的牌,不跳文字選單;
// 其他決策(指定目標、選牌堆、強制發動或丟棄…)還是用文字按鈕選單。

const CARD_PICK_KINDS = ["star", "sun", "moonCommit", "moonActivate"];

function showLocalModal(title, prompt, options, kind) {
  if (CARD_PICK_KINDS.includes(kind)) {
    return showCardPickUI(title, prompt, options, kind);
  }
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
