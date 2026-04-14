// ── Shared application state ──────────────────────────────────────────────────
const API = '';
const OUT_W = 1080, OUT_H = 1920;
const COLORS = ['#00f5a0','#ff3c6e','#ffd166','#06d6a0','#118ab2','#ef476f','#a8dadc','#f4a261'];
let SNAP_DIST = 12;

let videoEl = null, videoInfo = {width:1, height:1, duration:0};
let srcScale = 1, outScale = 1;
let srcZoom = 1, srcPanX = 0, srcPanY = 0;
let outZoom = 1, outPanX = 0, outPanY = 0;
let srcPanning = false, srcPanMx = 0, srcPanMy = 0, srcPanBaseX = 0, srcPanBaseY = 0;
let outPanning = false, outPanMx = 0, outPanMy = 0, outPanBaseX = 0, outPanBaseY = 0;
let filename = null, animFrame = null;
let zones = [], selectedZoneId = null;
let colorIdx = 0;
let copiedZone = null;

// Audio state
let audioTracks   = [];  // [{ idx, label, codec, channels, layout, muted }]
let audioTrackEls = [];  // one <audio> element per track
let audioCtx      = null;
let analyserNodes = [];
let gainNodes     = [];
let vizCanvases   = [];

// Tool selection & pen state
let currentTool = 'rect'; // 'rect' | 'ellipse' | 'pen'
let penPoints = [];        // [{x, y}] video coords — in-progress polygon
let penCursorPos = null;   // {x, y} canvas coords for rubber-band line

// Source canvas interaction state
let drawing = false, drawStartX, drawStartY;
let srcDragging = false, srcDragZone = null, srcDragOffX = 0, srcDragOffY = 0;
let srcResizing = false, srcResizeZone = null, srcResizeHandle = 'br';
let srcResizeStartX, srcResizeStartY, srcResizeOrigX, srcResizeOrigY, srcResizeOrigW, srcResizeOrigH;

// Output canvas interaction state
let outDragging = false, outDragZone = null, outDragOffX = 0, outDragOffY = 0;
let outResizing = false, outResizeZone = null, outResizeHandle = 'br';
let outResizeStartX, outResizeStartY, outResizeOrigX, outResizeOrigY, outResizeOrigW, outResizeOrigH;

// Zone list drag-to-reorder state
let zoneDragSrcIdx = null;
let showInputOutlines = true;
let showOutputOutlines = true;

// Pixel selection & HUD probe state
let selectedPixel = null;   // { x, y, r, g, b, a } in video coordinates
let hudProbeMode = false;   // toggle for per-frame HUD probe sampling
let settingProbeForZone = null; // zone id when assigning a probe pixel

// Trim state
let trimStart = 0, trimEnd = null;
let tlDragging = null; // 'head' | 'in' | 'out'
let tlZoom     = 1;    // magnification factor (1 = full video)
let tlOffset   = 0;    // visible window start as fraction of total duration

// Snap lines for output canvas during drag
let activeSnapLines = null;

// Panel resize state
let panelResizing = null;

// Undo
let undoStack = [];

// Export
let exportPollTimer = null;

// ── Captions ──────────────────────────────────────────────────────────────────
// captionTracks: [{ label, trackIdx, color, segments:[{start,end,text,words}] }]
let captionTracks    = [];
let activeCaptionTab = 0;   // index into captionTracks currently shown in the panel
let captionPollTimer = null;

// Track colors — cycled per transcribed track
const CAPTION_TRACK_COLORS = ['#FF6B35','#3B9EFF','#06D6A0','#FFD60A','#C77DFF','#FF4D6D'];

// Factory — returns a fresh style object with defaults
function defaultCaptionStyle() {
  return {
    fontFamily:    'Arial',
    fontSize:      72,
    fontWeight:    'bold',
    fontItalic:    false,
    textColor:     '#FFFFFF',
    strokeColor:   '#000000',
    strokeWidth:   4,
    bgColor:       '#000000',
    bgOpacity:     0,
    bgPadding:     14,
    bgRadius:      8,
    textAlign:     'center',
    positionX:     50,
    positionY:     85,
    maxWidth:      85,
    lineHeight:    1.25,
    letterSpacing: 0,
    allCaps:       false,
    shadow:        true,
    shadowColor:   '#000000',
    highlightEnabled: false,
    highlightColor:   '#FFD60A',
    animStyle:     'none',
  };
}

let captionStyle = {
  enabled:       false,
  fontFamily:    'Arial',
  fontSize:      72,          // in OUT_H (1920) pixel space
  fontWeight:    'bold',
  fontItalic:    false,
  textColor:     '#FFFFFF',
  strokeColor:   '#000000',
  strokeWidth:   4,
  bgColor:       '#000000',
  bgOpacity:     0,           // 0–1
  bgPadding:     14,
  bgRadius:      8,
  textAlign:     'center',    // 'left' | 'center' | 'right'
  positionX:     50,          // % of OUT_W
  positionY:     85,          // % of OUT_H (from top)
  maxWidth:      85,          // % of OUT_W
  lineHeight:    1.25,
  letterSpacing: 0,
  allCaps:       false,
  shadow:        true,
  shadowColor:   '#000000',
  highlightEnabled: false,
  highlightColor:   '#FFD60A',
  animStyle:     'none',      // 'none' | 'pop' | 'fade'
};

// ── DOM element references ────────────────────────────────────────────────────
const srcCanvas  = document.getElementById('video-canvas');
const ovCanvas   = document.getElementById('zone-overlay');
const outCanvas  = document.getElementById('output-canvas');
const srcCtx     = srcCanvas.getContext('2d');
const ovCtx      = ovCanvas.getContext('2d');
const outCtx     = outCanvas.getContext('2d');
const drawGuide  = document.getElementById('draw-guide');
const canvasCont = document.getElementById('canvas-container');
const tlTrack    = document.getElementById('tl-track');
