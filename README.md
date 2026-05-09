# OLED Pixel Designer

[![Build & Push Container Image](https://github.com/gtgrthrst/OLED_WEB/actions/workflows/container.yml/badge.svg)](https://github.com/gtgrthrst/OLED_WEB/actions/workflows/container.yml)
[![Container Image](https://ghcr.io/badge/gtgrthrst/oled_web)](https://github.com/gtgrthrst/OLED_WEB/pkgs/container/oled_web)

> 專為 **SSD1306 OLED 螢幕**設計的線上像素畫編輯器，使用 Go 構建，無需安裝任何套件。  
> An online pixel-art editor built with Go, purpose-built for SSD1306 OLED displays.

## 功能特色

### 🎨 繪圖工具
| 工具 | 快捷鍵 | 說明 |
|------|--------|------|
| 鉛筆 | `P` | 自由繪製，支援 1–12px 圓形筆刷 |
| 橡皮擦 | `E` | 可調整大小橡皮擦 |
| 填充 | `F` | 油漆桶填色 |
| 直線 | `L` | Bresenham 直線 |
| 矩形 / 實矩 | `R` | 空心或實心矩形 |
| 圓形 / 實圓 | `C` | 空心或實心圓形 |
| 文字 | `T` | 即時預覽，支援中文、自訂字體上傳 |
| 選取 | `S` | 矩形選取，複製 / 剪下 / 翻轉 / 反色 |
| 移動圖層 | `M` | 拖曳移動目前圖層 |

### 📐 畫布
- 螢幕尺寸預設：128×64、128×32、64×64 ... 最大 512×512
- 縮放：滾輪 / `+` `-`，中鍵拖曳平移
- 網格顯示（每 8 格加粗），適合確認 SSD1306 page 邊界

### 🔤 文字工具
- **系統字體**：Canvas 2D 超採樣渲染（4×–8×），支援中文 / 任意 Unicode
- **點陣字體**：5×7 / 3×5 / 8×8 ASCII；中文 8–24px（微軟正黑體 / 宋體 / 等寬）
- 上傳自訂 TTF / OTF 字體
- 筆劃閾值（1–100%，相對最亮像素）即時調整

### 🖼 圖示庫
- **479 個 Google Material Icons**，通過 codepoint 渲染至像素網格
- 4× 超採樣 + 自適應閾值，確保細節清晰
- 分類瀏覽 + 即時搜尋
- 插入尺寸：8 / 12 / 16 / 24 / 32 px

### 🗂 圖層系統
- 多圖層（文字、圖示、圖片、繪圖各為獨立圖層）
- 拖曳排序、顯示 / 隱藏、複製、刪除
- 向下合併 / 合併全部
- **跨頁面複製圖層**

### 📄 頁面管理
- 多頁面（類似 Figma Frame / 動畫幀）
- 標籤列切換，雙擊重新命名
- 複製頁面、刪除頁面
- **匯入時選擇「插入」或「全部替換」**

### 🖼 圖片匯入
- 支援 PNG / JPG / BMP
- 拖曳裁切選取範圍
- 縮放模式：等比留白 / 等比裁切 / 拉伸
- 抖色：Floyd-Steinberg / Bayer 有序抖色
- 可調整黑白閾值

### 💾 匯出格式

| 格式 | 副檔名 | 說明 |
|------|--------|------|
| MicroPython | `.py` | 完整 SSD1306 I2C 程式碼，含像素地圖與位元驗證 |
| Framebuf | `.py` | `bytearray` 逐行格式，MONO_HLSB |
| C / Arduino | `.h` | Adafruit_GFX `PROGMEM` 陣列，含像素地圖 |
| 頁面 JSON | `.json` | 單頁含圖層，可重新載入 |
| 專案 JSON | `.oled.json` | 完整多頁面專案 |
| **圖層 ZIP** | `.zip` | 選取圖層個別匯出並壓縮（含 README.txt） |

所有程式碼格式均包含：
- 編碼說明（Row-Major / MSB First 規則）
- 視覺化像素地圖（`#` / `.`）
- 前 3 行位元驗證（binary → hex）

---

## 快速開始

### 本地執行（Go）

```bash
# 需要 Go 1.24+
git clone https://github.com/gtgrthrst/OLED_WEB.git
cd OLED_WEB
go build -o oled_web .
./oled_web
# 開啟 http://localhost:8090
```

### Podman 容器

```bash
# 從 GitHub Container Registry 直接拉取（推薦）
podman run -d -p 8090:8090 --name oled_web \
  ghcr.io/gtgrthrst/oled_web:latest

# 本地建置並啟動
./run.sh up

# 或手動操作
podman build -f Containerfile -t oled_web:latest .
podman run -d -p 8090:8090 --name oled_web oled_web:latest

# podman-compose
podman compose -f compose.yaml up -d
```

> 映像由 **GitHub Actions** 自動建置，支援 `linux/amd64` 與 `linux/arm64`（Raspberry Pi）。

### Cloudflare Tunnel 公開分享

```bash
./oled_web &
cloudflared tunnel --url http://localhost:8090
# 輸出公開 URL，如 https://xxxx.trycloudflare.com
```

---

## 鍵盤快捷鍵

| 按鍵 | 功能 |
|------|------|
| `P` `E` `F` `L` `R` `C` `T` `S` `M` | 切換工具 |
| `Ctrl+Z` / `Ctrl+Y` | 復原 / 重做 |
| `Ctrl+D` | 複製目前圖層 |
| `+` / `-` | 放大 / 縮小 |
| `Enter` | 放置文字 / 圖示 |
| `Esc` | 取消放置 |
| `Delete` | 清除選取區 |
| `↑↓←→` | 移動目前圖層 1px |
| 滑鼠中鍵拖曳 | 平移畫布 |

---

## 技術棧

| 層次 | 技術 |
|------|------|
| 後端 | Go 1.24（標準庫 `net/http`，零依賴） |
| 前端 | 原生 HTML / CSS / JS（Canvas 2D API） |
| 字型 | Google Material Icons（codepoint 渲染） |
| ZIP | JSZip 3.10（CDN） |
| 容器 | Podman / OCI（alpine:3.21，~15 MB） |

---

## 專案結構

```
OLED_WEB/
├── main.go              # Go HTTP 伺服器 + 匯出 API
├── go.mod
├── Containerfile        # 多階段 Podman 建置
├── compose.yaml         # podman-compose 設定
├── run.sh               # 快速操作腳本
└── static/
    ├── index.html       # 主頁面（5欄式版面）
    ├── css/style.css    # 暗色主題 CSS
    └── js/
        ├── app.js       # 繪圖引擎 / 圖層 / 頁面管理
        ├── fonts.js     # ASCII 點陣字體資料
        └── icons.js     # Material Icons 渲染器
```

---

## 授權

MIT License © 2026
