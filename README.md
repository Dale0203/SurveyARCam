# SurveyARCam — 外業勘查 AR 導引相機（手機網頁）

解決的痛點：請同事外業拍照時，同事不知道「這個點是什麼、要拍哪幾張、朝哪個方向拍」。

## 是什麼

純靜態手機網頁（免安裝，LINE 傳連結即可用）：

- **點位清單**：依「離我距離」排序，類型標籤（基準地/比較標的/收益標的），一鍵跳 Google Maps 導航。
- **地圖檢視**：Leaflet + 國土測繪中心 EMAP 底圖，點位依類型/完成度著色。
- **到點偵測**：GPS 進入半徑（預設 30m）自動提示該點的拍攝清單。
- **AR 拍攝模式**：相機即時畫面疊加「點位名稱｜類型｜目前要拍的項目｜方位箭頭」；
  拍下後自動燒錄浮水印（點位/項目/方位角/座標/時間），檔名結構化
  （例：`梧棲段123_基準地_臨路狀況_1032.jpg`），清單自動打勾。
- **進度保存**：localStorage，換頁不掉。

## 資料載入（隱私設計）

本網頁是**通用外殼**，不含任何案件資料。點位 JSON 三種載入方式（優先序）：

1. 網址參數 `?data=<JSON網址>`（放私人 gist / 自家主機）
2. 上次載入的快取（localStorage）
3. 頁內「匯入檔案 / 貼上 JSON」

JSON 格式見 [POINTS_SCHEMA.md](POINTS_SCHEMA.md)，範例在 `data/sample_points.json`（示意資料，非本案）。

## 部署（GitHub Pages）

1. 開一個 repo（可公開，因為不含案件資料），把本資料夾內容推上去。
2. Settings → Pages → Deploy from branch → main / root。
3. 把 `https://<user>.github.io/<repo>/` 用 LINE 傳給同事。
4. 案件點位 JSON 用「匯入檔案」或私下連結載入，**不要 commit 進這個 repo**。

## 手機支援

- iOS Safari 16+：羅盤權限需使用者點一次「允許」（App 內有引導按鈕）。
- Android Chrome：直接可用。
- 相機/GPS/羅盤都要 HTTPS 才能啟用 —— 本機開發用 `?mock=1` 模擬模式（假 GPS/羅盤/相機），桌機瀏覽器即可測流程。

## 開發

無 build step，vanilla JS。`python -m http.server 8000` 後開
`http://localhost:8000/?mock=1` 即可測試。實機測試需部署到 HTTPS（GitHub Pages）。
