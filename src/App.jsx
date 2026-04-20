import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import "./App.css";
import html2canvas from "html2canvas"; // 추가
import * as Mp4Muxer from "mp4-muxer"; // 추가

/* =========================
   Utils
========================= */
/* =========================================
   [최종 수정] MP4 추출 로직 함수 (해상도별 코덱 자동 전환)
   ========================================= */
async function exportVideo({
  element,
  fps,
  width,
  height,
  maxT,
  msPerStep,
  setT,
  onProgress,
}) {
  if (!element) return;

  // 1. 짝수 해상도 보정 (홀수면 1을 뺌)
  const safeWidth = width % 2 === 0 ? width : width - 1;
  const safeHeight = height % 2 === 0 ? height : height - 1;

  console.log(`[Export] ${safeWidth}x${safeHeight} @ ${fps}fps`);

  // 2. 해상도에 따른 최적 코덱 문자열 선택
  // 4K 이상이면 High Profile Level 5.1, 그 외엔 Main Profile Level 4.2 사용
  const is4K = safeWidth >= 3840 || safeHeight >= 2160;
  const codecString = is4K ? "avc1.640033" : "avc1.4d002a"; 

  // 3. 전체 프레임 수 계산
  const totalDurationSec = (maxT * msPerStep) / 1000;
  const totalFrames = Math.ceil(totalDurationSec * fps);
  const dt = maxT / totalFrames;

  // 4. Muxer 설정
  const muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: "avc", width: safeWidth, height: safeHeight },
    fastStart: "in-memory",
  });

  // 에러 발생 시 원인을 저장할 변수
  let encoderError = null;

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      console.error("VideoEncoder Error:", e);
      encoderError = e; // 에러 저장
    },
  });

  // 5. 인코더 설정 (비트레이트도 해상도에 맞춰 조절)
  try {
    videoEncoder.configure({
      codec: codecString,
      width: safeWidth,
      height: safeHeight,
      bitrate: is4K ? 20_000_000 : 8_000_000, // 4K는 20Mbps, FHD는 8Mbps
      framerate: fps,
    });
  } catch (configErr) {
    throw new Error(`코덱 설정 실패: ${configErr.message}`);
  }

  // 6. 녹화 루프
  try {
    for (let i = 0; i < totalFrames; i++) {
      // 인코더가 죽었는지 확인
      if (videoEncoder.state === "closed" || encoderError) {
        throw new Error(
          encoderError 
            ? `인코딩 오류: ${encoderError.message}` 
            : "인코더가 예기치 않게 닫혔습니다 (해상도/코덱 호환성 문제)."
        );
      }

      if (onProgress) onProgress(Math.round((i / totalFrames) * 100));

      const currentT = i * dt;
      if (currentT > maxT) break;
      setT(currentT);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const canvas = await html2canvas(element, {
        scale: safeWidth > 1920 ? 1 : 2, // 4K는 1배, 그 외 2배
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false,
        width: safeWidth,
        height: safeHeight,
        windowWidth: safeWidth,
        windowHeight: safeHeight,
      });

      const frameBitmap = await createImageBitmap(canvas, {
        resizeWidth: safeWidth,
        resizeHeight: safeHeight,
        resizeQuality: "high",
      });

      const frame = new VideoFrame(frameBitmap, {
        timestamp: (i * 1_000_000) / fps,
      });

      videoEncoder.encode(frame, { keyFrame: i % fps === 0 });
      frame.close();
    }

    // 7. 마무리 및 다운로드
    await videoEncoder.flush();
    muxer.finalize();

    const { buffer } = muxer.target;
    const blob = new Blob([buffer], { type: "video/mp4" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `racing-chart-${Date.now()}.mp4`;
    a.click();
    URL.revokeObjectURL(url);
    
    if (onProgress) onProgress(100);

  } catch (err) {
    console.error(err);
    throw err;
  }
}

/* =========================================
   [2] 모달 컴포넌트 (파일 분리 없이 여기에 정의)
   ========================================= */
function ExportModal({ onClose, onExport, totalDuration }) {
  const [quality, setQuality] = useState("1080p");
  const [fps, setFps] = useState(30);

  const handleDownload = () => {
    let width = 1920;
    let height = 1080;
    if (quality === "720p") { width = 1280; height = 720; }
    if (quality === "4k") { width = 3840; height = 2160; }
    onExport({ width, height, fps });
  };

  return (
    <div className="export-overlay">
      <div className="export-card">
        <div className="export-header">
          <h3>동영상 내보내기</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="export-body">
          <div className="export-row">
            <span className="row-label">화질</span>
            <select value={quality} onChange={(e) => setQuality(e.target.value)}>
              <option value="720p">720p (HD)</option>
              <option value="1080p">1080p (FHD)</option>
              <option value="4k">4K (UHD)</option>
            </select>
          </div>
          <div className="export-row">
            <span className="row-label">프레임</span>
            <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
              <option value={30}>30 FPS</option>
              <option value={60}>60 FPS</option>
            </select>
          </div>
          <div className="export-info">
            예상 길이: <b>{totalDuration.toFixed(1)}초</b>
          </div>
        </div>
        <div className="export-footer">
          <button className="download-btn" onClick={handleDownload}>다운로드</button>
        </div>
      </div>
    </div>
  );
}
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsArrayBuffer(file);
  });
}


function toNumber(v) {
  if (v === null || v === undefined) return NaN;
  const s0 = String(v).trim();
  if (s0 === "") return NaN;              
  const s = s0.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function formatNumber(n, decimals = 0) {
  if (!Number.isFinite(n)) return "";
  try {
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    }).format(n);
  } catch {
    return String(n);
  }
}

function isLikelyTimeColumn(colName) {
  return /^\d{4}([.\-\/]\d{1,2})?$/.test(String(colName).trim());
}

function timeKey(colName) {
  const s = String(colName).trim();
  const m = s.match(/^(\d{4})(?:[.\-\/](\d{1,2}))?$/);
  if (!m) return Number.MAX_SAFE_INTEGER;
  const y = Number(m[1]);
  const mm = m[2] ? Number(m[2]) : 0;
  return y * 100 + mm;
}

/** Flourish 느낌: 과한 2x 확장(105→200) 줄이고, 1.2/1.5/2/2.5… 단으로 스케일 */
function niceMax(x) {
  if (!Number.isFinite(x) || x <= 0) return 1;
  const m = x * 1.06; // 살짝 헤드룸만
  const exp = Math.floor(Math.log10(m));
  const base = Math.pow(10, exp);
  const f = m / base;
  const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const s = steps.find((v) => f <= v) ?? 10;
  return s * base;
}

// ✅ axisMax 스무딩용 (상승은 빠르게, 하락은 느리게)
function smoothAxisMaxFactory() {
  const ref = { cur: 1 };
  return function smoothAxisMax(
    target,
    { up = 0.45, down = 0.08, snapUp = 2.2, min = 1 } = {}
  ) {
    const t = Number.isFinite(target) && target > 0 ? target : min;
    const p = Number.isFinite(ref.cur) && ref.cur > 0 ? ref.cur : t;

    let next = p;

    // 너무 급격히 커지면 바로 스냅
    if (t > p * snapUp) next = t;
    // 상승은 빠르게 따라감
    else if (t > p) next = p + (t - p) * up;
    // 하락은 천천히 내려감
    else next = p + (t - p) * down;

    if (!Number.isFinite(next) || next <= 0) next = min;
    ref.cur = next;
    return next;
  };
}

