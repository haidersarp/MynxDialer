FROM debian:bullseye-slim
ENV DEBIAN_FRONTEND=noninteractive

# Install Asterisk 18 from Debian Bullseye — has proper WebSocket support
RUN apt-get update && apt-get install -y \
    asterisk \
    asterisk-config \
    asterisk-modules \
    asterisk-core-sounds-en \
    asterisk-moh-opsound-wav \
    net-tools curl \
    && rm -rf /var/lib/apt/lists/*

# Try to load the WS module at startup via modules.conf
RUN echo '[modules]' > /etc/asterisk/modules.conf && \
    echo 'autoload=yes' >> /etc/asterisk/modules.conf && \
    echo 'noload=chan_sip.so' >> /etc/asterisk/modules.conf && \
    echo 'load=res_pjsip_transport_websocket.so' >> /etc/asterisk/modules.conf

# Copy our configs
COPY conf/ /etc/asterisk/

# Generate DTLS/TLS certificate for WebRTC
RUN openssl req -new -x509 -days 3650 -nodes \
    -subj "/CN=MynxDialer/O=MynxDialer/C=GB" \
    -keyout /etc/asterisk/dtls.key \
    -out /etc/asterisk/dtls.crt && \
    chmod 600 /etc/asterisk/dtls.key

RUN chown -R asterisk:asterisk /etc/asterisk/ && \
    chown -R asterisk:asterisk /var/spool/asterisk/ && \
    chown -R asterisk:asterisk /var/log/asterisk/ && \
    mkdir -p /var/spool/asterisk/monitor && \
    chown -R asterisk:asterisk /var/spool/asterisk/monitor

EXPOSE 5060/udp 5060/tcp 8088/tcp 5038/tcp 10000-10100/udp

CMD ["asterisk", "-f", "-vvv"]
