// ==========================================
// グローバル変数
// ==========================================
let audioContext;
let analyserL, analyserR; // リサージュ用（フィルタ後）
let analyserSpectrumL,analyserSpectrumR;     // スペクトル用（フィルタ前・生音）

const ampHistoryPower = []; // 二乗和の履歴

let startTime = 0;
const resetTime = 5;

let currentSweap = [];
let previousSweep = [];

let filterL, filterR;
let dataArrayL, dataArrayR;
let delayNodeL, delayNodeR;

// スペクトル表示用の変数
let freqDataArrayL,freqDataArrayR; 
let freqBufferLengthL,freqBufferLengthR;

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

const freqCanvasL = document.getElementById('frequencyCanvasL');
const freqCtxL = freqCanvasL.getContext('2d');
// Canvas解像度設定
freqCanvasL.width = 600;
freqCanvasL.height = 200;

const freqCanvasR = document.getElementById('frequencyCanvasR');
const freqCtxR = freqCanvasR.getContext('2d');
// Canvas解像度設定
freqCanvasR.width = 600;
freqCanvasR.height = 200;

const startBtn = document.getElementById('startBtn');
const statusDiv = document.getElementById('status');
const audioSelect = document.getElementById('audioSource');

const freqInput = document.getElementById('freqInput');
const bwInput = document.getElementById('bwInput');
const gainInput = document.getElementById('gainInput');

const ampCanvas = document.getElementById('ampCanvas');
const ampCtx = ampCanvas ? ampCanvas.getContext('2d') : null;

const delayInput = document.getElementById('delayInput');
const delayValueDisplay = document.getElementById('delayValue');

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
        freqCtxL.fillStyle = '#ffffff';
        freqCtxL.fillRect(0, 0, freqCanvasL.width, freqCanvasL.height);
        freqCtxR.fillStyle = '#ffffff';
        freqCtxR.fillRect(0, 0, freqCanvasR.width, freqCanvasR.height);

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

        // --- 遅延ノードの作成 ---
        delayNodeL = audioContext.createDelay(1.0);
        delayNodeR = audioContext.createDelay(1.0);
        

        // --- アナライザ作成 ---
        // 1. リサージュ用 (フィルタ後の音を見る)
        analyserL = audioContext.createAnalyser();
        analyserR = audioContext.createAnalyser();
        analyserL.fftSize = 2048*4; 
        analyserR.fftSize = 2048*4;
        analyserL.smoothingTimeConstant = 0; 
        analyserR.smoothingTimeConstant = 0;

        // 2. スペクトル用 (フィルタ前の「生音」)
        analyserSpectrumL = audioContext.createAnalyser();
        analyserSpectrumL.fftSize = 4096 * 4;
        analyserSpectrumL.smoothingTimeConstant = 0.0;

        analyserSpectrumR = audioContext.createAnalyser();
        analyserSpectrumR.fftSize = 4096 * 4;
        analyserSpectrumR.smoothingTimeConstant = 0.0;

        // --- 接続ルーティング ---
        
        // A. スペクトル用: Splitter(生の音) -> AnalyserSpectrum
        // マイク1(ch0)の生音を接続
        splitter.connect(analyserSpectrumL, 0);
        splitter.connect(analyserSpectrumR, 1);

        // B. リサージュ用: Splitter -> Filter -> AnalyserL/R
        splitter.connect(delayNodeL,0);
        splitter.connect(delayNodeR,1);

        delayNodeL.connect(filterL); 
        delayNodeR.connect(filterR); 

        filterL.connect(analyserL);
        filterR.connect(analyserR);

        // データ配列の準備
        // リサージュ用
        const bufferLength = analyserL.frequencyBinCount;
        dataArrayL = new Float32Array(bufferLength);
        dataArrayR = new Float32Array(bufferLength);

        // スペクトル用
        freqBufferLengthL = analyserSpectrumL.frequencyBinCount;
        freqDataArrayL = new Uint8Array(freqBufferLengthL);

        freqBufferLengthR = analyserSpectrumL.frequencyBinCount;
        freqDataArrayR = new Uint8Array(freqBufferLengthR);

        updateFilters();
        statusDiv.textContent = "モニタリング中... ";
        startBtn.textContent = "停止";
        isRunning = true;

        // スタート時に減衰曲線のリセットを行う。
        startTime = Date.now();
        currentSweap = [];
        previousSweep = [];
        
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

