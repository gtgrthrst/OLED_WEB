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

#### 內建像素字體

| 字體 | 尺寸 | 語言支援 | 說明 |
|------|------|----------|------|
| **[Cubic-11](https://github.com/ACh-K/Cubic-11)** | 11px 最佳 | 中 / 日 / 韓 / ASCII | 方塊像素風格，所有筆劃對齊格線，OFL 授權 |
| 5×7 標準 / 粗體 | 固定 7px | ASCII | 經典嵌入式點陣字型 |
| 3×5 迷你 | 固定 5px | ASCII | 極小尺寸，適合狀態列 |
| 8×8 等寬 | 固定 8px | ASCII | IBM 風格等寬字型 |
| 中文 8–24px | 可選 | 繁 / 簡體中文 | 正黑體 / 宋體 / 等寬，超採樣渲染 |

#### 系統 / 自訂字體

- **系統字體**：Canvas 2D 超採樣渲染（4×–8×），支援任意 Unicode 及中文
- **上傳字體**：直接拖入 TTF / OTF 檔案即可使用
- **筆劃閾值**（1–100%，相對最亮像素）：低值保留細節，高值使筆劃加粗

> **推薦字體組合**  
> OLED 顯示中文：**Cubic-11 + 11px** ← 開箱即用，不需另外設定  
> 英文小字：**5×7 標準** ← 7px 仍保持完整可讀性

### 🖼 圖示庫
- **479 個 Google Material Icons**，透過 codepoint 渲染至像素網格
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

#### ✂ 自動裁減空白區域

匯出時勾選「自動裁減空白區域」，自動掃描像素邊界，去除四周空白，產出最緊湊的尺寸：

```
原始畫布 128×64  ─→  裁減後 42×11 @ (43, 26)

# Cropped from 128×64 canvas, content offset (43, 26)
hello_data = bytearray([...])   # 僅 6 bytes，而非 1024 bytes
```

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
| 像素字體 | [Cubic-11](https://github.com/ACh-K/Cubic-11)（OFL）/ 自訂 5×7 / 3×5 / 8×8 點陣 |
| 圖示 | Google Material Icons（codepoint 渲染，479 個） |
| ZIP | JSZip 3.10（CDN） |
| 容器 | Podman / OCI（alpine:3.21，~15 MB） |
| CI/CD | GitHub Actions（multi-arch，推送至 ghcr.io） |

---

## 專案結構

```
OLED_WEB/
├── main.go                   # Go HTTP 伺服器 + 匯出 API
├── go.mod
├── Containerfile             # 多階段 Podman 建置
├── compose.yaml              # podman-compose 設定
├── run.sh                    # 快速操作腳本
├── .github/workflows/
│   └── container.yml         # CI：multi-arch 映像建置
└── static/
    ├── index.html            # 主頁面（5欄式版面）
    ├── css/style.css         # 暗色主題 CSS
    ├── fonts/
    │   └── Cubic_11.ttf     # 內建像素字體（OFL）
    └── js/
        ├── app.js            # 繪圖引擎 / 圖層 / 頁面管理
        ├── fonts.js          # ASCII 點陣字體資料
        └── icons.js          # Material Icons 渲染器
```

---

## 字體授權

| 字體 | 授權 | 來源 |
|------|------|------|
| Cubic-11 | [SIL Open Font License 1.1](https://openfontlicense.org/) | [ACh-K/Cubic-11](https://github.com/ACh-K/Cubic-11) |
| 5×7 / 3×5 / 8×8 點陣 | Public Domain | 自訂實作 |

## 授權

MIT License © 2026
