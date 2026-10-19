# --- Build stage ---------------------------------------------------------
# micromdm/scep veröffentlicht kein Container-Image (weder Docker Hub noch
# GHCR, geprüft am 19.10.2026), deshalb bauen wir es selbst. Die Version ist
# gepinnt: ein SCEP-Server stellt die Identitätszertifikate aus, mit denen
# sich jedes Telefon gegenüber NanoMDM ausweist — der soll sich nicht
# nebenbei ändern.
FROM golang:1.27-alpine AS build
ENV CGO_ENABLED=0
RUN go install github.com/micromdm/scep/v2/cmd/scepserver@v2.3.0

# --- Runtime -------------------------------------------------------------
FROM alpine:3.24
COPY --from=build /go/bin/scepserver /usr/local/bin/scepserver

# Unprivilegiert wie Backend und Web. Das Depot (CA-Schlüssel, ausgestellte
# Zertifikate, Seriennummern) wird zur Laufzeit beschrieben und muss dieser
# uid gehören — siehe docs/MDM-SETUP.md.
RUN adduser -S -u 10001 -D scep
USER 10001
ENTRYPOINT ["/usr/local/bin/scepserver"]
