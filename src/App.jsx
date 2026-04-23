import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import * as echarts from "echarts";
import "./App.css";
import html2canvas from "html2canvas";
import * as Mp4Muxer from "mp4-muxer";

/* =========================
   MP4 Export
========================= */
async function exportVideo({ element, fps, width, height, maxT, msPerStep, setT, onProgress }) {
  if (!element) return;
  const safeWidth = width % 2 === 0 ? width : width - 1;
  const safeHeight = height % 2 === 0 ? height : height - 1;
  const is4K = safeWidth >= 3840 || safeHeight >= 2160;
  const codecString = is4K ? "avc1.640033" : "avc1.4d002a";
  const totalDurationSec = (maxT * msPerStep) / 1000;
  const totalFrames = Math.ceil(totalDurationSec * fps);
  const dt = maxT / totalFrames;
  const muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: "avc", width: safeWidth, height: safeHeight },
    fastStart: "in-memory",
  });
  let encoderError = null;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { encoderError = e; },
  });
  try {
    videoEncoder.configure({ codec: codecString, width: safeWidth, height: safeHeight, bitrate: is4K ? 20_000_000 : 8_000_000, framerate: fps });
  } catch (configErr) {
    throw new Error(`코덱 설정 실패: ${configErr.message}`);
  }
  try {
    for (let i = 0; i < totalFrames; i++) {
      if (videoEncoder.state === "closed" || encoderError) throw new Error(encoderError ? `인코딩 오류: ${encoderError.message}` : "인코더가 닫혔습니다.");
      if (onProgress) onProgress(Math.round((i / totalFrames) * 100));
      const currentT = i * dt;
      if (currentT > maxT) break;
      setT(currentT);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const canvas = await html2canvas(element, { scale: safeWidth > 1920 ? 1 : 2, backgroundColor: "#ffffff", useCORS: true, logging: false, width: safeWidth, height: safeHeight, windowWidth: safeWidth, windowHeight: safeHeight });
      const frameBitmap = await createImageBitmap(canvas, { resizeWidth: safeWidth, resizeHeight: safeHeight, resizeQuality: "high" });
      const frame = new VideoFrame(frameBitmap, { timestamp: (i * 1_000_000) / fps });
      videoEncoder.encode(frame, { keyFrame: i % fps === 0 });
      frame.close();
    }
    await videoEncoder.flush();
    muxer.finalize();
    const { buffer } = muxer.target;
    const blob = new Blob([buffer], { type: "video/mp4" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `racing-chart-${Date.now()}.mp4`; a.click();
    URL.revokeObjectURL(url);
    if (onProgress) onProgress(100);
  } catch (err) {
    throw err;
  }
}

/* =========================
   ExportModal (MP4)
========================= */
function ExportModal({ onClose, onExport, totalDuration }) {
  const [quality, setQuality] = useState("1080p");
  const [fps, setFps] = useState(30);
  const handleDownload = () => {
    let width = 1920, height = 1080;
    if (quality === "720p") { width = 1280; height = 720; }
    if (quality === "4k") { width = 3840; height = 2160; }
    onExport({ width, height, fps });
  };
  return (
    <div className="export-overlay">
      <div className="export-card">
        <div className="export-header"><h3>동영상 내보내기</h3><button className="close-btn" onClick={onClose}>×</button></div>
        <div className="export-body">
          <div className="export-row"><span className="row-label">화질</span><select value={quality} onChange={e => setQuality(e.target.value)}><option value="720p">720p (HD)</option><option value="1080p">1080p (FHD)</option><option value="4k">4K (UHD)</option></select></div>
          <div className="export-row"><span className="row-label">프레임</span><select value={fps} onChange={e => setFps(Number(e.target.value))}><option value={30}>30 FPS</option><option value={60}>60 FPS</option></select></div>
          <div className="export-info">예상 길이: <b>{totalDuration.toFixed(1)}초</b></div>
        </div>
        <div className="export-footer"><button className="download-btn" onClick={handleDownload}>다운로드</button></div>
      </div>
    </div>
  );
}

/* =========================
   Utils
========================= */
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

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
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(n);
  } catch { return String(n); }
}

function isLikelyTimeColumn(colName) {
  return /^\d{4}([.\-\/]\d{1,2})?$/.test(String(colName).trim());
}

function timeKey(colName) {
  const s = String(colName).trim();
  const m = s.match(/^(\d{4})(?:[.\-\/](\d{1,2}))?$/);
  if (!m) return Number.MAX_SAFE_INTEGER;
  return Number(m[1]) * 100 + (m[2] ? Number(m[2]) : 0);
}

function niceMax(x) {
  if (!Number.isFinite(x) || x <= 0) return 1;
  const m = x * 1.06;
  const exp = Math.floor(Math.log10(m));
  const base = Math.pow(10, exp);
  const f = m / base;
  const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const s = steps.find(v => f <= v) ?? 10;
  return s * base;
}

function smoothAxisMaxFactory() {
  const ref = { cur: 1 };
  return function smoothAxisMax(target, { up = 0.45, down = 0.08, snapUp = 2.2, min = 1 } = {}) {
    const t = Number.isFinite(target) && target > 0 ? target : min;
    const p = Number.isFinite(ref.cur) && ref.cur > 0 ? ref.cur : t;
    let next = p;
    if (t > p * snapUp) next = t;
    else if (t > p) next = p + (t - p) * up;
    else next = p + (t - p) * down;
    if (!Number.isFinite(next) || next <= 0) next = min;
    ref.cur = next;
    return next;
  };
}

