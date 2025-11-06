// --- 設定値 ---
const BRIGHTNESS_THRESHOLD = 200; // 輝度の閾値 (0-255)
const DIFF_THRESHOLD = 20;        // ピクセル輝度差の閾値
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
let rearCameraId = null;      // 外カメラのIDを保持

// -------------------------------------------------------------------
// 📸 ステップ1: 外カメラのIDを特定する関数
// -------------------------------------------------------------------
async function getRearCameraId() {
    // 権限を確実にするため、一度ユーザーにカメラアクセスを求めます
    try {
        await navigator.mediaDevices.getUserMedia({ video: true }); 
    } catch (e) {
        console.warn("カメラ権限が拒否されました。", e);
        return;
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoInputs = devices.filter(device => device.kind === 'videoinput');
    
    // ラベルから外カメラを推測
    const rearCamera = videoInputs.find(device => {
        const label = device.label.toLowerCase();
        // 一般的な外カメラを示すキーワードをチェック
        return label.includes('back') || label.includes('rear') || label.includes('environment') || label.includes('背面');
    });

    if (rearCamera) {
        rearCameraId = rearCamera.deviceId;
    } else {
        // 特定できない場合、2番目のカメラを試す (多くのデバイスでリアが2番目になるため)
        if (videoInputs.length > 1) {
            rearCameraId = videoInputs[1].deviceId;
        } else if (videoInputs.length > 0) {
            // カメラが1つしかない場合はそれを採用
            rearCameraId = videoInputs[0].deviceId;
        }
    }
}


// -------------------------------------------------------------------
// 🎥 ステップ2: カメラのセットアップ (Chrome対策の ideal 指定)
// -------------------------------------------------------------------
async function setupCamera() {
    // 外カメラのID特定処理を待つ
    await getRearCameraId(); 
    
    let constraints;

    // Chromeの厳密な制約によるバグを避けるため、ideal(理想値)を優先
    constraints = {
        video: { 
            // 解像度を ideal で指定し、外カメラがサポートする解像度に合わせる
            width: { ideal: WIDTH }, 
            height: { ideal: HEIGHT },
            // facingMode を ideal: 'environment' で指定
            facingMode: { ideal: 'environment' }
        }
    };
    
    // deviceIdが特定できていれば、これも ideal で追加
    if (rearCameraId) {
        constraints.video.deviceId = { ideal: rearCameraId };
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;
        video.play();
        
        // カメラ映像の読み込み完了後、追跡処理を開始
        video.onloadedmetadata = () => {
            setInterval(processFrame, 1000 / 30); 
        };
    } catch (err) {
        console.error("カメラ起動に失敗しました。詳細:", err);
        statusDiv.textContent = 'エラー: 外カメラの起動に失敗しました。HTTPS接続とカメラ権限を確認してください。';
    }
}


// -------------------------------------------------------------------
// ✨ ステップ3: メインの追跡処理関数 (既存ロジックを維持)
// -------------------------------------------------------------------
function processFrame() {
    if (video.paused || video.ended) return;

    // 1. カメラ映像をCanvasに描画
    ctxOriginal.drawImage(video, 0, 0, WIDTH, HEIGHT);
    
    // 2. ピクセルデータを取得
    const imageDataOriginal = ctxOriginal.getImageData(0, 0, WIDTH, HEIGHT);
    const dataOriginal = imageDataOriginal.data;
    
    // 3. 輝度フィルタリング (明るい部分の抽出)
    const currentBrightFrame = new Uint8Array(WIDTH * HEIGHT);
    
    for (let i = 0; i < dataOriginal.length; i += 4) {
        const r = dataOriginal[i];
        const g = dataOriginal[i + 1];
        const b = dataOriginal[i + 2];
        
        // 輝度を計算
        const brightness = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        
        // 輝度フィルタリング: 明るいピクセルだけを白(255)に
        if (brightness > BRIGHTNESS_THRESHOLD) {
            currentBrightFrame[i / 4] = 255;
        } else {
            currentBrightFrame[i / 4] = 0;
        }
    }

    // 4. フレーム間の差分検出と重心計算
    if (previousFrameData) {
        let diffPixelsCount = 0;
        let totalX = 0;
        let totalY = 0;

        const imageDataDiff = ctxDiff.createImageData(WIDTH, HEIGHT);
        const dataDiff = imageDataDiff.data;

        for (let i = 0; i < currentBrightFrame.length; i++) {
            const index4 = i * 4;
            
            // 輝度差を計算
            const diff = Math.abs(currentBrightFrame[i] - previousFrameData[i]);

            // 差分が閾値を超え、かつ現在のフレームで明るい部分である (動く光を抽出)
            if (diff > DIFF_THRESHOLD && currentBrightFrame[i] === 255) {
                // 動きがあったピクセルは緑色で表示
                dataDiff[index4 + 1] = 255; 
                dataDiff[index4 + 3] = 255; 

                // 追跡のための重心計算
                const x = i % WIDTH;
                const y = Math.floor(i / WIDTH);
                totalX += x;
                totalY += y;
                diffPixelsCount++;

            } else {
                dataDiff[index4 + 3] = 0;
            }
        }
        
        // 差分Canvasに描画
        ctxDiff.putImageData(imageDataDiff, 0, 0);

        // 5. 追跡情報の表示と重心の描画
        if (diffPixelsCount > MIN_MOVEMENT_PIXELS) {
            const centerX = Math.round(totalX / diffPixelsCount);
            const centerY = Math.round(totalY / diffPixelsCount);
            
            statusDiv.textContent = `追跡中: 動きを検出 (${diffPixelsCount}ピクセル) - 中心座標 (${centerX}, ${centerY})`;

            // 重心を視覚的に表示 (赤い丸)
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

// -------------------------------------------------------------------
// 🚀 処理開始
// -------------------------------------------------------------------
setupCamera();