function pickAutoLabel(cols, sampleRows) {
  const candidates = cols.filter((c) => !isLikelyTimeColumn(c));
  if (!candidates.length) return cols[0] ?? "";
  const sample = sampleRows.slice(0, 40);
  let best = candidates[0];
  let bestScore = -1;
  for (const c of candidates) {
    const vals = sample.map((r) => String(r[c] ?? "").trim()).filter(Boolean);
    const uniq = new Set(vals).size;
    const filledRatio = vals.length / Math.max(sample.length, 1);
    const uniqRatio = uniq / Math.max(vals.length, 1);
    const score = filledRatio * 1.0 + uniqRatio * 0.8;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

function colLetter(i) {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/* =========================
   Palettes (Flourish 느낌 여러 세트)
========================= */
const PALETTES = {
  Flourish: ["#3A2E58", "#FF6A2A", "#4d78a7", "#76B7B2", "#59A14F", "#EDC948", "#B07AA1", "#E15759", "#9C755F", "#F28E2B", "#C794A8", "#2F4858"],
  "Flourish Alternate": ["#2E294E", "#EF476F", "#FFD166", "#06D6A0", "#118AB2", "#7B2CBF", "#F77F00", "#8D99AE", "#3D5A80", "#E63946"],
  "Flourish Blues": ["#1D4ED8", "#2563EB", "#3B82F6", "#60A5FA", "#93C5FD", "#0EA5E9", "#0284C7", "#0369A1"],
  "Flourish Light Blues": ["#0EA5E9", "#38BDF8", "#7DD3FC", "#BAE6FD", "#60A5FA", "#93C5FD", "#A5B4FC", "#C7D2FE"],
  "Flourish Purples": ["#4C1D95", "#6D28D9", "#7C3AED", "#7a30ce", "#A78BFA", "#C4B5FD", "#DDD6FE", "#5B21B6"],
  "Flourish Pinks": ["#9D174D", "#DB2777", "#EC4899", "#F472B6", "#F9A8D4", "#FDA4AF", "#FB7185", "#BE185D"],
  "Flourish Oranges": ["#7C2D12", "#C2410C", "#EA580C", "#F97316", "#FB923C", "#FDBA74", "#FFEDD5", "#9A3412"],
  "Flourish Yellows": ["#713F12", "#A16207", "#CA8A04", "#EAB308", "#FACC15", "#FDE047", "#FEF08A", "#854D0E"],
  "Flourish Teals": ["#134E4A", "#0F766E", "#14B8A6", "#2DD4BF", "#5EEAD4", "#99F6E4", "#CCFBF1", "#115E59"],
  "Flourish Greens": ["#14532D", "#166534", "#16A34A", "#22C55E", "#2fcf6a", "#86EFAC", "#BBF7D0", "#15803D"],
  "Flourish Reds": ["#7F1D1D", "#B91C1C", "#DC2626", "#EF4444", "#F87171", "#FCA5A5", "#FEE2E2", "#991B1B"],
  "Flourish Grays": ["#111827", "#374151", "#6B7280", "#9CA3AF", "#D1D5DB", "#E5E7EB", "#F3F4F6", "#4B5563"],
  Engage: ["#7C3AED", "#F97316", "#06B6D4", "#22C55E", "#EAB308", "#EF4444", "#3B82F6", "#EC4899"],
  Reveal: ["#0EA5E9", "#F59E0B", "#10B981", "#EF4444", "#8B5CF6", "#3B82F6", "#F97316", "#14B8A6"],
  Narrate: ["#334155", "#475569", "#64748B", "#94A3B8", "#CBD5E1", "#1F2937", "#0F172A", "#111827"],
  Illuminate: ["#F97316", "#EF4444", "#A855F7", "#3B82F6", "#14B8A6", "#22C55E", "#EAB308", "#EC4899"],
};

function hslFromKey(key, s = 68, l = 52) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} ${s}% ${l}%)`;
}

function palettePick(palette, idx, key, extend) {
  const pal = palette?.length ? palette : ["#3A2E58"];
  if (idx < pal.length) return pal[idx];
  if (extend) return hslFromKey(key || String(idx));
  return pal[idx % pal.length];
}

/* =========================
   Resize hook
========================= */
function useElementSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      setSize({ width: cr.width, height: cr.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/* =========================
   Small UI Components
========================= */
function IconButton({ title, onClick, children }) {
  return (
    <button className="iconBtn" title={title} onClick={onClick} type="button">
      {children}
    </button>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      className={`tabBtn ${active ? "active" : ""}`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function Select({ value, onChange, options }) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Switch({ checked, onChange, onLabel = "켬", offLabel = "끔" }) {
  return (
    <button
      type="button"
      className={`switch ${checked ? "on" : ""}`}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      title={checked ? onLabel : offLabel}
    >
      <span className="switchKnob" />
    </button>
  );
}

function Slider({ value, min, max, step, onChange }) {
  return (
    <input
      className="slider"
      type="range"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

function Section({ title, right, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="section">
      <button
        type="button"
        className="sectionHeader"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="sectionTitle">{title}</div>
        <div className="sectionRight">
          {right}
          <span className={`chev ${open ? "open" : ""}`}>▾</span>
        </div>
      </button>
      {open && <div className="sectionBody">{children}</div>}
    </div>
  );
}

function FieldRow({ label, hint, children }) {
  return (
    <div className="fieldRow">
      <div className="fieldLabel">
        <div className="fieldLabelMain">{label}</div>
        {hint ? <div className="fieldHint">{hint}</div> : null}
      </div>
      <div className="fieldControl">{children}</div>
    </div>
  );
}

/* =========================
   Axis (top)
========================= */
function AxisTop({ max, ticks = 3, labelWidth, showGrid = true, gridHeight = 0 }) {
  const step = max / ticks;
  return (
    <div className="axisTop">
      <div style={{ width: labelWidth }} />
      <div className="axisTopArea">
        <div className="axisLine" />
          {Array.from({ length: ticks + 1 }).map((_, i) => {
            const xPct = (i / ticks) * 100;
            const v = step * i;

            const isFirst = i === 0;
            const isLast = i === ticks;

            const tickTransform = isFirst
              ? "translateX(0)"
              : isLast
              ? "translateX(-100%)"
              : "translateX(-50%)";

            const labelTransform = isFirst
              ? "translateX(0)"
              : isLast
              ? "translateX(-100%)"
              : "translateX(-50%)";

            return (
              <div key={i} className="axisTick" style={{ left: `${xPct}%`, transform: tickTransform }}>
                {showGrid ? (
                  <div className="axisGridLine" style={{ height: Math.max(0, gridHeight) }} />
                ) : null}
                <div className="axisLabel" style={{ transform: labelTransform }}>
                  {formatNumber(v, 0)}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}

/* =========================
   Chart Preview
========================= */
function ChartPreview({
  frame,
  axisMax,
  categoriesLegend,
  topN,
  spacingPct,
  labelWidth,
  showImages,
  showLegend,
  showAxis,
  tickCount,
  showGrid,
  showBigTime,
  showTotal,
  decimals,
  barOpacity,
  timeLabel,
  total,
  playing,
  onTogglePlay,
  onScrub,
  t,
  maxT,
  showTimeline,
  valueCols,
  title,
  titleSize,
  titleAlign
}) {
  const plotRef = useRef(null);

  const smoothAxis = useMemo(() => smoothAxisMaxFactory(), []);
  const axisMaxUsed = smoothAxis(axisMax);

  const { height: plotH } = useElementSize(plotRef);

  const hudH = showTimeline ? 66 : 16;

  // spacingPct로 기본 gap 만들기
  let gap = clamp(Math.round(6 + (spacingPct / 100) * 16), 2, 18);

  const plotForBars = Math.max(0, plotH - 10);

  // 1) 우선 계산 (clamp 최소를 낮춤)
  let barH =
    plotH > 0
      ? Math.floor((plotForBars - gap * Math.max(0, topN - 1)) / Math.max(1, topN))
      : 28;

  // ✅ TopN이 커지면 Flourish처럼 막대가 더 얇아질 수 있어야 함
  barH = clamp(barH, 10, 96);

  // 2) 그래도 공간이 부족하면 barH + gap을 같이 줄여서 "무조건 fit"
  if (plotForBars > 0) {
    const need = topN * barH + Math.max(0, topN - 1) * gap;
    if (need > plotForBars) {
      const scale = plotForBars / need;
      barH = Math.max(8, Math.floor(barH * scale));
      gap = Math.max(2, Math.floor(gap * scale));
    }
  }

  const gridHeight = Math.max(0, plotH + hudH);

  // ✅ barH에 따라 글씨 크기 자동 조절
  const labelFont = clamp(Math.round(barH * 0.46), 10, 16);
  const valueFont = clamp(Math.round(barH * 0.44), 10, 15);

  // ✅ enter/exit용: 렌더에 남아있는 아이템(TopN 밖으로 나가는 애들도 잠깐 유지)
  const EXIT_MS = 460; // transform 420ms + 여유
  const ENTER_FROM_RANK = topN + 1.2;
  const EXIT_TO_RANK = topN + 1.2;

  const itemsRef = useRef(new Map()); // key -> item
  const [renderItems, setRenderItems] = useState([]);

  // frame 변화마다 enter/exit 상태 계산
  useEffect(() => {
    // 빈 프레임이면 초기화
    if (!frame || frame.length === 0) {
      itemsRef.current = new Map();
      setRenderItems([]);
      return;
    }

    const nextKeys = new Set(frame.map((d) => d.key));
    const m = new Map(itemsRef.current);

    // 1) 현재 frame에 있는 애들 업데이트 or 신규 추가(enter)
    for (const d of frame) {
      const prev = m.get(d.key);
      if (prev) {
        // exiting 중이었다가 다시 들어오면 즉시 복귀
        m.set(d.key, {
          ...prev,
          ...d,
          status: "present",
          rank: d.rank,
          opacity: 1,
        });
      } else {
        // 신규: 아래 화면 밖에서(enter) + 투명
        m.set(d.key, {
          ...d,
          status: "enter",
          rank: ENTER_FROM_RANK,
          opacity: 0,
        });
      }
    }

    // 2) 기존에 있었는데 이번 frame에 없으면 exit로 표시
    for (const [key, it] of m.entries()) {
      if (!nextKeys.has(key)) {
        // 이미 exit면 그대로 두되, 목표 rank/opacity로 한 번 더 보정
        m.set(key, {
          ...it,
          status: "exit",
          rank: EXIT_TO_RANK,
          opacity: 0,
          _exitAt: performance.now(),
        });
      }
    }

    itemsRef.current = m;
    setRenderItems(Array.from(m.values()));

    // 3) enter 아이템을 다음 프레임에 "목표 rank"로 이동 + 불투명 (슬라이드 인)
    const raf = requestAnimationFrame(() => {
      const mm = new Map(itemsRef.current);
      for (const d of frame) {
        const it = mm.get(d.key);
        if (it && it.status === "enter") {
          mm.set(d.key, { ...it, status: "present", rank: d.rank, opacity: 1 });
        }
      }
      itemsRef.current = mm;
      setRenderItems(Array.from(mm.values()));
    });

    // 4) exit 아이템은 애니메이션 끝나면 DOM에서 제거
    const timer = setTimeout(() => {
      const mm = new Map(itemsRef.current);
      const now = performance.now();
      for (const [key, it] of mm.entries()) {
        if (it.status === "exit" && it._exitAt && now - it._exitAt > EXIT_MS - 30) {
          mm.delete(key);
        }
      }
      itemsRef.current = mm;
      setRenderItems(Array.from(mm.values()));
    }, EXIT_MS);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [frame, topN]);

  // timeline ticks
  const timelineTicks = useMemo(() => {
    if (!valueCols?.length || maxT <= 0) return [];
    const n = 10;
    const out = [];
    for (let i = 0; i <= n; i++) {
      const tt = Math.round((i / n) * maxT);
      out.push({ p: i / n, label: valueCols[tt] ?? "" });
    }
    return out;
  }, [valueCols, maxT]);

  const tPct = maxT > 0 ? (clamp(t, 0, maxT) / maxT) * 100 : 0;

  return (
    <div className="chartWrap">
      <div className="chartCanvas flourishCanvas">
        {title ? (
          <div
            className="chartTitleArea"
            style={{
              fontSize: titleSize,
              textAlign: titleAlign,
              width: "100%",
              marginBottom: 20, // 차트와의 간격
              fontWeight: 700,
              color: "#111827",
              lineHeight: 1.2
            }}
          >
            {title}
          </div>
        ) : null}

        {showAxis ? (
          <AxisTop
            max={axisMaxUsed}
            ticks={tickCount}
            labelWidth={labelWidth}
            showGrid={showGrid}
            gridHeight={gridHeight}
          />
        ) : (
          <div style={{ height: 26 }} />
        )}

        <div className="plotArea" ref={plotRef} style={{ paddingBottom: hudH }}>
          {renderItems.map((d) => {
            const y = d.rank * (barH + gap);

            // ✅ enter/exit는 바가 "0 width"에서 시작/끝나게(더 Flourish 느낌)
            const rawPct = axisMaxUsed > 0 ? (d.value / axisMaxUsed) * 100 : 0;
            const baseW = clamp(rawPct, 0, 100);
            const w = d.status === "enter" ? 0 : baseW;

            return (
              <div
                key={d.key}
                className="barRow"
                style={{
                  transform: `translate3d(0, ${y}px, 0)`,
                  height: barH,
                  opacity: d.opacity ?? 1,
                }}
              >
                <div className="barLabel" style={{ width: labelWidth, fontSize: labelFont }} title={d.label}>
                  {d.label}
                </div>

                <div className="barTrack" style={{ height: barH }}>
                  <div
                    className="barFill"
                    style={{
                      width: `${w}%`,
                      background: d.color,
                      opacity: barOpacity,
                    }}
                  >
                    {showImages && d.imageUrl ? (
                      <div className="barFlagWrap" title="">
                        <img
                          className="barFlag"
                          src={d.imageUrl}
                          alt=""
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      </div>
                    ) : null}

                    <div className="barValueFloat" style={{ fontSize: valueFont }}>{formatNumber(d.value, decimals)}</div>
                  </div>
                </div>
              </div>
            );
          })}

          {showBigTime ? (
            <div className="bigTime">
              <div className="bigTimeYear">{timeLabel}</div>
              {showTotal ? (
                <div className="bigTimeTotal">Total: {formatNumber(total, 0)}</div>
              ) : null}
            </div>
          ) : null}

          {showLegend && categoriesLegend.length > 0 ? (
            <div className="legendRow">
              <div className="legendTitle">Region</div>
              <div className="legendItems">
                {categoriesLegend.map((c) => (
                  <div key={c.name} className="legendItem">
                    <span className="legendDot" style={{ background: c.color }} />
                    <span className="legendText">{c.name}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {showTimeline ? (
            <div className="timelineBar">
              <button
                className="playCircle"
                onClick={onTogglePlay}
                type="button"
                title={playing ? "일시정지" : "재생"}
              >
                {playing ? "❚❚" : "▶"}
              </button>

              <div className="timelineTrackWrap">
                <div className="timelineLine" />
                {timelineTicks.map((tk, i) => (
                  <div key={i} className="timelineTick" style={{ left: `${tk.p * 100}%` }}>
                    <div className="timelineTickLine" />
                    <div className="timelineTickLabel">{tk.label}</div>
                  </div>
                ))}
                <div className="timelineHandle" style={{ left: `${tPct}%` }} />
                <input
                  className="timelineSlider"
                  type="range"
                  min="0"
                  max={maxT}
                  step="0.001"
                  value={t}
                  onChange={(e) => onScrub(Number(e.target.value))}
                />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* =========================
   Data Grid
========================= */
/* =========================
   Data Grid (Editable)
========================= */
function DataGrid({ rows, columns, highlight, maxRows = 100, onCellChange }) {
  // 너무 많은 행 렌더링 방지 (페이징 대신 단순 자르기)
  const view = rows.slice(0, maxRows);

  return (
    <div className="dataGrid">
      <div className="dataGridTableWrap">
        <table className="dataTable">
          <thead>
            <tr>
              <th className="rownumTh" />
              {columns.map((c, i) => {
                const isHi = highlight?.includes(c);
                return (
                  <th key={c} className={isHi ? "hiCol" : ""}>
                    <div className="thTop">
                      <span className="colBadge">{colLetter(i)}</span>
                      <span className="colName">{c}</span>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {view.map((r, ri) => (
              <tr key={ri}>
                <td className="rownumTd">{ri + 1}</td>
                {columns.map((c) => (
                  <td key={c} className={highlight?.includes(c) ? "hiColCell" : ""}>
                    {/* 수정 가능한 Input으로 변경 */}
                    <input
                      className="dataCellInput"
                      type="text"
                      value={r[c] ?? ""}
                      onChange={(e) => onCellChange(ri, c, e.target.value)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > maxRows ? (
        <div className="dataGridFooter">
          성능을 위해 처음 {maxRows}행만 표시됩니다. (실제 데이터는 모두 존재함)
        </div>
      ) : null}
    </div>
  );
}

/* =========================
   Main App
========================= */
export default function App() {
  const [tab, setTab] = useState("preview"); // preview | data

  const [csvEncoding, setCsvEncoding] = useState("utf-8");
  const [workbook, setWorkbook] = useState(null);
  const [sheetName, setSheetName] = useState("");
  const [sheetNames, setSheetNames] = useState([]);
  const [rows, setRows] = useState([]);
  const [chartTitle, setChartTitle] = useState("나의 레이싱 차트");
  const [titleSize, setTitleSize] = useState(24);
  const [titleAlign, setTitleAlign] = useState("left"); // left | center | right
  const [showExportModal, setShowExportModal] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const chartAreaRef = useRef(null); // 캡처할 영역 Ref
  const [labelCol, setLabelCol] = useState("");
  const [categoryCol, setCategoryCol] = useState("");
  const [imageCol, setImageCol] = useState("");

  
  const columns = useMemo(() => {
    if (!rows.length) return [];
    return Object.keys(rows[0]);
  }, [rows]);
  

  const timeCandidates = useMemo(() => {
    return columns.filter(isLikelyTimeColumn).sort((a, b) => timeKey(a) - timeKey(b));
  }, [columns]);

  const [valueStart, setValueStart] = useState("");
  const [valueEnd, setValueEnd] = useState("");

  const valueCols = useMemo(() => {
    if (!timeCandidates.length) return [];
    const start = valueStart || timeCandidates[0];
    const end = valueEnd || timeCandidates[timeCandidates.length - 1];
    const si = timeCandidates.indexOf(start);
    const ei = timeCandidates.indexOf(end);
    if (si === -1 || ei === -1) return timeCandidates;
    const a = Math.min(si, ei);
    const b = Math.max(si, ei);
    return timeCandidates.slice(a, b + 1);
  }, [timeCandidates, valueStart, valueEnd]);

  // preview settings
  const [theme, setTheme] = useState("apex");
  const [topN, setTopN] = useState(10); // Flourish 기본 느낌
  const [spacingPct, setSpacingPct] = useState(10);
  const [sortingOn, setSortingOn] = useState(true);
  const [sortMode, setSortMode] = useState("desc"); // desc | asc

  // colors
  const [colorMode, setColorMode] = useState("category"); // category | label | single
  const [paletteName, setPaletteName] = useState("Flourish");
  const [extendColors, setExtendColors] = useState(true);

  const [singleColor, setSingleColor] = useState("#3E7EA5");
  const [highlightTop1, setHighlightTop1] = useState(true);
  const [highlightColor, setHighlightColor] = useState("#FF5A7A");

  const [barOpacity, setBarOpacity] = useState(0.92);

  // labels & layout
  const [decimals, setDecimals] = useState(0);
  const [labelWidth, setLabelWidth] = useState(170);

  // axis/legend/images
  const [showAxis, setShowAxis] = useState(true);
  const [tickCount, setTickCount] = useState(3);
  const [showGrid, setShowGrid] = useState(true);
  const [showLegend, setShowLegend] = useState(true);
  const [showImages, setShowImages] = useState(true);

  // big time / total
  const [showBigTime, setShowBigTime] = useState(true);
  const [showTotal, setShowTotal] = useState(true);

  // controls
  const [showTimeline, setShowTimeline] = useState(true);
  const [msPerStep, setMsPerStep] = useState(900);
  const [loop, setLoop] = useState(false);

  const [showTopIcons, setShowTopIcons] = useState(true);

  // animation state
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const tRef = useRef(0);
  const rafRef = useRef(null);
  const lastRef = useRef(null);

  const maxT = Math.max(0, valueCols.length - 1);

  // build series
  const series = useMemo(() => {
    if (!rows.length || !labelCol || !valueCols.length) return [];
    const list = [];

    const used = new Map(); // label 중복 방지용

    for (let ri = 0; ri < rows.length; ri++) {
      const r = rows[ri];
      const label = String(r[labelCol] ?? "").trim();
      if (!label) continue;

      const cnt = (used.get(label) ?? 0) + 1;
      used.set(label, cnt);
      const key = cnt === 1 ? label : `${label}__${cnt}`; // ✅ 중복 라벨 대비

      const cat = categoryCol ? String(r[categoryCol] ?? "").trim() : "";
      const imageUrl = imageCol ? String(r[imageCol] ?? "").trim() : "";

      const raw = valueCols.map((vc) => toNumber(r[vc]));

      // ✅ 등장 전엔 NaN 유지, 등장 후에는 마지막 값 유지(forward fill)
      let last = NaN;
      const values = raw.map((v) => {
        if (Number.isFinite(v)) {
          last = v;
          return v;
        }
        return last; // last가 NaN이면 계속 NaN(아직 등장 전)
      });

      list.push({ key, label, cat, imageUrl, values });
    }
    return list;
  }, [rows, labelCol, categoryCol, imageCol, valueCols]);

  const palette = useMemo(() => PALETTES[paletteName] ?? PALETTES.Flourish, [paletteName]);

  // stable color maps (Flourish처럼 "카테고리 리스트 순서대로" 매핑)
  const catColorMap = useMemo(() => {
    const m = new Map();
    if (!series.length) return m;
    const seen = new Set();
    const cats = [];
    for (const s of series) {
      if (!s.cat) continue;
      if (seen.has(s.cat)) continue;
      seen.add(s.cat);
      cats.push(s.cat);
    }
    cats.forEach((c, i) => m.set(c, palettePick(palette, i, c, extendColors)));
    return m;
  }, [series, palette, extendColors]);

  const labelColorMap = useMemo(() => {
    const m = new Map();
    if (!series.length) return m;
    series.forEach((s, i) => {
      if (!m.has(s.label)) m.set(s.label, palettePick(palette, i, s.label, extendColors));
    });
    return m;
  }, [series, palette, extendColors]);

  // current frame (smooth interpolate + real-time sorting)
  const { frame, axisMax, timeLabel, total } = useMemo(() => {
    if (!series.length || !valueCols.length) {
      return { frame: [], axisMax: 1, timeLabel: "", total: 0 };
    }

    const ti = clamp(t, 0, maxT);
    const i = Math.floor(ti);
    const frac = ti - i;
    const i2 = Math.min(i + 1, maxT);

    const itemsAll = series
      .map((s) => {
        const a0 = s.values[i];
        const b0 = s.values[i2];

        const aHas = Number.isFinite(a0);
        const bHas = Number.isFinite(b0);

        // ✅ 둘 다 없으면(등장 전) 아예 렌더 제외
        if (!aHas && !bHas) return null;

        // ✅ 등장 순간: 이전이 NaN이고 다음이 유효면 0에서 시작
        const a = aHas ? a0 : 0;
        const b = bHas ? b0 : a;

        const value = a + (b - a) * frac;

        let color = singleColor;
        if (colorMode === "category")
          color = s.cat
            ? (catColorMap.get(s.cat) ?? singleColor)
            : (labelColorMap.get(s.label) ?? singleColor);
        if (colorMode === "label") color = labelColorMap.get(s.label) ?? singleColor;

        return { key: s.key, label: s.label, cat: s.cat, imageUrl: s.imageUrl, value, color };
      })
      .filter(Boolean)
      .filter((d) => Number.isFinite(d.value));

    const tot = itemsAll.reduce((acc, d) => acc + (Number.isFinite(d.value) ? d.value : 0), 0);

    let ordered = itemsAll.slice();
    if (sortingOn) {
      ordered.sort((a, b) => {
        const diff = sortMode === "asc" ? a.value - b.value : b.value - a.value;
        if (Math.abs(diff) > 1e-9) return diff;
        return String(a.label).localeCompare(String(b.label));
      });
    }

    const top = ordered.slice(0, topN).map((d, idx) => ({ ...d, rank: idx }));

    // ✅ 단색 모드: 현재 1위(rank 0)만 다른 색(실시간)
    if (colorMode === "single" && highlightTop1 && top.length) {
      top[0] = { ...top[0], color: highlightColor };
    }

    const maxVal = Math.max(...top.map((d) => d.value), 1);
    const aMax = niceMax(maxVal);
    const tl = valueCols[Math.floor(ti)] ?? "";

    return { frame: top, axisMax: aMax, timeLabel: tl, total: tot };
  }, [
    series,
    valueCols,
    t,
    maxT,
    topN,
    sortingOn,
    sortMode,
    colorMode,
    singleColor,
    highlightTop1,
    highlightColor,
    catColorMap,
    labelColorMap,
  ]);

  const categoriesLegend = useMemo(() => {
    if (!categoryCol) return [];
    const out = [];
    const seen = new Set();
    for (const s of series) {
      if (!s.cat) continue;
      if (seen.has(s.cat)) continue;
      seen.add(s.cat);
      out.push({ name: s.cat, color: catColorMap.get(s.cat) ?? "#999" });
    }
    return out;
  }, [series, categoryCol, catColorMap]);

  /* =========================
     Animation loop
  ========================= */
  useEffect(() => {
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastRef.current = null;
      return;
    }
    if (!valueCols.length) return;

    const step = (ts) => {
      if (lastRef.current == null) lastRef.current = ts;
      const dt = ts - lastRef.current;
      lastRef.current = ts;

      const speed = dt / msPerStep;
      tRef.current = tRef.current + speed;

      if (tRef.current >= maxT) {
        if (loop) {
          tRef.current = 0;
        } else {
          tRef.current = maxT;
          setPlaying(false);
        }
      }
      setT(tRef.current);
      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastRef.current = null;
    };
  }, [playing, valueCols.length, msPerStep, maxT, loop]);

  function scrubTo(v) {
    const nv = clamp(v, 0, maxT);
    tRef.current = nv;
    setT(nv);
    setPlaying(false);
  }

  /* =========================
     File load
  ========================= */
  async function loadSheet(wb, name) {
     
    const ws = wb.Sheets[name];
    const json = XLSX.utils.sheet_to_json(ws, { defval: "" });
    setSheetName(name);
    setRows(json);

    if (json.length) {
      const cols = Object.keys(json[0]);

      const autoLabel = pickAutoLabel(cols, json);
      setLabelCol(autoLabel);

      const catCandidate = cols.find((c) => /region|category|group|대륙|지역|분류/i.test(c));
      setCategoryCol(catCandidate ?? "");

      const imgCandidate = cols.find((c) => /image|img|flag|url/i.test(c));
      setImageCol(imgCandidate ?? "");

      const tc = cols.filter(isLikelyTimeColumn).sort((a, b) => timeKey(a) - timeKey(b));
      setValueStart(tc[0] ?? "");
      setValueEnd(tc[tc.length - 1] ?? "");

      tRef.current = 0;
      setT(0);
      setPlaying(false);
    }
  }

  async function onUpload(file) {
    if (!file) return;
    const ok = /\.(xlsx|xls|csv)$/i.test(file.name);
    if (!ok) {
      alert("xlsx/xls/csv 파일만 업로드할 수 있어!");
      return;
    }

    const buf = await readFileAsArrayBuffer(file);
    const ext = file.name.split(".").pop()?.toLowerCase();
    let wb;

    if (ext === "csv") {
      let text;
      try {
        text = new TextDecoder(csvEncoding).decode(new Uint8Array(buf));
      } catch {
        text = new TextDecoder("utf-8").decode(new Uint8Array(buf));
      }
      wb = XLSX.read(text, { type: "string" });
    } else {
      wb = XLSX.read(buf, { type: "array" });
    }

    setWorkbook(wb);
    setSheetNames(wb.SheetNames);
    const first = wb.SheetNames[0];
    await loadSheet(wb, first);
  }

  /* =========================
     UI helpers
  ========================= */
  const highlightCols = useMemo(() => {
    const arr = [];
    if (labelCol) arr.push(labelCol);
    if (categoryCol) arr.push(categoryCol);
    if (imageCol) arr.push(imageCol);
    return arr;
  }, [labelCol, categoryCol, imageCol]);

  const hasReady = rows.length > 0 && labelCol && valueCols.length > 0;
  const handleCellChange = (rowIndex, col, value) => {
    setRows((prev) => {
      const newRows = [...prev];
      // 해당 행만 복사하여 업데이트 (불변성 유지)
      newRows[rowIndex] = { ...newRows[rowIndex], [col]: value };
      return newRows;
    });
  };
  const handleAddColumn = () => {
    const name = prompt("새로운 열 이름을 입력하세요 (예: Image)");
    if (!name || name.trim() === "") return;

    // 이미 존재하는지 체크
    if (columns.includes(name)) {
      alert("이미 존재하는 열 이름입니다.");
      return;
    }

    // 모든 행에 빈 값("")으로 해당 열 추가
    setRows((prev) => prev.map((r) => ({ ...r, [name]: "" })));
    
    // 만약 'Image'나 '이미지'라는 이름으로 만들었다면, 자동으로 이미지 컬럼으로 선택해주면 편함
    if (/image|img|이미지|사진/i.test(name)) {
      setImageCol(name);
    }
  };
  const handleDeleteColumn = () => {
    const name = prompt("삭제할 열 이름을 정확히 입력하세요:");
    if (!name) return;

    if (!columns.includes(name)) {
      alert("존재하지 않는 열 이름입니다.");
      return;
    }

    if (!window.confirm(`정말 '${name}' 열을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) {
      return;
    }

    // 모든 행에서 해당 키(key)를 제거 (delete 연산자 사용)
    setRows((prev) =>
      prev.map((r) => {
        const newRow = { ...r };
        delete newRow[name];
        return newRow;
      })
    );
  };

  /* ------------------------------------------------
     [추가 2] 내보내기 실행 함수
     ------------------------------------------------ */
  const handleExportConfirm = async (settings) => {
    setShowExportModal(false);
    setIsExporting(true);
    setPlaying(false);
    setT(0); 

    try { // ★ try 시작
      // UI 반영 대기
      await new Promise((r) => setTimeout(r, 500)); 

      // exportVideo 실행
      await exportVideo({
        element: chartAreaRef.current,
        fps: settings.fps,
        width: settings.width,
        height: settings.height,
        maxT: maxT,
        msPerStep: msPerStep,
        setT: (val) => {
          tRef.current = val;
          setT(val);
        },
        onProgress: setExportProgress,
      });

      // ★ 에러 없이 여기까지 와야 성공 메시지 출력
      alert("다운로드가 완료되었습니다! (다운로드 폴더를 확인하세요)");

    } catch (error) { // ★ 에러 발생 시 여기로 이동
      console.error(error);
      
      // 사용자에게 구체적인 에러 알려주기
      let msg = "알 수 없는 오류가 발생했습니다.";
      
      if (error.message && error.message.includes("is not defined")) {
         msg = "이 브라우저는 MP4 변환을 지원하지 않습니다. 최신 크롬(Chrome)을 사용해주세요.";
      } else if (error.message && error.message.includes("Tainted canvases")) {
         msg = "이미지 보안(CORS) 문제로 다운로드할 수 없습니다. 이미지를 끄고 시도해보세요.";
      } else {
         msg = `오류 내용: ${error.message}`;
      }

      alert(`다운로드 실패!\n${msg}`);
    } finally {
      // 성공이든 실패든 로딩창 끄기
      setIsExporting(false);
      setExportProgress(0);
    }
  };

  
  return (
    <div className={`app theme-${theme}`}>
      {/* Top bar */}
      <header className="topbar">
        <div className="topbarLeft">
          {showTopIcons ? (
            <>
              <IconButton title="되돌리기" onClick={() => {}}>
                ↶
              </IconButton>
              <IconButton title="다시하기" onClick={() => {}}>
                ↷
              </IconButton>
              <div className="topbarSep" />
              <IconButton title="설정" onClick={() => {}}>
                ⚙
              </IconButton>
            </>
          ) : (
            <span className="mutedSmall"></span>
          )}
        </div>

        <div className="topbarCenter">
          <TabButton active={tab === "preview"} onClick={() => setTab("preview")}>
            미리보기
          </TabButton>
          <TabButton active={tab === "data"} onClick={() => setTab("data")}>
            데이터
          </TabButton>
        </div>

        <div className="topbarRight">
          {/* [추가 3] MP4 다운로드 버튼 */}
          <button 
            className="primaryBtn" 
            onClick={() => setShowExportModal(true)}
            disabled={!rows.length || isExporting} // 데이터 없거나 녹화중이면 클릭 금지
            style={{ marginRight: "10px", padding: "6px 12px", cursor: "pointer" }}
          >
            MP4 다운로드
          </button>

          <span className="savedDot" />
          <span className="savedText">저장됨</span>
        </div>
      </header>

      <div className="main">
        {/* Workspace */}
        <main className="workspace">
          {!rows.length ? (
            <div className="emptyState">
              <div className="emptyCard">
                <div className="emptyTitle">데이터 업로드</div>
                <div className="emptySub">
                  사용 가능한 파일 형식 : xlsx / xls / csv
                </div>

                <div className="emptyRow">
                  <div className="miniLabel">CSV 인코딩</div>
                  <Select
                    value={csvEncoding}
                    onChange={setCsvEncoding}
                    options={[
                      { value: "utf-8", label: "UTF-8" },
                      { value: "euc-kr", label: "EUC-KR(CP949)" },
                    ]}
                  />
                </div>

                <label className="uploadBtn">
                  데이터 업로드
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => onUpload(e.target.files?.[0])}
                    style={{ display: "none" }}
                  />
                </label>

                <div className="emptyHint">
                  ※ 최종수정 (26.04.21)
                </div>
              </div>
            </div>
          ) : tab === "preview" ? (
            <div className="previewPane">
              <div className="previewInner" style={{ position: "relative" }}>
                
                {isExporting && (
                  <div style={{
                    position: "absolute", 
                    top: 0, left: 0, right: 0, bottom: 0,
                    background: "rgba(255,255,255,0.9)", 
                    zIndex: 9999, // 차트보다 위에 떠있어야 함
                    display: "flex", 
                    flexDirection: "column", 
                    alignItems: "center", 
                    justifyContent: "center"
                  }}>
                    <h3 style={{margin:0, color:"#333"}}>동영상 생성 중... {exportProgress}%</h3>
                    <div style={{ width: "300px", height: "10px", background: "#eee", borderRadius: "5px", marginTop: "15px", overflow:"hidden" }}>
                      <div style={{ width: `${exportProgress}%`, height: "100%", background: "#6366f1", transition: "width 0.2s" }} />
                    </div>
                    <p style={{ fontSize: "13px", color: "#666", marginTop: "10px" }}>
                      화면을 조작하거나 창을 닫지 마세요.
                    </p>
                  </div>
                )}

                {/* [2] 녹화 대상 (카메라 - 여기만 찍힘!) */}
                <div 
                  ref={chartAreaRef} 
                  style={{ 
                    width: "100%", 
                    height: "100%", 
                    background: "white", // 배경을 흰색으로 지정해야 투명하게 안 나옴
                    display: "flex",     // 차트가 꽉 차게
                    flexDirection: "column"
                  }}
                >
                  <ChartPreview
                    frame={frame}
                    axisMax={axisMax}
                    categoriesLegend={categoriesLegend}
                    topN={topN}
                    spacingPct={spacingPct}
                    labelWidth={labelWidth}
                    showImages={showImages}
                    showLegend={showLegend}
                    showAxis={showAxis}
                    tickCount={tickCount}
                    showGrid={showGrid}
                    showBigTime={showBigTime}
                    showTotal={showTotal}
                    decimals={decimals}
                    barOpacity={barOpacity}
                    timeLabel={timeLabel}
                    total={total}
                    playing={playing}
                    onTogglePlay={() => setPlaying((v) => !v)}
                    onScrub={scrubTo}
                    t={t}
                    maxT={maxT}
                    showTimeline={!isExporting}
                    valueCols={valueCols}
                    title={chartTitle}
                    titleSize={titleSize}
                    titleAlign={titleAlign}
                  />
                </div>

              </div>
            </div>
          ) : (
            <div className="dataPane">
              <div className="dataTop">
                <div className="sheetRow">
                  <div className="sheetTitle">데이터</div>
                  <div className="sheetMeta">
                    시트:{" "}
                    <Select
                      value={sheetName}
                      onChange={(v) => {
                        if (!workbook) return;
                        loadSheet(workbook, v);
                      }}
                      options={sheetNames.map((s) => ({ value: s, label: s }))}
                    />
                    <span className="mutedSmall">행: {rows.length}</span>
                  </div>
                </div>
              </div>

              <DataGrid rows={rows} columns={columns} highlight={highlightCols} onCellChange={handleCellChange}/>
            </div>
          )}
        </main>

        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebarHeader">
            <div className="sidebarTitle">레이싱 바 차트</div>
            <div className="sidebarSub">v0.3 (Flourish 스타일)</div>
          </div>

          {/* Theme */}
          <div className="sidebarBlock">
            <FieldRow label="테마">
              <div className="rowGap">
                <Select
                  value={theme}
                  onChange={setTheme}
                  options={[
                    { value: "apex", label: "기본(Apex)" },
                    { value: "blue", label: "블루" },
                    { value: "midnight", label: "미드나잇(다크)" },
                  ]}
                />
                <button className="miniBtn" type="button" onClick={() => {}} title="초기화">
                  ⟳
                </button>
              </div>
            </FieldRow>
          </div>

          {/* 사이드바 내부: 테마 설정 아래, 데이터 설정 위에 추가 추천 */}

