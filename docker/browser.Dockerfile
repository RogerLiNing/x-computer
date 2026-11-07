# Separate image: the ordinary shell sandbox remains available without a browser.
FROM mcr.microsoft.com/playwright:v1.58.2-noble
USER root
WORKDIR /opt/x-browser
RUN npm install --omit=dev playwright-core@1.58.2
COPY docker/browser-worker.mjs docker/browser-client.mjs docker/browser-network.mjs ./
ENV HOME=/workspace
USER 1000:1000
WORKDIR /workspace
CMD ["node", "/opt/x-browser/browser-worker.mjs"]
