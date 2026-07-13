# points.json 格式（SurveyARCam 與 SurveyPointBuilder 的共同契約）

```json
{
  "project": "梧棲海線基準地案",
  "version": 1,
  "arrivalRadius": 30,
  "categories": {
    "baseland": {
      "label": "基準地",
      "color": "#D64545",
      "shots": ["臨路狀況", "面寬", "縱深", "周邊發展-左", "周邊發展-右", "對面街景"]
    },
    "compare": {
      "label": "比較標的",
      "color": "#3B7DD8",
      "shots": ["外觀街景", "臨路狀況"]
    },
    "income": {
      "label": "收益標的",
      "color": "#2E9E5B",
      "shots": ["建物外觀", "出入口", "樓層/招牌"]
    }
  },
  "points": [
    {
      "id": "BL-01",
      "name": "梧棲段123地號",
      "category": "baseland",
      "lat": 24.2545,
      "lng": 120.5318,
      "note": "商業區，臨中央路",
      "shots": ["臨路狀況", "面寬"],
      "bearingHints": { "臨路狀況": 0 }
    }
  ]
}
```

## 欄位說明

### 頂層

| 欄位 | 必填 | 說明 |
| :-- | :-- | :-- |
| `project` | ✔ | 專案名稱，顯示在標題列 |
| `version` | ✔ | 格式版本，目前固定 `1` |
| `arrivalRadius` | ✖ | 到點偵測半徑（公尺），預設 30 |
| `categories` | ✔ | 類型定義；key 自訂，`label` 顯示名、`color` 地圖/標籤色、`shots` 該類型預設拍攝清單 |
| `points` | ✔ | 點位陣列 |

### point

| 欄位 | 必填 | 說明 |
| :-- | :-- | :-- |
| `id` | ✔ | 唯一代號（進度存檔 key、檔名用），如 `BL-01` |
| `name` | ✔ | 顯示名稱（段名地號或地址） |
| `category` | ✔ | 對應 `categories` 的 key |
| `lat` / `lng` | ✔ | WGS84 十進位度 |
| `note` | ✖ | 備註（使用分區、臨路等），顯示在點位詳情與 AR 頂欄 |
| `shots` | ✖ | 覆寫該點拍攝清單；省略則用 category 預設 |
| `bearingHints` | ✖ | `{拍攝項目: 方位角}`，真北 0–359 度；有設定時 AR 模式箭頭指向該方位並提示「朝北拍」等 |

## 照片檔名格式

```
{name}_{categoryLabel}_{shot}_{HHmm}.jpg
例：梧棲段123地號_基準地_臨路狀況_1032.jpg
```

`shot` 內的 `/` 等不能當檔名的字元以 `-` 取代。
