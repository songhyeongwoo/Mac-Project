# 🚀 Mac-Project  
### Interactive Data Visualization Platform

Mac-Project는 사용자가 직접 데이터를 입력하면  
동적(Animated) 데이터 시각화를 생성하고  
MP4 또는 GIF 파일로 추출할 수 있는  
웹 기반 인터랙티브 시각화 플랫폼입니다.

Flourish와 유사한 No-Code 데이터 시각화 환경을 목표로 개발 중입니다.

---

## 🌐 Live Demo
> <img width="1920" height="941" alt="image" src="https://github.com/user-attachments/assets/04d1eba3-ce55-4252-a0d5-5a3d5bd5722b" />


---

## 🧠 Problem Statement

기존 데이터 시각화 툴은:
- 설치가 필요하거나
- 전문 툴 사용법을 익혀야 하거나
- 영상 추출 기능이 제한적입니다.

Mac-Project는  
**브라우저 기반으로 즉시 사용 가능하며,  
애니메이션 시각화를 손쉽게 영상으로 추출할 수 있는 환경**을 제공합니다.

---

## ✨ Key Features

### 📊 Dynamic Chart Engine
- Animated Racing Bar Chart
- Timeline 기반 데이터 변화 시각화
- 실시간 차트 옵션 조정

### 🎨 Customization
- 색상 테마 변경
- 정렬/표시 옵션 설정
- 카테고리 기반 색상 매핑

### 🎞 Export System
- MP4 영상 다운로드
- GIF 추출 기능 (개발 중)
- Canvas 기반 렌더링 처리

### 📁 Data Handling
- 표 형태 데이터 입력
- 엑셀 기반 데이터 확장 예정
- 대규모 시계열 데이터 처리

---

## 🏗 Technical Architecture

Frontend SPA 기반 구조

- React (Component-driven architecture)
- Vite (Fast bundling & HMR)
- html2canvas (Canvas capture)
- mp4-muxer (Video export engine)
- Modular Chart Rendering Logic
- State-driven Animation Control

---

## 📂 Project Structure

```
Mac-Project/
├─ public/
├─ src/
│  ├─ components/        # UI Components
│  ├─ pages/             # Page-level logic
│  ├─ utils/             # Export / Data utils
│  ├─ chart-engine/      # Visualization logic (planned)
│  ├─ App.jsx
│  └─ main.jsx
├─ index.html
├─ package.json
└─ vite.config.js
```

---

## ⚙️ Installation

```
npm install
```

---

## ▶️ Run Development Server

```
npm run dev
```

---

## 📦 Production Build

```
npm run build
```


## 🌟 Long-Term Vision

Mac-Project는 단순 차트 생성 툴을 넘어  
**웹 기반 데이터 스토리텔링 플랫폼**으로 확장하는 것을 목표로 합니다.

사용자는 코드 없이  
전문적인 인터랙티브 시각화를 제작하고  
즉시 공유 및 영상화할 수 있는 환경을 제공받게 됩니다.

---

## 📌 Built With

- React
- Vite
- JavaScript (ES6+)
- Canvas API
- Git / GitHub (Collaborative Workflow)
