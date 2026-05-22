FROM rust:1.83-alpine AS builder

RUN apk add --no-cache build-base ca-certificates cmake musl-dev perl
WORKDIR /app

COPY Cargo.toml ./
COPY migrations ./migrations
COPY src ./src

RUN cargo build --release --target x86_64-unknown-linux-musl

FROM scratch AS runtime

COPY --from=builder /app/target/x86_64-unknown-linux-musl/release/diminspect-backend /diminspect-backend
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

ENV HOST=0.0.0.0
ENV PORT=4000
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD ["/diminspect-backend", "--healthcheck"]
ENTRYPOINT ["/diminspect-backend"]
