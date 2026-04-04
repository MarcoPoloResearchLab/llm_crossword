# syntax=docker/dockerfile:1
ARG GO_VERSION=1.26

FROM --platform=$BUILDPLATFORM golang:${GO_VERSION} AS build

ARG TARGETOS
ARG TARGETARCH
ARG GO_VERSION

ENV CGO_ENABLED=0

WORKDIR /app
COPY go.mod go.sum ./
RUN expected_go_version="$(awk '/^go / { print $2; exit }' go.mod | cut -d. -f1,2)" \
	&& [ -n "${expected_go_version}" ] \
	&& [ "${expected_go_version}" = "${GO_VERSION}" ] \
	|| (echo "go.mod requires Go ${expected_go_version}, but Dockerfile GO_VERSION=${GO_VERSION}" >&2; exit 1)
RUN go mod download
COPY . .
RUN GOOS="${TARGETOS:-$(go env GOOS)}" GOARCH="${TARGETARCH:-$(go env GOARCH)}" go build -o /out/crossword-api ./cmd/crossword-api

FROM alpine:3.21

RUN apk add --no-cache ca-certificates
COPY --from=build /out/crossword-api /usr/local/bin/crossword-api

ENV CROSSWORDAPI_LISTEN_ADDR=:9090

ENTRYPOINT ["/usr/local/bin/crossword-api"]
