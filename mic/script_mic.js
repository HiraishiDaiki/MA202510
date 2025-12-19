// ==========================================
// グローバル変数
// ==========================================
let audioContext;
let analyserL, analyserR;
let filterL, filterR;
let dataArrayL, dataArrayR;
let animationId;
let isRunning = false;

// 設定値
let targetFreq = 135;
let bandwidth = 20;
let visualGain = 5.0; 

// DOM要素
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const startBtn = document.getElementById('startBtn');
const statusDiv = document.getElementById('status');

const freqSlider = document.getElementById('freqSlider');
const bwSlider = document.getElementById('bwSlider');
const gainSlider = document.getElementById('gainSlider');
const freqVal = document.getElementById('freqVal');
const bwVal = document.getElementById('bwVal');
const gainVal = document.getElementById('gainVal');

// ==========================================
// 1. マイク入力のセットアップ
// ==========================================
async function setupAudio() {
    try {
        ctx.fillStyle = '#ffffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        audioContext = new (window.AudioContext || window.webkitAudioContext)();

        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                autoGainControl: false,
                noiseSuppression: false,
                channelCount: 2 
            }
        });

        const source = audioContext.createMediaStreamSource(stream);
        const splitter = audioContext.createChannelSplitter(2);
        source.connect(splitter);

        filterL = createBandpassFilter();
        filterR = createBandpassFilter();

        analyserL = audioContext.createAnalyser();
        analyserR = audioContext.createAnalyser();
        
        // 2048は約46ms分のデータ。長くしたい場合は4096などに増やす。
        analyserL.fftSize = 2048; 
        analyserR.fftSize = 2048;
        analyserL.smoothingTimeConstant = 0; 
        analyserR.smoothingTimeConstant = 0;

        splitter.connect(filterL, 0); 
        splitter.connect(filterR, 1); 

        filterL.connect(analyserL);
        filterR.connect(analyserR);

        const bufferLength = analyserL.frequencyBinCount;
        dataArrayL = new Float32Array(bufferLength);
        dataArrayR = new Float32Array(bufferLength);

        updateFilters();
        statusDiv.textContent = "モニタリング中... ";
        startBtn.textContent = "停止";
        isRunning = true;
        
        draw(); 

    } catch (err) {
        console.error(err);
        statusDiv.textContent = "エラー: マイクへのアクセスが拒否されたか、デバイスが見つかりません。";
    }
}

function createBandpassFilter() {
    const filter = audioContext.createBiquadFilter();
    filter.type = "bandpass";
    return filter;
}

function updateFilters() {
    if (!filterL || !filterR) return;

    const safeBw = Math.max(1, bandwidth);
    const qValue = targetFreq / safeBw;

    filterL.frequency.value = targetFreq;
    filterL.Q.value = qValue;
    
    filterR.frequency.value = targetFreq;
    filterR.Q.value = qValue;
}

// ==========================================
// 2. 描画ループ
// ==========================================
function draw() {
    if (!isRunning) return;

    animationId = requestAnimationFrame(draw);

    const width = canvas.width;
    const height = canvas.height;
    const cx = width / 2;
    const cy = height / 2;

    ctx.fillStyle = '#ffffffff'; 
    ctx.fillRect(0, 0, width, height);

    // 波形データの取得
    analyserL.getFloatTimeDomainData(dataArrayL);
    analyserR.getFloatTimeDomainData(dataArrayR);

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000000ff'; 
    ctx.beginPath();

    const len = dataArrayL.length;
    const scale = (width / 2) * visualGain;

    // バッファ内のデータ（一定の長さ）を一筆書きで描画
    for (let i = 0; i < len; i++) {
        const x = cx + dataArrayL[i] * scale;
        const y = cy - dataArrayR[i] * scale; 

        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }
    
    ctx.stroke();
}

// ==========================================
// 3. UIイベントリスナー
// ==========================================
startBtn.addEventListener('click', () => {
    if (isRunning) {
        // 停止処理
        if (audioContext) audioContext.close();
        cancelAnimationFrame(animationId);
        isRunning = false;
        startBtn.textContent = "マイク入力を開始";
        statusDiv.textContent = "停止 (画面を保持)";
    } else {
        // 開始処理
        setupAudio();
    }
});

freqSlider.addEventListener('input', (e) => {
    targetFreq = Number(e.target.value);
    freqVal.textContent = targetFreq;
    updateFilters();
});

bwSlider.addEventListener('input', (e) => {
    bandwidth = Number(e.target.value);
    bwVal.textContent = bandwidth;
    updateFilters();
});

gainSlider.addEventListener('input', (e) => {
    visualGain = Number(e.target.value);
    gainVal.textContent = visualGain.toFixed(1);
});