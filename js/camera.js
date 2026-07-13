// camera.js — getUserMedia、以影片原生解析度拍照、燒錄浮水印、下載/分享
(function () {
  'use strict';

  // 啟動相機串流；回傳 Promise<MediaStream>
  async function startCamera(videoEl) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('此裝置或瀏覽器不支援相機（需 HTTPS）');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    videoEl.srcObject = stream;
    videoEl.setAttribute('playsinline', ''); // iOS 必須
    videoEl.muted = true;
    await videoEl.play();
    return stream;
  }

  // 直接把既有 MediaStream（mock）接到 video
  async function attachStream(videoEl, stream) {
    videoEl.srcObject = stream;
    videoEl.setAttribute('playsinline', '');
    videoEl.muted = true;
    await videoEl.play();
    return stream;
  }

  function stopStream(stream) {
    if (stream) stream.getTracks().forEach((t) => t.stop());
  }

  // 依影片原生解析度繪製 + 底部浮水印黑條，回傳 Promise<Blob>(jpeg)
  function capture(videoEl, lines) {
    const w = videoEl.videoWidth || 1280;
    const h = videoEl.videoHeight || 720;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoEl, 0, 0, w, h);
    drawWatermark(ctx, w, h, lines);
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92);
    });
  }

  // 在既有 canvas（mock 或測試）上畫浮水印，回傳 Blob
  function captureFromCanvas(srcCanvas, lines) {
    const w = srcCanvas.width;
    const h = srcCanvas.height;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(srcCanvas, 0, 0, w, h);
    drawWatermark(ctx, w, h, lines);
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92);
    });
  }

  function drawWatermark(ctx, w, h, lines) {
    lines = (lines || []).filter((x) => x != null && x !== '');
    if (!lines.length) return;
    const fontPx = Math.max(12, Math.round(w * 0.022)); // 約寬度 2.2%
    const pad = Math.round(fontPx * 0.5);
    const lineH = Math.round(fontPx * 1.35);
    const barH = lineH * lines.length + pad * 2;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, h - barH, w, barH);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'top';
    ctx.font =
      fontPx +
      "px 'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif";
    lines.forEach((ln, i) => {
      ctx.fillText(ln, pad, h - barH + pad + i * lineH);
    });
    ctx.restore();
  }

  // 觸發下載
  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // 是否可用 Web Share（含檔案）
  function canShareFile(blob, filename) {
    try {
      if (!navigator.canShare || !navigator.share) return false;
      const file = new File([blob], filename, { type: 'image/jpeg' });
      return navigator.canShare({ files: [file] });
    } catch (e) {
      return false;
    }
  }

  async function shareFile(blob, filename, title) {
    const file = new File([blob], filename, { type: 'image/jpeg' });
    await navigator.share({ files: [file], title: title || filename });
  }

  window.Camera = {
    startCamera,
    attachStream,
    stopStream,
    capture,
    captureFromCanvas,
    download,
    canShareFile,
    shareFile,
  };
})();
