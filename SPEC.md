# SurveyARCam v1 實作工單

## 目標

依 README.md 的產品描述與 POINTS_SCHEMA.md 的資料格式，實作可部署到 GitHub Pages 的
純靜態手機網頁。UI 全繁體中文。

## 檔案結構（限定只碰本資料夾）

```
SurveyARCam/
├── index.html
├── css/app.css
├── js/
│   ├── app.js          # 主流程/畫面切換/狀態
│   ├── geo.js          # 距離(haversine)/方位角計算、GPS watch、羅盤
│   ├── camera.js       # getUserMedia、拍照、浮水印、存檔
│   └── mock.js         # ?mock=1 模擬 GPS/羅盤/相機
└── data/sample_points.json   # 已存在，勿改
```

不用框架、不用 build step。Leaflet 走 CDN（unpkg），並在無網路載入失敗時降級為純清單模式（地圖分頁顯示提示而非白畫面）。

## 畫面與行為

### 1. 資料載入
- 優先序：URL `?data=<encodeURIComponent 的 JSON 網址>`（fetch）→ localStorage 快取 → 首頁的「匯入 JSON 檔」(input type=file) 與「貼上 JSON」textarea。
- 載入成功即存 localStorage（key 含 JSON 內容 hash），並顯示 `project` 名稱。
- 格式驗證：缺 `points`/`categories` 或 point 缺必填欄位時，明確報錯訊息（哪一筆缺什麼），不要靜默略過。
- 頁尾提供「載入範例資料」按鈕（fetch data/sample_points.json）。

### 2. 點位清單（預設分頁）
- 卡片列表：名稱、類型標籤（categories.color 底色）、note、距離（GPS 可用時，動態更新、依距離排序）、拍攝進度（3/6）。
- 類型篩選 chips（全部/基準地/比較/收益，label 取自 categories）。
- 每卡兩個按鈕：「導航」（`https://www.google.com/maps/dir/?api=1&destination=lat,lng` 新分頁）、「開始勘查」（進點位詳情）。

### 3. 地圖分頁
- Leaflet；底圖 NLSC EMAP WMTS：`https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}`，attribution 國土測繪中心；tile error 時 fallback OSM。
- 點位 circleMarker 依 category color；全部拍完的點加 ✔（或改灰）。點擊 popup：名稱/類型/進度 +「開始勘查」。
- 我的位置藍點 + accuracy 圈。

### 4. 點位詳情
- 名稱/類型/note/距離；拍攝清單 checkbox（進度存 localStorage，key=`progress:{dataHash}:{pointId}`）。
- 按鈕：「導航」「AR 拍攝」「重設此點進度」。
- GPS 進入 arrivalRadius 時：清單分頁對應卡片高亮 + 一次性 toast「已到達 ○○，開始拍攝」。（不做通知權限，頁內提示即可）

### 5. AR 拍攝模式（核心）
- 全螢幕 `getUserMedia({video:{facingMode:{ideal:'environment'}}})`；iOS 需 `playsinline`。取不到相機時顯示中文錯誤與重試按鈕。
- 頂欄（半透明深色）：點位名稱｜類型｜note。
- 目前拍攝項目列：大字顯示目前項目（例「請拍：臨路狀況」），左右箭頭或滑動切換項目；已完成項目打勾標記。
- 方位導引：
  - 該項目有 `bearingHints` → 畫面中央上方顯示箭頭，依（目標方位 − 目前手機朝向）旋轉，對準 ±15° 內箭頭變綠並顯示「方向正確」；同時顯示文字「朝北 (0°)」（方位轉八方位中文：北/東北/東/…）。
  - 無 hint → 只顯示目前朝向（「目前朝向：東南 135°」）。
- 底欄：大顆快門鈕、「完成此點」鈕、目前 GPS 精度。
- 拍照：canvas 以「影片原生解析度」繪製（不是螢幕尺寸），底部燒錄半透明黑條浮水印一行或兩行：
  `梧棲段123地號｜基準地｜臨路狀況｜朝向N(2°)｜24.25450,120.53180｜2026-07-13 10:32`
  字體大小隨影像寬度縮放（約寬度的 2.2%）。
- 存檔：`canvas.toBlob('image/jpeg', 0.92)` →
  1. 產生 `<a download>` 下載（檔名依 POINTS_SCHEMA.md 規則，非法字元換 `-`）；
  2. 若 `navigator.canShare({files})` 可用，另提供「分享/存到相簿」鈕（iOS 存進照片 App 的主要途徑）。
- 拍照成功 → 該項目自動打勾、自動跳下一個未完成項目；全部完成顯示「此點完成 ✔」並可返回清單。

### 6. 感測器處理（易踩雷，照做）
- GPS：`watchPosition`，`enableHighAccuracy:true`；權限被拒時清單仍可用（只是不排序、不到點偵測），顯示提示條。
- 羅盤：
  - iOS：`DeviceOrientationEvent.requestPermission` 存在時，必須由按鈕手勢觸發（進 AR 模式前的「啟用羅盤」按鈕）；heading 用 `event.webkitCompassHeading`（已是順時針真北）。
  - Android：優先監聽 `deviceorientationabsolute`；heading = `(360 - event.alpha) % 360`。
  - heading 做低通濾波（角度要處理 359↔0 環繞，用向量平均或最短角差插值），避免箭頭抖動。
  - 拿不到羅盤時 AR 模式仍可拍，只是不顯示方位箭頭（浮水印方位寫「--」）。

### 7. mock 模式（?mock=1）
- 假 GPS：從第一個點位西南方約 200m 出發，每秒向該點移動 5m；假 heading 每秒 +10°。
- 假相機：canvas 灰底 + 移動網格 + 大字「MOCK CAMERA」當 video 來源（`canvas.captureStream()`）。
- mock 下整條流程（清單排序→到點→AR→拍照下載浮水印圖）都要能在桌機 Chrome 走通。

## 驗收條件（完成後逐條回報實際結果）

1. `python -m http.server` 起本機伺服器，`?mock=1` 下用文字描述無法驗的就說明，可驗的要實測：
   - `node --check` 所有 js 檔通過（若環境有 node）。
   - sample_points.json 能被你的驗證邏輯 parse（寫個 node 或 python 一次性腳本驗 schema 邏輯即可）。
2. 檔案結構如上、無多餘依賴、無 build step。
3. iOS 羅盤權限流程與 Android heading 換算都有實作且路徑正確（自查程式碼指出行號）。
4. 錯誤路徑：無資料、JSON 格式錯、相機被拒、GPS 被拒，都有中文提示不白屏。
5. 不 git commit、不動本資料夾以外的檔案。

## 完工回報格式

- 每個驗收條逐條：做了什麼驗證、結果。
- 已知限制清單（例如未實測 iOS 真機）。
