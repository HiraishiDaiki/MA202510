// ==========================================
// グローバル変数
// ==========================================
let audioContext;
let analyserL, analyserR; // リサージュ用（フィルタ後）
let analyserSpectrum;     // スペクトル用（フィルタ前・生音）

let filterL, filterR;
let dataArrayL, dataArrayR;
// スペクトル表示用の変数
let freqDataArray; 
let freqBufferLength;

let animationId;
let isRunning = false;

// 設定値
let targetFreq = 135;
let bandwidth = 20;
let visualGain = 5.0; 

// スペクトル表示の上限周波数 (Hz)
const MAX_DISPLAY_FREQ = 1000; 

// ==========================================
// DOM要素
// ==========================================
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const freqCanvas = document.getElementById('frequencyCanvas');
const freqCtx = freqCanvas.getContext('2d');
// Canvas解像度設定
freqCanvas.width = 600;
freqCanvas.height = 200;

const startBtn = document.getElementById('startBtn');
const statusDiv = document.getElementById('status');
const audioSelect = document.getElementById('audioSource');

const freqInput = document.getElementById('freqInput');
const bwInput = document.getElementById('bwInput');
const gainInput = document.getElementById('gainInput');

// ==========================================
// 0. デバイス一覧の取得
// ==========================================
async function getAudioDevices() {
    try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(device => device.kind === 'audioinput');

        audioSelect.innerHTML = '';
        audioInputs.forEach(device => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.text = device.label || `Microphone ${audioSelect.length + 1}`;
            audioSelect.appendChild(option);
        });
        
        statusDiv.textContent = "デバイスを選択して開始してください";
    } catch (e) {
        console.error(e);
        statusDiv.textContent = "マイクへのアクセスを許可してください";
    }
}
getAudioDevices();

// ==========================================
// 1. マイク入力のセットアップ
// ==========================================
async function setupAudio() {
    try {
        // 画面クリア
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        freqCtx.fillStyle = '#ffffff';
        freqCtx.fillRect(0, 0, freqCanvas.width, freqCanvas.height);

        audioContext = new (window.AudioContext || window.webkitAudioContext)();

        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: audioSelect.value ? { exact: audioSelect.value } : undefined,
                echoCancellation: false,
                autoGainControl: false,
                noiseSuppression: false,
                channelCount: 2 
            }
        });

        const source = audioContext.createMediaStreamSource(stream);
        const splitter = audioContext.createChannelSplitter(2);
        source.connect(splitter);

        // --- フィルタ作成 ---
        filterL = createBandpassFilter();
        filterR = createBandpassFilter();

        // --- アナライザ作成 ---
        // 1. リサージュ用 (フィルタ後の音を見る)
        analyserL = audioContext.createAnalyser();
        analyserR = audioContext.createAnalyser();
        analyserL.fftSize = 2048*4; 
        analyserR.fftSize = 2048*4;
        analyserL.smoothingTimeConstant = 0; 
        analyserR.smoothingTimeConstant = 0;

        // 2. スペクトル用 (フィルタ前の「生音」)
        analyserSpectrum = audioContext.createAnalyser();
        analyserSpectrum.fftSize = 4096 * 4;
        analyserSpectrum.smoothingTimeConstant = 0.0;

        // --- 接続ルーティング ---
        
        // A. スペクトル用: Splitter(生の音) -> AnalyserSpectrum
        // マイク1(ch0)の生音を接続
        splitter.connect(analyserSpectrum, 0);

        // B. リサージュ用: Splitter -> Filter -> AnalyserL/R
        splitter.connect(filterL, 0); 
        splitter.connect(filterR, 1); 

        filterL.connect(analyserL);
        filterR.connect(analyserR);

        // データ配列の準備
        // リサージュ用
        const bufferLength = analyserL.frequencyBinCount;
        dataArrayL = new Float32Array(bufferLength);
        dataArrayR = new Float32Array(bufferLength);

        // スペクトル用
        freqBufferLength = analyserSpectrum.frequencyBinCount;
        freqDataArray = new Uint8Array(freqBufferLength);

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
    const currentTime = audioContext.currentTime;
    
    filterL.frequency.setTargetAtTime(targetFreq, currentTime, 0.01);
    filterL.Q.setTargetAtTime(qValue, currentTime, 0.01);
    
    filterR.frequency.setTargetAtTime(targetFreq, currentTime, 0.01);
    filterR.Q.setTargetAtTime(qValue, currentTime, 0.01);
}

