# 猜☆拳☆王 — 雙人連線網頁版

規則邏輯是從 `../rps_core.py` 手動搬過來的 JS 版本(`rules.js` + `engine.js`)。
之後如果改規則,**Python 版跟這個網頁版要分別各改一次**,兩邊不會自動同步。

架構:建立房間的人(房主)瀏覽器負責跑遊戲邏輯,加入的人是即時同步的顯示端。
房主分頁如果關掉,對局會卡住(免費、不架伺服器的取捨)。
安全性走「休閒對局」等級:知道房間代碼的兩個人互相信任即可,沒有做正式反作弊。

## 1. 建立 Firebase 專案(免費)

1. 前往 https://console.firebase.google.com/ ,用 Google 帳號登入、建立新專案(可以關掉 Google Analytics,不需要)。
2. 專案建立後,左側選單「建構 → Authentication」→「開始使用」→ 在「Sign-in method」分頁啟用 **匿名(Anonymous)**。
   (不需要信箱密碼,使用者一打開網頁就會自動用匿名身分登入。)
3. 左側選單「建構 → Realtime Database」→「建立資料庫」→ 位置隨意 → 先選「以測試模式啟動」建立起來即可(接下來會換成正式規則)。
4. 進入 Realtime Database →「規則」分頁,把整段內容換成這個資料夾裡的 [database.rules.json](database.rules.json) 的內容,按「發布」。
5. 左側選單「專案總覽」旁的齒輪 →「專案設定」→ 往下捲到「你的應用程式」→ 點 `</>`(網頁)圖示 → 輸入應用程式名稱(隨意)→ 註冊。
6. 會看到一段 `firebaseConfig = {...}` 的物件,把裡面的值複製貼到這個資料夾的 [firebase-config.js](firebase-config.js),取代掉裡面的「填入你的...」文字。
   (這組設定值本身不是密鑰,可以放進公開的網頁程式碼,真正的保護是靠上面設定的資料庫規則。)

## 2. 本機測試

瀏覽器不能直接用 `file://` 開 `index.html`(Firebase SDK 會擋),要用一個簡單的本機伺服器,例如:

```bash
cd web
python -m http.server 8000
```

然後瀏覽器開 `http://localhost:8000`。可以開兩個瀏覽器分頁(或一個一般視窗+一個隱私視窗)模擬兩個玩家,一邊建立房間、一邊輸入代碼加入。

## 3. 放到 GitHub Pages

1. 把整個 `RPS` 專案(或至少 `web` 這個資料夾)推到你的 GitHub repo。
2. GitHub repo →「Settings」→「Pages」→ Source 選你放這些檔案的分支跟資料夾(例如 `main` 分支的 `/web`,或把 `web` 內容整個放到 repo 根目錄)。
3. 存好之後 GitHub 會給一個網址(通常是 `https://你的帳號.github.io/repo名稱/`),打開就能玩,兩個人各自用手機或電腦打開這個網址即可連線對戰。

## 檔案說明

| 檔案 | 內容 |
|---|---|
| `rules.js` | 卡片常數、勝負表(對應 `rps_core.py` 的規則資料部分) |
| `engine.js` | 遊戲邏輯(`Player` / `Game`,對應 `rps_core.py` 的邏輯部分,雙人版無 AI) |
| `net.js` | Firebase 連線、房間建立/加入、即時同步、RPC 詢問機制 |
| `app.js` | 畫面渲染、大廳/房間/對局的按鈕邏輯 |
| `firebase-config.js` | 你自己的 Firebase 專案設定值(依上面步驟填入) |
| `database.rules.json` | Realtime Database 安全規則(貼到 Firebase 主控台) |
