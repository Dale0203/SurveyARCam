// mock.js — ?mock=1 模擬 GPS / 羅盤 / 相機，讓桌機 Chrome 走通整條流程
(function () {
  'use strict';

  function isMock() {
    const p = new URLSearchParams(location.search);
    return p.get('mock') === '1' || p.has('mock');
  }

  // 假 GPS：從第一個點位西南方約 200m 出發，每秒朝該點移動 5m。
  // firstPoint: {lat,lng}；onUpdate({lat,lng,accuracy})
  function MockGeo(firstPoint, onUpdate) {
    this.target = firstPoint;
    this.onUpdate = onUpdate;
    // 西南方 = 從目標看 bearing 225；把起點放在該方向 200m
    const start = window.Geo.destination(firstPoint.lat, firstPoint.lng, 225, 200);
    this.pos = { lat: start.lat, lng: start.lng };
    this.timer = null;
  }
  MockGeo.prototype.start = function () {
    const tick = () => {
      const d = window.Geo.haversine(
        this.pos.lat, this.pos.lng, this.target.lat, this.target.lng
      );
      if (d > 1) {
        const br = window.Geo.bearing(
          this.pos.lat, this.pos.lng, this.target.lat, this.target.lng
        );
        const step = Math.min(5, d);
        this.pos = window.Geo.destination(this.pos.lat, this.pos.lng, br, step);
      }
      this.onUpdate({ lat: this.pos.lat, lng: this.pos.lng, accuracy: 8 });
    };
    tick();
    this.timer = setInterval(tick, 1000);
  };
  MockGeo.prototype.stop = function () {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  };

  // 假 heading：每秒 +10°；假 pitch：緩慢正弦擺動，方便桌機測試觀察標記垂直移動
  function MockCompass(onHeading) {
    this.onHeading = onHeading;
    this.h = 0;
    this.t = 0;
    this.pitch = 0;
    this.timer = null;
    this.available = true;
    this.filter = new window.Geo.HeadingFilter(0.5);
  }
  MockCompass.prototype.requestPermission = async function () { return true; };
  MockCompass.prototype.start = function () {
    const tick = () => {
      this.h = (this.h + 10) % 360;
      this.t += 1;
      this.pitch = 15 * Math.sin(this.t / 4); // -15..15 度緩慢擺動
      this.onHeading(this.filter.push(this.h), this.h, this.pitch);
    };
    tick();
    this.timer = setInterval(tick, 1000);
  };
  MockCompass.prototype.stop = function () {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  };

  // 假相機：灰底 + 移動網格 + 大字 MOCK CAMERA，用 captureStream 當 video 來源
  function MockCameraStream() {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');
    let off = 0;
    function draw() {
      const w = canvas.width, h = canvas.height;
      ctx.fillStyle = '#555';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 2;
      const gap = 60;
      off = (off + 2) % gap;
      for (let x = -gap + off; x < w; x += gap) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let y = -gap + off; y < h; y += gap) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
      ctx.fillStyle = '#fff';
      ctx.font = "bold 90px 'Microsoft JhengHei',sans-serif";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('MOCK CAMERA', w / 2, h / 2);
      ctx.textAlign = 'start';
    }
    draw();
    const timer = setInterval(draw, 40);
    const stream = canvas.captureStream(25);
    // 讓 stopStream 也能停掉繪製迴圈
    const origTracks = stream.getTracks();
    stream.__mockTimer = timer;
    stream.__mockCanvas = canvas;
    const origStop = stream.getTracks.bind(stream);
    // 包裝每個 track 的 stop 清 interval
    origTracks.forEach((t) => {
      const os = t.stop.bind(t);
      t.stop = function () { clearInterval(timer); os(); };
    });
    return stream;
  }

  window.Mock = { isMock, MockGeo, MockCompass, MockCameraStream };
})();
