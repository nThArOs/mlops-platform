FROM node:22-alpine AS ui
WORKDIR /ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci
COPY ui/ ./
RUN npm run build

FROM python:3.11-slim
# the Docker CLI (Apache-2.0) drives the host's daemon through the mounted socket
ARG DOCKER_CLI=27.3.1
RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates \
    && curl -fsSL https://download.docker.com/linux/static/stable/x86_64/docker-${DOCKER_CLI}.tgz \
       | tar -xz -C /usr/local/bin --strip-components=1 docker/docker \
    && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/* \
    && git config --system --add safe.directory '*'
WORKDIR /platform
COPY pyproject.toml ./
COPY mlops ./mlops
RUN pip install --no-cache-dir -e .
COPY configs ./configs
COPY --from=ui /ui/dist ./ui/dist
ENV MLOPS_CONFIG=configs/platform.docker.yaml PYTHONUNBUFFERED=1 MLFLOW_DISABLE_AGENT_HINT=1
CMD ["mlops", "api", "--host", "0.0.0.0", "--port", "8000"]