<Section title="차트 제목">
  {/* 1. 제목 입력 */}
  <FieldRow label="제목 텍스트">
    <input
      type="text"
      className="sidebarInput"
      value={chartTitle}
      onChange={(e) => setChartTitle(e.target.value)}
      style={{ width: "100%", padding: "4px 8px", border: "1px solid #d1d5db", borderRadius: 4 }}
      placeholder="제목을 입력하세요"
    />
  </FieldRow>

  {/* 2. 크기 조절 */}
  <FieldRow label="글자 크기">
    <div className="rowGap">
      <Slider 
        value={titleSize} 
        min={12} 
        max={60} 
        step={1} 
        onChange={setTitleSize} 
      />
      <span className="monoSmall">{titleSize}px</span>
    </div>
  </FieldRow>

  {/* 3. 위치(정렬) 조절 */}
  <FieldRow label="정렬 위치">
    <div className="seg">
      <button
        type="button"
        className={`segBtn ${titleAlign === "left" ? "active" : ""}`}
        onClick={() => setTitleAlign("left")}
      >
        왼쪽
      </button>
      <button
        type="button"
        className={`segBtn ${titleAlign === "center" ? "active" : ""}`}
        onClick={() => setTitleAlign("center")}
      >
        가운데
      </button>
      <button
        type="button"
        className={`segBtn ${titleAlign === "right" ? "active" : ""}`}
        onClick={() => setTitleAlign("right")}
      >
        오른쪽
      </button>
    </div>
  </FieldRow>