// 遅延ノードの時間を更新する関数
// --- 遅延ノードの時間を更新する関数 ---
function updateDelay() {
    // 1. まず、スライダーの値を取得して画面の表示（数値）だけを更新する
    const offsetMs = Number(delayInput.value);
    if (delayValueDisplay) {
        delayValueDisplay.textContent = offsetMs.toFixed(1);
    }

    // 2. もしマイクがスタートしていない（audioContext等が無い）場合は、ここで処理を止める
    if (!audioContext || !delayNodeL || !delayNodeR) {
        return; 
    }

    // 3. マイク動作中であれば、遅延を適用する
    const currentTime = audioContext.currentTime;

    // offsetがプラスならLを遅延、マイナスならRを遅延させる
    if (offsetMs > 0) {
        delayNodeL.delayTime.setTargetAtTime(offsetMs / 1000.0, currentTime, 0.01);
        delayNodeR.delayTime.setTargetAtTime(0, currentTime, 0.01);
    } else {
        delayNodeL.delayTime.setTargetAtTime(0, currentTime, 0.01);
        delayNodeR.delayTime.setTargetAtTime(Math.abs(offsetMs) / 1000.0, currentTime, 0.01);
    }
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
    const fw = freqCanvasL.width;
    const fh = freqCanvasL.height;

    freqCtxL.fillStyle = '#f0f0f0';
    freqCtxL.fillRect(0, 0, fw, fh);

    freqCtxR.fillStyle = '#f0f0f0';
    freqCtxR.fillRect(0, 0, fw, fh);

    // 生音用のアナライザからデータを取得
    analyserSpectrumL.getByteFrequencyData(freqDataArrayL);
    analyserSpectrumR.getByteFrequencyData(freqDataArrayR);

    const nyquist = audioContext.sampleRate / 2;
    const maxIndex = Math.floor((MAX_DISPLAY_FREQ / nyquist) * freqBufferLengthL);
    const barWidth = fw / maxIndex;

    let x = 0;

    for(let i = 0; i < maxIndex; i++) {
        const barHeightL = freqDataArrayL[i]; 
        const barHeightR = freqDataArrayR[i]; 

        const percentL = barHeightL / 255;
        const hL = percentL * fh;

        const percentR = barHeightR / 255;
        const hR = percentR * fh;

        freqCtxL.fillStyle = `#000000`;
        freqCtxL.fillRect(x, fh - hL, barWidth + 1, hL);
        
        freqCtxR.fillStyle = `#000000`;
        freqCtxR.fillRect(x, fh - hR, barWidth + 1, hR);

        x += barWidth;
    }
    
    // ガイドライン（これはフィルタの中心周波数を示す）
    drawFreqGuide(targetFreq);

    // ==========================================
    // --- 3. 振幅（二乗和：トータルパワー）の推移を描画 ---
    // ==========================================
    if (ampCtx) {
        const aw = ampCanvas.width;
        const ah = ampCanvas.height;

        // 背景クリア
        ampCtx.fillStyle = '#f0f0f0';
        ampCtx.fillRect(0,0,aw,ah);

        // --- 1.FFTデータから targetFreq の高さを取得する
        const nyquist = audioContext.sampleRate / 2;
        // targetFreq に対応する配列のインデックスを取得する
        const targetIndex = Math.floor((targetFreq / nyquist) * freqBufferLengthL);

        // 左右のグラフの高さを取得し0-1の間に正規化
        const valL = freqDataArrayL[targetIndex] / 255.0;
        const valR = freqDataArrayR[targetIndex] / 255.0;

       // --- 2. 二乗和（トータルパワー）の計算 ---
        // 10のべき乗(Math.pow)を使って、dBを一度「純粋なエネルギー(振幅の二乗)」に戻す
        const energyL = Math.pow(10, valL * 5); 
        const energyR = Math.pow(10, valR * 5);

        // 二つのマイクのエネルギーの和（二乗和）をとる
        const totalEnergy = energyL + energyR;

        // --- 3. 再び対数(dB)に戻して減衰直線にする ---
        // 2つのマイクの最大値が1.0に収まるように割ってからlogをとる
        let power = Math.log10(totalEnergy / 2) / 5;

        // ゲインをかけて、画面の表示(1.0)を突き抜けないように制限する
        //power = Math.min(power * visualGain, 1.0);

        // Y座標を計算
        const yPos = ah - (power * ah);

        // --- 3. X座標の計算 ---
        let elapsedTime = (Date.now() - startTime) / 1000;
        let xPos = (elapsedTime % resetTime ) / resetTime *aw;

        // 右端に到達したときの処理
        if(currentSweap.length > 0 && xPos < currentSweap[currentSweap.length - 1][0]){
            // 現在の線を過去の線にコピーしてリセット
            previousSweep = [...currentSweap];
            currentSweap = [];
            startTime = Date.now();
            xPos = 0;
        }

        // 現在の座標を配列に保存
        currentSweap.push([xPos,yPos]);

        // --- 4. 過去の軌跡の描画 ---
        if (previousSweep.length > 0) {
            ampCtx.beginPath();
            ampCtx.moveTo(previousSweep[0][0], previousSweep[0][1]);
            for (let i = 1; i < previousSweep.length; i++) {
                ampCtx.lineTo(previousSweep[i][0], previousSweep[i][1]);
            }
            ampCtx.strokeStyle = "rgba(51, 51, 51, 0.4)"; // 半透明のグレー
            ampCtx.lineWidth = 1;
            ampCtx.stroke();
        }

        // --- 5. 現在の軌跡の描画 ---
        if (currentSweap.length > 0){
            ampCtx.beginPath();
            ampCtx.moveTo(currentSweap[0][0],currentSweap[0][1]);
            for (let i = 1; i < currentSweap.length; i++){
                ampCtx.lineTo(currentSweap[i][0], currentSweap[i][1]);
            }
            ampCtx.strokeStyle = "black";
            ampCtx.lineWidth = 2;
            ampCtx.stroke();
        }
    }
}

