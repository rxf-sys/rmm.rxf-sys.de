# scepserver for the MDM profile — issues the device identity certificates
# that NanoMDM verifies against (NANOMDM_CA=/mdm/ca.pem). micromdm/scep
# publishes no container image, so this builds the pinned release from source.
# Setup and operation: docs/MDM-SETUP.md, part 4.
FROM golang:1-alpine AS build
ARG SCEP_VERSION=v2.3.0
ENV CGO_ENABLED=0
RUN go install github.com/micromdm/scep/v2/cmd/scepserver@${SCEP_VERSION}
# CSR verifier (-csrverifierexec): asks the backend whether a challenge belongs
# to an open enrollment. Standard library only. Its tests run here because no
# CI job builds this directory — an image with a broken verifier never exists.
WORKDIR /src/verifier
COPY verifier/ ./
RUN go vet ./... && go test ./... && go build -trimpath -o /go/bin/scep-csr-verifier .

FROM alpine:3
COPY --from=build /go/bin/scepserver /usr/local/bin/scepserver
COPY --from=build /go/bin/scep-csr-verifier /usr/local/bin/scep-csr-verifier
COPY entrypoint.sh /usr/local/bin/scep-entrypoint
RUN chmod 0755 /usr/local/bin/scep-entrypoint
# Same uid as backend and web. The depot is a bind mount and must belong to
# this uid: chown -R 10001:10001 infrastructure/scep-depot
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/scep-entrypoint"]