</Section>

          {tab === "data" ? (
            <>
            <div className="dataPane">
              {/* ✅ 여기에 버튼 추가 */}
              <div className="dataToolbar" style={{ marginBottom: 10, display: 'flex', gap: 10 }}>
                <button 
                  className="primaryBtn" 
                  onClick={handleAddColumn}
                  style={{ padding: '6px 12px', cursor: 'pointer' }}
                >
                  + 열 추가하기
                </button>
                <div className="hintText" style={{ alignSelf: 'center', fontSize: 13, color: '#666' }}>
                  (Tip: 'Image' 열을 추가하고 이미지 주소를 입력해보세요)
                </div>
              </div>

              {rows.length > 0 ? (
                <DataGrid
                  rows={rows}
                  columns={columns}
                  highlight={highlightCols}
                  onCellChange={handleCellChange}
                />
              ) : (
                <div className="emptyMsg">데이터를 업로드해주세요.</div>
              )}
            </div>
          ) : (
              <div className="sidebarBlock">
                <label className="uploadBtn sidebarUpload">
                  데이터 업로드
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => onUpload(e.target.files?.[0])}
                    style={{ display: "none" }}
                  />
                </label>
              </div>

              <div className="sidebarBlock">
                <div className="blockTitle">시각화할 컬럼 선택</div>

                <div className="mapRow">
                  <div className="mapLeft">
                    <div className="mapName">
                      라벨 <span className="req">(필수)</span>
                    </div>
                  </div>
                  <div className="mapRight">
                    <Select
                      value={labelCol}
                      onChange={setLabelCol}
                      options={[
                        { value: "", label: "선택…" },
                        ...columns.map((c) => ({ value: c, label: c })),
                      ]}
                    />
                  </div>
                </div>

                <div className="mapRow">
                  <div className="mapLeft">
                    <div className="mapName">값(연도 범위)</div>
                    <div className="mapHint">예: 2005 ~ 2024</div>
                  </div>
                  <div className="mapRight">
                    <div className="rowGap">
                      <Select
                        value={valueStart}
                        onChange={setValueStart}
                        options={timeCandidates.map((c) => ({ value: c, label: c }))}
                      />
                      <span className="mutedSmall">→</span>
                      <Select
                        value={valueEnd}
                        onChange={setValueEnd}
                        options={timeCandidates.map((c) => ({ value: c, label: c }))}
                      />
                    </div>
                    {!timeCandidates.length ? (
                      <div className="warn">
                        ⚠️ 연도 컬럼을 못 찾았어. 컬럼명이 1960, 2005 같은 형태인지 확인해줘.
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="mapRow">
                  <div className="mapLeft">
                    <div className="mapName">카테고리(범례)</div>
                  </div>
                  <div className="mapRight">
                    <Select
                      value={categoryCol}
                      onChange={setCategoryCol}
                      options={[
                        { value: "", label: "(없음)" },
                        ...columns.map((c) => ({ value: c, label: c })),
                      ]}
                    />
                  </div>
                </div>

                <div className="mapRow">
                  <div className="mapLeft">
                    <div className="mapName">이미지(국기/아이콘)</div>
                  </div>
                  <div className="mapRight">
                    <Select
                      value={imageCol}
                      onChange={setImageCol}
                      options={[
                        { value: "", label: "(없음)" },
                        ...columns.map((c) => ({ value: c, label: c })),
                      ]}
                    />
                  </div>
                </div>

                <button
                  className="primaryBtn"
                  type="button"
                  onClick={() => setTab("preview")}
                  disabled={!hasReady}
                  title={!hasReady ? "라벨 + 연도(값) 컬럼이 필요해" : ""}
                >
                  미리보기로 이동
                </button>
              </div>
            </>
          ) : (
            <>
              <Section title="설정">
                <FieldRow label="표시 막대 수">
                  <div className="rowGap">
                    <Select
                      value={String(topN)}
                      onChange={(v) => setTopN(Number(v))}
                      options={[8, 10, 12, 14, 16, 20].map((n) => ({
                        value: String(n),
                        label: String(n),
                      }))}
                    />
                    <span className="mutedSmall">Top {topN}</span>
                  </div>
                </FieldRow>

                <FieldRow label="막대 간격(%)">
                  <div className="rowGap">
                    <Slider value={spacingPct} min={0} max={30} step={1} onChange={setSpacingPct} />
                    <span className="monoSmall">{spacingPct}</span>
                  </div>
                </FieldRow>

                <FieldRow label="라벨 영역 폭" hint="왼쪽 라벨 컬럼">
                  <div className="rowGap">
                    <Slider value={labelWidth} min={140} max={260} step={2} onChange={setLabelWidth} />
                    <span className="monoSmall">{labelWidth}px</span>
                  </div>
                </FieldRow>

                <FieldRow label="정렬">
                  <div className="rowGap">
                    <div className="seg">
                      <button
                        type="button"
                        className={`segBtn ${sortingOn ? "active" : ""}`}
                        onClick={() => setSortingOn(true)}
                      >
                        켬
                      </button>
                      <button
                        type="button"
                        className={`segBtn ${!sortingOn ? "active" : ""}`}
                        onClick={() => setSortingOn(false)}
                      >
                        끔
                      </button>
                    </div>
                  </div>
                </FieldRow>

                <FieldRow label="정렬 방향">
                  <div className="seg">
                    <button
                      type="button"
                      className={`segBtn ${sortMode === "desc" ? "active" : ""}`}
                      onClick={() => setSortMode("desc")}
                    >
                      내림차순
                    </button>
                    <button
                      type="button"
                      className={`segBtn ${sortMode === "asc" ? "active" : ""}`}
                      onClick={() => setSortMode("asc")}
                    >
                      오름차순
                    </button>
                  </div>
                </FieldRow>
              </Section>

              <Section title="색상">
                <FieldRow label="Color mode">
                  <Select
                    value={colorMode}
                    onChange={setColorMode}
                    options={[
                      { value: "category", label: "By category" },
                      { value: "label", label: "By bar" },
                      { value: "single", label: "Single" },
                    ]}
                  />
                </FieldRow>

                {colorMode !== "single" ? (
                  <>
                    <FieldRow label="Palette">
                      <div className="rowGap">
                        <Select
                          value={paletteName}
                          onChange={setPaletteName}
                          options={Object.keys(PALETTES).map((k) => ({ value: k, label: k }))}
                        />
                      </div>
                    </FieldRow>

                    <FieldRow label="Extend">
                      <Switch checked={extendColors} onChange={setExtendColors} />
                    </FieldRow>

                    <div className="paletteRow">
                      {(PALETTES[paletteName] ?? PALETTES.Flourish).slice(0, 10).map((c) => (
                        <span key={c} className="swatch" style={{ background: c }} />
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <FieldRow label="단색 컬러">
                      <div className="rowGap">
                        <input
                          type="color"
                          value={singleColor}
                          onChange={(e) => setSingleColor(e.target.value)}
                          className="colorPicker"
                        />
                        <span className="monoSmall">{singleColor}</span>
                      </div>
                    </FieldRow>

                    <FieldRow label="Highlight #1">
                      <Switch checked={highlightTop1} onChange={setHighlightTop1} />
                    </FieldRow>

                    {highlightTop1 ? (
                      <FieldRow label="하이라이트 색">
                        <div className="rowGap">
                          <input
                            type="color"
                            value={highlightColor}
                            onChange={(e) => setHighlightColor(e.target.value)}
                            className="colorPicker"
                          />
                          <span className="monoSmall">{highlightColor}</span>
                        </div>
                      </FieldRow>
                    ) : null}
                  </>
                )}

                <FieldRow label="막대 투명도">
                  <div className="rowGap">
                    <Slider value={barOpacity} min={0.6} max={1} step={0.01} onChange={setBarOpacity} />
                    <span className="monoSmall">{barOpacity.toFixed(2)}</span>
                  </div>
                </FieldRow>
              </Section>

              <Section title="라벨">
                <FieldRow label="소수점 자리">
                  <Select
                    value={String(decimals)}
                    onChange={(v) => setDecimals(Number(v))}
                    options={[0, 1, 2, 3].map((n) => ({ value: String(n), label: String(n) }))}
                  />
                </FieldRow>
              </Section>

              <Section title="아이콘/이미지">
                <FieldRow label="국기/아이콘 표시">
                  <Switch checked={showImages} onChange={setShowImages} />
                </FieldRow>
                <FieldRow label="상단 툴 아이콘 표시" hint="Undo/Redo/설정">
                  <Switch checked={showTopIcons} onChange={setShowTopIcons} />
                </FieldRow>
              </Section>

              <Section title="연도/총합">
                <FieldRow label="큰 연도 표시">
                  <Switch checked={showBigTime} onChange={setShowBigTime} />
                </FieldRow>
                <FieldRow label="Total 표시">
                  <Switch checked={showTotal} onChange={setShowTotal} />
                </FieldRow>
              </Section>

              <Section title="재생/타임라인">
                <FieldRow label="타임라인 표시">
                  <Switch checked={showTimeline} onChange={setShowTimeline} />
                </FieldRow>
                <FieldRow label="재생 속도">
                  <div className="rowGap">
                    <Slider value={msPerStep} min={350} max={2500} step={50} onChange={setMsPerStep} />
                    <span className="monoSmall">{msPerStep}ms</span>
                  </div>
                </FieldRow>
                <FieldRow label="반복 재생">
                  <Switch checked={loop} onChange={setLoop} />
                </FieldRow>

                <div className="rowGap" style={{ marginTop: 8 }}>
                  <button className="primaryBtn" type="button" onClick={() => setPlaying((v) => !v)} disabled={!hasReady}>
                    {playing ? "일시정지" : "재생"}
                  </button>
                  <button
                    className="ghostBtn"
                    type="button"
                    onClick={() => {
                      setPlaying(false);
                      tRef.current = 0;
                      setT(0);
                    }}
                  >
                    처음으로
                  </button>
                </div>
              </Section>

              <Section title="범례">
                <FieldRow label="범례 표시">
                  <Switch checked={showLegend} onChange={setShowLegend} />
                </FieldRow>
              </Section>

              <Section title="축/그리드">
                <FieldRow label="축 표시">
                  <Switch checked={showAxis} onChange={setShowAxis} />
                </FieldRow>
                <FieldRow label="눈금 개수">
                  <Select
                    value={String(tickCount)}
                    onChange={(v) => setTickCount(Number(v))}
                    options={[2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))}
                  />
                </FieldRow>
                <FieldRow label="그리드 표시">
                  <Switch checked={showGrid} onChange={setShowGrid} />
                </FieldRow>
              </Section>
            </>
          )}
        </aside>
      </div>
      {showExportModal && (
        <ExportModal
          onClose={() => setShowExportModal(false)}
          onExport={handleExportConfirm}
          totalDuration={(maxT * msPerStep) / 1000} // 예상 시간 계산 (초)
        />
      )}


    </div>
  );
}
