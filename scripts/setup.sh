#!/bin/bash
#==============================================================================
# MynxDialer Predictive Dialer — Ubuntu/OVH Server Setup Script
# Run as root on a fresh Ubuntu 22.04 server
#==============================================================================
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERR]${NC}  $1"; exit 1; }

[[ $EUID -ne 0 ]] && err "Run as root: sudo bash setup.sh"

SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
info "Server IP detected: $SERVER_IP"

#──────────────────────────────────────────────────────────────────────────────
# 1. System updates
#──────────────────────────────────────────────────────────────────────────────
info "Updating system..."
apt-get update -qq && apt-get upgrade -y -qq
apt-get install -y -qq curl wget git build-essential software-properties-common \
  apt-transport-https ca-certificates gnupg lsb-release ufw unzip net-tools

#──────────────────────────────────────────────────────────────────────────────
# 2. Firewall
#──────────────────────────────────────────────────────────────────────────────
info "Configuring firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 3000/tcp    # Admin UI
ufw allow 3001/tcp    # Agent UI
ufw allow 5000/tcp    # Backend API
ufw allow 5060/tcp    # SIP TCP
ufw allow 5060/udp    # SIP UDP
ufw allow 5061/tcp    # SIP TLS
ufw allow 8088/tcp    # Asterisk HTTP
ufw allow 8089/tcp    # Asterisk WSS (WebRTC)
ufw allow 10000:20000/udp  # RTP media
ufw allow 3306/tcp    # MySQL (restrict later)
ufw --force enable
info "Firewall configured"

#──────────────────────────────────────────────────────────────────────────────
# 3. Node.js 20
#──────────────────────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  info "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
info "Node.js: $(node --version)"

#──────────────────────────────────────────────────────────────────────────────
# 4. Docker & Docker Compose
#──────────────────────────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  info "Installing Docker..."
  curl -fsSL https://get.docker.com | bash
  systemctl enable docker
  systemctl start docker
fi
if ! command -v docker-compose &>/dev/null; then
  info "Installing Docker Compose..."
  curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)" -o /usr/local/bin/docker-compose
  chmod +x /usr/local/bin/docker-compose
fi
info "Docker: $(docker --version)"
info "Docker Compose: $(docker-compose --version)"

#──────────────────────────────────────────────────────────────────────────────
# 5. Asterisk 20
#──────────────────────────────────────────────────────────────────────────────
if ! command -v asterisk &>/dev/null; then
  info "Installing Asterisk dependencies..."
  apt-get install -y -qq libedit-dev libjansson-dev libxml2-dev libsqlite3-dev \
    libssl-dev libsrtp2-dev liburiparser-dev libxslt1-dev uuid-dev xmlstarlet \
    libopus-dev libvpx-dev sox mpg123

  info "Downloading Asterisk 20..."
  cd /usr/src
  wget -q "https://downloads.asterisk.org/pub/telephony/asterisk/asterisk-20-current.tar.gz"
  tar xzf asterisk-20-current.tar.gz
  cd asterisk-20*/

  info "Configuring Asterisk..."
  contrib/scripts/get_mp3_source.sh || true
  ./configure --with-jansson-bundled --with-pjproject-bundled 2>&1 | tail -5

  info "Enabling modules..."
  make menuselect.makeopts
  menuselect/menuselect --enable chan_pjsip \
    --enable res_pjsip \
    --enable res_pjsip_session \
    --enable res_pjsip_transport_websocket \
    --enable res_srtp \
    --enable codec_opus \
    --enable codec_g722 \
    --enable app_queue \
    --enable app_confbridge \
    --enable res_agi \
    --enable func_callerid \
    menuselect.makeopts

  info "Compiling Asterisk (this takes 5-10 minutes)..."
  make -j$(nproc) 2>&1 | tail -20
  make install
  make samples
  make config
  ldconfig

  info "Asterisk installed: $(asterisk --version)"
fi

#──────────────────────────────────────────────────────────────────────────────
# 6. SSL certificate for Asterisk WebRTC (self-signed)
#──────────────────────────────────────────────────────────────────────────────
info "Generating SSL certificate for Asterisk..."
mkdir -p /etc/asterisk/keys
if [ ! -f /etc/asterisk/keys/asterisk.crt ]; then
  openssl req -new -x509 -days 3650 -nodes \
    -subj "/C=US/ST=State/L=City/O=Dialer/CN=${SERVER_IP}" \
    -addext "subjectAltName=IP:${SERVER_IP}" \
    -keyout /etc/asterisk/keys/asterisk.key \
    -out /etc/asterisk/keys/asterisk.crt
  chmod 600 /etc/asterisk/keys/asterisk.key
  info "Self-signed certificate created"