// ガイドライン表示関数
function drawFreqGuide(freq) {
    if(!audioContext) return;
    if (freq > MAX_DISPLAY_FREQ) return;

    const fw = freqCanvasL.width;
    const fh = freqCanvasL.height;
    const xPos = (freq / MAX_DISPLAY_FREQ) * fw;

    if (xPos < fw) {
        freqCtxL.beginPath();
        freqCtxL.moveTo(xPos, 0);
        freqCtxL.lineTo(xPos, fh);
        freqCtxL.strokeStyle = 'red';
        freqCtxL.lineWidth = 2;
        freqCtxL.setLineDash([5, 5]); 
        freqCtxL.stroke();
        freqCtxL.setLineDash([]); 

        freqCtxL.fillStyle = 'red';
        freqCtxL.font = '12px Arial';
        freqCtxL.fillText(`${freq}Hz`, xPos + 5, 15);

        freqCtxR.beginPath();
        freqCtxR.moveTo(xPos, 0);
        freqCtxR.lineTo(xPos, fh);
        freqCtxR.strokeStyle = 'red';
        freqCtxR.lineWidth = 2;
        freqCtxR.setLineDash([5, 5]); 
        freqCtxR.stroke();
        freqCtxR.setLineDash([]); 

        freqCtxR.fillStyle = 'red';
        freqCtxR.font = '12px Arial';
        freqCtxR.fillText(`${freq}Hz`, xPos + 5, 15);
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

if (delayInput){
    delayInput.addEventListener('input',updateDelay);
}

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