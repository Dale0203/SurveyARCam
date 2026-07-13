// geo.js — 距離/方位角計算、GPS watch、羅盤（含低通濾波與 iOS/Android 分流）
// 全部掛在 window.Geo 命名空間，供其他模組使用。

(function () {
  'use strict';

  const R = 6371000; // 地球半徑（公尺）
  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;

  // haversine 距離（公尺）
  function haversine(lat1, lng1, lat2, lng2) {
    const dLat = rad(lat2 - lat1);
    const dLng = rad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  // 從 (lat1,lng1) 指向 (lat2,lng2) 的真北方位角（0–359.999）
  function bearing(lat1, lng1, lat2, lng2) {
    const p1 = rad(lat1), p2 = rad(lat2);
    const dl = rad(lng2 - lng1);
    const y = Math.sin(dl) * Math.cos(p2);
    const x =
      Math.cos(p1) * Math.sin(p2) -
      Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }

  // 由起點沿 bearing 走 distM 公尺後的座標（mock 用）
  function destination(lat, lng, bearingDeg, distM) {
    const d = distM / R;
    const br = rad(bearingDeg);
    const p1 = rad(lat), l1 = rad(lng);
    const p2 = Math.asin(
      Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(br)
    );
    const l2 =
      l1 +
      Math.atan2(
        Math.sin(br) * Math.sin(d) * Math.cos(p1),
        Math.cos(d) - Math.sin(p1) * Math.sin(p2)
      );
    return { lat: deg(p2), lng: ((deg(l2) + 540) % 360) - 180 };
  }

  // 最短角差 (a - b)，回傳 -180..180
  function angleDiff(a, b) {
    let d = ((a - b + 540) % 360) - 180;
    return d;
  }

  const DIRS8_CN = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
  const DIRS8_EN = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

  function dir8Index(deg) {
    return Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  }
  function toEightDirCN(deg) {
    return DIRS8_CN[dir8Index(deg)];
  }
  function toEightDirEN(deg) {
    return DIRS8_EN[dir8Index(deg)];
  }

  // 角度低通濾波器：用單位向量 EMA，正確處理 359↔0 環繞
  function HeadingFilter(alpha) {
    this.a = alpha || 0.2;
    this.s = null;
    this.c = null;
  }
  HeadingFilter.prototype.push = function (deg) {
    const r = rad(deg);
    const s = Math.sin(r), c = Math.cos(r);
    if (this.s === null) {
      this.s = s;
      this.c = c;
    } else {
      this.s += this.a * (s - this.s);
      this.c += this.a * (c - this.c);
    }
    return (deg2(Math.atan2(this.s, this.c)) + 360) % 360;
    function deg2(r2) { return (r2 * 180) / Math.PI; }
  };

  // ---- GPS watch ----
  // onUpdate({lat,lng,accuracy}), onError(errObj)
  function GeoWatch(onUpdate, onError) {
    this.onUpdate = onUpdate;
    this.onError = onError;
    this.id = null;
  }
  GeoWatch.prototype.start = function () {
    if (!('geolocation' in navigator)) {
      this.onError && this.onError({ code: -1, message: '此裝置不支援定位' });
      return;
    }
    this.id = navigator.geolocation.watchPosition(
      (pos) =>
        this.onUpdate({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      (err) => this.onError && this.onError(err),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
  };
  GeoWatch.prototype.stop = function () {
    if (this.id !== null) {
      navigator.geolocation.clearWatch(this.id);
      this.id = null;
    }
  };

  // ---- 羅盤 ----
  // onHeading(filteredDeg, rawDeg, pitchDeg)
  // pitchDeg：簡化俯仰角，0=水平、負=往下看、正=往上看（供 AR 浮動標記垂直定位用，非精確高程）
  function Compass(onHeading) {
    this.onHeading = onHeading;
    this.filter = new HeadingFilter(0.25);
    this.pitchAlpha = 0.25;
    this.pitchFiltered = null;
    this.pitch = null;
    this.started = false;
    this._handler = this._handler.bind(this);
    this.available = false;
  }
  // iOS 需由使用者手勢觸發；回傳 Promise<boolean> 是否取得授權
  Compass.prototype.requestPermission = async function () {
    const D = window.DeviceOrientationEvent;
    if (D && typeof D.requestPermission === 'function') {
      try {
        const res = await D.requestPermission();
        return res === 'granted';
      } catch (e) {
        return false;
      }
    }
    return true; // 非 iOS 或不需授權
  };
  Compass.prototype.start = function () {
    if (this.started) return;
    this.started = true;
    // Android 優先 deviceorientationabsolute；iOS 用 deviceorientation + webkitCompassHeading
    window.addEventListener('deviceorientationabsolute', this._handler, true);
    window.addEventListener('deviceorientation', this._handler, true);
  };
  Compass.prototype.stop = function () {
    if (!this.started) return;
    this.started = false;
    window.removeEventListener('deviceorientationabsolute', this._handler, true);
    window.removeEventListener('deviceorientation', this._handler, true);
  };
  Compass.prototype._handler = function (e) {
    let heading = null;
    if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) {
      // iOS：已是順時針、真北
      heading = e.webkitCompassHeading;
    } else if (typeof e.alpha === 'number' && e.alpha !== null) {
      // Android：alpha 逆時針 → 換算真北順時針
      heading = (360 - e.alpha) % 360;
    }
    if (heading === null || isNaN(heading)) return;
    this.available = true;
    const filtered = this.filter.push(heading);

    // 俯仰角（簡化）：e.beta 手機直立握持時約 90，往下看變小、往上看變大
    let pitch = this.pitch;
    if (typeof e.beta === 'number' && !isNaN(e.beta)) {
      let raw = e.beta - 90;
      raw = Math.max(-90, Math.min(90, raw));
      pitch = this.pitchFiltered === null
        ? raw
        : this.pitchFiltered + this.pitchAlpha * (raw - this.pitchFiltered);
      this.pitchFiltered = pitch;
    }
    this.pitch = pitch;

    this.onHeading(filtered, heading, pitch);
  };

  window.Geo = {
    haversine,
    bearing,
    destination,
    angleDiff,
    toEightDirCN,
    toEightDirEN,
    HeadingFilter,
    GeoWatch,
    Compass,
  };
})();
