# The rented sandbox. Doubles as the microVM rootfs: fc-rootfs.sh exports this image to ext4 and
# Firecracker boots it with init=/start.sh, so start.sh must also work as PID 1 (it does).
FROM python:3.11-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssh-server \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /run/sshd \
 && sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config

COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 22
CMD ["/start.sh"]
