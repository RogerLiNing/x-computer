# Development fallback when the official Playwright image download is slow.
FROM x-computer-sandbox:latest
USER root
ARG ALPINE_MIRROR=https://dl-cdn.alpinelinux.org/alpine
RUN sed -i "s|https://dl-cdn.alpinelinux.org/alpine|${ALPINE_MIRROR}|g" /etc/apk/repositories && apk add --no-cache chromium font-noto-cjk
WORKDIR /opt/x-browser
RUN npm install --omit=dev playwright-core@1.58.2
COPY docker/browser-worker.mjs docker/browser-client.mjs docker/browser-network.mjs ./
ENV X_BROWSER_EXECUTABLE=/usr/bin/chromium
USER 1000:1000
WORKDIR /workspace
CMD ["node", "/opt/x-browser/browser-worker.mjs"]