fi

#──────────────────────────────────────────────────────────────────────────────
# 7. Copy Asterisk config files
#──────────────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIALER_DIR="$(dirname "$SCRIPT_DIR")"

if [ -d "$DIALER_DIR/asterisk/conf" ]; then
  info "Copying Asterisk config files..."
  cp "$DIALER_DIR/asterisk/conf/pjsip.conf" /etc/asterisk/pjsip.conf
  cp "$DIALER_DIR/asterisk/conf/extensions.conf" /etc/asterisk/extensions.conf
  cp "$DIALER_DIR/asterisk/conf/manager.conf" /etc/asterisk/manager.conf
  cp "$DIALER_DIR/asterisk/conf/http.conf" /etc/asterisk/http.conf
  cp "$DIALER_DIR/asterisk/conf/queues.conf" /etc/asterisk/queues.conf
  cp "$DIALER_DIR/asterisk/conf/rtp.conf" /etc/asterisk/rtp.conf

  # Update config with server IP
  sed -i "s/YOUR_SERVER_PUBLIC_IP/${SERVER_IP}/g" /etc/asterisk/*.conf 2>/dev/null || true

  chown -R asterisk:asterisk /etc/asterisk/
  info "Asterisk configs installed"
fi

#──────────────────────────────────────────────────────────────────────────────
# 8. Start Asterisk
#──────────────────────────────────────────────────────────────────────────────
info "Starting Asterisk..."
systemctl enable asterisk
systemctl restart asterisk || service asterisk restart
sleep 3
if systemctl is-active --quiet asterisk; then
  info "Asterisk is running"
else
  warn "Asterisk may not have started - check: journalctl -u asterisk -n 50"
fi

#──────────────────────────────────────────────────────────────────────────────
# 9. Setup .env file
#──────────────────────────────────────────────────────────────────────────────
if [ ! -f "$DIALER_DIR/.env" ]; then
  info "Creating .env file..."
  cp "$DIALER_DIR/.env.example" "$DIALER_DIR/.env"

  # Generate JWT secret
  JWT_SECRET=$(openssl rand -hex 64)
  sed -i "s/CHANGE_THIS_TO_A_LONG_RANDOM_STRING_64_CHARS_MIN/${JWT_SECRET}/g" "$DIALER_DIR/.env"
  sed -i "s/YOUR_SERVER_PUBLIC_IP/${SERVER_IP}/g" "$DIALER_DIR/.env"
  sed -i "s/YOUR_SERVER_IP/${SERVER_IP}/g" "$DIALER_DIR/.env"

  # Update AMI host to host-gateway for Docker
  sed -i "s/AMI_HOST=172.17.0.1/AMI_HOST=172.17.0.1/g" "$DIALER_DIR/.env"

  info ".env file created — review and update as needed"
fi

#──────────────────────────────────────────────────────────────────────────────
# 10. Build and start Docker services
#──────────────────────────────────────────────────────────────────────────────
info "Building Docker images (this may take 5-10 minutes)..."
cd "$DIALER_DIR"
docker-compose build --no-cache

info "Starting Docker services..."
docker-compose up -d

sleep 5
info "Docker services status:"
docker-compose ps

#──────────────────────────────────────────────────────────────────────────────
# Done!
#──────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              MynxDialer Setup Complete!                       ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  Admin UI:   http://${SERVER_IP}:3000                        ║${NC}"
echo -e "${GREEN}║  Agent UI:   http://${SERVER_IP}:3001                        ║${NC}"
echo -e "${GREEN}║  API:        http://${SERVER_IP}:5000                        ║${NC}"
echo -e "${GREEN}║                                                              ║${NC}"
echo -e "${GREEN}║  Default login: admin / admin123                             ║${NC}"
echo -e "${GREEN}║                                                              ║${NC}"
echo -e "${GREEN}║  IMPORTANT NEXT STEPS:                                       ║${NC}"
echo -e "${GREEN}║  1. Change the admin password immediately!                   ║${NC}"
echo -e "${GREEN}║  2. Update .env with your SIP trunk credentials              ║${NC}"
echo -e "${GREEN}║  3. Update asterisk/conf/pjsip.conf with your trunk          ║${NC}"
echo -e "${GREEN}║  4. Set up SSL/TLS for production (Let's Encrypt)            ║${NC}"
echo -e "${GREEN}║  5. Add agent extensions in pjsip.conf                       ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
warn "For WebRTC (JsSIP) to work, you need valid SSL on port 8089."
warn "For testing, you can use the self-signed cert (browsers will warn)."
warn "For production, use: certbot --standalone -d yourdomain.com"
