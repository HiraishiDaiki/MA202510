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
const lightBtn = document.getElementById('light-btn');

// Canvasサイズを設定
canvasOriginal.width = WIDTH;
canvasOriginal.height = HEIGHT;
canvasDiff.width = WIDTH;
canvasDiff.height = HEIGHT;

// --- 追跡に必要な変数 ---
let previousFrameData = null; 
let intervalId = null; 
let isLightOn = false;

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
        
        // 追跡処理を開始
        video.onloadedmetadata = () => {
            statusDiv.textContent = 'カメラ起動成功。外カメラで追跡を開始します。';
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
            video.onloadedmetadata = () => {
                statusDiv.textContent = '内カメラで起動しました（外カメラエラー）。動作確認してください。';
                intervalId = setInterval(processFrame, 1000 / FPS);
            };
        } catch (fallbackErr) {
             console.error("内カメラでの起動にも失敗しました:", fallbackErr);
             statusDiv.textContent = 'カメラへのアクセス権限がないか、デバイスがサポートしていません。';
        }
    }
}

// -------------------------------------------------------------------
// ライトのON/OFF切り替え
// -------------------------------------------------------------------
async function toggleLight(){
  const stream = video.srcObject;
  if(!stream) return;

  // ビデオトラックを取得
  const track = stream.getVideoTracks()[0];

  // デバイスがライト二対応しているか確認
  const capabilities = track.getCapabilities();
  if(!capabilities.torch){
    alert('この端末またはカメラはライトの点灯に対応していません。');
    return;
  }

  try {
    // ライトの状態を反転
    isLightOn = !isLightOn

    // 制約を適用してライトをオン/オフ
    await track.applyConstraints({
      advanced:[{torch: isLightOn}]
    });

    // ボタンの文字を更新
    lightBtn.textContent = isLightOn ? 'ライト消灯':'ライト点灯';
    
  } catch(err){
    console.log('ライトの切り替えに失敗しました：'err);
    statusDiv.textContent = 'エラー：ライト操作に失敗しました';
    isLightOn = !isLightOn
  }
}

//ボタンにクリックイベントを追加
if(lightBtn){
  lightBtn.addEventListener('click',toggleLight);
}

// -------------------------------------------------------------------
// メインの追跡処理関数
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
            
            statusDiv.textContent = `動作検出中`;

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
setupCamera();
