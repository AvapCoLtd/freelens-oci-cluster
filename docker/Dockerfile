# pnpm バージョンを固定し `make build` の再現性を保つ。
FROM node:24-slim

RUN npm install -g pnpm@11.10.0

# make は --user で uid/gid を上書きするため、この ARG は make 経由では効かない: 直接 docker run する場合のみ意味を持つ。
ARG UID=1000
ARG GID=1000
RUN if [ "${UID}" != "1000" ] || [ "${GID}" != "1000" ]; then \
      groupmod -g "${GID}" node && usermod -u "${UID}" -g "${GID}" node; \
    fi

USER node
WORKDIR /work
