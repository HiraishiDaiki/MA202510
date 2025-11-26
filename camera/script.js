<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>光の動きトラッカー（ライト付き）</title>
    <!-- Tailwind CSS を読み込み -->
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        /* ビデオ要素を非表示にして、キャンバスの背後で実行させる */
        #video {
            display: none;
        }
        /* キャンバスを重ねて配置するためのコンテナ */
        .canvas-container {
            position: relative;
            width: 640px; /* WIDTH と合わせる */
            height: 480px; /* HEIGHT と合わせる */
            margin: 0 auto;
            border: 2px solid #3b82f6;
            border-radius: 0.5rem;
            overflow: hidden;
        }
        /* キャンバスを絶対位置で重ねる */
        #canvas-original, #canvas-diff {
            position: absolute;
            top: 0;
            left: 0;
        }
        /* オリジナルキャンバスは透過しない */
        #canvas-original {
            z-index: 10;
        }
        /* 差分キャンバスは半透明にし、動きだけを重ねて表示 */
        #canvas-diff {
            z-index: 20;
            opacity: 0.8; 
        }
    </style>
</head>
<body class="bg-gray-50 flex flex-col items-center justify-center min-h-screen p-4 font-sans">

    <header class="mb-6 text-center">
        <h1 class="text-3xl font-extrabold text-blue-600 mb-2">📹 動作追跡デモ</h1>
        <p class="text-gray-500">外カメラ起動時に自動でライトが点灯します。</p>
    </header>

    <div class="canvas-container shadow-2xl">
        <!-- 元の映像を表示するキャンバス -->
        <canvas id="canvas-original"></canvas>
        <!-- 差分（動き）を表示するキャンバス -->
        <canvas id="canvas-diff"></canvas>
        <!-- カメラ映像のソース（非表示） -->
        <video id="video" playsinline muted></video>
    </div>

    <!-- ステータス表示領域 -->
    <div id="status" class="mt-6 p-4 w-full max-w-lg bg-white border border-gray-200 rounded-lg shadow-md text-sm text-center text-gray-700">
        カメラを起動中です...
    </div>

    <script>
// --- 設定値 ---
const WIDTH = 640;
const HEIGHT = 480;
const FPS = 30; 
const BRIGHTNESS_THRESHOLD = 200; // 輝度のしきい値
const DIFF_THRESHOLD = 20;        // 差分のしきい値
const MIN_MOVEMENT_PIXELS = 100;  // 光の塊のしきい値

// --- HTML要素の取得とコンテキスト ---
const video = document.getElementById('video');
const canvasOriginal = document.getElementById('canvas-original');
const canvasDiff = document.getElementById('canvas-diff');
const ctxOriginal = canvasOriginal.getContext('2d');
const ctxDiff = canvasDiff.getContext('2d');
const statusDiv = document.getElementById('status');

// Canvasサイズを設定
canvasOriginal.width = WIDTH;
canvasOriginal.height = HEIGHT;
canvasDiff.width = WIDTH;
canvasDiff.height = HEIGHT;

// --- 追跡に必要な変数 ---
let previousFrameData = null; 
let intervalId = null; 

// -------------------------------------------------------------------
// 【追加機能】ライトのON/OFFを切り替えるヘルパー関数
// -------------------------------------------------------------------
/**
 * カメラストリームのトーチ（ライト）をONまたはOFFにします。
 * @param {MediaStream} stream - カメラストリーム
 * @param {boolean} state - trueでON、falseでOFF
 */
function toggleTorch(stream, state) {
    // 最初のビデオトラックを取得
    const track = stream.getVideoTracks()[0];
    const capabilities = track.getCapabilities();

    // 1. デバイスがトーチ機能をサポートしているか確認
    if (capabilities.torch) {
        // 2. 制約を適用してトーチの状態を変更
        track.applyConstraints({
            advanced: [{ torch: state }]
        }).then(() => {
            console.log(`Torch is ${state ? 'ON' : 'OFF'}`);
        }).catch(err => {
            console.error("Failed to toggle torch:", err);
            statusDiv.textContent += ` (ライト操作失敗)`;
        });
    } else {
        console.warn("Torch capability not supported on this device/track.");
    }
}


// -------------------------------------------------------------------
// カメラのセットアップ
// -------------------------------------------------------------------
async function setupCamera() {
    // 追跡処理が既に実行中の場合は停止し、リセット
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }
    previousFrameData = null; // 前フレームデータもリセット

    // 1. 外カメラ指定の制約
    let constraints = {
        video: { 
            // 解像度は ideal で指定し、外カメラがサポートする範囲に合わせる
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
        
        // 🚨 【変更点】ライトを点灯させる
        toggleTorch(stream, true);

        // 追跡処理を開始
        video.onloadedmetadata = () => {
            statusDiv.textContent = 'カメラ起動成功。外カメラで追跡を開始します。(ライトON)';
            intervalId = setInterval(processFrame, 1000 / FPS); 
        };
        
    } catch (err) {
        console.error("外カメラ (ideal) での起動に失敗しました。詳細:", err);
        statusDiv.textContent = 'エラー: 外カメラ起動失敗。内カメラを試みます';
        
        // 2. 外カメラが利用できない/エラーの場合、内カメラでのフォールバックを試みる
        try {
            constraints.video.facingMode = { ideal: 'user' }; // 内カメラに切り替え
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            
            video.srcObject = stream;
            video.play();

            // 🚨 【変更点】フォールバック成功時にもライトを点灯させる
            toggleTorch(stream, true);

            video.onloadedmetadata = () => {
                statusDiv.textContent = '内カメラで起動しました（外カメラエラー）。動作確認してください。(ライトON)';
                intervalId = setInterval(processFrame, 1000 / FPS);
            };
        } catch (fallbackErr) {
             console.error("内カメラでの起動にも失敗しました:", fallbackErr);
             statusDiv.textContent = 'カメラへのアクセス権限がないか、デバイスがサポートしていません。';
        }
    }
}


// -------------------------------------------------------------------
// メインの追跡処理関数 (変更なし)
// -------------------------------------------------------------------
function processFrame() {
    if (video.paused || video.ended) return;

    // 1. カメラ映像をCanvasに描画
    ctxOriginal.drawImage(video, 0, 0, WIDTH, HEIGHT);
    
    const imageDataOriginal = ctxOriginal.getImageData(0, 0, WIDTH, HEIGHT);
    const dataOriginal = imageDataOriginal.data;
    
    // 2. 輝度フィルタリング (明るい部分の抽出)
    const currentBrightFrame = new Uint8Array(WIDTH * HEIGHT);
    
    for (let i = 0; i < dataOriginal.length; i += 4) {
        // RGB成分の取得  
        const r = dataOriginal[i];
        const g = dataOriginal[i + 1];
        const b = dataOriginal[i + 2];

        // 輝度の計算 
        const brightness = 0.2126 * r + 0.7152 * g + 0.0722 * b;

        // 輝度がしきい値を超えていたら白にする
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
            // 差分の計算  
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
            
            statusDiv.textContent = `動作検出中: ピクセル数 ${diffPixelsCount}、重心 (${centerX}, ${centerY})`;

            // 重心を視覚的に表示 (赤い丸)
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
// 処理開始
// -------------------------------------------------------------------
window.onload = setupCamera; // ページロード完了後にカメラセットアップを開始
    </script>
</body>
</html>
