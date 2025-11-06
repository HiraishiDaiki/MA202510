// --- 設定値 ---
const BRIGHTNESS_THRESHOLD = 200; // 輝度の閾値 (0-255)。この値より明るいピクセルを抽出
const DIFF_THRESHOLD = 20;        // ピクセル輝度差の閾値。この値以上の変化を「動き」と見なす
const MIN_MOVEMENT_PIXELS = 100;  // 動きとして認識する最低ピクセル数

// --- HTML要素の取得 ---
const video = document.getElementById('video');
const canvasOriginal = document.getElementById('canvas-original');
const canvasDiff = document.getElementById('canvas-diff');
const ctxOriginal = canvasOriginal.getContext('2d');
const ctxDiff = canvasDiff.getContext('2d');
const statusDiv = document.getElementById('status');

const WIDTH = canvasOriginal.width;
const HEIGHT = canvasOriginal.height;

// --- 追跡に必要な変数 ---
let previousFrameData = null; // 前フレームの輝度フィルタリング後のピクセルデータを保持

// --- カメラのセットアップ ---
async function setupCamera() {
    try {
        // スマホカメラへのアクセスを要求
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: WIDTH, height: HEIGHT } });
        video.srcObject = stream;
        video.play();
        video.onloadedmetadata = () => {
            // カメラ起動後、一定間隔で処理を開始
            setInterval(processFrame, 1000 / 30); // 30 FPSでフレームを処理
        };
    } catch (err) {
        console.error("カメラへのアクセスに失敗しました:", err);
        statusDiv.textContent = 'エラー: カメラへのアクセスを許可してください。';
    }
}

// --- メイン処理関数 ---
function processFrame() {
    if (video.paused || video.ended) return;

    // 1. カメラ映像をCanvasに描画
    ctxOriginal.drawImage(video, 0, 0, WIDTH, HEIGHT);
    
    // 2. ピクセルデータを取得
    const imageDataOriginal = ctxOriginal.getImageData(0, 0, WIDTH, HEIGHT);
    const dataOriginal = imageDataOriginal.data;
    
    // 3. 輝度フィルタリング (明るい部分の抽出)
    const currentBrightFrame = new Uint8Array(WIDTH * HEIGHT); // 輝度フィルタリング後のデータ (0または255)
    
    for (let i = 0; i < dataOriginal.length; i += 4) {
        const r = dataOriginal[i];
        const g = dataOriginal[i + 1];
        const b = dataOriginal[i + 2];
        
        // 輝度を計算 (標準的な方法)
        const brightness = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        
        // 輝度フィルタリング: 明るいピクセルだけを白(255)に
        if (brightness > BRIGHTNESS_THRESHOLD) {
            currentBrightFrame[i / 4] = 255;
        } else {
            currentBrightFrame[i / 4] = 0;
        }
    }

    // 4. フレーム間の差分検出
    if (previousFrameData) {
        let diffPixelsCount = 0;
        let totalX = 0;
        let totalY = 0;

        // 差分Canvas用のImageDataを作成
        const imageDataDiff = ctxDiff.createImageData(WIDTH, HEIGHT);
        const dataDiff = imageDataDiff.data;

        for (let i = 0; i < currentBrightFrame.length; i++) {
            const index4 = i * 4;
            
            // 輝度差を計算 (前フレームとの明るさの違い)
            const diff = Math.abs(currentBrightFrame[i] - previousFrameData[i]);

            // 差分が閾値を超え、かつ現在のフレームで明るい部分である (動く光を抽出)
            if (diff > DIFF_THRESHOLD && currentBrightFrame[i] === 255) {
                // 動きがあったピクセルは緑色で表示
                dataDiff[index4] = 0;     // R
                dataDiff[index4 + 1] = 255; // G (動いた光のスポット)
                dataDiff[index4 + 2] = 0;     // B
                dataDiff[index4 + 3] = 255; // A

                // 追跡のための重心計算
                const x = i % WIDTH;
                const y = Math.floor(i / WIDTH);
                totalX += x;
                totalY += y;
                diffPixelsCount++;

            } else {
                // 変化がないピクセルは透明
                dataDiff[index4 + 3] = 0;
            }
        }
        
        // 差分Canvasに描画
        ctxDiff.putImageData(imageDataDiff, 0, 0);

        // 5. 追跡情報の表示 (重心の計算)
        if (diffPixelsCount > MIN_MOVEMENT_PIXELS) {
            const centerX = Math.round(totalX / diffPixelsCount);
            const centerY = Math.round(totalY / diffPixelsCount);
            
            statusDiv.textContent = `追跡中: 動きを検出 (${diffPixelsCount}ピクセル) - 中心座標 (${centerX}, ${centerY})`;

            // 重心を視覚的に表示 (例: 赤い丸)
            ctxOriginal.fillStyle = 'red';
            ctxOriginal.beginPath();
            ctxOriginal.arc(centerX, centerY, 10, 0, 2 * Math.PI);
            ctxOriginal.fill();
            
        } else {
            statusDiv.textContent = '追跡情報: 動きが検出されていません';
        }

    }

    // 6. 現在の輝度データを次のフレームのために保存
    previousFrameData = currentBrightFrame;
}

// 処理開始
setupCamera();
