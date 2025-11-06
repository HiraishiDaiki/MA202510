// --- 設定値 ---
const WIDTH = 640;
const HEIGHT = 480;
const FPS = 30; // フレームレート
const BRIGHTNESS_THRESHOLD = 200; 
const DIFF_THRESHOLD = 20;        
const MIN_MOVEMENT_PIXELS = 100;  

// --- HTML要素の取得とコンテキスト ---
const video = document.getElementById('video');
const canvasOriginal = document.getElementById('canvas-original');
const canvasDiff = document.getElementById('canvas-diff');
const ctxOriginal = canvasOriginal.getContext('2d');
const ctxDiff = canvasDiff.getContext('2d');
const statusDiv = document.getElementById('status');

canvasOriginal.width = WIDTH;
canvasOriginal.height = HEIGHT;
canvasDiff.width = WIDTH;
canvasDiff.height = HEIGHT;

// --- 追跡に必要な変数 ---
let previousFrameData = null; 
let intervalId = null; // 追跡処理のインターバルID

// -------------------------------------------------------------------
// 🎥 ステップ1: カメラのセットアップ（外カメラ優先）
// -------------------------------------------------------------------
async function setupCamera() {
    // 追跡処理が既に実行中の場合は停止
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }
    
    // 1. 外カメラ指定の制約 (idealを使用し、柔軟性を確保)
    let constraints = {
        video: { 
            width: { ideal: WIDTH }, 
            height: { ideal: HEIGHT },
            facingMode: { ideal: 'environment' } // 外カメラを理想値として要求
        }
    };

    try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        // 成功したら、ストリームを設定して再生
        video.srcObject = stream;
        video.play();
        
        // 追跡処理を開始
        video.onloadedmetadata = () => {
            statusDiv.textContent = 'カメラ起動成功。追跡を開始します。';
            intervalId = setInterval(processFrame, 1000 / FPS); 
        };
        
    } catch (err) {
        console.error("外カメラ (ideal) での起動に失敗しました。詳細:", err);
        statusDiv.textContent = 'エラー: カメラ起動に失敗。内カメラを試します...';
        
        // 2. 外カメラが利用できない/エラーの場合、内カメラでフォールバックを試みる（デバッグ用）
        try {
            constraints.video.facingMode = { ideal: 'user' };
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            
            video.srcObject = stream;
            video.play();
            video.onloadedmetadata = () => {
                statusDiv.textContent = '内カメラで起動しました（外カメラエラー）。';
                intervalId = setInterval(processFrame, 1000 / FPS);
            };
        } catch (fallbackErr) {
             console.error("カメラへのアクセス権限がないか、デバイスにカメラがありません:", fallbackErr);
             statusDiv.textContent = '致命的なエラー: カメラへのアクセス権限がないか、デバイスがサポートしていません。';
        }
    }
}


// -------------------------------------------------------------------
// ✨ ステップ2: メインの追跡処理関数 (既存ロジックを維持)
// -------------------------------------------------------------------
function processFrame() {
    if (video.paused || video.ended) return;

    // 1. カメラ映像をCanvasに描画
    ctxOriginal.drawImage(video, 0, 0, WIDTH, HEIGHT);
    
    const imageDataOriginal = ctxOriginal.getImageData(0, 0, WIDTH, HEIGHT);
    const dataOriginal = imageDataOriginal.data;
    
    // 2. 輝度フィルタリング
    const currentBrightFrame = new Uint8Array(WIDTH * HEIGHT);
    
    for (let i = 0; i < dataOriginal.length; i += 4) {
        const r = dataOriginal[i];
        const g = dataOriginal[i + 1];
        const b = dataOriginal[i + 2];
        const brightness = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        
        if (brightness > BRIGHTNESS_THRESHOLD) {
            currentBrightFrame[i / 4] = 255;
        } else {
            currentBrightFrame[i / 4] = 0;
        }
    }

    // 3. フレーム間の差分検出と重心計算
    if (previousFrameData) {
        let diffPixelsCount = 0;
        let totalX = 0;
        let totalY = 0;

        const imageDataDiff = ctxDiff.createImageData(WIDTH, HEIGHT);
        const dataDiff = imageDataDiff.data;

        for (let i = 0; i < currentBrightFrame.length; i++) {
            const index4 = i * 4;
            const diff = Math.abs(currentBrightFrame[i] - previousFrameData[i]);

            if (diff > DIFF_THRESHOLD && currentBrightFrame[i] === 255) {
                // 動いた光のスポットを緑色で表示
                dataDiff[index4 + 1] = 255; 
                dataDiff[index4 + 3] = 255; 

                // 重心計算のための座標加算
                totalX += (i % WIDTH);
                totalY += Math.floor(i / WIDTH);
                diffPixelsCount++;

            } else {
                dataDiff[index4 + 3] = 0; // 透明
            }
        }
        
        ctxDiff.putImageData(imageDataDiff, 0, 0);

        // 4. 追跡情報の表示と重心の描画
        if (diffPixelsCount > MIN_MOVEMENT_PIXELS) {
            const centerX = Math.round(totalX / diffPixelsCount);
            const centerY = Math.round(totalY / diffPixelsCount);
            
            statusDiv.textContent = `追跡中: 中心座標 (${centerX}, ${centerY})`;

            // 重心を視覚的に表示
            ctxOriginal.fillStyle = 'red';
            ctxOriginal.beginPath();
            ctxOriginal.arc(centerX, centerY, 10, 0, 2 * Math.PI);
            ctxOriginal.fill();
            
        } else {
            statusDiv.textContent = '追跡情報: 動きが検出されていません';
        }

    }

    // 5. 現在の輝度データを次のフレームのために保存
    previousFrameData = currentBrightFrame;
}

// -------------------------------------------------------------------
// 🚀 処理開始
// -------------------------------------------------------------------
setupCamera();
