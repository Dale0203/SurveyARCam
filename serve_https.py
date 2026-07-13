# serve_https.py — 開發用 HTTPS 伺服器（手機實機測試用）
# 相機/GPS/羅盤需要 HTTPS，本腳本自動產生自簽憑證並在區網開 HTTPS。
# 用法：python serve_https.py [port]（預設 8443）
# 手機（同一 Wi-Fi）開 https://<本機IP>:8443 → 憑證警告選「繼續前往」。
import os
import socket
import ssl
import subprocess
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
CERT_DIR = os.path.join(ROOT, "dev_cert")
CERT = os.path.join(CERT_DIR, "cert.pem")
KEY = os.path.join(CERT_DIR, "key.pem")
GIT_OPENSSL = r"C:\Program Files\Git\usr\bin\openssl.exe"


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def make_cert(ip):
    os.makedirs(CERT_DIR, exist_ok=True)
    try:
        _make_cert_cryptography(ip)
        return
    except ImportError:
        pass
    _make_cert_openssl(ip)


def _make_cert_cryptography(ip):
    import datetime
    import ipaddress

    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "SurveyARCam-dev")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + datetime.timedelta(days=365))
        .add_extension(
            x509.SubjectAlternativeName(
                [
                    x509.DNSName("localhost"),
                    x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
                    x509.IPAddress(ipaddress.ip_address(ip)),
                ]
            ),
            critical=False,
        )
        .sign(key, hashes.SHA256())
    )
    with open(KEY, "wb") as f:
        f.write(
            key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.TraditionalOpenSSL,
                serialization.NoEncryption(),
            )
        )
    with open(CERT, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))


def _make_cert_openssl(ip):
    exe = GIT_OPENSSL if os.path.exists(GIT_OPENSSL) else "openssl"
    subprocess.run(
        [
            exe, "req", "-x509", "-newkey", "rsa:2048",
            "-keyout", KEY, "-out", CERT, "-days", "365", "-nodes",
            "-subj", "//CN=SurveyARCam-dev",  # 雙斜線避開 MSYS 路徑轉換
            "-addext", f"subjectAltName=DNS:localhost,IP:127.0.0.1,IP:{ip}",
        ],
        check=True,
    )


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")  # 開發期避免手機吃舊快取
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8443
    ip = lan_ip()
    if not (os.path.exists(CERT) and os.path.exists(KEY)):
        print("產生自簽憑證…")
        make_cert(ip)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(CERT, KEY)
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    print(f"HTTPS 伺服器已啟動：")
    print(f"  本機測試  https://localhost:{port}/?mock=1")
    print(f"  手機實測  https://{ip}:{port}/   （同一 Wi-Fi，憑證警告選繼續）")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
