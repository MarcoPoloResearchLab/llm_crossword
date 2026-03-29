# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM golang:1.25 AS build

ARG TARGETOS
ARG TARGETARCH

ENV CGO_ENABLED=0

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN GOOS="${TARGETOS:-$(go env GOOS)}" GOARCH="${TARGETARCH:-$(go env GOARCH)}" go build -o /out/crossword-api ./cmd/crossword-api

FROM alpine:3.21

RUN apk add --no-cache ca-certificates
COPY --from=build /out/crossword-api /usr/local/bin/crossword-api

ENV CROSSWORDAPI_LISTEN_ADDR=:9090

ENTRYPOINT ["/usr/local/bin/crossword-api"]