function pickAutoLabel(cols, sampleRows) {
  const candidates = cols.filter(c => !isLikelyTimeColumn(c));
  if (!candidates.length) return cols[0] ?? "";
  const sample = sampleRows.slice(0, 40);
  let best = candidates[0], bestScore = -1;
  for (const c of candidates) {
    const vals = sample.map(r => String(r[c] ?? "").trim()).filter(Boolean);
    const uniq = new Set(vals).size;
    const filledRatio = vals.length / Math.max(sample.length, 1);
    const uniqRatio = uniq / Math.max(vals.length, 1);
    const score = filledRatio * 1.0 + uniqRatio * 0.8;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

function colLetter(i) {
  let s = "", n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/* =========================
   Palettes
========================= */
const PALETTES = {
  Flourish: ["#3A2E58","#FF6A2A","#4d78a7","#76B7B2","#59A14F","#EDC948","#B07AA1","#E15759","#9C755F","#F28E2B"],
  "Flourish Alternate": ["#2E294E","#EF476F","#FFD166","#06D6A0","#118AB2","#7B2CBF","#F77F00","#8D99AE","#3D5A80","#E63946"],
  "Flourish Blues": ["#1D4ED8","#2563EB","#3B82F6","#60A5FA","#93C5FD","#0EA5E9","#0284C7","#0369A1"],
  "Flourish Purples": ["#4C1D95","#6D28D9","#7C3AED","#7a30ce","#A78BFA","#C4B5FD","#DDD6FE","#5B21B6"],
  "Flourish Pinks": ["#9D174D","#DB2777","#EC4899","#F472B6","#F9A8D4","#FDA4AF","#FB7185","#BE185D"],
  "Flourish Greens": ["#14532D","#166534","#16A34A","#22C55E","#2fcf6a","#86EFAC","#BBF7D0","#15803D"],
  Engage: ["#7C3AED","#F97316","#06B6D4","#22C55E","#EAB308","#EF4444","#3B82F6","#EC4899"],
  Reveal: ["#0EA5E9","#F59E0B","#10B981","#EF4444","#8B5CF6","#3B82F6","#F97316","#14B8A6"],
  Narrate: ["#334155","#475569","#64748B","#94A3B8","#CBD5E1","#1F2937","#0F172A","#111827"],
};
const ECHARTS_PALETTE = [
  '#6366f1','#8b5cf6','#d946ef','#f43f5e','#f97316',
  '#06b6d4','#10b981','#eab308','#3b82f6','#ec4899',
  '#14b8a6','#f59e0b','#84cc16','#a855f7','#ef4444',
];

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
   Hooks
========================= */
function useElementSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(entries => {
      const cr = entries[0]?.contentRect;
      if (cr) setSize({ width: cr.width, height: cr.height });
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/* =========================
   Small UI Components (racing chart용)
========================= */
function IconButton({ title, onClick, children }) {
  return <button className="iconBtn" title={title} onClick={onClick} type="button">{children}</button>;
}
function TabButton({ active, onClick, children }) {
  return <button className={`tabBtn ${active ? "active" : ""}`} onClick={onClick} type="button">{children}</button>;
}
function Select({ value, onChange, options }) {
  return (
    <select className="select" value={value} onChange={e => onChange(e.target.value)}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
function Switch({ checked, onChange }) {
  return (
    <button type="button" className={`switch ${checked ? "on" : ""}`} onClick={() => onChange(!checked)} aria-pressed={checked}>
      <span className="switchKnob" />
    </button>
  );
}
function Slider({ value, min, max, step, onChange }) {
  return <input className="slider" type="range" value={value} min={min} max={max} step={step} onChange={e => onChange(Number(e.target.value))} />;
}
function Section({ title, right, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="section">
      <button type="button" className="sectionHeader" onClick={() => setOpen(v => !v)}>
        <div className="sectionTitle">{title}</div>
        <div className="sectionRight">{right}<span className={`chev ${open ? "open" : ""}`}>▾</span></div>
      </button>
      {open && <div className="sectionBody">{children}</div>}
    </div>
  );
}
function FieldRow({ label, hint, children }) {
  return (
    <div className="fieldRow">
      <div className="fieldLabel"><div className="fieldLabelMain">{label}</div>{hint ? <div className="fieldHint">{hint}</div> : null}</div>
      <div className="fieldControl">{children}</div>
    </div>
  );
}
function SliderRow({ label, display, children }) {
  return (
    <div style={{ padding: '6px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span className="fieldLabelMain">{label}</span>
        <span className="monoSmall">{display}</span>
      </div>
      {children}
    </div>
  );
}

/* =========================
   Axis (racing chart용)
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
          const isFirst = i === 0, isLast = i === ticks;
          const trans = isFirst ? "translateX(0)" : isLast ? "translateX(-100%)" : "translateX(-50%)";
          return (
            <div key={i} className="axisTick" style={{ left: `${xPct}%`, transform: trans }}>
              {showGrid ? <div className="axisGridLine" style={{ height: Math.max(0, gridHeight) }} /> : null}
              <div className="axisLabel" style={{ transform: trans }}>{formatNumber(v, 0)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* =========================
   ChartPreview (racing chart)
========================= */
function ChartPreview({ frame, axisMax, categoriesLegend, topN, spacingPct, labelWidth, showImages, showLegend, showAxis, tickCount, showGrid, showBigTime, showTotal, decimals, barOpacity, timeLabel, total, playing, onTogglePlay, onScrub, t, maxT, showTimeline, valueCols, title, titleSize, titleAlign, subtitle, footerText, msPerStep }) {
  const plotRef = useRef(null);
  const smoothAxis = useMemo(() => smoothAxisMaxFactory(), []);
  const axisMaxUsed = smoothAxis(axisMax);
  const { height: plotH } = useElementSize(plotRef);
  const hudH = showTimeline ? 66 : 16;
  let gap = clamp(Math.round(6 + (spacingPct / 100) * 16), 2, 18);
  const plotForBars = Math.max(0, plotH - 10);
  let barH = plotH > 0 ? Math.floor((plotForBars - gap * Math.max(0, topN - 1)) / Math.max(1, topN)) : 28;
  barH = clamp(barH, 10, 96);
  if (plotForBars > 0) {
    const need = topN * barH + Math.max(0, topN - 1) * gap;
    if (need > plotForBars) { const scale = plotForBars / need; barH = Math.max(8, Math.floor(barH * scale)); gap = Math.max(2, Math.floor(gap * scale)); }
  }
  const gridHeight = Math.max(0, plotH + hudH);
  const labelFont = clamp(Math.round(barH * 0.46), 10, 16);
  const valueFont = clamp(Math.round(barH * 0.44), 10, 15);
  const prevKeysRef = useRef(new Set());
  const smoothRankRef = useRef({});
  const smoothWidRef = useRef({});
  // lerpFactor scales with playback speed: faster step → snappier animation
  const lerpFactor = playing
    ? clamp(1 - Math.pow(0.2, 60 / Math.max(1, msPerStep ?? 900)), 0.04, 0.65)
    : 1.0;

  const timelineTicks = useMemo(() => {
    if (!valueCols?.length || maxT <= 0) return [];
    const n = 10;
    return Array.from({ length: n + 1 }, (_, i) => ({ p: i / n, label: valueCols[Math.round((i / n) * maxT)] ?? "" }));
  }, [valueCols, maxT]);
  const tPct = maxT > 0 ? (clamp(t, 0, maxT) / maxT) * 100 : 0;

  return (
    <div className="chartWrap">
      <div className="chartCanvas flourishCanvas">
        {title ? <div className="chartTitleArea" style={{ fontSize: titleSize, textAlign: titleAlign, width: "100%", marginBottom: subtitle ? 4 : 20, fontWeight: 700, color: "#111827", lineHeight: 1.2 }}>{title}</div> : null}
        {subtitle ? <div style={{ fontSize: Math.max(12, titleSize * 0.58), textAlign: titleAlign, width: "100%", marginBottom: 14, color: "#64748b", fontWeight: 400, lineHeight: 1.3 }}>{subtitle}</div> : null}
        {showAxis ? <AxisTop max={axisMaxUsed} ticks={tickCount} labelWidth={labelWidth} showGrid={showGrid} gridHeight={gridHeight} /> : <div style={{ height: 26 }} />}
        <div className="plotArea" ref={plotRef} style={{ paddingBottom: hudH }}>
          {(() => {
            const prevKeys = prevKeysRef.current;
            const nextKeys = new Set(frame.map(d => d.key));
            prevKeysRef.current = nextKeys;
            return frame.map(d => {
              const isNew = !prevKeys.has(d.key);

              // Lerp rank → smooth Y position (snaps on new entry, lerps otherwise)
              const targetRank = d.rank;
              const prevRank = smoothRankRef.current[d.key] ?? targetRank;
              const curRank = isNew ? targetRank : prevRank + (targetRank - prevRank) * lerpFactor;
              smoothRankRef.current[d.key] = curRank;
              const y = curRank * (barH + gap);

              // Lerp width → smooth bar grow/shrink
              const targetW = clamp(axisMaxUsed > 0 ? (d.value / axisMaxUsed) * 100 : 0, 0, 100);
              const prevW = smoothWidRef.current[d.key] ?? targetW;
              const curW = isNew ? targetW : prevW + (targetW - prevW) * lerpFactor;
              smoothWidRef.current[d.key] = curW;

              return (
                <div key={d.key} className="barRow"
                  style={{ transform: `translate3d(0,${y}px,0)`, height: barH, opacity: isNew ? 0 : 1, transition: 'opacity 220ms ease' }}>
                  <div className="barLabel" style={{ width: labelWidth, fontSize: labelFont }} title={d.label}>{d.label}</div>
                  <div className="barTrack" style={{ height: barH }}>
                    <div className="barFill" style={{ width: `${curW}%`, background: d.color, opacity: barOpacity, transition: playing ? 'none' : undefined }}>
                      {showImages && d.imageUrl ? <div className="barFlagWrap"><img className="barFlag" src={d.imageUrl} alt="" onError={e => { e.currentTarget.style.display = "none"; }} /></div> : null}
                      <div className="barValueFloat" style={{ fontSize: valueFont }}>{formatNumber(d.value, decimals)}</div>
                    </div>
                  </div>
                </div>
              );
            });
          })()}
          {showBigTime ? <div className="bigTime"><div className="bigTimeYear">{timeLabel}</div>{showTotal ? <div className="bigTimeTotal">Total: {formatNumber(total, 0)}</div> : null}</div> : null}
          {showLegend && categoriesLegend.length > 0 ? <div className="legendRow"><div className="legendTitle">Region</div><div className="legendItems">{categoriesLegend.map(c => <div key={c.name} className="legendItem"><span className="legendDot" style={{ background: c.color }} /><span className="legendText">{c.name}</span></div>)}</div></div> : null}
          {showTimeline ? (
            <div className="timelineBar">
              <button className="playCircle" onClick={onTogglePlay} type="button">{playing ? "❚❚" : "▶"}</button>
              <div className="timelineTrackWrap">
                <div className="timelineLine" />
                {timelineTicks.map((tk, i) => (
                  <div key={i} className="timelineTick" style={{ left: `${tk.p * 100}%` }}>
                    <div className="timelineTickLine" /><div className="timelineTickLabel">{tk.label}</div>
                  </div>
                ))}
                <div className="timelineHandle" style={{ left: `${tPct}%` }} />
                <input className="timelineSlider" type="range" min="0" max={maxT} step="0.001" value={t} onChange={e => onScrub(Number(e.target.value))} />
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {footerText ? <div style={{ textAlign: 'right', fontSize: 10, color: '#94a3b8', padding: '6px 12px 8px' }}>{footerText}</div> : null}
    </div>
  );
}

/* =========================
   DataGrid (editable)
========================= */
function DataGrid({ rows, columns, highlight, maxRows = 100, onCellChange }) {
  const view = rows.slice(0, maxRows);
  return (
    <div className="dataGrid">
      <div className="dataGridTableWrap">
        <table className="dataTable">
          <thead>
            <tr>
              <th className="rownumTh" />
              {columns.map((c, i) => (
                <th key={c} className={highlight?.includes(c) ? "hiCol" : ""}>
                  <div className="thTop"><span className="colBadge">{colLetter(i)}</span><span className="colName">{c}</span></div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.map((r, ri) => (
              <tr key={ri}>
                <td className="rownumTd">{ri + 1}</td>
                {columns.map(c => (
                  <td key={c} className={highlight?.includes(c) ? "hiColCell" : ""}>
                    <input className="dataCellInput" type="text" value={r[c] ?? ""} onChange={e => onCellChange(ri, c, e.target.value)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > maxRows ? <div className="dataGridFooter">성능을 위해 처음 {maxRows}행만 표시됩니다.</div> : null}
    </div>
  );
}

/* =========================
   EChartCanvas (ECharts 렌더러)
========================= */
const EChartCanvas = forwardRef(function EChartCanvas({ option, style, onClick }, ref) {
  const divRef = useRef(null);
  const instanceRef = useRef(null);

  useImperativeHandle(ref, () => ({
    getDataURL: (opts) => instanceRef.current?.getDataURL(opts),
  }));

  useEffect(() => {
    if (!divRef.current) return;
    if (!instanceRef.current) instanceRef.current = echarts.init(divRef.current);
    instanceRef.current.setOption(option, true);
  }, [option]);

  useEffect(() => {
    const ro = new ResizeObserver(() => instanceRef.current?.resize());
    if (divRef.current) ro.observe(divRef.current);
    return () => { ro.disconnect(); instanceRef.current?.dispose(); instanceRef.current = null; };
  }, []);

  return <div ref={divRef} style={style} onClick={onClick} />;
});

/* =========================
   ECharts Option Builder
========================= */
function buildEChartsOption({ type, data, cfg = {}, isGallery = false }) {
  let colors;
  if (isGallery) {
    colors = ECHARTS_PALETTE;
  } else if (cfg.colorMode === 'single') {
    colors = Array.from({ length: Math.max(data.length, 20) }, () => cfg.singleColor || '#6366f1');
  } else {
    colors = PALETTES[cfg.paletteName ?? 'Flourish'] ?? ECHARTS_PALETTE;
  }
  const fontSize = isGallery ? 11 : (cfg.labelSize ?? 12);
  const fontWeight = isGallery ? 'bold' : (cfg.labelBold ? 'bold' : 'normal');
  const legendFontSize = isGallery ? 10 : (cfg.legendSize ?? 12);
  const legendFontWeight = isGallery ? 'normal' : (cfg.legendBold ? 'bold' : 'normal');
  const opacity = isGallery ? 1 : (cfg.barOpacity ?? 0.92);
  const barWidth = isGallery ? '50%' : `${cfg.barWidth ?? 50}%`;
  const bgColor = isGallery ? 'transparent' : (cfg.bgColor ?? '#ffffff');
  const labels = data.map(d => d.name);
  const values = data.map(d => d.value);

  let option = {
    backgroundColor: bgColor,
    color: colors,
    tooltip: { trigger: type === 'pie' ? 'item' : 'axis', textStyle: { fontFamily: 'Pretendard' } },
    legend: { show: isGallery ? true : (cfg.legendShow ?? true), bottom: isGallery ? 0 : 25, textStyle: { fontFamily: 'Pretendard', fontSize: legendFontSize, fontWeight: legendFontWeight } },
    grid: { top: isGallery ? 40 : 100, right: 30, bottom: isGallery ? 30 : 70, left: 60, containLabel: true },
    animation: true,
  };

  if (!isGallery) {
    option.title = [
      { text: cfg.title?.text ?? '', subtext: cfg.subtitle?.text ?? '', left: cfg.title?.align ?? 'center', top: 20, textStyle: { fontFamily: 'Pretendard', fontSize: cfg.title?.size ?? 24, fontWeight: cfg.title?.bold ? 'bold' : 'normal', color: '#0f172a' }, subtextStyle: { fontFamily: 'Pretendard', fontSize: cfg.subtitle?.size ?? 14, fontWeight: cfg.subtitle?.bold ? 'bold' : 'normal', color: '#64748b' } },
      { text: cfg.footer?.text ?? '', bottom: 5, right: 20, textStyle: { fontFamily: 'Pretendard', fontSize: 10, color: '#94a3b8', fontWeight: 'normal' } },
    ];
  }

  switch (type) {
    case 'pie': {
      const topN = cfg.topN ?? 0;
      let pieData = [...data].sort((a, b) => b.value - a.value);
      if (topN > 0) {
        pieData = pieData.slice(0, topN);
      }
      option.series = [{ type: 'pie', radius: isGallery ? ['30%', '70%'] : ['40%', '70%'], itemStyle: { borderColor: bgColor, borderWidth: 2, opacity }, label: { show: !isGallery, fontFamily: 'Pretendard', fontSize, fontWeight }, data: pieData }];
      break;
    }
    case 'bar':
      option.xAxis = { type: 'category', data: labels, axisLabel: { fontFamily: 'Pretendard', fontSize, fontWeight }, axisLine: { show: false }, axisTick: { show: false } };
      option.yAxis = { type: 'value', splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } }, axisLabel: { fontFamily: 'Pretendard', fontSize, fontWeight } };
      option.series = [{ name: '값', type: 'bar', barWidth, itemStyle: { borderRadius: [4, 4, 0, 0], color: p => colors[p.dataIndex % colors.length], opacity }, data: values }];
      break;
    case 'racing': {
      const sorted = [...data].sort((a, b) => b.value - a.value);
      option.xAxis = { max: 'dataMax', splitLine: { show: true, lineStyle: { type: 'dashed' } }, axisLabel: { fontFamily: 'Pretendard', fontSize, fontWeight } };
      option.yAxis = { type: 'category', data: sorted.map(d => d.name), inverse: true, animationDuration: 300, animationDurationUpdate: 300, axisLabel: { fontFamily: 'Pretendard', fontSize, fontWeight }, axisLine: { show: false }, axisTick: { show: false } };
      option.series = [{ type: 'bar', realtimeSort: true, barWidth, itemStyle: { borderRadius: [0, 4, 4, 0], color: params => colors[params.dataIndex % colors.length], opacity }, label: { show: true, position: 'right', valueAnimation: true, fontFamily: 'Pretendard', fontSize, fontWeight }, data: sorted.map(d => d.value) }];
      option.grid = { ...option.grid, left: 80 };
      option.animationDuration = 0;
      option.animationDurationUpdate = 1200;
      break;
    }
    case 'line':
      option.xAxis = { type: 'category', data: labels, axisLabel: { fontFamily: 'Pretendard', fontSize, fontWeight }, axisLine: { show: false }, axisTick: { show: false } };
      option.yAxis = { type: 'value', splitLine: { lineStyle: { type: 'dashed' } }, axisLabel: { fontFamily: 'Pretendard', fontSize, fontWeight } };
      option.series = [{
        name: '값', type: 'line', smooth: true, symbolSize: isGallery ? 7 : 10,
        lineStyle: { width: isGallery ? 3 : Math.max(1, (cfg.barWidth ?? 50) / 15), color: colors[0] },
        itemStyle: { color: p => colors[p.dataIndex % colors.length], opacity },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: colors[0] + '40' }, { offset: 1, color: colors[0] + '00' }] } },
        data: values,
      }];
      break;
  }
  return option;
}

/* =========================
   Sample Racing Data
========================= */
const SAMPLE_RACING_DATA = [
  { 플랫폼: '유튜브', '2019': 2900, '2020': 3200, '2021': 3600, '2022': 3900, '2023': 4100, '2024': 4300 },
  { 플랫폼: '인스타그램', '2019': 1700, '2020': 1850, '2021': 1950, '2022': 2050, '2023': 2150, '2024': 2250 },
  { 플랫폼: '틱톡', '2019': 200, '2020': 500, '2021': 900, '2022': 1300, '2023': 1600, '2024': 1900 },
  { 플랫폼: 'X (트위터)', '2019': 1100, '2020': 1050, '2021': 1000, '2022': 970, '2023': 940, '2024': 920 },
  { 플랫폼: '페이스북', '2019': 3000, '2020': 2700, '2021': 2200, '2022': 1700, '2023': 1200, '2024': 900 },
  { 플랫폼: '네이버', '2019': 650, '2020': 700, '2021': 750, '2022': 780, '2023': 800, '2024': 820 },
  { 플랫폼: '카카오톡', '2019': 4100, '2020': 4200, '2021': 4250, '2022': 4280, '2023': 4300, '2024': 4320 },
];

/* =========================
   MAC Logo SVG
========================= */
function MacLogo({ className = "h-8 w-8" }) {
  return (
    <svg viewBox="0 0 100 100" className={className} xmlns="http://www.w3.org/2000/svg">
      <rect x="15" y="55" width="18" height="30" rx="4" fill="#818cf8" />
      <rect x="41" y="35" width="18" height="50" rx="4" fill="#4f46e5" />
      <rect x="67" y="15" width="18" height="70" rx="4" fill="#312e81" />
    </svg>
  );
}

/* =========================
   Main App
========================= */
export default function App() {
  /* ---------- 화면 상태 ---------- */
  const [screen, setScreen] = useState('landing'); // 'landing' | 'upload' | 'editor'
  const [editorTab, setEditorTab] = useState('gallery'); // 'gallery' | 'design'
  const [chartType, setChartType] = useState('bar'); // 'bar'|'pie'|'racing'|'line'

  /* ---------- 토스트 ---------- */
  const [toastMsg, setToastMsg] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimer = useRef(null);
  function showToast(msg) {
    setToastMsg(msg);
    setToastVisible(true);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastVisible(false), 3000);
  }

  /* ---------- 마이 프로젝트 ---------- */
  const [showProjectsModal, setShowProjectsModal] = useState(false);
  const [projects, setProjects] = useState(() => JSON.parse(localStorage.getItem('mac_projects') || '[]'));

  /* ---------- 기존 레이싱 차트 상태 ---------- */
  const [csvEncoding, setCsvEncoding] = useState("utf-8");
  const [workbook, setWorkbook] = useState(null);
  const [sheetName, setSheetName] = useState("");
  const [sheetNames, setSheetNames] = useState([]);
  const [rows, setRows] = useState([]);
  const [chartTitle, setChartTitle] = useState("나의 레이싱 차트");
  const [titleSize, setTitleSize] = useState(24);
  const [titleAlign, setTitleAlign] = useState("left");
  const [showExportModal, setShowExportModal] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const chartAreaRef = useRef(null);
  const [labelCol, setLabelCol] = useState("");
  const [categoryCol, setCategoryCol] = useState("");
  const [imageCol, setImageCol] = useState("");

  const columns = useMemo(() => (!rows.length ? [] : Object.keys(rows[0])), [rows]);
  const timeCandidates = useMemo(() => columns.filter(isLikelyTimeColumn).sort((a, b) => timeKey(a) - timeKey(b)), [columns]);

  const [valueStart, setValueStart] = useState("");
  const [valueEnd, setValueEnd] = useState("");
  const valueCols = useMemo(() => {
    if (!timeCandidates.length) return [];
    const start = valueStart || timeCandidates[0];
    const end = valueEnd || timeCandidates[timeCandidates.length - 1];
    const si = timeCandidates.indexOf(start), ei = timeCandidates.indexOf(end);
    if (si === -1 || ei === -1) return timeCandidates;
    return timeCandidates.slice(Math.min(si, ei), Math.max(si, ei) + 1);
  }, [timeCandidates, valueStart, valueEnd]);

  const [theme, setTheme] = useState("apex");
  const [topN, setTopN] = useState(10);
  const [spacingPct, setSpacingPct] = useState(10);
  const [sortingOn, setSortingOn] = useState(true);
  const [sortMode, setSortMode] = useState("desc");
  const [colorMode, setColorMode] = useState("category");
  const [paletteName, setPaletteName] = useState("Flourish");
  const [extendColors, setExtendColors] = useState(true);
  const [singleColor, setSingleColor] = useState("#3E7EA5");
  const [highlightTop1, setHighlightTop1] = useState(true);
  const [highlightColor, setHighlightColor] = useState("#FF5A7A");
  const [barOpacity, setBarOpacity] = useState(0.92);
  const [decimals, setDecimals] = useState(0);
  const [labelWidth, setLabelWidth] = useState(170);
  const [showAxis, setShowAxis] = useState(true);
  const [tickCount, setTickCount] = useState(3);
  const [showGrid, setShowGrid] = useState(true);
  const [showLegend, setShowLegend] = useState(true);
  const [showImages, setShowImages] = useState(true);
  const [showBigTime, setShowBigTime] = useState(true);
  const [showTotal, setShowTotal] = useState(true);
  const [showTimeline, setShowTimeline] = useState(true);
  const [msPerStep, setMsPerStep] = useState(900);
  const [loop, setLoop] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const tRef = useRef(0);
  const rafRef = useRef(null);
  const lastRef = useRef(null);
  const maxT = Math.max(0, valueCols.length - 1);

  /* ---------- 갤러리 & 디자인 뷰 전용 상태 ---------- */
  const [selectedCols, setSelectedCols] = useState([]);
  const [bindLabel, setBindLabel] = useState('');
  const [bindValue, setBindValue] = useState('');
  /* 통합 디자인 설정 (모든 차트 공통) */
  const [subtitle, setSubtitle] = useState('');
  const [subtitleSize, setSubtitleSize] = useState(14);
  const [subtitleBold, setSubtitleBold] = useState(false);
  const [footerText, setFooterText] = useState('');
  const [bgColor, setBgColor] = useState('#ffffff');
  const [barWidth, setBarWidth] = useState(50);
  const [labelSize, setLabelSize] = useState(12);
  const [labelBold, setLabelBold] = useState(true);
  const [legendSize, setLegendSize] = useState(12);
  const [legendBold, setLegendBold] = useState(false);
  const designEchartRef = useRef(null);

  /* ---------- Racing series ---------- */
  const series = useMemo(() => {
    if (!rows.length || !labelCol || !valueCols.length) return [];
    const used = new Map();
    return rows.reduce((list, r) => {
      const label = String(r[labelCol] ?? "").trim();
      if (!label) return list;
      const cnt = (used.get(label) ?? 0) + 1;
      used.set(label, cnt);
      const key = cnt === 1 ? label : `${label}__${cnt}`;
      const cat = categoryCol ? String(r[categoryCol] ?? "").trim() : "";
      const imageUrl = imageCol ? String(r[imageCol] ?? "").trim() : "";
      const raw = valueCols.map(vc => toNumber(r[vc]));
      let last = NaN;
      const values = raw.map(v => { if (Number.isFinite(v)) { last = v; return v; } return last; });
      list.push({ key, label, cat, imageUrl, values });
      return list;
    }, []);
  }, [rows, labelCol, categoryCol, imageCol, valueCols]);

  const palette = useMemo(() => PALETTES[paletteName] ?? PALETTES.Flourish, [paletteName]);
  const catColorMap = useMemo(() => {
    const m = new Map();
    if (!series.length) return m;
    const cats = [...new Set(series.filter(s => s.cat).map(s => s.cat))];
    cats.forEach((c, i) => m.set(c, palettePick(palette, i, c, extendColors)));
    return m;
  }, [series, palette, extendColors]);
  const labelColorMap = useMemo(() => {
    const m = new Map();
    series.forEach((s, i) => { if (!m.has(s.label)) m.set(s.label, palettePick(palette, i, s.label, extendColors)); });
    return m;
  }, [series, palette, extendColors]);

  const { frame, axisMax, timeLabel, total } = useMemo(() => {
    if (!series.length || !valueCols.length) return { frame: [], axisMax: 1, timeLabel: "", total: 0 };
    const ti = clamp(t, 0, maxT);
    const i = Math.floor(ti), frac = ti - i, i2 = Math.min(i + 1, maxT);
    const itemsAll = series.map(s => {
      const a0 = s.values[i], b0 = s.values[i2];
      if (!Number.isFinite(a0) && !Number.isFinite(b0)) return null;
      const a = Number.isFinite(a0) ? a0 : 0, b = Number.isFinite(b0) ? b0 : a;
      const value = a + (b - a) * frac;
      let color = singleColor;
      if (colorMode === "category") color = s.cat ? (catColorMap.get(s.cat) ?? singleColor) : (labelColorMap.get(s.label) ?? singleColor);
      if (colorMode === "label") color = labelColorMap.get(s.label) ?? singleColor;
      return { key: s.key, label: s.label, cat: s.cat, imageUrl: s.imageUrl, value, color };
    }).filter(Boolean).filter(d => Number.isFinite(d.value));
    const tot = itemsAll.reduce((acc, d) => acc + d.value, 0);
    let ordered = itemsAll.slice();
    if (sortingOn) ordered.sort((a, b) => { const diff = sortMode === "asc" ? a.value - b.value : b.value - a.value; return Math.abs(diff) > 1e-9 ? diff : String(a.label).localeCompare(String(b.label)); });
    const top = ordered.slice(0, topN).map((d, idx) => ({ ...d, rank: idx }));
    if (colorMode === "single" && highlightTop1 && top.length) top[0] = { ...top[0], color: highlightColor };
    const maxVal = Math.max(...top.map(d => d.value), 1);
    return { frame: top, axisMax: niceMax(maxVal), timeLabel: valueCols[Math.floor(ti)] ?? "", total: tot };
  }, [series, valueCols, t, maxT, topN, sortingOn, sortMode, colorMode, singleColor, highlightTop1, highlightColor, catColorMap, labelColorMap]);

  const categoriesLegend = useMemo(() => {
    if (!categoryCol) return [];
    const out = [], seen = new Set();
    for (const s of series) { if (!s.cat || seen.has(s.cat)) continue; seen.add(s.cat); out.push({ name: s.cat, color: catColorMap.get(s.cat) ?? "#999" }); }
    return out;
  }, [series, categoryCol, catColorMap]);

  /* ---------- 갤러리 ECharts 데이터 ---------- */
  const galleryStrCols = useMemo(() => selectedCols.filter(c => !isLikelyTimeColumn(c)), [selectedCols]);
  const galleryNumCols = useMemo(() => selectedCols.filter(isLikelyTimeColumn).sort((a, b) => timeKey(a) - timeKey(b)), [selectedCols]);
  const galleryLabelCol = galleryStrCols[0] || labelCol;
  const galleryValueCol = galleryNumCols[galleryNumCols.length - 1] || valueCols[valueCols.length - 1] || '';
  const galleryChartData = useMemo(() => {
    if (!rows.length || !galleryLabelCol || !galleryValueCol) return [];
    let data = rows.map(r => ({ name: String(r[galleryLabelCol] ?? '').trim(), value: toNumber(r[galleryValueCol]) }))
      .filter(d => d.name && Number.isFinite(d.value))
      .sort((a, b) => b.value - a.value);
    if (topN > 0) data = data.slice(0, topN);
    return data.slice(0, 20);
  }, [rows, galleryLabelCol, galleryValueCol, topN]);

  /* ---------- 디자인 뷰 ECharts 데이터 ---------- */
  const designChartData = useMemo(() => {
    if (!rows.length || !bindLabel || !bindValue) return [];
    let data = rows.map(r => ({ name: String(r[bindLabel] ?? '').trim(), value: toNumber(r[bindValue]) }))
      .filter(d => d.name && Number.isFinite(d.value))
      .sort((a, b) => b.value - a.value);
    if (topN > 0) data = data.slice(0, topN);
    return data;
  }, [rows, bindLabel, bindValue, topN]);

  /* ---------- Animation loop ---------- */
  useEffect(() => {
    if (!playing) { if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = null; lastRef.current = null; return; }
    if (!valueCols.length) return;
    const step = ts => {
      if (lastRef.current == null) lastRef.current = ts;
      const dt = ts - lastRef.current; lastRef.current = ts;
      tRef.current += dt / msPerStep;
      if (tRef.current >= maxT) { if (loop) tRef.current = 0; else { tRef.current = maxT; setPlaying(false); } }
      setT(tRef.current);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = null; lastRef.current = null; };
  }, [playing, valueCols.length, msPerStep, maxT, loop]);

  function scrubTo(v) { const nv = clamp(v, 0, maxT); tRef.current = nv; setT(nv); setPlaying(false); }

  /* ---------- 데이터 로드 ---------- */
  async function loadSheet(wb, name) {
    const ws = wb.Sheets[name];
    const json = XLSX.utils.sheet_to_json(ws, { defval: "" });
    setSheetName(name);
    setRows(json);
    if (json.length) {
      const cols = Object.keys(json[0]);
      const autoLabel = pickAutoLabel(cols, json);
      setLabelCol(autoLabel);
      setCategoryCol(cols.find(c => /region|category|group|대륙|지역|분류/i.test(c)) ?? "");
      setImageCol(cols.find(c => /image|img|flag|url/i.test(c)) ?? "");
      const tc = cols.filter(isLikelyTimeColumn).sort((a, b) => timeKey(a) - timeKey(b));
      setValueStart(tc[0] ?? "");
      setValueEnd(tc[tc.length - 1] ?? "");
      setSelectedCols([...cols]);
      setBindLabel(autoLabel);
      setBindValue(tc[tc.length - 1] || '');
      tRef.current = 0; setT(0); setPlaying(false);
      setScreen('editor');
      setEditorTab('gallery');
      showToast('데이터를 성공적으로 불러왔습니다.');
    }
  }

  async function onUpload(file) {
    if (!file) return;
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) { alert("xlsx/xls/csv 파일만 업로드할 수 있어요."); return; }
    const buf = await readFileAsArrayBuffer(file);
    const ext = file.name.split('.').pop()?.toLowerCase();
    let wb;
    if (ext === 'csv') {
      let text;
      try { text = new TextDecoder(csvEncoding).decode(new Uint8Array(buf)); } catch { text = new TextDecoder("utf-8").decode(new Uint8Array(buf)); }
      wb = XLSX.read(text, { type: "string" });
    } else {
      wb = XLSX.read(buf, { type: "array" });
    }
    setWorkbook(wb);
    setSheetNames(wb.SheetNames);
    await loadSheet(wb, wb.SheetNames[0]);
  }

  function loadSampleData() {
    const data = SAMPLE_RACING_DATA;
    const cols = Object.keys(data[0]);
    setRows(JSON.parse(JSON.stringify(data)));
    setWorkbook(null); setSheetNames([]); setSheetName('sample');
    const tc = cols.filter(isLikelyTimeColumn).sort((a, b) => timeKey(a) - timeKey(b));
    const autoLabel = pickAutoLabel(cols, data);
    setLabelCol(autoLabel);
    setCategoryCol(''); setImageCol('');
    setValueStart(tc[0] ?? ''); setValueEnd(tc[tc.length - 1] ?? '');
    setSelectedCols([...cols]);
    setBindLabel(autoLabel);
    setBindValue(tc[tc.length - 1] || '');
    setChartTitle('소셜 미디어 플랫폼 이용자 수 추이 (만 명)');
    tRef.current = 0; setT(0); setPlaying(false);
    setScreen('editor');
    setEditorTab('gallery');
    showToast('샘플 데이터를 불러왔습니다.');
  }

  /* ---------- 셀 편집 ---------- */
  const handleCellChange = (rowIndex, col, value) => {
    setRows(prev => { const nr = [...prev]; nr[rowIndex] = { ...nr[rowIndex], [col]: value }; return nr; });
  };

  /* ---------- 프로젝트 저장/불러오기 ---------- */
  function saveProject() {
    const name = prompt("저장할 프로젝트 이름을 입력하세요:", chartTitle || "새 프로젝트");
    if (!name) return;
    const proj = { id: Date.now().toString(), name, date: new Date().toLocaleDateString(), config: JSON.stringify({ chartType, labelCol, categoryCol, valueStart, valueEnd, bindLabel, bindValue, chartTitle, titleSize, titleAlign, subtitle, subtitleSize, subtitleBold, footerText, bgColor, barWidth, labelSize, labelBold, legendSize, legendBold, theme, topN, spacingPct, sortingOn, sortMode, colorMode, paletteName, singleColor, barOpacity, showAxis, showGrid, showBigTime, showTotal, showTimeline, msPerStep, loop, showLegend }) };
    const list = [...projects, proj];
    localStorage.setItem('mac_projects', JSON.stringify(list));
    setProjects(list);
    showToast(`'${name}' 프로젝트가 저장되었습니다.`);
  }

  function loadProject(id) {
    const proj = projects.find(p => p.id === id);
    if (!proj) return;
    try {
      const cfg = JSON.parse(proj.config);
      setChartType(cfg.chartType ?? 'bar');
      setLabelCol(cfg.labelCol ?? '');
      setCategoryCol(cfg.categoryCol ?? '');
      setValueStart(cfg.valueStart ?? '');
      setValueEnd(cfg.valueEnd ?? '');
      setBindLabel(cfg.bindLabel ?? '');
      setBindValue(cfg.bindValue ?? '');
      setChartTitle(cfg.chartTitle ?? '');
      setTitleSize(cfg.titleSize ?? 24);
      setTitleAlign(cfg.titleAlign ?? 'left');
      setSubtitle(cfg.subtitle ?? '');
      setSubtitleSize(cfg.subtitleSize ?? 14);
      setSubtitleBold(cfg.subtitleBold ?? false);
      setFooterText(cfg.footerText ?? '');
      setBgColor(cfg.bgColor ?? '#ffffff');
      setBarWidth(cfg.barWidth ?? 50);
      setLabelSize(cfg.labelSize ?? 12);
      setLabelBold(cfg.labelBold ?? true);
      setLegendSize(cfg.legendSize ?? 12);
      setLegendBold(cfg.legendBold ?? false);
      setTheme(cfg.theme ?? 'apex');
      setTopN(cfg.topN ?? 10);
      setSpacingPct(cfg.spacingPct ?? 10);
      setSortingOn(cfg.sortingOn ?? true);
      setSortMode(cfg.sortMode ?? 'desc');
      setColorMode(cfg.colorMode ?? 'category');
      setPaletteName(cfg.paletteName ?? 'Flourish');
      setSingleColor(cfg.singleColor ?? '#3E7EA5');
      setBarOpacity(cfg.barOpacity ?? 0.92);
      setShowLegend(cfg.showLegend ?? true);
      setShowAxis(cfg.showAxis ?? true);
      setShowGrid(cfg.showGrid ?? true);
      setShowBigTime(cfg.showBigTime ?? true);
      setShowTotal(cfg.showTotal ?? true);
      setShowTimeline(cfg.showTimeline ?? true);
      setMsPerStep(cfg.msPerStep ?? 900);
      setLoop(cfg.loop ?? false);
    } catch {}
    setShowProjectsModal(false);
    showToast('설정을 불러왔습니다. 데이터를 다시 업로드해주세요.');
  }

  function deleteProject(id) {
    const list = projects.filter(p => p.id !== id);
    localStorage.setItem('mac_projects', JSON.stringify(list));
    setProjects(list);
  }

  /* ---------- JPG 추출 (ECharts용) ---------- */
  async function exportJPG() {
    if (designEchartRef.current) {
      const url = designEchartRef.current.getDataURL({ type: 'jpeg', pixelRatio: 2, backgroundColor: bgColor || '#ffffff' });
      const link = document.createElement('a');
      link.download = `${chartTitle || 'chart'}_MAC.jpg`;
      link.href = url; link.click();
      showToast('JPG 이미지가 추출되었습니다.');
    }
  }

  /* ---------- MP4 추출 ---------- */
  const hasReady = rows.length > 0 && labelCol && valueCols.length > 0;
  const highlightCols = useMemo(() => [labelCol, categoryCol, imageCol].filter(Boolean), [labelCol, categoryCol, imageCol]);

  const handleExportConfirm = async (settings) => {
    setShowExportModal(false); setIsExporting(true); setPlaying(false); setT(0);
    try {
      await new Promise(r => setTimeout(r, 500));
      await exportVideo({ element: chartAreaRef.current, fps: settings.fps, width: settings.width, height: settings.height, maxT, msPerStep, setT: val => { tRef.current = val; setT(val); }, onProgress: setExportProgress });
      alert("다운로드가 완료되었습니다!");
    } catch (error) {
      let msg = "알 수 없는 오류";
      if (error.message?.includes("is not defined")) msg = "이 브라우저는 MP4 변환을 지원하지 않습니다. 최신 Chrome을 사용해주세요.";
      else if (error.message?.includes("Tainted")) msg = "이미지 보안(CORS) 문제로 다운로드할 수 없습니다.";
      else msg = `오류: ${error.message}`;
      alert(`다운로드 실패!\n${msg}`);
    } finally { setIsExporting(false); setExportProgress(0); }
  };

  /* ---------- 네비게이션 ---------- */
  function goToUpload() { setScreen('upload'); }
  function goToLanding() { setScreen('landing'); }
  function goBackToUpload() { setScreen('upload'); setPlaying(false); }

  function switchToDesign(type) {
    if (type) setChartType(type);
    setEditorTab('design');
    if (type !== 'racing') {
      const strCols = columns.filter(c => !isLikelyTimeColumn(c));
      const numCols = columns.filter(isLikelyTimeColumn).sort((a, b) => timeKey(a) - timeKey(b));
      setBindLabel(bindLabel || strCols[0] || labelCol || columns[0] || '');
      setBindValue(bindValue || numCols[numCols.length - 1] || valueCols[valueCols.length - 1] || '');
    }
  }

  const CHART_INFO = [
    { id: 'bar', title: 'Bar Chart', icon: 'fa-chart-simple' },
    { id: 'pie', title: 'Pie Chart', icon: 'fa-chart-pie' },
    { id: 'racing', title: 'Racing Chart', icon: 'fa-chart-gantt' },
    { id: 'line', title: 'Line Chart', icon: 'fa-chart-line' },
  ];

  /* ================================================================
     RENDER
  ================================================================ */
  return (
    <div className={`app theme-${theme} selection:bg-indigo-100 selection:text-indigo-900`} style={{ fontFamily: "'Pretendard', system-ui, sans-serif" }}>

      {/* ===== TOAST ===== */}
      <div className={`fixed top-8 left-1/2 -translate-x-1/2 bg-zinc-900/95 backdrop-blur text-white px-6 py-3.5 rounded-full shadow-2xl flex items-center gap-3 z-[100] transition-all duration-300 border border-white/10 ${toastVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-10 pointer-events-none'}`}>
        <i className="fa-solid fa-check-circle text-emerald-400 text-lg" />
        <span className="text-sm font-medium tracking-wide">{toastMsg}</span>
      </div>

      {/* ===== MY PROJECTS MODAL ===== */}
      {showProjectsModal && (
        <div className="fixed inset-0 z-50 modal-backdrop flex items-center justify-center fade-in p-4" onClick={e => { if (e.target === e.currentTarget) setShowProjectsModal(false); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[80vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="text-xl font-bold text-zinc-900"><i className="fa-solid fa-folder-open text-indigo-500 mr-2" />마이 프로젝트</h2>
              <button onClick={() => setShowProjectsModal(false)} className="text-slate-400 hover:text-red-500 transition"><i className="fa-solid fa-xmark text-xl" /></button>
            </div>
            <div className="p-6 overflow-y-auto flex-1 space-y-3">
              {projects.length === 0 ? (
                <div className="text-center text-slate-400 py-10"><i className="fa-solid fa-folder-open text-4xl mb-3 opacity-30" /><p className="text-sm">저장된 프로젝트가 없습니다.</p></div>
              ) : [...projects].reverse().map(p => (
                <div key={p.id} className="flex items-center justify-between p-4 bg-white border border-slate-200 rounded-xl hover:border-indigo-400 hover:shadow-md transition">
                  <div>
                    <h4 className="font-bold text-zinc-800">{p.name}</h4>
                    <p className="text-xs text-slate-500 mt-1"><i className="fa-regular fa-clock mr-1" />{p.date}</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => loadProject(p.id)} className="text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded text-sm font-bold transition">불러오기</button>
                    <button onClick={() => deleteProject(p.id)} className="text-red-400 hover:text-red-600 px-2 py-1.5 rounded text-sm transition"><i className="fa-solid fa-trash" /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===== EXPORT MODAL (MP4) ===== */}
      {showExportModal && <ExportModal onClose={() => setShowExportModal(false)} onExport={handleExportConfirm} totalDuration={(maxT * msPerStep) / 1000} />}

      {/* ================================================================
          LANDING SCREEN
      ================================================================ */}
      {screen === 'landing' && (
        <div className="flex-1 flex flex-col fade-in relative w-full overflow-y-auto bg-[#f8fafc] text-slate-800">
          {/* bg blobs */}
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-indigo-200/40 blur-[100px] pointer-events-none" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-blue-200/40 blur-[100px] pointer-events-none" />

          {/* Nav */}
          <nav className="flex items-center justify-between px-8 py-5 w-full sticky top-0 z-20 glass-nav">
            <div className="flex items-center gap-2.5 text-zinc-900">
              <MacLogo />
              <span className="text-2xl font-extrabold tracking-tight">MAC.</span>
            </div>
            <div className="flex items-center gap-4">
              <button onClick={() => setShowProjectsModal(true)} className="text-slate-500 hover:text-indigo-600 transition-colors font-bold text-sm flex items-center gap-2 mr-4">
                <i className="fa-solid fa-folder" /> 내 프로젝트
              </button>
              <button onClick={goToUpload} className="bg-zinc-900 text-white px-5 py-2.5 rounded-full hover:bg-zinc-800 transition-all font-bold text-sm shadow-md hover:-translate-y-0.5">
                무료로 시작하기
              </button>
            </div>
          </nav>

          {/* Hero */}
          <div className="flex-1 flex flex-col lg:flex-row items-center justify-center w-full max-w-7xl mx-auto px-8 gap-12 relative z-10 py-16">
            <div className="flex-1 flex flex-col justify-center max-w-2xl">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-600 text-xs font-bold tracking-wide mb-6 w-max">
                <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500" /></span>
                MAC v1.0
              </div>
              <h1 className="text-5xl md:text-[64px] font-extrabold text-zinc-900 leading-[1.1] mb-6 tracking-tight">
                데이터 시각화,<br />가장 세련되고 단순하게.
              </h1>
              <p className="text-lg md:text-xl text-slate-500 leading-relaxed mb-10 font-medium">
                복잡한 코드나 전문가용 툴은 필요 없습니다.<br className="hidden md:block" />
                스프레드시트를 업로드하고, 레이싱 차트부터 MP4 추출까지 한 번에.
              </p>
              <button onClick={goToUpload} className="w-full sm:w-max flex items-center justify-center gap-3 bg-indigo-600 text-white px-8 py-4 rounded-2xl font-bold hover:bg-indigo-700 hover:shadow-xl hover:shadow-indigo-600/30 transition-all text-lg group">
                게스트로 바로 시작하기
                <i className="fa-solid fa-arrow-right group-hover:translate-x-1 transition-transform" />
              </button>
            </div>

            {/* 미리보기 카드 */}
            <div className="flex-1 w-full relative hidden lg:block">
              <div className="absolute inset-0 bg-gradient-to-tr from-indigo-100 to-transparent rounded-[2rem] transform rotate-3 scale-105 opacity-50" />
              <div className="relative w-full aspect-[4/3] glass-card rounded-[2rem] shadow-[0_20px_50px_rgba(8,112,184,0.07)] p-8 flex flex-col justify-between border border-white">
                <div className="flex items-center justify-between mb-8 border-b border-slate-100 pb-4">
                  <div className="flex gap-2">
                    <div className="w-3 h-3 rounded-full bg-rose-400" /><div className="w-3 h-3 rounded-full bg-amber-400" /><div className="w-3 h-3 rounded-full bg-emerald-400" />
                  </div>
                  <div className="h-6 w-24 bg-slate-100 rounded-full" />
                </div>
                <div className="flex-1 w-full relative">
                  <svg viewBox="0 0 400 200" className="w-full h-full overflow-visible">
                    <defs><linearGradient id="modernBar" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4f46e5" /><stop offset="100%" stopColor="#818cf8" /></linearGradient></defs>
                    <line x1="20" y1="160" x2="380" y2="160" stroke="#f1f5f9" strokeWidth="2" />
                    <rect x="50" y="160" width="36" height="0" fill="url(#modernBar)" rx="4"><animate attributeName="y" values="160;100;100;160" dur="5s" repeatCount="indefinite" keyTimes="0;0.15;0.85;1" /><animate attributeName="height" values="0;60;60;0" dur="5s" repeatCount="indefinite" keyTimes="0;0.15;0.85;1" /></rect>
                    <rect x="130" y="160" width="36" height="0" fill="#cbd5e1" rx="4"><animate attributeName="y" values="160;70;70;160" dur="5s" repeatCount="indefinite" keyTimes="0;0.2;0.85;1" begin="0.1s" /><animate attributeName="height" values="0;90;90;0" dur="5s" repeatCount="indefinite" keyTimes="0;0.2;0.85;1" begin="0.1s" /></rect>
                    <rect x="210" y="160" width="36" height="0" fill="url(#modernBar)" rx="4"><animate attributeName="y" values="160;120;120;160" dur="5s" repeatCount="indefinite" keyTimes="0;0.25;0.85;1" begin="0.2s" /><animate attributeName="height" values="0;40;40;0" dur="5s" repeatCount="indefinite" keyTimes="0;0.25;0.85;1" begin="0.2s" /></rect>
                    <rect x="290" y="160" width="36" height="0" fill="#e2e8f0" rx="4"><animate attributeName="y" values="160;40;40;160" dur="5s" repeatCount="indefinite" keyTimes="0;0.3;0.85;1" begin="0.3s" /><animate attributeName="height" values="0;120;120;0" dur="5s" repeatCount="indefinite" keyTimes="0;0.3;0.85;1" begin="0.3s" /></rect>
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================
          UPLOAD SCREEN (데이터 가져오기)
      ================================================================ */}
      {screen === 'upload' && (
        <div className="flex-1 flex flex-col bg-[#f8fafc] fade-in relative w-full overflow-y-auto">
          <nav className="flex items-center justify-between px-8 py-5 w-full sticky top-0 z-20 glass-nav">
            <div onClick={goToLanding} className="flex items-center gap-2.5 text-zinc-900 cursor-pointer hover:opacity-70 transition">
              <MacLogo className="h-7 w-7" />
              <span className="text-xl font-extrabold tracking-tight">MAC.</span>
            </div>
          </nav>

          <div className="flex-1 flex flex-col items-center justify-center p-6 pb-24">
            <div className="max-w-2xl w-full text-center">
              <h1 className="text-3xl font-extrabold text-zinc-900 mb-2">데이터 가져오기</h1>
              <p className="text-slate-400 text-sm mb-2">xlsx, xls, csv 파일을 업로드하세요.</p>

              {/* CSV 인코딩 선택 */}
              <div className="flex items-center justify-center gap-3 mb-6">
                <span className="text-xs font-bold text-slate-500">CSV 인코딩</span>
                <select value={csvEncoding} onChange={e => setCsvEncoding(e.target.value)} className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 outline-none bg-white font-medium">
                  <option value="utf-8">UTF-8</option>
                  <option value="euc-kr">EUC-KR (CP949)</option>
                </select>
              </div>

              {/* 업로드 카드 */}
              <div className="bg-white rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 p-2 relative">
                <label className="border-2 border-dashed border-slate-200 rounded-[1.5rem] p-16 flex flex-col items-center justify-center hover:bg-slate-50 transition-all cursor-pointer group">
                  <div className="bg-indigo-50 text-indigo-600 w-16 h-16 rounded-2xl flex items-center justify-center mb-6 group-hover:-translate-y-2 transition-all shadow-sm">
                    <i className="fa-solid fa-cloud-arrow-up text-2xl" />
                  </div>
                  <h3 className="text-xl font-bold text-zinc-900 mb-2">클릭하여 파일 업로드</h3>
                  <p className="text-slate-400 text-sm mb-2 font-medium">.xlsx, .xls, .csv</p>
                  <input type="file" className="hidden" accept=".xlsx,.xls,.csv" onChange={e => onUpload(e.target.files?.[0])} />
                </label>
              </div>

              {/* 샘플 데이터 */}
              <div className="mt-6 flex items-center justify-center">
                <button onClick={loadSampleData} className="text-indigo-600 font-bold hover:underline flex items-center gap-1.5 text-sm">
                  <i className="fa-solid fa-bolt-lightning" /> 샘플 데이터(소셜 미디어 트렌드)로 테스트하기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================
          EDITOR SCREEN
      ================================================================ */}
      {screen === 'editor' && (
        <div className="flex-1 flex flex-col h-full fade-in w-full overflow-hidden bg-[#f1f5f9]">

          {/* Header */}
          <header className="bg-white border-b border-slate-200 px-6 h-14 flex justify-between items-center shrink-0 z-20">
            <div className="flex items-center gap-5">
              <button onClick={goBackToUpload} className="text-slate-400 hover:text-zinc-900 transition flex items-center gap-2 font-semibold text-sm">
                <i className="fa-solid fa-arrow-left" /> 처음으로
              </button>
            </div>

            {/* 탭 세그먼트 컨트롤 */}
            <div className="flex bg-slate-100 p-1 rounded-lg">
              <button onClick={() => setEditorTab('gallery')} className={`flex items-center gap-2 px-4 py-1 rounded-md font-semibold text-sm transition-all ${editorTab === 'gallery' ? 'bg-white text-zinc-900 shadow-sm' : 'text-slate-400 hover:text-zinc-900'}`}>
                <i className="fa-solid fa-wand-magic-sparkles text-indigo-600" /> 추천 차트
              </button>
              <button onClick={() => switchToDesign(chartType)} className={`flex items-center gap-2 px-4 py-1 rounded-md font-semibold text-sm transition-all ${editorTab === 'design' ? 'bg-white text-zinc-900 shadow-sm' : 'text-slate-400 hover:text-zinc-900'}`}>
                <i className="fa-solid fa-pen-ruler" /> 상세 편집
              </button>
              <button onClick={() => setEditorTab('data')} className={`flex items-center gap-2 px-4 py-1 rounded-md font-semibold text-sm transition-all ${editorTab === 'data' ? 'bg-white text-zinc-900 shadow-sm' : 'text-slate-400 hover:text-zinc-900'}`}>
                <i className="fa-solid fa-table text-emerald-600" /> 데이터 수정
              </button>
            </div>

            <div className="flex items-center gap-3">
              <button onClick={saveProject} className="px-4 py-1.5 text-sm font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors border border-indigo-200">
                <i className="fa-solid fa-floppy-disk mr-1" />저장
              </button>
              {chartType === 'racing' && editorTab === 'design' ? (
                <button onClick={() => setShowExportModal(true)} disabled={!hasReady || isExporting} className="px-4 py-1.5 text-sm font-semibold bg-zinc-900 text-white rounded-lg shadow-sm hover:bg-zinc-800 transition disabled:opacity-50">
                  MP4 추출
                </button>
              ) : editorTab === 'design' ? (
                <button onClick={exportJPG} className="px-4 py-1.5 text-sm font-semibold bg-zinc-900 text-white rounded-lg shadow-sm hover:bg-zinc-800 transition">
                  JPG 추출
                </button>
              ) : null}
            </div>
          </header>

          {/* Main workspace */}
          <main className="flex-1 flex overflow-hidden relative">

            {/* ====== GALLERY VIEW (추천 차트) ====== */}
            {editorTab === 'gallery' && (
              <div className="absolute inset-0 overflow-y-auto bg-[#f1f5f9] p-6 md:p-8">
                {galleryChartData.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-400">
                    <i className="fa-solid fa-chart-pie text-4xl mb-4 opacity-30" />
                    <p className="text-sm text-center">데이터를 업로드하면 차트가 표시됩니다.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 auto-rows-[360px]">
                    {CHART_INFO.map(({ id, title, icon }) => (
                      <div key={id}
                        className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
                        onClick={() => switchToDesign(id)}>
                        <div className="px-5 py-4 border-b border-slate-100 bg-white flex justify-between items-center shrink-0">
                          <h3 className="font-bold text-zinc-900 text-[15px] flex items-center gap-2">
                            <i className={`fa-solid ${icon} text-indigo-500`} />{title}
                          </h3>
                          <span className="text-xs text-indigo-500 font-bold">편집하기 <i className="fa-solid fa-angle-right" /></span>
                        </div>
                        <div className="flex-1 min-h-0 p-3">
                          <EChartCanvas
                            option={buildEChartsOption({
                              type: id,
                              data: id === 'racing' ? galleryChartData.slice(0, 10) : galleryChartData,
                              cfg: { topN },
                              isGallery: true,
                            })}
                            style={{ width: '100%', height: '100%' }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ====== DATA VIEW (데이터 수정) ====== */}
            {editorTab === 'data' && (
              <div className="absolute inset-0 flex flex-col bg-[#f8fafc]">

                {/* 상단: 데이터 바인딩 */}
                <div className="shrink-0 bg-white border-b border-slate-200 px-6 py-4">
                  <div className="flex items-center gap-6 flex-wrap">
                    {chartType === 'racing' ? (
                      <>
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 block mb-1">라벨 컬럼</label>
                          <select value={labelCol} onChange={e => setLabelCol(e.target.value)} className="text-xs px-2 py-1.5 border border-slate-200 rounded-lg outline-none bg-white font-semibold min-w-[120px]">
                            {columns.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 block mb-1">카테고리 컬럼</label>
                          <select value={categoryCol} onChange={e => setCategoryCol(e.target.value)} className="text-xs px-2 py-1.5 border border-slate-200 rounded-lg outline-none bg-white font-semibold min-w-[120px]">
                            <option value="">(없음)</option>
                            {columns.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 block mb-1">이미지 URL 컬럼</label>
                          <select value={imageCol} onChange={e => setImageCol(e.target.value)} className="text-xs px-2 py-1.5 border border-slate-200 rounded-lg outline-none bg-white font-semibold min-w-[120px]">
                            <option value="">(없음)</option>
                            {columns.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 block mb-1">시작 연도</label>
                          <select value={valueStart} onChange={e => setValueStart(e.target.value)} className="text-xs px-2 py-1.5 border border-slate-200 rounded-lg outline-none bg-white font-semibold min-w-[90px]">
                            {timeCandidates.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 block mb-1">종료 연도</label>
                          <select value={valueEnd} onChange={e => setValueEnd(e.target.value)} className="text-xs px-2 py-1.5 border border-slate-200 rounded-lg outline-none bg-white font-semibold min-w-[90px]">
                            {timeCandidates.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 block mb-1">기준 라벨 (X축)</label>
                          <select value={bindLabel} onChange={e => setBindLabel(e.target.value)} className="text-xs px-2 py-1.5 border border-slate-200 rounded-lg outline-none bg-white font-semibold min-w-[140px]">
                            {columns.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 block mb-1">시각화 값 (Y축)</label>
                          <select value={bindValue} onChange={e => setBindValue(e.target.value)} className="text-xs px-2 py-1.5 border border-slate-200 rounded-lg outline-none bg-white font-semibold min-w-[140px]">
                            {columns.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                      </>
                    )}
                    <div className="ml-auto text-xs text-slate-400 font-medium">
                      <i className="fa-solid fa-pen-to-square mr-1 text-indigo-400" />셀을 클릭하여 직접 수정하세요
                    </div>
                  </div>
                </div>

                {/* 하단: 데이터 테이블 */}
                <div className="flex-1 overflow-auto">
                  <DataGrid
                    rows={rows}
                    columns={columns}
                    highlight={chartType === 'racing' ? highlightCols : [bindLabel, bindValue].filter(Boolean)}
                    onCellChange={handleCellChange}
                  />
                </div>
              </div>
            )}

            {/* ====== DESIGN VIEW (상세 편집) ====== */}
            {editorTab === 'design' && (
              <div className="absolute inset-0 flex bg-[#f1f5f9]">

                {/* 중앙: 차트 미리보기 */}
                <div className="flex-1 p-5 flex items-stretch justify-center relative overflow-hidden">
                  {/* MP4 추출 진행 오버레이 */}
                  {isExporting && (
                    <div className="absolute inset-0 bg-white/90 z-10 flex flex-col items-center justify-center">
                      <h3 className="text-lg font-bold text-zinc-800 mb-3">동영상 생성 중... {exportProgress}%</h3>
                      <div className="w-72 h-2.5 bg-slate-200 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-500 rounded-full transition-all duration-200" style={{ width: `${exportProgress}%` }} />
                      </div>
                      <p className="text-xs text-slate-500 mt-3">화면을 조작하거나 창을 닫지 마세요.</p>
                    </div>
                  )}

                  <div className="w-full bg-white rounded-xl shadow-lg border border-slate-200 flex flex-col overflow-hidden" id="export-container">
                    {chartType === 'racing' ? (
                      <div ref={chartAreaRef} className="racing-in-design" style={{ background: 'white' }}>
                        <ChartPreview
                          frame={frame} axisMax={axisMax} categoriesLegend={categoriesLegend}
                          topN={topN} spacingPct={spacingPct} labelWidth={labelWidth}
                          showImages={showImages} showLegend={showLegend} showAxis={showAxis}
                          tickCount={tickCount} showGrid={showGrid} showBigTime={showBigTime}
                          showTotal={showTotal} decimals={decimals} barOpacity={barOpacity}
                          timeLabel={timeLabel} total={total}
                          playing={playing} onTogglePlay={() => setPlaying(v => !v)} onScrub={scrubTo}
                          t={t} maxT={maxT} showTimeline={!isExporting}
                          valueCols={valueCols} title={chartTitle} titleSize={titleSize} titleAlign={titleAlign}
                          subtitle={subtitle} footerText={footerText} msPerStep={msPerStep}
                        />
                      </div>
                    ) : (
                      <EChartCanvas
                        ref={designEchartRef}
                        option={buildEChartsOption({
                          type: chartType,
                          data: designChartData,
                          cfg: {
                            title: { text: chartTitle, align: titleAlign, size: titleSize, bold: true },
                            subtitle: { text: subtitle, size: subtitleSize, bold: subtitleBold },
                            footer: { text: footerText },
                            bgColor, barWidth, labelSize, labelBold,
                            barOpacity, legendShow: showLegend, legendSize, legendBold,
                            topN, colorMode, paletteName, singleColor,
                          },
                          isGallery: false,
                        })}
                        style={{ width: '100%', height: '100%', minHeight: 400 }}
                      />
                    )}
                  </div>
                </div>

                {/* 오른쪽: 설정 패널 */}
                <div className="w-[300px] shrink-0 bg-white border-l border-slate-200 flex flex-col z-10 shadow-[-4px_0_15px_rgba(0,0,0,0.03)] overflow-hidden">
                  <div className="p-4 border-b border-slate-100 bg-slate-50 shrink-0">
                    <h3 className="font-bold text-zinc-900 text-sm flex items-center gap-2">
                      <i className="fa-solid fa-palette text-indigo-500" /> 차트 디자인 속성
                    </h3>
                  </div>

                  <div className="flex-1 overflow-y-auto">
                    {/* ===== 통합 오른쪽 패널 (모든 차트 공통) ===== */}
                    <div className="p-4">

                        {/* 차트 타입 스위처 */}
                        <div className="mb-4">
                          <label className="text-[11px] font-bold text-slate-400 block mb-2">차트 유형</label>
                          <div className="grid grid-cols-4 gap-1 bg-slate-100 p-1 rounded-lg">
                            {CHART_INFO.map(({ id, icon }) => (
                              <button key={id} onClick={() => switchToDesign(id)}
                                className={`py-1.5 rounded text-sm transition-all ${chartType === id ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-400 hover:text-zinc-900'}`}>
                                <i className={`fa-solid ${icon}`} />
                              </button>
                            ))}
                          </div>
                        </div>

                        <Section title="테마" defaultOpen={false}>
                          {chartType === 'racing' ? (
                            <FieldRow label="배경 테마">
                              <div className="seg">
                                {[['apex','기본'],['midnight','다크'],['blue','블루']].map(([val,label]) => (
                                  <button key={val} type="button" className={`segBtn ${theme === val ? 'active' : ''}`} onClick={() => setTheme(val)}>{label}</button>
                                ))}
                              </div>
                            </FieldRow>
                          ) : (
                            <FieldRow label="배경 색상">
                              <div className="rowGap">
                                <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)} className="colorPicker" />
                                <span className="monoSmall">{bgColor}</span>
                              </div>
                            </FieldRow>
                          )}
                        </Section>

                        <Section title="차트 제목">
                          <div style={{ padding: '6px 0' }}>
                            <div className="fieldLabelMain" style={{ marginBottom: 6 }}>제목 텍스트</div>
                            <input type="text" className="sidebarInput" style={{ width: '100%' }} value={chartTitle} onChange={e => setChartTitle(e.target.value)} placeholder="제목 입력" />
                          </div>
                          <div style={{ padding: '6px 0' }}>
                            <div className="fieldLabelMain" style={{ marginBottom: 6 }}>소제목 텍스트</div>
                            <input type="text" className="sidebarInput" style={{ width: '100%' }} value={subtitle} onChange={e => setSubtitle(e.target.value)} placeholder="소제목 입력" />
                          </div>
                          <div style={{ padding: '6px 0' }}>
                            <div className="fieldLabelMain" style={{ marginBottom: 6 }}>데이터 출처</div>
                            <input type="text" className="sidebarInput" style={{ width: '100%' }} value={footerText} onChange={e => setFooterText(e.target.value)} placeholder="출처 입력" />
                          </div>
                          <SliderRow label="제목 글자 크기" display={`${titleSize}px`}>
                            <Slider value={titleSize} min={12} max={60} step={1} onChange={setTitleSize} />
                          </SliderRow>
                          <div style={{ padding: '6px 0' }}>
                            <div className="fieldLabelMain" style={{ marginBottom: 6 }}>정렬</div>
                            <div className="seg full">
                              {['left','center','right'].map(a => (
                                <button key={a} type="button" className={`segBtn ${titleAlign === a ? 'active' : ''}`}
                                  style={{ flex: 1 }}
                                  onClick={() => setTitleAlign(a)}>
                                  {a === 'left' ? '왼쪽' : a === 'center' ? '가운데' : '오른쪽'}
                                </button>
                              ))}
                            </div>
                          </div>
                        </Section>

                        <Section title="설정">
                          <FieldRow label={chartType === 'racing' ? "표시 막대 수" : "Top N"}>
                            <Select value={String(topN)} onChange={v => setTopN(Number(v))}
                              options={[0,5,8,10,12,14,16,20].map(n => ({ value: String(n), label: n === 0 ? '전체' : String(n) }))} />
                          </FieldRow>
                          {chartType === 'racing' ? (
                            <>
                              <SliderRow label="막대 간격(%)" display={`${spacingPct}%`}>
                                <Slider value={spacingPct} min={0} max={30} step={1} onChange={setSpacingPct} />
                              </SliderRow>
                              <SliderRow label="라벨 영역 폭" display={`${labelWidth}px`}>
                                <Slider value={labelWidth} min={140} max={260} step={2} onChange={setLabelWidth} />
                              </SliderRow>
                              <FieldRow label="정렬">
                                <div className="seg">
                                  <button type="button" className={`segBtn ${sortingOn ? 'active' : ''}`} onClick={() => setSortingOn(true)}>켬</button>
                                  <button type="button" className={`segBtn ${!sortingOn ? 'active' : ''}`} onClick={() => setSortingOn(false)}>끔</button>
                                </div>
                              </FieldRow>
                              <FieldRow label="정렬 방향">
                                <div className="seg">
                                  <button type="button" className={`segBtn ${sortMode === 'desc' ? 'active' : ''}`} onClick={() => setSortMode('desc')}>내림차순</button>
                                  <button type="button" className={`segBtn ${sortMode === 'asc' ? 'active' : ''}`} onClick={() => setSortMode('asc')}>오름차순</button>
                                </div>
                              </FieldRow>
                            </>
                          ) : (
                            <SliderRow label="바 두께 / 선 굵기" display={`${barWidth}%`}>
                              <Slider value={barWidth} min={10} max={100} step={5} onChange={setBarWidth} />
                            </SliderRow>
                          )}
                        </Section>

                        <Section title="색상">
                          <FieldRow label="Color mode">
                            <Select value={colorMode} onChange={setColorMode}
                              options={chartType === 'racing'
                                ? [{ value:'category',label:'By category' },{ value:'label',label:'By bar' },{ value:'single',label:'Single' }]
                                : [{ value:'palette',label:'팔레트' },{ value:'single',label:'단색' }]
                              }
                            />
                          </FieldRow>
                          {colorMode !== 'single' ? (
                            <>
                              <FieldRow label="Palette">
                                <Select value={paletteName} onChange={setPaletteName} options={Object.keys(PALETTES).map(k => ({ value: k, label: k }))} />
                              </FieldRow>
                              {chartType === 'racing' && <FieldRow label="Extend"><Switch checked={extendColors} onChange={setExtendColors} /></FieldRow>}
                              <div className="paletteRow">{(PALETTES[paletteName] ?? PALETTES.Flourish).slice(0,10).map(c => <span key={c} className="swatch" style={{ background: c }} />)}</div>
                            </>
                          ) : (
                            <>
                              <FieldRow label="단색 컬러">
                                <div className="rowGap">
                                  <input type="color" value={singleColor} onChange={e => setSingleColor(e.target.value)} className="colorPicker" />
                                  <span className="monoSmall">{singleColor}</span>
                                </div>
                              </FieldRow>
                              {chartType === 'racing' && (
                                <>
                                  <FieldRow label="Highlight #1"><Switch checked={highlightTop1} onChange={setHighlightTop1} /></FieldRow>
                                  {highlightTop1 && (
                                    <FieldRow label="하이라이트 색">
                                      <div className="rowGap">
                                        <input type="color" value={highlightColor} onChange={e => setHighlightColor(e.target.value)} className="colorPicker" />
                                        <span className="monoSmall">{highlightColor}</span>
                                      </div>
                                    </FieldRow>
                                  )}
                                </>
                              )}
                            </>
                          )}
                          <SliderRow label="막대 투명도" display={barOpacity.toFixed(2)}>
                            <Slider value={barOpacity} min={0.6} max={1} step={0.01} onChange={setBarOpacity} />
                          </SliderRow>
                        </Section>

                        {chartType !== 'racing' && (
                          <Section title="그래프 서식">
                            <SliderRow label="라벨 폰트 크기" display={`${labelSize}px`}>
                              <Slider value={labelSize} min={8} max={24} step={1} onChange={setLabelSize} />
                            </SliderRow>
                            <FieldRow label="라벨 볼드">
                              <Switch checked={labelBold} onChange={setLabelBold} />
                            </FieldRow>
                          </Section>
                        )}

                        {chartType === 'racing' && (
                          <Section title="라벨">
                            <FieldRow label="소수점 자리">
                              <Select value={String(decimals)} onChange={v => setDecimals(Number(v))} options={[0,1,2,3].map(n => ({ value:String(n),label:String(n) }))} />
                            </FieldRow>
                          </Section>
                        )}

                        {chartType === 'racing' && (
                          <Section title="연도/총합">
                            <FieldRow label="큰 연도 표시"><Switch checked={showBigTime} onChange={setShowBigTime} /></FieldRow>
                            <FieldRow label="Total 표시"><Switch checked={showTotal} onChange={setShowTotal} /></FieldRow>
                          </Section>
                        )}

                        {chartType === 'racing' && (
                          <Section title="재생/타임라인">
                            <FieldRow label="타임라인 표시"><Switch checked={showTimeline} onChange={setShowTimeline} /></FieldRow>
                            <SliderRow label="재생 속도" display={`${msPerStep}ms`}>
                              <Slider value={msPerStep} min={350} max={2500} step={50} onChange={setMsPerStep} />
                            </SliderRow>
                            <FieldRow label="반복 재생"><Switch checked={loop} onChange={setLoop} /></FieldRow>
                            <div className="rowGap" style={{ marginTop: 8 }}>
                              <button className="primaryBtn" type="button" onClick={() => setPlaying(v => !v)} disabled={!hasReady}>{playing ? "일시정지" : "재생"}</button>
                              <button className="ghostBtn" type="button" onClick={() => { setPlaying(false); tRef.current = 0; setT(0); }}>처음으로</button>
                            </div>
                          </Section>
                        )}

                        <Section title="범례/축/그리드">
                          <FieldRow label="범례 표시"><Switch checked={showLegend} onChange={setShowLegend} /></FieldRow>
                          {chartType !== 'racing' && (
                            <>
                              <SliderRow label="범례 크기" display={`${legendSize}px`}>
                                <Slider value={legendSize} min={8} max={20} step={1} onChange={setLegendSize} />
                              </SliderRow>
                              <FieldRow label="범례 볼드"><Switch checked={legendBold} onChange={setLegendBold} /></FieldRow>
                            </>
                          )}
                          {chartType === 'racing' && (
                            <>
                              <FieldRow label="축 표시"><Switch checked={showAxis} onChange={setShowAxis} /></FieldRow>
                              <FieldRow label="눈금 개수"><Select value={String(tickCount)} onChange={v => setTickCount(Number(v))} options={[2,3,4,5].map(n => ({ value:String(n),label:String(n) }))} /></FieldRow>
                              <FieldRow label="그리드 표시"><Switch checked={showGrid} onChange={setShowGrid} /></FieldRow>
                              <FieldRow label="이미지 표시"><Switch checked={showImages} onChange={setShowImages} /></FieldRow>
                            </>
                          )}
                        </Section>

                        {chartType === 'racing' && (
                          <Section title="이미지 컬럼">
                            <FieldRow label="이미지 컬럼">
                              <Select value={imageCol} onChange={setImageCol} options={[{ value:'',label:'(없음)' },...columns.map(c => ({ value:c,label:c }))]} />
                            </FieldRow>
                          </Section>
                        )}
                      </div>
                  </div>
                </div>

              </div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