// ==========================================
// 2. 描画ループ
// ==========================================
function draw() {
    if (!isRunning) return;
    animationId = requestAnimationFrame(draw);

    // --- 1. リサージュ図形の描画 (フィルタ後の音) ---
    const width = canvas.width;
    const height = canvas.height;
    const cx = width / 2;
    const cy = height / 2;

    ctx.fillStyle = '#ffffff'; 
    ctx.fillRect(0, 0, width, height);

    analyserL.getFloatTimeDomainData(dataArrayL);
    analyserR.getFloatTimeDomainData(dataArrayR);

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000000'; 
    ctx.beginPath();

    const len = dataArrayL.length;
    const scale = (width / 2) * visualGain;

    for (let i = 0; i < len; i++) {
        const x = cx + dataArrayL[i] * scale;
        const y = cy - dataArrayR[i] * scale; 

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();


    // --- 2. スペクトル（周波数分析）の描画 (フィルタ前の生音) ---
    const fw = freqCanvas.width;
    const fh = freqCanvas.height;

    freqCtx.fillStyle = '#f0f0f0';
    freqCtx.fillRect(0, 0, fw, fh);

    // 生音用のアナライザからデータを取得
    analyserSpectrum.getByteFrequencyData(freqDataArray);

    const nyquist = audioContext.sampleRate / 2;
    const maxIndex = Math.floor((MAX_DISPLAY_FREQ / nyquist) * freqBufferLength);
    const barWidth = fw / maxIndex;

    let x = 0;

    for(let i = 0; i < maxIndex; i++) {
        const barHeight = freqDataArray[i]; 

        const percent = barHeight / 255;
        const h = percent * fh;

        freqCtx.fillStyle = `#000000`;
        freqCtx.fillRect(x, fh - h, barWidth + 1, h);

        x += barWidth;
    }
    
    // ガイドライン（これはフィルタの中心周波数を示す）
    drawFreqGuide(targetFreq);
}

// ガイドライン表示関数
function drawFreqGuide(freq) {
    if(!audioContext) return;
    if (freq > MAX_DISPLAY_FREQ) return;

    const fw = freqCanvas.width;
    const fh = freqCanvas.height;
    const xPos = (freq / MAX_DISPLAY_FREQ) * fw;

    if (xPos < fw) {
        freqCtx.beginPath();
        freqCtx.moveTo(xPos, 0);
        freqCtx.lineTo(xPos, fh);
        freqCtx.strokeStyle = 'red';
        freqCtx.lineWidth = 2;
        freqCtx.setLineDash([5, 5]); 
        freqCtx.stroke();
        freqCtx.setLineDash([]); 

        freqCtx.fillStyle = 'red';
        freqCtx.font = '12px Arial';
        freqCtx.fillText(`${freq}Hz`, xPos + 5, 15);
    }
}

// ==========================================
// 3. UIイベントリスナー
// ==========================================
startBtn.addEventListener('click', () => {
    if (isRunning) {
        if (audioContext) audioContext.close();
        cancelAnimationFrame(animationId);
        isRunning = false;
        startBtn.textContent = "マイク入力を開始";
        statusDiv.textContent = "停止";
    } else {
        setupAudio();
    }
});

freqInput.addEventListener('input', (e) => {
    targetFreq = Number(e.target.value);
    updateFilters();
});
bwInput.addEventListener('input', (e) => {
    bandwidth = Number(e.target.value);
    updateFilters();
});
gainInput.addEventListener('input', (e) => {
    visualGain = Number(e.target.value);
});

// 画像保存
document.querySelectorAll('.saveBtn').forEach(button => {
    button.addEventListener("click", function() {
        const canvasId = this.getAttribute("data-canvas-id");
        const targetCanvas = document.getElementById(canvasId);
        if (!targetCanvas) return;
        const dataURL = targetCanvas.toDataURL("image/png");
        const now = new Date();
        const timestamp = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}-${now.getMinutes().toString().padStart(2, '0')}-${now.getSeconds().toString().padStart(2, '0')}`;
        const link = document.createElement("a");
        link.href = dataURL;
        link.download = `${canvasId}_${timestamp}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });
});