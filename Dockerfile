# syntax=docker/dockerfile:1
# SysTorch multi-stage image build.
#   stage ui   — npm ci + tsc + vite build → dist
#   stage rs   — cargo build --release（default-members = daemon bin）
#   runtime    — 精简 Debian + 二进制 + dist 静态托管（**ServeDir 同源**，
#                选型理由见 docs/deployment.md：单进程免 nginx、同源免 CORS）
#
# 静态托管与配置初始化走 Dockerfile 内联 CMD（仓库铁律：不新增 scripts/ 文件）。

# ─── stage 1 · UI ───────────────────────────────────────────────────
FROM node:22-alpine AS ui
WORKDIR /src/ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci
COPY ui/ ./
# ts-rs 生成类型从 daemon crate 引用共享 JsonValue；独立 UI 构建阶段
# 也需要把它按仓库相对路径复制进构建上下文。
COPY rs/crates/systorch-daemon/bindings/ /src/rs/crates/systorch-daemon/bindings/
# npm run build = tsc --noEmit && vite build（契约级类型门禁随镜像构建生效）
RUN npm run build

# ─── stage 2 · Rust release ────────────────────────────────────────
FROM rust:1-bookworm AS rust-base
FROM rust-base AS rs
WORKDIR /src
ARG SYSTORCH_BUILD_REVISION
ARG JEV_BUILD_REVISION
# 仅用于构建网络诊断；默认沿用 Cargo 行为，运行镜像不继承这些参数。
ARG CARGO_HTTP_MULTIPLEXING=true
ARG CARGO_HTTP_TIMEOUT=30
ARG CARGO_NET_RETRY=3
COPY rs/ ./rs/
# --locked：锁文件与 Cargo.toml 同步才放行（可复现构建）；rs/Cargo.lock 已入库
# 已有完整缓存时离线确认；缺失时才有界联网，避免每次重建都刷新索引。
# 包完整性仍由 Cargo 按锁文件校验，编译阶段离线进行。
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    (cargo fetch --locked --offline --manifest-path rs/Cargo.toml \
     || timeout 300 cargo fetch --locked --manifest-path rs/Cargo.toml)
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/rs/target \
    cargo build --release --locked --offline --manifest-path rs/Cargo.toml \
    && cp /src/rs/target/release/systorch-daemon /usr/local/bin/systorch-daemon

# ─── stage 3 · runtime ─────────────────────────────────────────────
FROM debian:bookworm-slim
# HTTPS 上游信任根从相同 Debian 系列的 Rust 构建镜像复制；运行镜像无需 apt 网络访问。
COPY --from=rust-base /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

COPY --from=rs /usr/local/bin/systorch-daemon /usr/local/bin/systorch-daemon
COPY --from=ui /src/ui/dist /app/ui/dist
# Seed config only when neither the new nor legacy config path was supplied.
COPY rs/providers.example.toml /app/providers.example.toml

# New SYSTORCH_* variables are canonical. Legacy JEV_* names remain accepted by the daemon.

EXPOSE 11435
# /health is public in both modes; the daemon healthcheck verifies service identity and API revision.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD ["/usr/local/bin/systorch-daemon", "--healthcheck"]

# Resolve defaults without overriding user-supplied canonical or legacy environment variables.
CMD ["sh", "-ec", "CONFIG_PATH=\"${SYSTORCH_CONFIG:-${JEV_SWITCH_CONFIG:-/data/providers.toml}}\"; DATA_DIR=\"${SYSTORCH_DATA_DIR:-${JEV_SWITCH_DATA_DIR:-/data}}\"; UI_DIST=\"${SYSTORCH_UI_DIST:-${JEV_UI_DIST:-/app/ui/dist}}\"; if [ -z \"${SYSTORCH_MODE:-${JEV_SWITCH_MODE:-}}\" ]; then export SYSTORCH_MODE=cloud; fi; export SYSTORCH_CONFIG=\"$CONFIG_PATH\" SYSTORCH_DATA_DIR=\"$DATA_DIR\" SYSTORCH_UI_DIST=\"$UI_DIST\"; mkdir -p \"$(dirname \"$CONFIG_PATH\")\" \"$DATA_DIR\"; if [ ! -f \"$CONFIG_PATH\" ]; then cp /app/providers.example.toml \"$CONFIG_PATH\"; chmod 600 \"$CONFIG_PATH\"; fi; exec /usr/local/bin/systorch-daemon"]
